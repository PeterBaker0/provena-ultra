import { Hono } from "hono";
import { getCurrentUser, requireAnyRole, requiredAuthMiddleware } from "@provena/auth";
import type { ApiBindings } from "../types";
import { statusPayload } from "../utils/http";

const READ_ROLES = [
  "entity-registry-read",
  "entity-registry-write",
  "entity-registry-admin",
  "sys-admin-read",
  "sys-admin-write",
  "sys-admin-admin",
] as const;
const WRITE_ROLES = ["entity-registry-write", "entity-registry-admin", "sys-admin-write", "sys-admin-admin"] as const;
const ADMIN_ROLES = ["entity-registry-admin", "sys-admin-admin"] as const;

export const createCheckAccessRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();

  router.get("/public", (c) =>
    c.json({
      status: statusPayload(true, "Public access successful."),
    }),
  );

  router.get("/general", requiredAuthMiddleware, (c) => {
    const user = getCurrentUser(c);
    return c.json({
      username: user.username,
      roles: user.roles,
    });
  });

  router.get("/check-general-access", requiredAuthMiddleware, (c) => {
    getCurrentUser(c);
    return c.json(statusPayload(true, "General access granted."));
  });

  router.get("/check-read-access", requiredAuthMiddleware, (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, READ_ROLES);
    return c.json(statusPayload(true, "Read access granted."));
  });

  router.get("/check-write-access", requiredAuthMiddleware, (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, WRITE_ROLES);
    return c.json(statusPayload(true, "Write access granted."));
  });

  router.get("/check-admin-access", requiredAuthMiddleware, (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ROLES);
    return c.json(statusPayload(true, "Admin access granted."));
  });

  return router;
};
