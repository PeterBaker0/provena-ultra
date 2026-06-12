/**
 * Zod schemas for the job API + job payloads, ported from legacy
 * `ProvenaInterfaces/AsyncJobModels.py` / `AsyncJobAPI.py`.
 *
 * Note: the legacy `user_info: EncryptedUserInfo` fields are replaced with a
 * plain `username` carried by the job session - the v2 system runs jobs
 * in-process with full DB access and does not need encrypted user context.
 * For wire compatibility the payload schemas accept (and ignore) `user_info`.
 */
import { z } from "zod";
import { nonEmptyString, paginationKeySchema } from "./common.js";
import { modelRunRecordSchema } from "./provenance.js";
import { itemSubTypeSchema } from "./registry.js";

export const jobTypeSchema = z.enum(["PROV_LODGE", "REGISTRY", "EMAIL", "REPORT"]);

export const jobSubTypeSchema = z.enum([
  "PROV_LODGE_WAKE_UP",
  "MODEL_RUN_PROV_LODGE",
  "MODEL_RUN_LODGE_ONLY",
  "MODEL_RUN_BATCH_SUBMIT",
  "LODGE_CREATE_ACTIVITY",
  "LODGE_VERSION_ACTIVITY",
  "MODEL_RUN_UPDATE",
  "MODEL_RUN_UPDATE_LODGE_ONLY",
  "REGISTRY_WAKE_UP",
  "REGISTER_CREATE_ACTIVITY",
  "REGISTER_VERSION_ACTIVITY",
  "EMAIL_WAKE_UP",
  "SEND_EMAIL",
  "GENERATE_REPORT",
]);

export const jobStatusSchema = z.enum([
  "PENDING",
  "DEQUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
]);

/* Job API requests */

export const listJobsRequestSchema = z.object({
  pagination_key: paginationKeySchema.nullish(),
  limit: z.number().int().positive().default(10),
});

export const listByBatchRequestSchema = z.object({
  batch_id: nonEmptyString,
  pagination_key: paginationKeySchema.nullish(),
  limit: z.number().int().positive().default(10),
});

export const retryJobRequestSchema = z.object({
  session_id: nonEmptyString,
});

export const adminListJobsRequestSchema = z.object({
  username_filter: z.string().nullish(),
  limit: z.number().int().positive().default(10),
  pagination_key: paginationKeySchema.nullish(),
});

export const adminListByBatchRequestSchema = z.object({
  batch_id: nonEmptyString,
  username_filter: z.string().nullish(),
  pagination_key: paginationKeySchema.nullish(),
  limit: z.number().int().positive().default(10),
});

export const adminLaunchJobRequestSchema = z
  .object({
    username: z.string().nullish(),
    request_batch_id: z.boolean().default(false),
    add_to_batch: z.string().nullish(),
    job_type: jobTypeSchema,
    job_sub_type: jobSubTypeSchema,
    job_payload: z.record(z.unknown()),
  })
  .superRefine((value, ctx) => {
    if (value.request_batch_id && value.add_to_batch != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot specify both a new batch and an existing batch id.",
      });
    }
  });

/* Job payloads (subset of legacy payloads relevant to launch/validate) */

const ignoredUserInfo = { user_info: z.string().nullish() };

export const wakeUpPayloadSchema = z.object({
  reason: z.string().nullish(),
});

export const provLodgeModelRunPayloadSchema = z.object({
  record: modelRunRecordSchema,
  revalidate: z.boolean(),
  ...ignoredUserInfo,
});

export const provLodgeModelRunLodgeOnlyPayloadSchema = z.object({
  model_run_record_id: nonEmptyString,
  record: modelRunRecordSchema,
  revalidate: z.boolean(),
  ...ignoredUserInfo,
});

export const provLodgeUpdatePayloadSchema = z.object({
  model_run_record_id: nonEmptyString,
  updated_record: modelRunRecordSchema,
  reason: nonEmptyString,
  revalidate: z.boolean(),
  ...ignoredUserInfo,
});

export const provLodgeUpdateLodgeOnlyPayloadSchema = z.object({
  model_run_record_id: nonEmptyString,
  updated_record: modelRunRecordSchema,
  revalidate: z.boolean(),
  ...ignoredUserInfo,
});

export const provLodgeBatchSubmitPayloadSchema = z.object({
  records: z.array(modelRunRecordSchema),
  ...ignoredUserInfo,
});

export const provLodgeCreationPayloadSchema = z.object({
  created_item_id: nonEmptyString,
  creation_activity_id: nonEmptyString,
  linked_person_id: nonEmptyString,
  created_item_subtype: itemSubTypeSchema,
});

export const provLodgeVersionPayloadSchema = z.object({
  from_version_id: nonEmptyString,
  to_version_id: nonEmptyString,
  version_activity_id: nonEmptyString,
  linked_person_id: nonEmptyString,
  item_subtype: itemSubTypeSchema,
});

export const registryRegisterCreateActivityPayloadSchema = z.object({
  created_item_id: nonEmptyString,
  created_item_subtype: itemSubTypeSchema,
  linked_person_id: nonEmptyString,
});

export const registryRegisterVersionActivityPayloadSchema = z.object({
  reason: nonEmptyString,
  version_number: z.number().int(),
  from_version_id: nonEmptyString,
  to_version_id: nonEmptyString,
  linked_person_id: nonEmptyString,
  item_subtype: itemSubTypeSchema,
});

export const emailSendEmailPayloadSchema = z.object({
  email_to: nonEmptyString,
  subject: nonEmptyString,
  body: nonEmptyString,
  reason: nonEmptyString,
});

export const reportGeneratePayloadSchema = z.object({
  id: nonEmptyString,
  item_subtype: itemSubTypeSchema,
  depth: z.number().int().min(1).max(3),
  ...ignoredUserInfo,
});

import type { JobSubType } from "../types/AsyncJobModels.js";

export const JOB_PAYLOAD_SCHEMA_MAP: Record<JobSubType, z.ZodTypeAny> = {
  PROV_LODGE_WAKE_UP: wakeUpPayloadSchema,
  MODEL_RUN_PROV_LODGE: provLodgeModelRunPayloadSchema,
  MODEL_RUN_LODGE_ONLY: provLodgeModelRunLodgeOnlyPayloadSchema,
  MODEL_RUN_BATCH_SUBMIT: provLodgeBatchSubmitPayloadSchema,
  LODGE_CREATE_ACTIVITY: provLodgeCreationPayloadSchema,
  LODGE_VERSION_ACTIVITY: provLodgeVersionPayloadSchema,
  MODEL_RUN_UPDATE: provLodgeUpdatePayloadSchema,
  MODEL_RUN_UPDATE_LODGE_ONLY: provLodgeUpdateLodgeOnlyPayloadSchema,
  REGISTRY_WAKE_UP: wakeUpPayloadSchema,
  REGISTER_CREATE_ACTIVITY: registryRegisterCreateActivityPayloadSchema,
  REGISTER_VERSION_ACTIVITY: registryRegisterVersionActivityPayloadSchema,
  EMAIL_WAKE_UP: wakeUpPayloadSchema,
  SEND_EMAIL: emailSendEmailPayloadSchema,
  GENERATE_REPORT: reportGeneratePayloadSchema,
};
