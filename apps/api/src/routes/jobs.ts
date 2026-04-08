import { Hono } from "hono";
import { fetchJobRequestSchema, launchJobRequestSchema, listJobsRequestSchema } from "@provena/contracts";
import { getCurrentUser, requireAnyRole, requiredAuthMiddleware } from "@provena/auth";
import type { ApiBindings } from "../types";
import { statusResponse } from "../utils/http";

const USER_ROLES = ["job-service-read", "job-service-write", "job-service-admin"] as const;
const ADMIN_WRITE_ROLES = ["job-service-write", "job-service-admin"] as const;
const ADMIN_READ_ANY_ROLES = ["job-service-read", "job-service-write", "job-service-admin"] as const;

export const createJobsRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();
  router.use("/jobs/*", requiredAuthMiddleware);

  router.get("/jobs/user/fetch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, USER_ROLES);
    const parsed = fetchJobRequestSchema.safeParse({ id: c.req.query("session_id") ?? "" });
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.fetchForUser(parsed.data.id, user.username);
    return c.json(response);
  });

  router.post("/jobs/user/list", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, USER_ROLES);
    const parsed = listJobsRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.listForUser(user.username, parsed.data);
    return c.json(response);
  });

  router.post("/jobs/user/list_batch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, USER_ROLES);
    const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const batchId = typeof payload.batch_id === "string" ? payload.batch_id : "";
    if (!batchId) {
      return c.json(statusResponse(false, "Missing batch_id"), 400);
    }
    const parsed = listJobsRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.listBatch(batchId, user.username, parsed.data);
    return c.json(response);
  });

  router.post("/jobs/user/retry", () =>
    new Response(JSON.stringify(statusResponse(false, "Not implemented")), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );

  router.get("/jobs/admin/fetch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ANY_ROLES);
    const parsed = fetchJobRequestSchema.safeParse({ id: c.req.query("session_id") ?? "" });
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.fetchForAdmin(parsed.data.id);
    return c.json(response);
  });

  router.post("/jobs/admin/list", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ANY_ROLES);
    const parsed = listJobsRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.listForAdmin(parsed.data);
    return c.json(response);
  });

  router.post("/jobs/admin/list_batch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ANY_ROLES);
    const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const batchId = typeof payload.batch_id === "string" ? payload.batch_id : "";
    if (!batchId) {
      return c.json(statusResponse(false, "Missing batch_id"), 400);
    }
    const parsed = listJobsRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const usernameFilter =
      typeof payload.username_filter === "string" ? payload.username_filter : undefined;
    const response = await c.get("services").jobs.listBatch(batchId, usernameFilter, parsed.data);
    return c.json(response);
  });

  router.post("/jobs/admin/launch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const parsed = launchJobRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(statusResponse(false, parsed.error.message), 400);
    }
    const response = await c.get("services").jobs.launch({
      username: parsed.data.username,
      jobType: parsed.data.job_type,
      jobSubType: parsed.data.job_sub_type ?? null,
      payload: parsed.data.payload,
    });
    return c.json(response);
  });

  router.post("/jobs/admin/retry", () =>
    new Response(JSON.stringify(statusResponse(false, "Not implemented")), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  );
  return router;
};
