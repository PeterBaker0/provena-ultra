import { Hono } from "hono";
import { getCurrentUser, requiredAuthMiddleware, requireAnyRole } from "@provena/auth";
import type { ApiBindings } from "../types";
import { badRequest } from "../utils/http";

const ADMIN_READ_ROLES = ["sys-admin-read", "sys-admin-write", "sys-admin-admin"] as const;
const ADMIN_WRITE_ROLES = ["sys-admin-write", "sys-admin-admin"] as const;
const ADMIN_ADMIN_ROLES = ["sys-admin-admin"] as const;

export const createAccessControlRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.post("/user/request-change", async (c) => {
    const user = getCurrentUser(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const requestedRoles = Array.isArray(body.requested_roles)
      ? body.requested_roles.filter((entry: unknown): entry is string => typeof entry === "string")
      : Array.isArray(body.requestedRoles)
        ? body.requestedRoles.filter((entry: unknown): entry is string => typeof entry === "string")
        : [];
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!reason) {
      return badRequest(c, "reason is required");
    }
    return c.json(
      await c.get("services").auth.requestAccessChange(user.username, requestedRoles, reason),
    );
  });

  router.get("/user/request-history", async (c) => {
    const user = getCurrentUser(c);
    return c.json(
      await c.get("services").auth.listAccessRequests({
        pendingOnly: false,
        username: user.username,
      }),
    );
  });

  router.get("/user/pending-request-history", async (c) => {
    const user = getCurrentUser(c);
    return c.json(
      await c.get("services").auth.listAccessRequests({
        pendingOnly: true,
        username: user.username,
      }),
    );
  });

  router.get("/user/generate-access-report", async (c) => {
    const user = getCurrentUser(c);
    return c.json({
      status: { success: true },
      report: await c.get("services").auth.generateAccessReport(user.username),
    });
  });

  router.get("/admin/all-pending-request-history", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    return c.json(await c.get("services").auth.listAccessRequests({ pendingOnly: true }));
  });

  router.get("/admin/all-request-history", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    return c.json(await c.get("services").auth.listAccessRequests({ pendingOnly: false }));
  });

  router.get("/admin/user-pending-request-history", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const username = c.req.query("username");
    if (!username) {
      return badRequest(c, "username is required");
    }
    return c.json(
      await c.get("services").auth.listAccessRequests({ pendingOnly: true, username }),
    );
  });

  router.get("/admin/user-request-history", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const username = c.req.query("username");
    if (!username) {
      return badRequest(c, "username is required");
    }
    return c.json(
      await c.get("services").auth.listAccessRequests({ pendingOnly: false, username }),
    );
  });

  router.post("/admin/add-note", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.request_id === "string" ? body.request_id : undefined);
    const note = typeof body.note === "string" ? body.note : "";
    if (!id || !note) {
      return badRequest(c, "id/request_id and note are required");
    }
    const updated = await c.get("services").auth.addAccessRequestNote(id, note);
    if (!updated.item) {
      return c.json(updated, 404);
    }
    return c.json(updated);
  });

  router.post("/admin/change-request-state", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.request_id === "string" ? body.request_id : undefined);
    const status =
      typeof body.status === "string"
        ? body.status
        : typeof body.desired_state === "string"
          ? body.desired_state
          : undefined;
    const note =
      (typeof body.note === "string" ? body.note : undefined) ??
      (typeof body.additional_note === "string" ? body.additional_note : undefined);
    if (!id || !status) {
      return badRequest(c, "id/request_id and status/desired_state are required");
    }
    const updated = await c.get("services").auth.changeAccessRequestStatus(id, status as never, note);
    if (!updated.item) {
      return c.json(updated, 404);
    }
    return c.json(updated);
  });

  router.post("/admin/delete-request", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ADMIN_ROLES);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.request_id === "string" ? body.request_id : undefined);
    if (!id) {
      return badRequest(c, "id/request_id is required");
    }
    const deleted = await c.get("services").auth.deleteAccessRequest(id);
    if (!deleted.item) {
      return c.json(deleted, 404);
    }
    return c.json(deleted);
  });

  return router;
};
