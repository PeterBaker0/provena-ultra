/**
 * Wire serialization of stored items into the legacy response shapes.
 * FastAPI emitted all fields including nulls - we mirror that.
 */
import type { StoredItem } from "@provena/db";

export interface WireHistoryEntry {
  id: number;
  timestamp: number;
  reason: string;
  username: string;
  item: Record<string, unknown>;
}

export type WireItem = Record<string, unknown>;

const versioningInfo = (stored: StoredItem): Record<string, unknown> | null => {
  if (stored.base.versioningVersion == null) return null;
  return {
    previous_version: stored.base.versioningPreviousVersion,
    version: stored.base.versioningVersion,
    reason: stored.base.versioningReason,
    next_version: stored.base.versioningNextVersion,
  };
};

const workflowLinks = (stored: StoredItem): Record<string, unknown> | null => {
  if (
    stored.base.createActivityWorkflowId == null &&
    stored.base.versionActivityWorkflowId == null
  ) {
    return null;
  }
  return {
    create_activity_workflow_id: stored.base.createActivityWorkflowId,
    version_activity_workflow_id: stored.base.versionActivityWorkflowId,
  };
};

const recordInfoFields = (stored: StoredItem): Record<string, unknown> => ({
  id: stored.base.id,
  owner_username: stored.base.ownerUsername,
  created_timestamp: stored.base.createdTimestamp,
  updated_timestamp: stored.base.updatedTimestamp,
  item_category: stored.base.itemCategory,
  item_subtype: stored.base.itemSubType,
  record_type: stored.base.recordType,
  workflow_links: workflowLinks(stored),
  versioning_info: versioningInfo(stored),
});

/** Serialize a SEED item (legacy SeededItem - record info only). */
export const serializeSeedItem = (stored: StoredItem): WireItem => recordInfoFields(stored);

/** Serialize a COMPLETE item (legacy ItemBase + DomainInfo + history). */
export const serializeCompleteItem = (stored: StoredItem): WireItem => ({
  ...(stored.domainInfo ?? {}),
  history: stored.history.map((h) => ({
    id: h.id,
    timestamp: h.timestamp,
    reason: h.reason,
    username: h.username,
    item: h.item,
  })),
  ...recordInfoFields(stored),
  display_name: stored.base.displayName,
  user_metadata: stored.base.userMetadata ?? null,
});

export const serializeItem = (stored: StoredItem): WireItem =>
  stored.base.recordType === "SEED_ITEM"
    ? serializeSeedItem(stored)
    : serializeCompleteItem(stored);

export const successStatus = (details = ""): { success: boolean; details: string } => ({
  success: true,
  details,
});

export const failureStatus = (details: string): { success: boolean; details: string } => ({
  success: false,
  details,
});
