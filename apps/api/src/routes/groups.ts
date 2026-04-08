import { Hono } from "hono";
import { getCurrentUser, requiredAuthMiddleware, requireAnyRole } from "@provena/auth";
import type { ApiBindings } from "../types";
import { badRequest, parseJson } from "../utils/http";

const ADMIN_READ_ROLES = ["sys-admin-read", "sys-admin-write", "sys-admin-admin"] as const;
const ADMIN_WRITE_ROLES = ["sys-admin-write", "sys-admin-admin"] as const;
const ADMIN_ADMIN_ROLES = ["sys-admin-admin"] as const;

export const createGroupsRouter = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.get("/user/list_groups", async (c) => {
    const body = await parseJson(c).catch(() => ({} as Record<string, unknown>));
    const filter = typeof body.filter === "string" ? body.filter : c.req.query("filter");
    return c.json(await c.get("services").auth.listGroups(filter));
  });

  router.get("/user/describe_group", async (c) => {
    const id = c.req.query("id");
    if (!id) {
      return badRequest(c, "id is required");
    }
    return c.json(await c.get("services").auth.describeGroup(id));
  });

  router.get("/user/list_user_membership", async (c) => {
    const user = getCurrentUser(c);
    return c.json(await c.get("services").auth.listUserMembership(user.username));
  });

  router.get("/user/list_members", async (c) => {
    const user = getCurrentUser(c);
    const id = c.req.query("id");
    if (!id) {
      return badRequest(c, "id is required");
    }
    const membership = await c.get("services").auth.checkMembership(id, user.username);
    if (!membership.is_member) {
      return c.json(
        {
          status: {
            success: false,
            details: `You are not a member of group with id ${id}.`,
          },
        },
        401,
      );
    }
    return c.json(await c.get("services").auth.listMembers(id));
  });

  router.get("/user/check_membership", async (c) => {
    const user = getCurrentUser(c);
    const groupId = c.req.query("group_id");
    if (!groupId) {
      return badRequest(c, "group_id is required");
    }
    return c.json(await c.get("services").auth.checkMembership(groupId, user.username));
  });

  router.get("/admin/list_groups", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const filter = c.req.query("filter");
    return c.json(await c.get("services").auth.listGroups(filter));
  });

  router.get("/admin/describe_group", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const id = c.req.query("id");
    if (!id) {
      return badRequest(c, "id is required");
    }
    return c.json(await c.get("services").auth.describeGroup(id));
  });

  router.get("/admin/list_members", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const id = c.req.query("id");
    if (!id) {
      return badRequest(c, "id is required");
    }
    return c.json(await c.get("services").auth.listMembers(id));
  });

  router.get("/admin/list_user_membership", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const username = c.req.query("username");
    if (!username) {
      return badRequest(c, "username is required");
    }
    return c.json(await c.get("services").auth.listUserMembership(username));
  });

  router.get("/admin/check_membership", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_READ_ROLES);
    const groupId = c.req.query("group_id");
    const username = c.req.query("username");
    if (!groupId || !username) {
      return badRequest(c, "group_id and username are required");
    }
    return c.json(await c.get("services").auth.checkMembership(groupId, username));
  });

  router.post("/admin/add_member", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await parseJson(c);
    const groupId =
      (typeof body.group_id === "string" ? body.group_id : undefined) ??
      (typeof body.id === "string" ? body.id : undefined);
    const nestedUser =
      typeof body.user === "object" && body.user !== null
        ? (body.user as Record<string, unknown>)
        : undefined;
    const username =
      typeof body.username === "string"
        ? body.username
        : typeof nestedUser?.username === "string"
          ? nestedUser.username
          : undefined;
    if (!groupId || !username) {
      return badRequest(c, "group_id/id and username are required");
    }
    return c.json(await c.get("services").auth.addMember(groupId, username, user.username));
  });

  router.delete("/admin/remove_member", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const groupId = c.req.query("group_id");
    const username = c.req.query("username");
    if (!groupId || !username) {
      return badRequest(c, "group_id and username are required");
    }
    return c.json(await c.get("services").auth.removeMember(groupId, username));
  });

  router.post("/admin/remove_members", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await parseJson(c);
    const groupId =
      (typeof body.group_id === "string" ? body.group_id : undefined) ??
      (typeof body.id === "string" ? body.id : undefined);
    const usernames = Array.isArray(body.member_usernames)
      ? body.member_usernames.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (!groupId || usernames.length === 0) {
      return badRequest(c, "group_id/id and member_usernames are required");
    }
    return c.json(await c.get("services").auth.removeMembers(groupId, usernames));
  });

  router.post("/admin/add_group", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await parseJson(c);
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.name === "string" ? body.name : undefined);
    if (!id) {
      return badRequest(c, "id/name is required");
    }
    const description =
      typeof body.description === "string" ? body.description : null;
    return c.json(await c.get("services").auth.addGroup(id, description));
  });

  router.put("/admin/update_group", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_WRITE_ROLES);
    const body = await parseJson(c);
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.name === "string" ? body.name : undefined);
    if (!id) {
      return badRequest(c, "id/name is required");
    }
    const description =
      typeof body.description === "string" ? body.description : null;
    return c.json(await c.get("services").auth.updateGroup(id, description));
  });

  router.delete("/admin/remove_group", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ADMIN_ROLES);
    const id = c.req.query("id");
    if (!id) {
      return badRequest(c, "id is required");
    }
    return c.json(await c.get("services").auth.removeGroup(id));
  });

  router.get("/admin/export", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ADMIN_ROLES);
    return c.json(await c.get("services").auth.exportGroups());
  });

  router.post("/admin/import", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ADMIN_ROLES);
    const body = await parseJson(c);
    const items = Array.isArray(body.items)
      ? body.items.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      : [];
    return c.json(await c.get("services").auth.importGroups(items));
  });

  router.post("/admin/restore_from_table", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ADMIN_ADMIN_ROLES);
    const tableName = c.req.query("table_name");
    if (!tableName) {
      return badRequest(c, "table_name is required");
    }
    return c.json(await c.get("services").auth.restoreGroupsFromTable(tableName));
  });

  return router;
};
