/**
 * Monolithic Provena API - mounts each legacy service as a router group:
 *
 *   /api/auth        <- auth-api
 *   /api/registry    <- registry-api
 *   /api/data-store  <- data-store-api
 *   /api/prov        <- prov-api
 *   /api/search      <- search-api
 *   /api/handle      <- id-service-api
 *   /api/job         <- job-api
 *   /api/warmer      <- lambda warmer (stub)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getConfig } from "@provena/config";
import type { AuthEnv } from "@provena/auth";
import { ApiError } from "./errors.js";
import { buildRegistryRouter } from "./routers/registry/index.js";
import { buildDataStoreRouter } from "./routers/datastore/index.js";
import { buildProvRouter } from "./routers/prov/index.js";
import { buildAuthRouter } from "./routers/auth/index.js";
import { buildSearchRouter } from "./routers/search/index.js";
import { buildHandleRouter } from "./routers/handle/index.js";
import { buildJobRouter } from "./routers/job/index.js";

export const buildApp = (): Hono<AuthEnv> => {
  const app = new Hono<AuthEnv>();
  const config = getConfig();

  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.use(
    "*",
    cors({
      origin: origins.includes("*") ? "*" : origins,
      credentials: !origins.includes("*"),
      allowHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    }),
  );

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ detail: error.detail }, error.statusCode as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ detail: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      /* FastAPI-style 422 validation error shape. */
      return c.json(
        {
          detail: error.issues.map((issue) => ({
            loc: ["body", ...issue.path],
            msg: issue.message,
            type: issue.code,
          })),
        },
        422,
      );
    }
    console.error("[api] unhandled error:", error);
    return c.json({ detail: `Internal server error: ${(error as Error).message}` }, 500);
  });

  app.get("/", (c) => c.json({ message: "Health check successful." }));

  app.route("/api/registry", buildRegistryRouter());
  app.route("/api/data-store", buildDataStoreRouter());
  app.route("/api/prov", buildProvRouter());
  app.route("/api/auth", buildAuthRouter());
  app.route("/api/search", buildSearchRouter());
  app.route("/api/handle", buildHandleRouter());
  app.route("/api/job", buildJobRouter());

  /* Warmer stub - legacy lambda warmer compatibility for UIs. */
  app.get("/api/warmer", (c) => c.json({ message: "warmed" }));
  app.post("/api/warmer", (c) => c.json({ message: "warmed" }));

  return app;
};
