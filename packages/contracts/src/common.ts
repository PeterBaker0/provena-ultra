import { z } from "zod";

export const statusSchema = z.object({
  success: z.boolean(),
  details: z.string().optional(),
});

export type Status = z.infer<typeof statusSchema>;

export const userSchema = z.object({
  username: z.string(),
  roles: z.array(z.string()),
  rawToken: z.string().optional(),
});

export type User = z.infer<typeof userSchema>;

export const paginationSchema = z.object({
  limit: z.number().int().positive().default(50),
  offset: z.number().int().min(0).default(0),
});

export const paginatedRequestSchema = z.object({
  pagination: paginationSchema.optional(),
  query: z.record(z.unknown()).optional(),
});

export const paginatedResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  records: z.array(z.unknown()),
});

export type PaginatedRequest = z.infer<typeof paginatedRequestSchema>;
export type PaginatedResponse = z.infer<typeof paginatedResponseSchema>;
