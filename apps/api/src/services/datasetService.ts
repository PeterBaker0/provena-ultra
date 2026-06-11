/**
 * Dataset domain service (legacy data-store-api behaviour). Datasets are
 * registry items managed through this service - the legacy proxy-route
 * indirection is replaced by direct in-process calls.
 */
import {
  ADMIN_ROLE,
  DATASET_READ_ROLE,
  DATASET_WRITE_ROLE,
  METADATA_READ_ROLE,
} from "@provena/interfaces";
import type { DatasetMetadata } from "@provena/interfaces/types/RegistryModels";
import { evaluateUserAccess, type AuthenticatedUser } from "@provena/auth";
import { ensureSidecars, type StoredItem } from "@provena/db";
import { constructS3Path, findS3Path, metadataKeyForPath, type S3Location } from "@provena/storage";
import { submitJob } from "@provena/jobs";
import { getContainer } from "../container.js";
import { badRequest, forbidden, unauthorized } from "../errors.js";
import * as registry from "./registryService.js";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const DATA_READ_ROLES = [DATASET_READ_ROLE, DATASET_WRITE_ROLE, ADMIN_ROLE];
const DATA_WRITE_ROLES = [DATASET_WRITE_ROLE, ADMIN_ROLE];

/* --------------------------- field validation ---------------------------- */

const validateOptionallyRequiredCheck = (
  check: { relevant?: boolean; obtained?: boolean },
  name: string,
): void => {
  if (check.relevant && !check.obtained) {
    throw new Error(
      `${name} is marked as relevant but the required consent/approval has not been obtained.`,
    );
  }
};

/** Port of legacy `validate_fields` (metadata_helpers.py). */
export const validateCollectionFormatFields = (cf: DatasetMetadata): void => {
  const published = cf.dataset_info.published_date?.value;
  const created = cf.dataset_info.created_date?.value;
  if (published && created && published < created) {
    throw new Error(
      `Published date (${published}) cannot be before the created date (${created}).`,
    );
  }
  validateOptionallyRequiredCheck(
    cf.approvals.ethics_registration,
    "Dataset Registration Ethics and Privacy",
  );
  validateOptionallyRequiredCheck(cf.approvals.ethics_access, "Dataset Access Ethics and Privacy");
  validateOptionallyRequiredCheck(
    cf.approvals.indigenous_knowledge,
    "Indigenous Knowledge and Consent",
  );
  validateOptionallyRequiredCheck(cf.approvals.export_controls, "Export Controls");
};

/** Check linked registry entities exist and have the right subtypes. */
export const validateLinkedEntities = async (cf: DatasetMetadata): Promise<void> => {
  const { items } = getContainer();
  const checks: { id: string; subtype: string; label: string }[] = [
    { id: cf.associations.organisation_id, subtype: "ORGANISATION", label: "Record Creator Organisation" },
    { id: cf.dataset_info.publisher_id, subtype: "ORGANISATION", label: "Publisher" },
  ];
  if (cf.associations.data_custodian_id) {
    checks.push({
      id: cf.associations.data_custodian_id,
      subtype: "PERSON",
      label: "Dataset Custodian",
    });
  }
  for (const check of checks) {
    const stored = await items.fetchItem(check.id);
    if (!stored) {
      throw new Error(
        `${check.label} with id ${check.id} does not exist in the registry.`,
      );
    }
    if (stored.base.itemSubType !== check.subtype) {
      throw new Error(
        `${check.label} with id ${check.id} has subtype ${stored.base.itemSubType}, expected ${check.subtype}.`,
      );
    }
  }
};

/* ------------------------------ domain info ------------------------------ */

const buildDatasetDomainInfo = (
  cf: DatasetMetadata,
  s3: S3Location,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> => ({
  display_name: cf.dataset_info.name,
  collection_format: cf,
  s3,
  release_history: previous?.release_history ?? [],
  release_status: previous?.release_status ?? "NOT_RELEASED",
  release_approver: previous?.release_approver ?? null,
  release_timestamp: previous?.release_timestamp ?? null,
  access_info_uri: cf.dataset_info.access_info.uri ?? null,
  user_metadata: cf.dataset_info.user_metadata ?? null,
});

const writeMetadataFile = async (s3: S3Location, cf: DatasetMetadata, handle: string) => {
  const { storage } = getContainer();
  await storage.putJsonObject(metadataKeyForPath(s3.path), {
    handle,
    ...cf,
  });
};

/* --------------------------------- MINT ---------------------------------- */

export interface MintResult {
  handle: string;
  s3Location: S3Location;
  registerCreateActivitySessionId: string | null;
}

export const mintDataset = async (
  cf: DatasetMetadata,
  user: AuthenticatedUser,
): Promise<MintResult> => {
  const { items, db, storage, groups } = getContainer();

  validateCollectionFormatFields(cf);
  await validateLinkedEntities(cf);
  const linkedPersonId = await registry.enforceLinkedPerson(user, "DATASET");

  const handle = await registry.mintHandle();
  const s3Location = await constructS3Path(storage, handle);

  const domainInfo = buildDatasetDomainInfo(cf, s3Location);
  await items.createCompleteItem({
    id: handle,
    subtype: "DATASET",
    ownerUsername: user.username,
    domainInfo,
    historyUsername: user.username,
    historyReason: "Created dataset",
    versioningInfo: { previous_version: null, version: 1, reason: null, next_version: null },
  });

  /*
   * Default access: general metadata read + dataset read, plus the default
   * data store access of any groups the user belongs to (legacy behaviour).
   */
  const groupRoles: Record<string, string[]> = {};
  for (const group of await groups.groupsForUser(user.username)) {
    if (group.default_data_store_access && group.default_data_store_access.length > 0) {
      groupRoles[group.id] = group.default_data_store_access;
    }
  }
  await ensureSidecars(
    db,
    handle,
    user.username,
    [METADATA_READ_ROLE, DATASET_READ_ROLE],
    groupRoles,
  );

  await writeMetadataFile(s3Location, cf, handle);

  const sessionId = await registry.spawnCreateActivity({
    createdItemId: handle,
    createdItemSubtype: "DATASET",
    linkedPersonId: linkedPersonId ?? "",
    username: user.username,
  });
  await items.setWorkflowLinks(handle, { createActivityWorkflowId: sessionId });

  return { handle, s3Location, registerCreateActivitySessionId: sessionId };
};

/* -------------------------------- helpers -------------------------------- */

export const fetchDatasetWithAccess = async (
  id: string,
  user: AuthenticatedUser,
): Promise<registry.FetchedItem> => {
  const result = await registry.fetchItemWithAccess({
    id,
    user,
    subtype: "DATASET",
    seedAllowed: true,
  });
  return result;
};

const releaseEditableCheck = (stored: StoredItem): void => {
  const status = (stored.domainInfo?.release_status as string | undefined) ?? "NOT_RELEASED";
  if (status === "PENDING" || status === "RELEASED") {
    throw forbidden(
      `Dataset ${stored.base.id} is pending review or is released. Cannot modify dataset while a review is ongoing.`,
    );
  }
};

/* -------------------------------- UPDATE --------------------------------- */

export interface UpdateMetadataResult {
  handle: string;
  s3Location: S3Location;
}

export const updateDatasetMetadata = async (input: {
  handleId: string;
  cf: DatasetMetadata;
  reason: string;
  user: AuthenticatedUser;
}): Promise<UpdateMetadataResult> => {
  const { items, storage } = getContainer();
  validateCollectionFormatFields(input.cf);
  await validateLinkedEntities(input.cf);

  const fetched = await fetchDatasetWithAccess(input.handleId, input.user);
  if (!evaluateUserAccess(fetched.roles, ["metadata-write", ADMIN_ROLE])) {
    throw unauthorized(
      `You do not have sufficient permissions to update dataset ${input.handleId}.`,
    );
  }
  await registry.checkNotLocked(input.handleId);
  releaseEditableCheck(fetched.stored);

  const wasSeed = fetched.stored.base.recordType === "SEED_ITEM";
  const s3Location: S3Location = wasSeed
    ? await constructS3Path(storage, input.handleId)
    : ({
        bucket_name: fetched.stored.domainInfo?.s3
          ? (fetched.stored.domainInfo.s3 as S3Location).bucket_name
          : storage.bucket,
        path: (fetched.stored.domainInfo?.s3 as S3Location | undefined)?.path ??
          (await findS3Path(storage, input.handleId)).path,
        s3_uri:
          (fetched.stored.domainInfo?.s3 as S3Location | undefined)?.s3_uri ??
          (await findS3Path(storage, input.handleId)).s3_uri,
      } as S3Location);

  const domainInfo = buildDatasetDomainInfo(
    input.cf,
    s3Location,
    fetched.stored.domainInfo ?? null,
  );
  await items.updateItem({
    id: input.handleId,
    domainInfo,
    reason: wasSeed ? "Update of seed dataset" : input.reason,
    username: input.user.username,
  });
  await writeMetadataFile(s3Location, input.cf, input.handleId);
  return { handle: input.handleId, s3Location };
};

/* -------------------------------- REVERT --------------------------------- */

export const revertDatasetMetadata = async (input: {
  id: string;
  historyId: number;
  reason: string;
  user: AuthenticatedUser;
}): Promise<void> => {
  const fetched = await fetchDatasetWithAccess(input.id, input.user);
  if (!evaluateUserAccess(fetched.roles, ["metadata-write", ADMIN_ROLE])) {
    throw unauthorized(
      `You do not have sufficient permissions to revert dataset ${input.id}.`,
    );
  }
  await registry.checkNotLocked(input.id);
  releaseEditableCheck(fetched.stored);

  const target = fetched.stored.history.find((h) => h.id === input.historyId);
  if (!target) {
    throw badRequest(`No history entry with id ${input.historyId} for dataset ${input.id}.`);
  }
  /* Reverted domain info keeps current s3 location + release state. */
  const targetInfo = { ...target.item } as Record<string, unknown>;
  targetInfo.s3 = fetched.stored.domainInfo?.s3;
  targetInfo.release_status = fetched.stored.domainInfo?.release_status ?? "NOT_RELEASED";
  targetInfo.release_approver = fetched.stored.domainInfo?.release_approver ?? null;
  targetInfo.release_timestamp = fetched.stored.domainInfo?.release_timestamp ?? null;
  targetInfo.release_history = fetched.stored.domainInfo?.release_history ?? [];

  const { items } = getContainer();
  await items.updateItem({
    id: input.id,
    domainInfo: targetInfo,
    reason: `Reverting dataset to history id ${input.historyId}. Reason: ${input.reason}.`,
    username: input.user.username,
  });
  const cf = targetInfo.collection_format as DatasetMetadata;
  await writeMetadataFile(targetInfo.s3 as S3Location, cf, input.id);
};

/* -------------------------------- VERSION -------------------------------- */

export const versionDataset = async (input: {
  id: string;
  reason: string;
  user: AuthenticatedUser;
}): Promise<{ newVersionId: string; versionJobSessionId: string }> => {
  const { items, storage } = getContainer();
  const result = await registry.versionItem({
    id: input.id,
    reason: input.reason,
    subtype: "DATASET",
    user: input.user,
  });

  /* New version gets its own storage location. */
  const newStored = await items.fetchItem(result.newVersionId);
  if (newStored?.domainInfo) {
    const cf = newStored.domainInfo.collection_format as DatasetMetadata;
    const newLocation = await constructS3Path(storage, result.newVersionId);
    const updated = buildDatasetDomainInfo(cf, newLocation, newStored.domainInfo);
    await items.updateItem({
      id: result.newVersionId,
      domainInfo: updated,
      reason: "(System) Dataset S3 path updated to new version's storage location",
      username: input.user.username,
      excludeHistoryUpdate: false,
    });
    await writeMetadataFile(newLocation, cf, result.newVersionId);
  }
  return { newVersionId: result.newVersionId, versionJobSessionId: result.versionJobSessionId };
};

/* ------------------------------ CREDENTIALS ------------------------------ */

export const generateCredentials = async (input: {
  datasetId: string;
  write: boolean;
  consoleSessionRequired: boolean;
  user: AuthenticatedUser;
}): Promise<{
  credentials: Record<string, unknown>;
  consoleSessionUrl: string | null;
}> => {
  const { storage } = getContainer();
  const fetched = await fetchDatasetWithAccess(input.datasetId, input.user);

  if (input.write && (await getContainer().locks.isLocked(input.datasetId))) {
    throw unauthorized(
      "This dataset is locked - you cannot modify the files of a locked dataset. Unlock the dataset first.",
    );
  }

  const acceptable = input.write ? DATA_WRITE_ROLES : DATA_READ_ROLES;
  const authorised =
    registry.isRegistryAdmin(input.user) || evaluateUserAccess(fetched.roles, acceptable);
  if (!authorised) {
    throw unauthorized(
      `You do not have sufficient permissions to ${input.write ? "write to" : "read from"} this dataset!`,
    );
  }

  if (fetched.stored.base.recordType === "SEED_ITEM" || !fetched.stored.domainInfo) {
    throw badRequest(
      `The item with id ${input.datasetId} is a SeededItem and cannot have credentials generated.`,
    );
  }

  if (input.write) releaseEditableCheck(fetched.stored);

  const s3 = fetched.stored.domainInfo.s3 as S3Location;
  const sessionName = `${input.user.username},${input.write ? "write" : "read"}-prog-bucket-access`;
  const credentials = await storage.brokerDatasetCredentials({
    location: s3,
    write: input.write,
    sessionName,
  });
  const consoleSessionUrl = input.consoleSessionRequired
    ? storage.consoleSessionUrl(s3)
    : null;
  return { credentials: { ...credentials }, consoleSessionUrl };
};

/* ----------------------------- PRESIGNED URL ----------------------------- */

export const generatePresignedUrl = async (input: {
  datasetId: string;
  filePath: string;
  expiresIn: number;
  user: AuthenticatedUser;
}): Promise<string> => {
  const { storage } = getContainer();
  const fetched = await fetchDatasetWithAccess(input.datasetId, input.user);
  const authorised =
    registry.isRegistryAdmin(input.user) ||
    evaluateUserAccess(fetched.roles, DATA_READ_ROLES);
  if (!authorised) {
    throw unauthorized("You do not have sufficient permissions to read from this dataset!");
  }
  if (!fetched.stored.domainInfo) {
    throw badRequest(`Dataset ${input.datasetId} is a seed item.`);
  }
  const s3 = fetched.stored.domainInfo.s3 as S3Location;
  const key = `${s3.path.replace(/\/+$/, "")}/${input.filePath.replace(/^\/+/, "")}`;
  const exists = await storage.objectExists(key);
  if (!exists) {
    throw badRequest(
      `File path ${input.filePath} does not exist within dataset ${input.datasetId}.`,
    );
  }
  return storage.presignedGetUrl(key, input.expiresIn);
};

/* -------------------------------- RELEASE -------------------------------- */

const personEmail = async (personId: string): Promise<string | null> => {
  const { items } = getContainer();
  const stored = await items.fetchItem(personId);
  if (!stored || stored.base.itemSubType !== "PERSON" || !stored.domainInfo) return null;
  return (stored.domainInfo.email as string | undefined) ?? null;
};

export const requestDatasetReview = async (input: {
  datasetId: string;
  approverId: string;
  notes: string;
  user: AuthenticatedUser;
}): Promise<void> => {
  const { items, reviewers } = getContainer();
  const fetched = await fetchDatasetWithAccess(input.datasetId, input.user);

  if (!evaluateUserAccess(fetched.roles, [ADMIN_ROLE])) {
    throw unauthorized(
      `You require admin permission on dataset ${input.datasetId} to request its release.`,
    );
  }
  if (fetched.stored.base.recordType === "SEED_ITEM" || !fetched.stored.domainInfo) {
    throw badRequest("Cannot request release of a seed dataset.");
  }
  const status = fetched.stored.domainInfo.release_status as string;
  if (status === "PENDING" || status === "RELEASED") {
    throw badRequest(
      `Dataset ${input.datasetId} is already ${status === "PENDING" ? "pending review" : "released"}.`,
    );
  }
  if (!(await reviewers.isReviewer(input.approverId))) {
    throw badRequest(
      `Specified approver ${input.approverId} is not a registered dataset reviewer.`,
    );
  }
  const requesterPersonId = await registry.enforceLinkedPerson(input.user, "DATASET");

  const history = [
    ...((fetched.stored.domainInfo.release_history as unknown[]) ?? []),
    {
      action: "REQUEST",
      timestamp: nowSeconds(),
      approver: input.approverId,
      requester: requesterPersonId,
      notes: input.notes,
    },
  ];
  const updated = {
    ...fetched.stored.domainInfo,
    release_status: "PENDING",
    release_approver: input.approverId,
    release_timestamp: nowSeconds(),
    release_history: history,
  };
  await items.updateItem({
    id: input.datasetId,
    domainInfo: updated,
    reason: "(System) Dataset release review requested",
    username: input.user.username,
    excludeHistoryUpdate: true,
  });

  const approverEmail = await personEmail(input.approverId);
  if (approverEmail) {
    await submitJob({
      username: input.user.username,
      jobSubType: "SEND_EMAIL",
      payload: {
        email_to: approverEmail,
        subject: `Provena: dataset release review requested (${input.datasetId})`,
        body: `A release review has been requested for dataset ${input.datasetId} by ${input.user.username}.\n\nNotes: ${input.notes}\n\nPlease review the dataset in the Provena data store.`,
        reason: "Dataset release review request",
      },
    });
  }
};

export const actionDatasetReview = async (input: {
  datasetId: string;
  approve: boolean;
  notes: string;
  user: AuthenticatedUser;
}): Promise<void> => {
  const { items, reviewers, links } = getContainer();
  const userPersonId = await links.lookup(input.user.username);
  if (!userPersonId) {
    throw badRequest(
      "You must have a linked Person in the registry to action a release request.",
    );
  }
  if (!(await reviewers.isReviewer(userPersonId))) {
    throw unauthorized(
      `User ${input.user.username} (person ${userPersonId}) is not a registered dataset reviewer.`,
    );
  }
  const fetched = await registry.fetchItemWithAccess({
    id: input.datasetId,
    user: input.user,
    subtype: "DATASET",
    seedAllowed: false,
  });
  const info = fetched.stored.domainInfo!;
  if ((info.release_status as string) !== "PENDING") {
    throw badRequest(`Dataset ${input.datasetId} is not pending release review.`);
  }
  if ((info.release_approver as string) !== userPersonId) {
    throw unauthorized(
      `User with name ${input.user.username} and linked ID ${userPersonId} is not the approver for dataset ${input.datasetId}. Only the designated approver can perform this action.`,
    );
  }

  const history = [
    ...((info.release_history as unknown[]) ?? []),
    {
      action: input.approve ? "APPROVE" : "REJECT",
      timestamp: nowSeconds(),
      approver: userPersonId,
      requester: null,
      notes: input.notes,
    },
  ];
  const updated = {
    ...info,
    release_status: input.approve ? "RELEASED" : "NOT_RELEASED",
    release_approver: userPersonId,
    release_timestamp: nowSeconds(),
    release_history: history,
  };
  await items.updateItem({
    id: input.datasetId,
    domainInfo: updated,
    reason: `(System) Dataset release ${input.approve ? "approved" : "rejected"}`,
    username: input.user.username,
    excludeHistoryUpdate: true,
  });

  /* Notify the most recent requester. */
  const requestEntries = (info.release_history as { action: string; requester?: string }[]) ?? [];
  const lastRequest = [...requestEntries].reverse().find((e) => e.action === "REQUEST");
  if (lastRequest?.requester) {
    const requesterEmail = await personEmail(lastRequest.requester);
    if (requesterEmail) {
      await submitJob({
        username: input.user.username,
        jobSubType: "SEND_EMAIL",
        payload: {
          email_to: requesterEmail,
          subject: `Provena: dataset release ${input.approve ? "approved" : "rejected"} (${input.datasetId})`,
          body: `Your release request for dataset ${input.datasetId} was ${input.approve ? "approved" : "rejected"}.\n\nNotes: ${input.notes}`,
          reason: "Dataset release review actioned",
        },
      });
    }
  }
};
