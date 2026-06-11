/**
 * Zod schemas for provenance models, ported from legacy
 * `ProvenaInterfaces/ProvenanceModels.py` / `ProvenanceAPI.py`.
 */
import { z } from "zod";
import { nonEmptyString, unixTimestamp } from "./common.js";

export const datasetTypeSchema = z.enum(["DATA_STORE"]);

export const templatedDatasetSchema = z.object({
  dataset_template_id: nonEmptyString,
  dataset_id: nonEmptyString,
  dataset_type: datasetTypeSchema,
  resources: z.record(z.string()).nullish(),
});

export const associationInfoSchema = z.object({
  modeller_id: nonEmptyString,
  requesting_organisation_id: nonEmptyString.nullish(),
});

export const modelRunRecordSchema = z
  .object({
    workflow_template_id: nonEmptyString,
    model_version: nonEmptyString.nullish(),
    inputs: z.array(templatedDatasetSchema),
    outputs: z.array(templatedDatasetSchema),
    annotations: z.record(z.string()).nullish(),
    display_name: nonEmptyString,
    description: nonEmptyString,
    study_id: nonEmptyString.nullish(),
    associations: associationInfoSchema,
    start_time: unixTimestamp,
    end_time: unixTimestamp,
  })
  .superRefine((value, ctx) => {
    if (value.start_time > value.end_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start_time"],
        message: `The 'start_time' value (${value.start_time}) must be smaller than or equal to the 'end_time' value (${value.end_time}).`,
      });
    }
  });

export type ModelRunRecordInput = z.input<typeof modelRunRecordSchema>;
export type ModelRunRecordParsed = z.output<typeof modelRunRecordSchema>;

/* Requests */

export const registerBatchModelRunRequestSchema = z.object({
  records: z.array(modelRunRecordSchema),
});

export const postUpdateModelRunInputSchema = z.object({
  model_run_id: nonEmptyString,
  reason: nonEmptyString,
  record: modelRunRecordSchema,
});

export const generateReportRequestSchema = z.object({
  id: nonEmptyString,
  // Full subtype enum for surface compat - handler enforces supported subtypes
  // (STUDY / MODEL_RUN) like the legacy report generator did.
  item_subtype: z.enum([
    "WORKFLOW_RUN",
    "MODEL_RUN",
    "STUDY",
    "CREATE",
    "VERSION",
    "PERSON",
    "ORGANISATION",
    "SOFTWARE",
    "MODEL",
    "WORKFLOW_TEMPLATE",
    "MODEL_RUN_WORKFLOW_TEMPLATE",
    "DATASET",
    "DATASET_TEMPLATE",
  ]),
  depth: z.number().int().min(1).max(3),
});

export const postDeleteGraphRequestSchema = z.object({
  record_id: nonEmptyString,
  trial_mode: z.boolean().default(false),
});
