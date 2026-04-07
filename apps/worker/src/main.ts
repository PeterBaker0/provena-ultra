import { getEnv } from "@provena/config";
import { getDb, fetchJobBySessionId, updateJobStatus } from "@provena/db";
import { createLogger } from "@provena/observability";
import { createQueueService, queueNameFrom, type JobMessage } from "@provena/queue";

const env = getEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = getDb();
const queue = createQueueService(env, logger);

const safeString = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const processMessage = async (message: JobMessage): Promise<void> => {
  const queueName = queueNameFrom(message.jobType, message.jobSubType);
  logger.info("worker_processing_job", {
    session_id: message.sessionId,
    queue_name: queueName,
    username: message.username,
  });

  const existing = await fetchJobBySessionId(db, message.sessionId);
  if (!existing) {
    logger.warn("worker_missing_job_record", {
      session_id: message.sessionId,
      queue_name: queueName,
    });
    return;
  }

  await updateJobStatus(db, message.sessionId, "IN_PROGRESS", {
    queue_name: queueName,
    started_at: new Date().toISOString(),
  });

  try {
    switch (message.jobType) {
      case "prov":
        await updateJobStatus(
          db,
          message.sessionId,
          "SUCCEEDED",
          {
            queue_name: queueName,
            completed_at: new Date().toISOString(),
          },
          {
            handled_by: "worker",
            domain: "provenance",
            job_type: message.jobType,
            job_sub_type: message.jobSubType ?? null,
          },
        );
        break;
      case "report":
        await updateJobStatus(
          db,
          message.sessionId,
          "SUCCEEDED",
          {
            queue_name: queueName,
            completed_at: new Date().toISOString(),
          },
          {
            handled_by: "worker",
            report_url: null,
          },
        );
        break;
      default:
        await updateJobStatus(
          db,
          message.sessionId,
          "SUCCEEDED",
          {
            queue_name: queueName,
            completed_at: new Date().toISOString(),
          },
          {
            handled_by: "worker",
            note: "Generic completion handler",
          },
        );
        break;
    }

    logger.info("worker_completed_job", {
      session_id: message.sessionId,
      queue_name: queueName,
      job_type: message.jobType,
      job_sub_type: message.jobSubType ?? null,
    });
  } catch (error) {
    await updateJobStatus(
      db,
      message.sessionId,
      "FAILED",
      {
        queue_name: queueName,
        failed_at: new Date().toISOString(),
        error: safeString(error),
      },
      null,
    );
    logger.error("worker_failed_job", {
      session_id: message.sessionId,
      queue_name: queueName,
      error: safeString(error),
    });
  }
};

const registerHandlers = async (): Promise<void> => {
  const queueNames = [
    queueNameFrom("prov", "model_run_lodge"),
    queueNameFrom("prov", "model_run_batch_lodge"),
    queueNameFrom("prov", "model_run_update"),
    queueNameFrom("prov", "model_run_delete"),
    queueNameFrom("prov", "model_run_link_study"),
    queueNameFrom("report", "generate"),
  ];

  for (const queueName of queueNames) {
    await queue.work(queueName, processMessage);
  }
};

const start = async (): Promise<void> => {
  await queue.start();
  await registerHandlers();
  logger.info("worker_started", {
    schema: env.PG_BOSS_SCHEMA,
  });
};

void start().catch((error) => {
  logger.error("worker_startup_failed", {
    error: safeString(error),
  });
  process.exitCode = 1;
});
