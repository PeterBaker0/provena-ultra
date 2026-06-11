/**
 * Standalone background worker - processes the pg-boss queue using the
 * shared job handlers from the API package. Use when running the API with
 * WORKER_EMBEDDED=false (e.g. to scale workers independently in compose).
 */
import { runMigrations } from "@provena/db";
import { startWorker, stopBoss } from "@provena/jobs";
import { registerAllJobHandlers } from "@provena/api";

const main = async (): Promise<void> => {
  await runMigrations();
  console.log("[worker] database migrations applied");
  registerAllJobHandlers();
  await startWorker({ batchSize: 10 });
  console.log("[worker] processing jobs");
};

const shutdown = async (): Promise<void> => {
  console.log("[worker] shutting down");
  await stopBoss();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("[worker] fatal startup error:", error);
  process.exit(1);
});
