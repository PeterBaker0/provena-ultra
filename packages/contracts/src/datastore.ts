import { z } from "zod";
import {
  AccessSettingsSchema,
  DomainInfoSchema,
  RegistryItemSchema,
} from "./registry";
import { PaginatedRequestSchema, StatusSchema } from "./common";

export const ValidateMetadataRequestSchema = z.object({
  metadata: z.record(z.string(), z.any()),
  metadata_schema: z.record(z.string(), z.any()).optional(),
});

export const ValidateMetadataResponseSchema = StatusSchema.extend({
  validation_messages: z.array(z.string()).optional(),
});

export const MintDatasetRequestSchema = z.object({
  dataset: DomainInfoSchema,
  access_settings: AccessSettingsSchema,
});

export const UpdateMetadataRequestSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.any()),
});

export const RevertMetadataRequestSchema = z.object({
  id: z.string(),
  history_item_id: z.string(),
});

export const VersionDatasetRequestSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
});

export const DatasetListRequestSchema = PaginatedRequestSchema.extend({
  statuses: z.array(z.string()).optional(),
});

export const DatasetFetchRequestSchema = z.object({
  id: z.string(),
});

export const MintDatasetResponseSchema = StatusSchema.extend({
  id: z.string().optional(),
});

export const UpdateMetadataResponseSchema = StatusSchema.extend({
  item: RegistryItemSchema.optional(),
});

export const VersionDatasetResponseSchema = StatusSchema.extend({
  item: RegistryItemSchema.optional(),
});

export const DatasetListResponseSchema = StatusSchema.extend({
  items: z.array(RegistryItemSchema).default([]),
  total: z.number().int().nonnegative().default(0),
});

export const DatasetFetchResponseSchema = StatusSchema.extend({
  item: RegistryItemSchema.optional(),
});

export const GenerateCredentialsRequestSchema = z.object({
  dataset_id: z.string(),
  prefix: z.string().optional(),
});

export const CredentialResponseSchema = StatusSchema.extend({
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  session_token: z.string().optional(),
  expires_at: z.string().optional(),
  console_url: z.string().nullable().optional(),
});

export const GeneratePresignedUrlRequestSchema = z.object({
  dataset_id: z.string(),
  key: z.string(),
  action: z.enum(["download", "upload"]).default("download"),
  expires_in_seconds: z.number().int().positive().max(86400).default(3600),
});

export const GeneratePresignedUrlResponseSchema = StatusSchema.extend({
  url: z.string().optional(),
});

export const ReviewerActionSchema = z.enum(["approve", "reject"]);

export const ApprovalRequestPayloadSchema = z.object({
  dataset_id: z.string(),
  notes: z.string().optional(),
});

export const ActionApprovalRequestSchema = z.object({
  request_id: z.string(),
  action: ReviewerActionSchema,
  notes: z.string().optional(),
});

export type ValidateMetadataRequest = z.infer<typeof ValidateMetadataRequestSchema>;
export type ValidateMetadataResponse = z.infer<typeof ValidateMetadataResponseSchema>;
export type MintDatasetRequest = z.infer<typeof MintDatasetRequestSchema>;
export type UpdateMetadataRequest = z.infer<typeof UpdateMetadataRequestSchema>;
export type RevertMetadataRequest = z.infer<typeof RevertMetadataRequestSchema>;
export type VersionDatasetRequest = z.infer<typeof VersionDatasetRequestSchema>;
export type DatasetListRequest = z.infer<typeof DatasetListRequestSchema>;
export type DatasetFetchRequest = z.infer<typeof DatasetFetchRequestSchema>;
export type MintDatasetResponse = z.infer<typeof MintDatasetResponseSchema>;
export type UpdateMetadataResponse = z.infer<typeof UpdateMetadataResponseSchema>;
export type VersionDatasetResponse = z.infer<typeof VersionDatasetResponseSchema>;
export type DatasetListResponse = z.infer<typeof DatasetListResponseSchema>;
export type DatasetFetchResponse = z.infer<typeof DatasetFetchResponseSchema>;
export type GenerateCredentialsRequest = z.infer<typeof GenerateCredentialsRequestSchema>;
export type CredentialResponse = z.infer<typeof CredentialResponseSchema>;
export type GeneratePresignedUrlRequest = z.infer<typeof GeneratePresignedUrlRequestSchema>;
export type GeneratePresignedUrlResponse = z.infer<typeof GeneratePresignedUrlResponseSchema>;
export type ApprovalRequestPayload = z.infer<typeof ApprovalRequestPayloadSchema>;
export type ActionApprovalRequest = z.infer<typeof ActionApprovalRequestSchema>;
