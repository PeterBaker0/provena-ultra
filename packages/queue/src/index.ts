import PgBoss from "pg-boss";
import type { Env } from "@provena/config";
import type { Logger } from "@provena/observability";

export interface JobMessage<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  sessionId: string;
  jobType: string;
  jobSubType?: string | null;
  payload: TPayload;
  username: string;
}

export const queueNameFrom = (jobType: string, jobSubType?: string | null): string =>
  jobSubType ? `${jobType}.${jobSubType}` : jobType;

export interface QueueService {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  publish: <TPayload extends Record<string, unknown>>(
    message: JobMessage<TPayload>,
  ) => Promise<string>;
  work: (
    queueName: string,
    handler: (message: JobMessage) => Promise<void>,
  ) => Promise<void>;
}

export const createQueueService = (env: Env, logger: Logger): QueueService => {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
  });

  let started = false;

  return {
    start: async () => {
      if (started) {
        return;
      }

      await boss.start();
      started = true;
      logger.info("Queue service started", { schema: env.PG_BOSS_SCHEMA });
    },
    stop: async () => {
      if (!started) {
        return;
      }

      await boss.stop();
      started = false;
      logger.info("Queue service stopped");
    },
    publish: async (message) => {
      const queueName = queueNameFrom(message.jobType, message.jobSubType);
      await boss.createQueue(queueName);
      const id = await boss.send(queueName, message);
      if (!id) {
        throw new Error(`Failed to enqueue message for ${queueName}`);
      }
      return id;
    },
    work: async (queueName, handler) => {
      await boss.createQueue(queueName);
      await boss.work<JobMessage>(queueName, async (jobs) => {
        for (const job of jobs) {
          if (!job.data) {
            continue;
          }
          await handler(job.data);
        }
      });
      logger.info("Queue worker registered", { queueName });
    },
  };
};
