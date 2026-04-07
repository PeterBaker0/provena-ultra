import { z } from "zod";
import {
  ApiResponseMetaSchema,
  PageRequestSchema,
  PaginatedResponseSchema,
  StatusSchema,
} from "./common";

export const ItemCategorySchema = z.enum(["activity", "entity", "agent"]);

export const ItemSubTypeSchema = z.enum([
  "person",
  "organisation",
  "dataset",
  "model",
  "study",
  "create",
  "version",
  "model_run",
  "model_run_workflow_template",
  "dataset_template",
]);

export const RegistryItemSchema = z.object({
  id: z.string(),
  category: ItemCategorySchema,
  subtype: ItemSubTypeSchema,
  version: z.number().int().nonnegative(),
  display_name: z.string(),
  owner_username: z.string(),
  record: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RegistryFetchResponseSchema = z.object({
  item: RegistryItemSchema.nullable(),
  status: StatusSchema,
  meta: ApiResponseMetaSchema.optional(),
});

export const RegistryListRequestSchema = z
  .object({
    category: ItemCategorySchema.optional(),
    subtype: ItemSubTypeSchema.optional(),
    filter: z.string().optional(),
    page: PageRequestSchema.optional(),
  })
  .default({});

export const RegistryListResponseSchema = PaginatedResponseSchema(RegistryItemSchema);

export const RegistryMutationRequestSchema = z.object({
  id: z.string().optional(),
  record: z.record(z.string(), z.unknown()),
});

export const RegistryMutationResponseSchema = z.object({
  item: RegistryItemSchema,
  status: StatusSchema,
  meta: ApiResponseMetaSchema.optional(),
});

export const DatasetReleaseRequestSchema = z.object({
  dataset_id: z.string(),
  approver_group: z.string().optional(),
  comment: z.string().optional(),
});

export const DatasetReleaseActionRequestSchema = z.object({
  request_id: z.string(),
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
});

export const DatasetReleaseResponseSchema = z.object({
  request_id: z.string(),
  status: StatusSchema,
});

export type ItemCategory = z.infer<typeof ItemCategorySchema>;
export type ItemSubType = z.infer<typeof ItemSubTypeSchema>;
export type RegistryItem = z.infer<typeof RegistryItemSchema>;
export type RegistryFetchResponse = z.infer<typeof RegistryFetchResponseSchema>;
export type RegistryListRequest = z.infer<typeof RegistryListRequestSchema>;
export type RegistryListResponse = z.infer<typeof RegistryListResponseSchema>;
export type RegistryMutationRequest = z.infer<typeof RegistryMutationRequestSchema>;
export type RegistryMutationResponse = z.infer<typeof RegistryMutationResponseSchema>;
export type DatasetReleaseRequest = z.infer<typeof DatasetReleaseRequestSchema>;
export type DatasetReleaseActionRequest = z.infer<typeof DatasetReleaseActionRequestSchema>;
export type DatasetReleaseResponse = z.infer<typeof DatasetReleaseResponseSchema>;
