import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEnv } from "@provena/config";
import { createLogger } from "@provena/observability";
import { optionalAuthMiddleware } from "@provena/auth";
import type { ApiBindings } from "./types";
import { buildServices } from "./services";
import { registerAllRoutes } from "./routes";

const env = getEnv();
const logger = createLogger(env.LOG_LEVEL);
const runtime = buildServices(logger);
const { db, queue, storage, services } = runtime;
void queue.start().catch((error) => {
  logger.error("Failed to start queue service", {
    error: error instanceof Error ? error.message : "unknown",
  });
});

const app = new Hono<ApiBindings>();

app.use("*", async (c, next) => {
  c.set("requestId", randomUUID());
  c.set("logger", logger);
  c.set("db", db);
  c.set("queue", queue);
  c.set("storage", storage);
  c.set("services", services);
  await next();
});

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN_LIST,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    credentials: true,
  }),
);
app.use("*", optionalAuthMiddleware);

registerAllRoutes(app);

app.get("/", (c) =>
  c.json({
    message: "Health check successful.",
  }),
);

export default app;
