/**
 * Registry domain service - the core item lifecycle orchestration shared by
 * the registry router, the data store router (datasets) and the prov router
 * (model runs). Ports the behaviour of legacy
 * `registry-api/helpers/action_helpers.py`.
 */
import {
  ADMIN_ROLE,
  METADATA_READ_ROLE,
  METADATA_WRITE_ROLE,
  ROLE_METADATA_MAP,
  availableRolesForSubtype,
  categoryForSubtype,
  defaultRolesForSubtype,
  registrySchemas,
  subtypeHasVersioning,
  subtypeRequiresLinkedPerson,
  type Roles,
} from "@provena/interfaces";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import {
  describeAccessRoles,
  entityRegistryGuards,
  evaluateUserAccess,
  type AuthenticatedUser,
} from "@provena/auth";
import { ensureSidecars, type StoredItem } from "@provena/db";
import { submitJob } from "@provena/jobs";
import { getConfig } from "@provena/config";
import { getContainer } from "../container.js";
import { ApiError, badRequest, internalError, unauthorized } from "../errors.js";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/* Roles which grant fetch access. */
const FETCH_ACTION_ACCEPTED_ROLES: Roles = [
  METADATA_READ_ROLE,
  METADATA_WRITE_ROLE,
  ADMIN_ROLE,
  "dataset-data-read",
  "dataset-data-write",
];

const WRITE_ACTION_ACCEPTED_ROLES: Roles = [METADATA_WRITE_ROLE, ADMIN_ROLE, "dataset-data-write"];

const ADMIN_ACTION_ACCEPTED_ROLES: Roles = [ADMIN_ROLE];

export interface FetchedItem {
  stored: StoredItem;
  roles: Roles;
  locked: boolean;
}

export const userGroupIdSet = async (username: string): Promise<Set<string>> => {
  const { groups } = getContainer();
  const userGroups = await groups.groupsForUser(username);
  return new Set(userGroups.map((g) => g.id));
};

export const isRegistryAdmin = (user: AuthenticatedUser): boolean =>
  entityRegistryGuards.isAdmin(user);

/** Resolve user's linked person id, throwing the legacy-style error if missing. */
export const enforceLinkedPerson = async (
  user: AuthenticatedUser,
  subtype: ItemSubType,
): Promise<string | null> => {
  if (!subtypeRequiresLinkedPerson(subtype)) return null;
  const { links } = getContainer();
  const personId = await links.lookup(user.username);
  if (!personId) {
    throw badRequest(
      `In order to perform this registry action, you must link your user account to a registered Person in the registry. Your username ${user.username} did not have a linked person.`,
    );
  }
  return personId;
};

/** Compute the effective item roles for a user (legacy describe_access_helper). */
export const describeAccess = async (
  itemId: string,
  user: AuthenticatedUser,
  availableRoles: Roles,
): Promise<Roles> => {
  const { auth } = getContainer();
  if (isRegistryAdmin(user)) return [...availableRoles];
  const settings = await auth.getAccessSettings(itemId);
  if (!settings) {
    throw internalError(
      `An error occurred while trying to fetch the authorisation configuration of the object. Access denied.`,
    );
  }
  return describeAccessRoles({
    username: user.username,
    isRegistryAdmin: false,
    settings,
    userGroupIds: await userGroupIdSet(user.username),
    availableRoles,
  });
};

const expectItem = async (id: string): Promise<StoredItem> => {
  const { items } = getContainer();
  const stored = await items.fetchItem(id);
  if (!stored) {
    throw badRequest(
      `Item (id=${id}) was not present in the registry. Are you sure the id is correct?`,
    );
  }
  return stored;
};

const checkSubtype = (stored: StoredItem, subtype: ItemSubType): void => {
  if (stored.base.itemSubType !== subtype) {
    throw badRequest(
      `The item with id ${stored.base.id} has subtype ${stored.base.itemSubType} which does not match the expected subtype ${subtype} for this route.`,
    );
  }
};

export const checkNotLocked = async (id: string): Promise<void> => {
  const { locks } = getContainer();
  if (await locks.isLocked(id)) {
    throw unauthorized(`Cannot perform this action against a locked resource (id ${id}).`);
  }
};

/* ------------------------------- FETCH ----------------------------------- */

export const fetchItemWithAccess = async (input: {
  id: string;
  user: AuthenticatedUser;
  subtype?: ItemSubType;
  seedAllowed?: boolean;
}): Promise<FetchedItem> => {
  const { locks } = getContainer();
  const stored = await expectItem(input.id);
  if (input.subtype) checkSubtype(stored, input.subtype);
  if (stored.base.recordType === "SEED_ITEM" && !input.seedAllowed) {
    throw badRequest(
      `Item with id ${input.id} is a seed item. Seed items cannot be fetched on this route unless seed_allowed is enabled.`,
    );
  }
  const availableRoles = availableRolesForSubtype(stored.base.itemSubType);
  const roles = await describeAccess(input.id, input.user, availableRoles);
  if (!evaluateUserAccess(roles, FETCH_ACTION_ACCEPTED_ROLES)) {
    throw unauthorized(
      `You do not have sufficient permissions to fetch item with id ${input.id}.`,
    );
  }
  const locked = await locks.isLocked(input.id);
  return { stored, roles, locked };
};

/* ------------------------------- LIST ------------------------------------ */

export interface ListOptions {
  subtype?: ItemSubType | null;
  recordType?: "ALL" | "SEED_ONLY" | "COMPLETE_ONLY";
  releaseStatus?: "NOT_RELEASED" | "PENDING" | "RELEASED" | null;
  releaseReviewer?: string | null;
  sortType?:
    | "CREATED_TIME"
    | "UPDATED_TIME"
    | "DISPLAY_NAME"
    | "RELEASE_TIMESTAMP"
    | "ACCESS_INFO_URI_BEGINS_WITH"
    | null;
  ascending?: boolean;
  beginsWith?: string | null;
  pageSize?: number;
  paginationKey?: Record<string, unknown> | null;
}

export interface AccessFilteredList {
  items: StoredItem[];
  seedItems: StoredItem[];
  notAuthorisedCount: number;
  totalCount: number;
  paginationKey: Record<string, unknown> | null;
}

/** List + per-item access post-filtering (legacy list_items_paginated_and_filter). */
export const listItemsWithAccess = async (
  options: ListOptions,
  user: AuthenticatedUser,
): Promise<AccessFilteredList> => {
  const { items, auth } = getContainer();
  const result = await items.listItems(options);

  const admin = isRegistryAdmin(user);
  const groupIds = admin ? new Set<string>() : await userGroupIdSet(user.username);

  const accessible: StoredItem[] = [];
  let notAuthorisedCount = 0;
  for (const stored of result.items) {
    if (admin) {
      accessible.push(stored);
      continue;
    }
    const settings = await auth.getAccessSettings(stored.base.id);
    if (!settings) {
      notAuthorisedCount += 1;
      continue;
    }
    const roles = describeAccessRoles({
      username: user.username,
      isRegistryAdmin: false,
      settings,
      userGroupIds: groupIds,
      availableRoles: availableRolesForSubtype(stored.base.itemSubType),
    });
    if (evaluateUserAccess(roles, FETCH_ACTION_ACCEPTED_ROLES)) {
      accessible.push(stored);
    } else {
      notAuthorisedCount += 1;
    }
  }

  return {
    items: accessible.filter((s) => s.base.recordType === "COMPLETE_ITEM"),
    seedItems: accessible.filter((s) => s.base.recordType === "SEED_ITEM"),
    notAuthorisedCount,
    totalCount: result.totalCount,
    paginationKey: result.paginationKey,
  };
};

/* ------------------------------ MINT/SEED -------------------------------- */

export const mintHandle = async (): Promise<string> => {
  const { handles } = getContainer();
  const config = getConfig();
  /* Self describing handle - value points at the registry item URL. */
  return handles.mint(config.HANDLE_PREFIX, {
    type: "URL",
    value: `${config.API_PUBLIC_URL}/item`,
    index: 1,
  });
};

export const seedItem = async (input: {
  subtype: ItemSubType;
  user: AuthenticatedUser;
  versioningInfo?: { previous_version?: string | null; version: number; reason?: string | null };
  baseAccessSettings?: { owner: string; general: string[]; groups: Record<string, string[]> };
}): Promise<StoredItem> => {
  const { items, db } = getContainer();
  await enforceLinkedPerson(input.user, input.subtype);
  const handle = await mintHandle();
  const stored = await items.createSeedItem({
    id: handle,
    subtype: input.subtype,
    ownerUsername: input.user.username,
    versioningInfo: input.versioningInfo ?? null,
  });
  const settings = input.baseAccessSettings;
  await ensureSidecars(
    db,
    handle,
    settings?.owner ?? input.user.username,
    settings?.general ?? defaultRolesForSubtype(input.subtype),
    settings?.groups ?? {},
  );
  return stored;
};

/* ------------------------------- CREATE ---------------------------------- */

export interface CreateResult {
  stored: StoredItem;
  registerCreateActivitySessionId: string | null;
}

export const createItem = async (input: {
  subtype: ItemSubType;
  domainInfo: Record<string, unknown>;
  user: AuthenticatedUser;
  /** Skip the create activity spinoff (used for datasets which handle it separately). */
  suppressCreateActivity?: boolean;
}): Promise<CreateResult> => {
  const { items, db } = getContainer();
  const linkedPersonId = await enforceLinkedPerson(input.user, input.subtype);
  /* Validate domain info via zod (defensive - routers validate too). */
  const schema = registrySchemas.domainInfoSchemaFor(input.subtype);
  const parsed = schema.parse(input.domainInfo) as Record<string, unknown>;

  const handle = await mintHandle();
  let stored = await items.createCompleteItem({
    id: handle,
    subtype: input.subtype,
    ownerUsername: input.user.username,
    domainInfo: parsed,
    historyUsername: input.user.username,
    historyReason: "Created item",
    versioningInfo: subtypeHasVersioning(input.subtype)
      ? { previous_version: null, version: 1, reason: null, next_version: null }
      : null,
  });
  await ensureSidecars(db, handle, input.user.username, defaultRolesForSubtype(input.subtype));

  let sessionId: string | null = null;
  if (subtypeHasVersioning(input.subtype) && !input.suppressCreateActivity) {
    sessionId = await spawnCreateActivity({
      createdItemId: handle,
      createdItemSubtype: input.subtype,
      linkedPersonId: linkedPersonId ?? "",
      username: input.user.username,
    });
    await items.setWorkflowLinks(handle, { createActivityWorkflowId: sessionId });
    stored = (await items.fetchItem(handle))!;
  }
  return { stored, registerCreateActivitySessionId: sessionId };
};

export const spawnCreateActivity = async (input: {
  createdItemId: string;
  createdItemSubtype: ItemSubType;
  linkedPersonId: string;
  username: string;
}): Promise<string> => {
  const { sessionId } = await submitJob({
    username: input.username,
    jobSubType: "REGISTER_CREATE_ACTIVITY",
    payload: {
      created_item_id: input.createdItemId,
      created_item_subtype: input.createdItemSubtype,
      linked_person_id: input.linkedPersonId,
    },
  });
  return sessionId;
};

/* ------------------------------- UPDATE ---------------------------------- */

export interface UpdateResult {
  registerCreateActivitySessionId: string | null;
}

export const updateItem = async (input: {
  id: string;
  subtype: ItemSubType;
  domainInfo: Record<string, unknown>;
  reason: string | null;
  user: AuthenticatedUser;
  excludeHistoryUpdate?: boolean;
  /** Bypass per-item access checks (used by admin/system paths). */
  bypassItemAccess?: boolean;
}): Promise<UpdateResult> => {
  const { items } = getContainer();
  const linkedPersonId = await enforceLinkedPerson(input.user, input.subtype);
  const stored = await expectItem(input.id);
  checkSubtype(stored, input.subtype);

  const wasSeed = stored.base.recordType === "SEED_ITEM";
  if (!wasSeed && (input.reason == null || input.reason.length === 0)) {
    throw badRequest("Must provide a reason when updating an existing complete item.");
  }

  await checkNotLocked(input.id);

  if (!input.bypassItemAccess) {
    const roles = await describeAccess(
      input.id,
      input.user,
      availableRolesForSubtype(input.subtype),
    );
    if (!evaluateUserAccess(roles, WRITE_ACTION_ACCEPTED_ROLES)) {
      throw unauthorized(
        `You do not have sufficient permissions to update item with id ${input.id}.`,
      );
    }
  }

  const schema = registrySchemas.domainInfoSchemaFor(input.subtype);
  const parsed = schema.parse(input.domainInfo) as Record<string, unknown>;

  await items.updateItem({
    id: input.id,
    domainInfo: parsed,
    reason: input.reason ?? "Update of seed item",
    username: input.user.username,
    excludeHistoryUpdate: input.excludeHistoryUpdate ?? false,
  });

  /* Seed -> complete on versioning-enabled subtype spawns Create activity. */
  let sessionId: string | null = null;
  if (wasSeed && subtypeHasVersioning(input.subtype)) {
    sessionId = await spawnCreateActivity({
      createdItemId: input.id,
      createdItemSubtype: input.subtype,
      linkedPersonId: linkedPersonId ?? "",
      username: input.user.username,
    });
    await items.setWorkflowLinks(input.id, { createActivityWorkflowId: sessionId });
  }
  return { registerCreateActivitySessionId: sessionId };
};

/* ------------------------------- REVERT ---------------------------------- */

export const revertItem = async (input: {
  id: string;
  historyId: number;
  reason: string;
  subtype: ItemSubType;
  user: AuthenticatedUser;
  bypassItemAccess?: boolean;
}): Promise<void> => {
  const { items } = getContainer();
  await enforceLinkedPerson(input.user, input.subtype);
  const stored = await expectItem(input.id);
  checkSubtype(stored, input.subtype);
  await checkNotLocked(input.id);
  if (!input.bypassItemAccess) {
    const roles = await describeAccess(
      input.id,
      input.user,
      availableRolesForSubtype(input.subtype),
    );
    if (!evaluateUserAccess(roles, WRITE_ACTION_ACCEPTED_ROLES)) {
      throw unauthorized(
        `You do not have sufficient permissions to revert item with id ${input.id}.`,
      );
    }
  }
  const target = stored.history.find((h) => h.id === input.historyId);
  if (!target) {
    throw badRequest(
      `No history entry with id ${input.historyId} exists for item ${input.id}.`,
    );
  }
  await items.revertItem({
    id: input.id,
    historyId: input.historyId,
    reason: input.reason,
    username: input.user.username,
  });
};

/* ------------------------------- VERSION --------------------------------- */

export interface VersionResult {
  newVersionId: string;
  versionJobSessionId: string;
}

export const versionItem = async (input: {
  id: string;
  reason: string;
  subtype: ItemSubType;
  user: AuthenticatedUser;
  bypassItemAccess?: boolean;
}): Promise<VersionResult> => {
  const { items, auth, db } = getContainer();
  if (!subtypeHasVersioning(input.subtype)) {
    throw badRequest(`Subtype ${input.subtype} does not support versioning.`);
  }
  const linkedPersonId = await enforceLinkedPerson(input.user, input.subtype);
  const stored = await expectItem(input.id);
  checkSubtype(stored, input.subtype);
  await checkNotLocked(input.id);

  if (stored.base.recordType !== "COMPLETE_ITEM" || !stored.domainInfo) {
    throw badRequest(`Cannot version a seed item (id ${input.id}).`);
  }

  /* Versioning requires item admin (legacy: admin on item to revise). */
  if (!input.bypassItemAccess) {
    const roles = await describeAccess(
      input.id,
      input.user,
      availableRolesForSubtype(input.subtype),
    );
    if (!evaluateUserAccess(roles, ADMIN_ACTION_ACCEPTED_ROLES)) {
      throw unauthorized(
        `You do not have sufficient permissions (admin) to version item with id ${input.id}.`,
      );
    }
  }

  if (stored.base.versioningNextVersion) {
    throw badRequest(
      `Cannot version item ${input.id} - it already has a next version (${stored.base.versioningNextVersion}). Only the latest version can be revised.`,
    );
  }

  const currentVersion = stored.base.versioningVersion ?? 1;
  const newVersionNumber = currentVersion + 1;
  const newHandle = await mintHandle();

  await items.createCompleteItem({
    id: newHandle,
    subtype: input.subtype,
    ownerUsername: input.user.username,
    domainInfo: stored.domainInfo,
    historyUsername: input.user.username,
    historyReason: `Created new version from item ${input.id}: ${input.reason}`,
    versioningInfo: {
      previous_version: input.id,
      version: newVersionNumber,
      reason: input.reason,
      next_version: null,
    },
  });
  /* Inherit access configuration from the previous version (legacy behaviour). */
  const previousSettings = await auth.getAccessSettings(input.id);
  await ensureSidecars(
    db,
    newHandle,
    input.user.username,
    previousSettings?.general ?? defaultRolesForSubtype(input.subtype),
    previousSettings?.groups ?? {},
  );
  await items.setVersioningNextVersion(input.id, newHandle);

  const { sessionId } = await submitJob({
    username: input.user.username,
    jobSubType: "REGISTER_VERSION_ACTIVITY",
    payload: {
      reason: input.reason,
      version_number: newVersionNumber,
      from_version_id: input.id,
      to_version_id: newHandle,
      linked_person_id: linkedPersonId ?? "",
      item_subtype: input.subtype,
    },
  });
  await items.setWorkflowLinks(newHandle, { versionActivityWorkflowId: sessionId });

  return { newVersionId: newHandle, versionJobSessionId: sessionId };
};

/* ------------------------------- DELETE ---------------------------------- */

export const deleteItem = async (id: string): Promise<void> => {
  const { items } = getContainer();
  const deleted = await items.deleteItem(id);
  if (!deleted) {
    throw badRequest(
      `Item (id=${id}) was not present in the registry. Are you sure the id is correct?`,
    );
  }
};

/* ----------------------------- AUTH CONFIG ------------------------------- */

export const getAuthConfiguration = async (
  id: string,
  user: AuthenticatedUser,
): Promise<{ owner: string; general: string[]; groups: Record<string, string[]> }> => {
  const { auth } = getContainer();
  await expectItem(id);
  const settings = await auth.getAccessSettings(id);
  if (!settings) throw internalError(`No access settings found for item ${id}.`);
  if (!isRegistryAdmin(user) && settings.owner !== user.username) {
    throw unauthorized(
      `Only the owner or a registry admin can view the access configuration of item ${id}.`,
    );
  }
  return settings;
};

export const putAuthConfiguration = async (
  id: string,
  newSettings: { owner: string; general: string[]; groups: Record<string, string[]> },
  user: AuthenticatedUser,
): Promise<void> => {
  const { auth } = getContainer();
  await expectItem(id);
  await checkNotLocked(id);
  const settings = await auth.getAccessSettings(id);
  if (!settings) throw internalError(`No access settings found for item ${id}.`);
  if (!isRegistryAdmin(user) && settings.owner !== user.username) {
    throw unauthorized(
      `Only the owner or a registry admin can modify the access configuration of item ${id}.`,
    );
  }
  if (newSettings.owner !== settings.owner) {
    throw badRequest("Cannot change the owner of a resource through this endpoint.");
  }
  await auth.putAccessSettings(id, newSettings);
};

export const authRoles = (subtype: ItemSubType): { roles: unknown[] } => ({
  roles: availableRolesForSubtype(subtype).map((roleName) => {
    const described = ROLE_METADATA_MAP[roleName];
    return {
      role_display_name: described?.role_display_name ?? roleName,
      role_name: roleName,
      description: described?.description ?? "",
      also_grants: described?.also_grants ?? [],
    };
  }),
});

/* -------------------------------- LOCKS ---------------------------------- */

const checkLockPermission = async (
  id: string,
  user: AuthenticatedUser,
  subtype: ItemSubType,
): Promise<void> => {
  const roles = await describeAccess(id, user, availableRolesForSubtype(subtype));
  if (!evaluateUserAccess(roles, ADMIN_ACTION_ACCEPTED_ROLES)) {
    throw unauthorized(
      `You do not have sufficient permissions (admin) to change the lock state of item ${id}.`,
    );
  }
};

export const lockItem = async (input: {
  id: string;
  reason: string;
  subtype: ItemSubType;
  user: AuthenticatedUser;
}): Promise<void> => {
  const { locks } = getContainer();
  const stored = await expectItem(input.id);
  checkSubtype(stored, input.subtype);
  await checkLockPermission(input.id, input.user, input.subtype);
  if (await locks.isLocked(input.id)) {
    throw badRequest(`Item ${input.id} is already locked.`);
  }
  await locks.setLocked(input.id, true, {
    username: input.user.username,
    email: input.user.email,
    reason: input.reason,
    timestamp: nowSeconds(),
  });
};

export const unlockItem = async (input: {
  id: string;
  reason: string;
  subtype: ItemSubType;
  user: AuthenticatedUser;
}): Promise<void> => {
  const { locks } = getContainer();
  const stored = await expectItem(input.id);
  checkSubtype(stored, input.subtype);
  await checkLockPermission(input.id, input.user, input.subtype);
  if (!(await locks.isLocked(input.id))) {
    throw badRequest(`Item ${input.id} is not locked.`);
  }
  await locks.setLocked(input.id, false, {
    username: input.user.username,
    email: input.user.email,
    reason: input.reason,
    timestamp: nowSeconds(),
  });
};

export const lockHistory = async (
  id: string,
  user: AuthenticatedUser,
  subtype: ItemSubType,
): Promise<unknown[]> => {
  const { locks } = getContainer();
  const stored = await expectItem(id);
  checkSubtype(stored, subtype);
  const roles = await describeAccess(id, user, availableRolesForSubtype(subtype));
  if (!evaluateUserAccess(roles, FETCH_ACTION_ACCEPTED_ROLES)) {
    throw unauthorized(`You do not have permission to view the lock history of item ${id}.`);
  }
  return locks.lockHistory(id);
};

export const lockedStatus = async (id: string): Promise<boolean> => {
  const { locks } = getContainer();
  await expectItem(id);
  return locks.isLocked(id);
};
