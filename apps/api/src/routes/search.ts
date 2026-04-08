import { Hono } from "hono";
import { getCurrentUser, requiredAuthMiddleware, requireAnyRole } from "@provena/auth";
import type { ApiBindings } from "../types";
import { statusPayload } from "../utils/http";

export const createSearchRoutes = () => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.get("/search/entity-registry", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["entity-registry-read", "entity-registry-write", "entity-registry-admin"]);
    const query = c.req.query("query") ?? c.req.query("q") ?? "";
    const subtype = c.req.query("subtype") ?? undefined;
    const limit = Number(c.req.query("limit") ?? "25");
    const results = await c.get("services").search.searchEntityRegistry({
      query,
      subtype,
      limit: Number.isFinite(limit) ? limit : 25,
    });
    return c.json({ status: statusPayload(true), results });
  });

  router.get("/search/global", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["entity-registry-read", "entity-registry-write", "entity-registry-admin"]);
    const query = c.req.query("query") ?? c.req.query("q") ?? "";
    const results = await c.get("services").search.searchEntityRegistry({
      query,
      limit: 50,
    });
    return c.json({ status: statusPayload(true), results });
  });

  return router;
};
