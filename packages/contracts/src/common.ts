import { z } from "zod";

export const StatusSchema = z.object({
  status: z.boolean().default(true),
  details: z.string().optional(),
});
export const statusSchema = StatusSchema;
export type Status = z.infer<typeof StatusSchema>;

export const ApiResponseMetaSchema = z.object({
  request_id: z.string().optional(),
  generated_at: z.string().optional(),
});
export type ApiResponseMeta = z.infer<typeof ApiResponseMetaSchema>;

export const UserSchema = z.object({
  username: z.string(),
  roles: z.array(z.string()).default([]),
  raw_token: z.string().optional(),
});
export const userSchema = UserSchema;
export type User = z.infer<typeof UserSchema>;

export const PageRequestSchema = z.object({
  limit: z.number().int().positive().default(50),
  offset: z.number().int().min(0).default(0),
});

export const PaginatedRequestSchema = z.object({
  pagination: PageRequestSchema.optional(),
  query: z.record(z.string(), z.unknown()).optional(),
});
export const paginationSchema = PageRequestSchema;
export const paginatedRequestSchema = PaginatedRequestSchema;
export type PaginatedRequest = z.infer<typeof PaginatedRequestSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(recordSchema: T) =>
  z.object({
    status: z.boolean().default(true),
    count: z.number().int().nonnegative(),
    records: z.array(recordSchema),
  });

export const paginatedResponseSchema = z.object({
  status: z.boolean().default(true),
  count: z.number().int().nonnegative(),
  records: z.array(z.unknown()),
});

export type PaginatedResponse = z.infer<typeof paginatedResponseSchema>;

export const LineageNodeSchema = z.object({
  id: z.string(),
  category: z.string(),
  subtype: z.string(),
  display_name: z.string(),
});
