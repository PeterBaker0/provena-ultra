import { Hono } from "hono";
import { getCurrentUser, requireAnyRole, requiredAuthMiddleware } from "@provena/auth";
import type { ApiBindings } from "../types";
import { badRequest, parseJson } from "../utils/http";

export const createLinkRoutes = () => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.get("/user/lookup", async (c) => {
    const user = getCurrentUser(c);
    return c.json(await c.get("services").auth.findUserLinkByUsername(user.username));
  });

  router.post("/user/assign", async (c) => {
    const user = getCurrentUser(c);
    const body = await parseJson(c);
    if (!body.person_id) {
      return badRequest(c, "Missing person_id.");
    }
    return c.json(
      await c
        .get("services")
        .auth.assignUserLink(user.username, String(body.person_id), user.username),
    );
  });

  router.post("/user/validate", async (c) => {
    const user = getCurrentUser(c);
    const link = await c.get("services").auth.findUserLinkByUsername(user.username);
    return c.json({
      status: link.status,
      linked: Boolean(link.person_id),
      person_id: link.person_id,
      link: link.link,
    });
  });

  router.get("/admin/lookup", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["sys-admin-read", "sys-admin-write", "sys-admin-admin"]);
    const username = c.req.query("username");
    if (!username) {
      return badRequest(c, "Missing username.");
    }
    return c.json(await c.get("services").auth.findUserLinkByUsername(username));
  });

  router.post("/admin/assign", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["sys-admin-write", "sys-admin-admin"]);
    const body = await parseJson(c);
    if (!body.username || !body.person_id) {
      return badRequest(c, "Missing username/person_id.");
    }
    return c.json(
      await c
        .get("services")
        .auth.assignUserLink(String(body.username), String(body.person_id), user.username),
    );
  });

  router.delete("/admin/clear", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["sys-admin-write", "sys-admin-admin"]);
    const username = c.req.query("username");
    if (!username) {
      return badRequest(c, "Missing username.");
    }
    return c.json(await c.get("services").auth.clearUserLink(username));
  });

  router.get("/admin/reverse_lookup", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, ["sys-admin-read", "sys-admin-write", "sys-admin-admin"]);
    const personId = c.req.query("person_id");
    if (!personId) {
      return badRequest(c, "Missing person_id.");
    }
    return c.json(await c.get("services").auth.reverseLookupUserLink(personId));
  });

  return router;
};
