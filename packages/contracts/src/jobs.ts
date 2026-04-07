import { z } from "zod";
import { statusSchema } from "./common";

export const jobStatusSchema = z.enum([
  "PENDING",
  "DEQUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobSchema = z.object({
  id: z.string(),
  session_id: z.string().uuid(),
  batch_id: z.string().uuid().nullable(),
  username: z.string(),
  job_type: z.string(),
  job_sub_type: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: jobStatusSchema,
  status_info: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Job = z.infer<typeof jobSchema>;

export const fetchJobRequestSchema = z.object({
  id: z.string(),
});

export const listJobsRequestSchema = z.object({
  username: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const launchJobRequestSchema = z.object({
  job_type: z.string(),
  job_sub_type: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  username: z.string(),
});

export const fetchJobResponseSchema = z.object({
  status: statusSchema,
  job: jobSchema.nullable(),
});

export const listJobsResponseSchema = z.object({
  status: statusSchema,
  jobs: z.array(jobSchema),
  total: z.number().int(),
});

export const launchJobResponseSchema = z.object({
  status: statusSchema,
  job: jobSchema,
});

export type FetchJobRequest = z.infer<typeof fetchJobRequestSchema>;
export type ListJobsRequest = z.infer<typeof listJobsRequestSchema>;
export type LaunchJobRequest = z.infer<typeof launchJobRequestSchema>;
export type FetchJobResponse = z.infer<typeof fetchJobResponseSchema>;
export type ListJobsResponse = z.infer<typeof listJobsResponseSchema>;
export type LaunchJobResponse = z.infer<typeof launchJobResponseSchema>;
