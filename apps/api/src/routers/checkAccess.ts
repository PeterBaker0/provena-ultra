/**
 * Shared /check-access router replicating the legacy per-service check
 * endpoints. The auth-api variant additionally exposes /public and /general.
 */
import { Hono } from "hono";
import { toUserResponse, requireUser, type AuthEnv, type ComponentGuards } from "@provena/auth";
import { successStatus } from "../serializers.js";

export const buildCheckAccessRouter = (guards: ComponentGuards): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  router.get("/check-general-access", requireUser(), (c) =>
    c.json(toUserResponse(c.get("user"))),
  );
  router.get("/check-read-access", guards.read, (c) => c.json(toUserResponse(c.get("user"))));
  router.get("/check-write-access", guards.write, (c) => c.json(toUserResponse(c.get("user"))));
  router.get("/check-admin-access", guards.admin, (c) => c.json(toUserResponse(c.get("user"))));
  return router;
};

/** auth-api style check access router (/public + /general). */
export const buildAuthCheckAccessRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  router.get("/public", (c) =>
    c.json(successStatus("Successfully accessed public endpoint.")),
  );
  router.get("/general", requireUser(), (c) => c.json(toUserResponse(c.get("user"))));
  return router;
};
