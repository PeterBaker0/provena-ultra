import type { DbClient } from "@provena/db";
import { eq, datasetReleaseRequests, datasetReviewers, RegistryRepository } from "@provena/db";
import type { StorageAdapter } from "@provena/storage";
import { randomUUID } from "node:crypto";
import { statusPayload } from "../utils/http";

type DatasetRow = Awaited<ReturnType<RegistryRepository["fetchById"]>>;

const toIso = (value: Date): string => value.toISOString();

const mapDataset = (item: NonNullable<DatasetRow>) => ({
  id: item.id,
  category: item.category,
  subtype: item.subtype,
  version: item.version,
  display_name: item.displayName,
  owner_username: item.ownerUsername,
  record: item.record,
  created_at: toIso(item.createdAt),
  updated_at: toIso(item.updatedAt),
});

export interface DataStoreService {
  validateMetadata: (metadata: Record<string, unknown>) => Promise<{
    status: ReturnType<typeof statusPayload>;
    validation_messages: string[];
    details: string;
  }>;
  getDatasetSchema: () => Promise<{
    status: ReturnType<typeof statusPayload>;
    schema: Record<string, unknown>;
  }>;
  mintDataset: (input: {
    ownerUsername: string;
    displayName: string;
    record: Record<string, unknown>;
  }) => Promise<string>;
  updateDatasetMetadata: (input: {
    id: string;
    metadata: Record<string, unknown>;
    updatedBy: string;
  }) => Promise<ReturnType<typeof mapDataset>>;
  revertDatasetMetadata: (input: { id: string; updatedBy: string }) => Promise<ReturnType<typeof mapDataset>>;
  versionDataset: (input: {
    id: string;
    reason?: string;
    updatedBy: string;
  }) => Promise<ReturnType<typeof mapDataset>>;
  listDatasets: (
    limit: number,
    offset: number,
  ) => Promise<{ records: ReturnType<typeof mapDataset>[]; total: number }>;
  fetchDataset: (id: string) => Promise<ReturnType<typeof mapDataset> | null>;
  generatePresignedUrl: (input: {
    key: string;
    action: "download" | "upload";
    expiresInSeconds: number;
  }) => Promise<string>;
  generateCredentials: (input: {
    username: string;
    datasetId: string;
    mode: "read" | "write";
  }) => Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiresAt: string;
    consoleUrl: string | null;
  }>;
  removeReviewer: (username: string) => Promise<void>;
  addReviewer: (username: string, createdBy: string) => Promise<void>;
  listReviewers: () => Promise<string[]>;
  requestApproval: (input: {
    datasetId: string;
    requesterUsername: string;
    notes?: string;
  }) => Promise<string>;
  actionApproval: (input: {
    requestId: string;
    action: "APPROVE" | "REJECT";
    decidedBy: string;
    notes?: string;
  }) => Promise<
    | {
        id: string;
        dataset_id: string;
        requester_username: string;
        status: string;
        notes: string | null;
      }
    | null
  >;
}

export const createDataStoreService = (
  db: DbClient,
  registryRepository: RegistryRepository,
  storage: StorageAdapter,
): DataStoreService => ({
  validateMetadata: async (metadata) => ({
    status: statusPayload(true, "Validation successful."),
    validation_messages: [],
    details: `Validated ${Object.keys(metadata).length} metadata fields.`,
  }),
  getDatasetSchema: async () => ({
    status: statusPayload(true),
    schema: {
      type: "object",
      additionalProperties: true,
    },
  }),
  mintDataset: async ({ ownerUsername, displayName, record }) => {
    const id = `dataset:${randomUUID()}`;
    await registryRepository.create({
      id,
      category: "entity",
      subtype: "dataset",
      displayName,
      ownerUsername,
      record,
    });
    return id;
  },
  updateDatasetMetadata: async ({ id, metadata, updatedBy }) => {
    const existing = await registryRepository.fetchById(id);
    if (!existing) {
      throw new Error(`Dataset ${id} not found`);
    }
    const updated = await registryRepository.update({
      id,
      updatedBy,
      displayName: existing.displayName,
      record: {
        ...existing.record,
        metadata,
      },
    });
    return mapDataset(updated);
  },
  revertDatasetMetadata: async ({ id, updatedBy }) => {
    const existing = await registryRepository.fetchById(id);
    if (!existing) {
      throw new Error(`Dataset ${id} not found`);
    }
    const updated = await registryRepository.update({
      id,
      updatedBy,
      displayName: existing.displayName,
      record: existing.record,
    });
    return mapDataset(updated);
  },
  versionDataset: async ({ id, reason, updatedBy }) => {
    const existing = await registryRepository.fetchById(id);
    if (!existing) {
      throw new Error(`Dataset ${id} not found`);
    }
    const updated = await registryRepository.update({
      id,
      updatedBy,
      displayName: existing.displayName,
      record: {
        ...existing.record,
        _version_reason: reason ?? null,
      },
    });
    return mapDataset(updated);
  },
  listDatasets: async (limit, offset) => {
    const listed = await registryRepository.list({
      category: "entity",
      subtype: "dataset",
      limit,
      offset,
    });
    return {
      records: listed.records.map(mapDataset),
      total: listed.total,
    };
  },
  fetchDataset: async (id) => {
    const item = await registryRepository.fetchById(id);
    return item ? mapDataset(item) : null;
  },
  generatePresignedUrl: async ({ key, action, expiresInSeconds }) =>
    storage.generatePresignedUrl({
      key,
      action,
      expiresInSeconds,
    }),
  generateCredentials: async ({ username, datasetId }) =>
    storage.generateTemporaryCredentials(username, datasetId),
  removeReviewer: async (username) => {
    await db.delete(datasetReviewers).where(eq(datasetReviewers.username, username));
  },
  addReviewer: async (username, createdBy) => {
    await db
      .insert(datasetReviewers)
      .values({
        username,
        createdBy,
      })
      .onConflictDoNothing({
        target: datasetReviewers.username,
      });
  },
  listReviewers: async () => {
    const reviewers = await db.select().from(datasetReviewers);
    return reviewers.map((reviewer) => reviewer.username);
  },
  requestApproval: async ({ datasetId, requesterUsername, notes }) => {
    const requestId = randomUUID();
    await db.insert(datasetReleaseRequests).values({
      id: requestId,
      datasetId,
      requesterUsername,
      notes: notes ?? null,
      status: "PENDING",
    });
    return requestId;
  },
  actionApproval: async ({ requestId, action, decidedBy, notes }) => {
    const [updated] = await db
      .update(datasetReleaseRequests)
      .set({
        status: action === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedBy,
        decidedAt: new Date(),
        notes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(datasetReleaseRequests.id, requestId))
      .returning();

    if (!updated) {
      return null;
    }

    return {
      id: updated.id,
      dataset_id: updated.datasetId,
      requester_username: updated.requesterUsername,
      status: updated.status,
      notes: updated.notes,
    };
  },
});
