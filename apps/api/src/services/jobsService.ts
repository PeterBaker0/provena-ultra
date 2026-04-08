import { randomUUID } from "node:crypto";
import type { DbClient } from "@provena/db";
import {
  createJob,
  fetchJobBySessionId,
  listJobs,
  listJobsByBatchId,
  updateJobStatus,
} from "@provena/db";
import type { QueueService } from "@provena/queue";
import { statusPayload } from "../utils/http";

type JobRow = Awaited<ReturnType<typeof fetchJobBySessionId>>;

const toIso = (value: Date): string => value.toISOString();

const mapJob = (job: NonNullable<JobRow>) => ({
  id: job.id,
  session_id: job.sessionId,
  batch_id: job.batchId,
  username: job.username,
  job_type: job.jobType,
  job_sub_type: job.jobSubType,
  payload: job.payload,
  status: job.status,
  status_info: job.statusInfo,
  result: job.result,
  created_at: toIso(job.createdAt),
  updated_at: toIso(job.updatedAt),
});

export interface JobsService {
  fetchForUser: (sessionId: string, username: string) => Promise<Record<string, unknown>>;
  fetchForAdmin: (sessionId: string) => Promise<Record<string, unknown>>;
  listForUser: (
    username: string,
    input: { limit: number; offset: number },
  ) => Promise<Record<string, unknown>>;
  listForAdmin: (input: {
    username?: string;
    limit: number;
    offset: number;
  }) => Promise<Record<string, unknown>>;
  listBatch: (
    batchId: string,
    usernameFilter: string | undefined,
    input: { limit: number; offset: number },
  ) => Promise<Record<string, unknown>>;
  launch: (input: {
    username: string;
    jobType: string;
    jobSubType: string | null;
    payload: Record<string, unknown>;
    batchId?: string | null;
  }) => Promise<Record<string, unknown>>;
  markInProgress: (sessionId: string) => Promise<void>;
  markSucceeded: (sessionId: string, result?: Record<string, unknown> | null) => Promise<void>;
  markFailed: (
    sessionId: string,
    statusInfo?: Record<string, unknown> | null,
    result?: Record<string, unknown> | null,
  ) => Promise<void>;
}

export const createJobsService = (db: DbClient, queue: QueueService): JobsService => ({
  fetchForUser: async (sessionId, username) => {
    const job = await fetchJobBySessionId(db, sessionId);
    if (!job || job.username !== username) {
      return {
        status: statusPayload(false, "Item was not found."),
        job: null,
      };
    }
    return {
      status: statusPayload(true),
      job: mapJob(job),
    };
  },
  fetchForAdmin: async (sessionId) => {
    const job = await fetchJobBySessionId(db, sessionId);
    return {
      status: statusPayload(Boolean(job), job ? undefined : "Item was not found."),
      job: job ? mapJob(job) : null,
    };
  },
  listForUser: async (username, input) => {
    const listed = await listJobs(db, {
      username,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      status: statusPayload(true),
      jobs: listed.jobs.map(mapJob),
      total: listed.total,
    };
  },
  listForAdmin: async (input) => {
    const listed = await listJobs(db, {
      username: input.username,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      status: statusPayload(true),
      jobs: listed.jobs.map(mapJob),
      total: listed.total,
    };
  },
  listBatch: async (batchId, usernameFilter, input) => {
    const jobs = await listJobsByBatchId(
      db,
      batchId,
      usernameFilter,
      input.limit,
      input.offset,
    );
    return {
      status: statusPayload(true),
      jobs: jobs.map(mapJob),
      total: jobs.length,
    };
  },
  launch: async ({ username, jobType, jobSubType, payload, batchId }) => {
    const sessionId = randomUUID();
    const created = await createJob(db, {
      sessionId,
      batchId: batchId ?? null,
      username,
      jobType,
      jobSubType,
      payload,
      status: "PENDING",
    });
    await queue.publish({
      sessionId: created.sessionId,
      username: created.username,
      jobType: created.jobType,
      jobSubType: created.jobSubType,
      payload: created.payload,
    });
    return {
      status: statusPayload(true),
      job: mapJob(created),
      session_id: created.sessionId,
      batch_id: created.batchId,
    };
  },
  markInProgress: async (sessionId) => {
    await updateJobStatus(db, sessionId, "IN_PROGRESS");
  },
  markSucceeded: async (sessionId, result) => {
    await updateJobStatus(db, sessionId, "SUCCEEDED", null, result ?? null);
  },
  markFailed: async (sessionId, statusInfo, result) => {
    await updateJobStatus(db, sessionId, "FAILED", statusInfo ?? null, result ?? null);
  },
});
