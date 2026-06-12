/**
 * Background task system: pg-boss (Postgres-backed queue) + the legacy-shaped
 * `job_session` table.
 *
 * Replaces the legacy SNS/SQS/ECS "job system". Tasks are submitted via
 * `submitJob` which (1) creates a job_session row (PENDING) and (2) enqueues
 * a pg-boss job referencing the session. Workers (embedded in the API or the
 * standalone worker app) dispatch on the job sub type to a registered
 * handler, transitioning the session through
 * PENDING -> DEQUEUED -> IN_PROGRESS -> SUCCEEDED/FAILED.
 */
import PgBoss from "pg-boss";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "@provena/config";
import { getDb, makeJobRepo, type JobSessionRecord } from "@provena/db";
import type { JobSubType, JobType } from "@provena/interfaces/types/AsyncJobModels";
import { jobTypeForSubType, WAKE_UP_SUB_TYPES } from "@provena/interfaces";

export const JOB_QUEUE_NAME = "provena-jobs";

let boss: PgBoss | undefined;
let bossStarted = false;

export const getBoss = async (): Promise<PgBoss> => {
  if (!boss) {
    boss = new PgBoss({
      connectionString: getConfig().DATABASE_URL,
      schema: "pgboss",
    });
    boss.on("error", (error) => {
      console.error("[pg-boss] error:", error);
    });
  }
  if (!bossStarted) {
    await boss.start();
    await boss.createQueue(JOB_QUEUE_NAME);
    bossStarted = true;
  }
  return boss;
};

export const stopBoss = async (): Promise<void> => {
  if (boss && bossStarted) {
    await boss.stop({ graceful: true, wait: true });
  }
  boss = undefined;
  bossStarted = false;
};

/* ------------------------------ submission ------------------------------- */

export interface SubmitJobInput {
  username: string;
  jobSubType: JobSubType;
  payload: Record<string, unknown>;
  /** Explicit job type override (defaults from sub type). */
  jobType?: JobType;
  batchId?: string | null;
}

export interface SubmittedJob {
  sessionId: string;
  batchId: string | null;
}

export const submitJob = async (input: SubmitJobInput): Promise<SubmittedJob> => {
  const jobs = makeJobRepo(getDb());
  const session = await jobs.create({
    username: input.username,
    jobType: input.jobType ?? jobTypeForSubType(input.jobSubType),
    jobSubType: input.jobSubType,
    payload: input.payload,
    batchId: input.batchId ?? null,
  });
  const queue = await getBoss();
  await queue.send(JOB_QUEUE_NAME, { sessionId: session.session_id }, { retryLimit: 0 });
  return { sessionId: session.session_id, batchId: session.batch_id };
};

export const newBatchId = (): string => uuidv4();

/* ------------------------------- handlers -------------------------------- */

export interface JobContext {
  sessionId: string;
  username: string;
  batchId: string | null;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  context: JobContext,
) => Promise<Record<string, unknown>>;

const handlers = new Map<JobSubType, JobHandler>();

export const registerJobHandler = (subType: JobSubType, handler: JobHandler): void => {
  handlers.set(subType, handler);
};

export const registeredHandlerCount = (): number => handlers.size;

/* Wake-up jobs succeed immediately - register defaults. */
for (const wakeUp of WAKE_UP_SUB_TYPES) {
  registerJobHandler(wakeUp, async () => ({}));
}

/* -------------------------------- worker --------------------------------- */

const processSession = async (sessionId: string): Promise<void> => {
  const jobs = makeJobRepo(getDb());
  const session = await jobs.get(sessionId);
  if (!session) {
    console.error(`[jobs] session ${sessionId} not found - skipping`);
    return;
  }
  await jobs.setStatus(sessionId, "IN_PROGRESS");
  const handler = handlers.get(session.job_sub_type);
  if (!handler) {
    await jobs.setStatus(
      sessionId,
      "FAILED",
      `No handler registered for job sub type ${session.job_sub_type}.`,
    );
    return;
  }
  try {
    const result = await handler(session.payload, {
      sessionId,
      username: session.username,
      batchId: session.batch_id,
    });
    await jobs.setStatus(sessionId, "SUCCEEDED", "Job completed successfully.", result);
  } catch (error) {
    const message = error instanceof Error ? `${error.message}` : String(error);
    console.error(`[jobs] session ${sessionId} (${session.job_sub_type}) failed:`, error);
    await jobs.setStatus(sessionId, "FAILED", message);
  }
};

export interface WorkerOptions {
  /** Concurrent fetch batch size (default 5). */
  batchSize?: number;
}

export const startWorker = async (options: WorkerOptions = {}): Promise<void> => {
  const queue = await getBoss();
  await queue.work<{ sessionId: string }>(
    JOB_QUEUE_NAME,
    { batchSize: options.batchSize ?? 5 },
    async (bossJobs) => {
      for (const bossJob of bossJobs) {
        const jobs = makeJobRepo(getDb());
        await jobs.setStatus(bossJob.data.sessionId, "DEQUEUED");
        await processSession(bossJob.data.sessionId);
      }
    },
  );
  console.log(`[jobs] worker listening on queue '${JOB_QUEUE_NAME}'`);
};

/**
 * Retry a job - re-enqueues the same session (legacy retry endpoint
 * semantics: produces a NEW session with the same payload).
 */
export const retryJob = async (sessionId: string): Promise<SubmittedJob> => {
  const jobs = makeJobRepo(getDb());
  const session = await jobs.get(sessionId);
  if (!session) throw new Error(`Job session ${sessionId} not found.`);
  return submitJob({
    username: session.username,
    jobType: session.job_type,
    jobSubType: session.job_sub_type,
    payload: session.payload,
    batchId: session.batch_id,
  });
};

export type { JobSessionRecord };
