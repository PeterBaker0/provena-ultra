/**
 * API entrypoint - serves the monolithic Hono app and (by default) embeds
 * the background job worker in-process.
 */
import { serve } from "@hono/node-server";
import { getConfig } from "@provena/config";
import { runMigrations } from "@provena/db";
import { startWorker } from "@provena/jobs";
import { getStorageService } from "@provena/storage";
import { buildApp } from "./app.js";
import { registerAllJobHandlers } from "./services/jobHandlers.js";

const main = async (): Promise<void> => {
  const config = getConfig();

  /* Apply migrations on boot (idempotent). */
  try {
    await runMigrations();
    console.log("[api] database migrations applied");
  } catch (error) {
    console.error("[api] migration failure:", error);
    throw error;
  }

  /* Bootstrap the storage bucket (best effort - storage may start later). */
  try {
    await getStorageService().ensureBucket();
    console.log("[api] storage bucket ready");
  } catch (error) {
    console.warn("[api] storage bootstrap failed (continuing):", (error as Error).message);
  }

  registerAllJobHandlers();
  if (config.WORKER_EMBEDDED) {
    await startWorker();
    console.log("[api] embedded job worker started");
  }

  const app = buildApp();
  serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  });
};

main().catch((error) => {
  console.error("[api] fatal startup error:", error);
  process.exit(1);
});
