import { and, count, desc, eq } from "drizzle-orm";
import type { DbClient } from "../client";
import { jobs } from "../schema/core";

const nowIso = (): Date => new Date();

export interface CreateJobInput {
  sessionId: string;
  batchId: string | null;
  username: string;
  jobType: string;
  jobSubType: string | null;
  payload: Record<string, unknown>;
  status?: "PENDING" | "DEQUEUED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
}

export const createJob = async (
  db: DbClient,
  input: CreateJobInput,
): Promise<typeof jobs.$inferSelect> => {
  const [created] = await db
    .insert(jobs)
    .values({
      sessionId: input.sessionId,
      batchId: input.batchId,
      username: input.username,
      jobType: input.jobType,
      jobSubType: input.jobSubType,
      payload: input.payload,
      status: input.status ?? "PENDING",
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create job.");
  }
  return created;
};

export const updateJobStatus = async (
  db: DbClient,
  sessionId: string,
  status: "PENDING" | "DEQUEUED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED",
  statusInfo?: Record<string, unknown> | null,
  result?: Record<string, unknown> | null,
): Promise<typeof jobs.$inferSelect | null> => {
  const [updated] = await db
    .update(jobs)
    .set({
      status,
      statusInfo: statusInfo ?? null,
      result: result ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.sessionId, sessionId))
    .returning();

  return updated ?? null;
};

export const fetchJobBySessionId = async (
  db: DbClient,
  sessionId: string,
): Promise<typeof jobs.$inferSelect | null> => {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.sessionId, sessionId))
    .limit(1);
  return job ?? null;
};

export interface ListJobsInput {
  username?: string;
  limit: number;
  offset: number;
}

export const listJobs = async (
  db: DbClient,
  input: ListJobsInput,
): Promise<{ jobs: Array<typeof jobs.$inferSelect>; total: number }> => {
  const whereClause = input.username ? eq(jobs.username, input.username) : undefined;

  const records = await db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(desc(jobs.createdAt))
    .limit(input.limit)
    .offset(input.offset);

  const [totals] = await db
    .select({ value: count() })
    .from(jobs)
    .where(whereClause);

  return {
    jobs: records,
    total: totals?.value ?? 0,
  };
};

export const listJobsByBatchId = async (
  db: DbClient,
  batchId: string,
  usernameFilter: string | undefined,
  limit: number,
  offset: number,
): Promise<Array<typeof jobs.$inferSelect>> => {
  const whereClause = usernameFilter
    ? and(eq(jobs.batchId, batchId), eq(jobs.username, usernameFilter))
    : eq(jobs.batchId, batchId);

  return db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);
};
