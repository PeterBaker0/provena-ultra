/**
 * Zod schemas for data store API requests, ported from legacy
 * `ProvenaInterfaces/DataStoreAPI.py`.
 */
import { z } from "zod";
import { nonEmptyString } from "./common.js";
import { collectionFormatSchema } from "./registry.js";

const HOURS_TO_SECS = 3600;

export const credentialsRequestSchema = z.object({
  dataset_id: nonEmptyString,
  console_session_required: z.boolean(),
});

export const presignedUrlRequestSchema = z.object({
  dataset_id: nonEmptyString,
  file_path: nonEmptyString,
  expires_in: z
    .number()
    .int()
    .min(1)
    .max(HOURS_TO_SECS * 24)
    .default(HOURS_TO_SECS * 3),
});

export const releaseApprovalRequestSchema = z.object({
  dataset_id: nonEmptyString,
  approver_id: nonEmptyString,
  notes: nonEmptyString,
});

export const actionApprovalRequestSchema = z.object({
  dataset_id: nonEmptyString,
  approve: z.boolean(),
  notes: z.string(),
});

/** Mint + update both take the dataset collection format. */
export const mintDatasetRequestSchema = collectionFormatSchema;
export const updateMetadataRequestSchema = collectionFormatSchema;
