import { Hono } from "hono";
import { getCurrentUser, requireAnyRole } from "@provena/auth";
import type { ApiBindings } from "../types";
import { parseJsonBody, statusPayload } from "../utils/http";

const handleReadRoles = ["handle-read", "handle-write", "handle-admin", "sys-admin-read"] as const;
const handleWriteRoles = ["handle-write", "handle-admin", "sys-admin-write"] as const;

export const createIdServiceRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();

  router.post("/mint", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleWriteRoles);
  const body = await parseJsonBody(c);
  const value = typeof body.value === "string" ? body.value : "";
  const valueType = typeof body.value_type === "string" ? body.value_type : "";
  if (!value || !valueType) {
    return c.json(statusPayload(false, "value and value_type are required"), 400);
  }

    const response = await c.get("services").handle.mint(value, valueType, user.username);
    return c.json(response);
  });

  router.post("/add_value", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleWriteRoles);
  const body = await parseJsonBody(c);
  const handleId = typeof body.id === "string" ? body.id : "";
  const value = typeof body.value === "string" ? body.value : "";
  const valueType = typeof body.value_type === "string" ? body.value_type : "";
  if (!handleId || !value || !valueType) {
    return c.json(statusPayload(false, "id, value, and value_type are required"), 400);
  }
    return c.json(await c.get("services").handle.addValue(handleId, value, valueType));
  });

  router.post("/add_value_by_index", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleWriteRoles);
  const body = await parseJsonBody(c);
  const handleId = typeof body.id === "string" ? body.id : "";
  const value = typeof body.value === "string" ? body.value : "";
  const valueType = typeof body.value_type === "string" ? body.value_type : "";
  const index = Number(body.index ?? 0);
  if (!handleId || !value || !valueType || !Number.isInteger(index) || index < 1) {
    return c.json(statusPayload(false, "id, value, value_type and positive integer index are required"), 400);
  }
    return c.json(await c.get("services").handle.addValueByIndex(handleId, index, value, valueType));
  });

  router.get("/get", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleReadRoles);
  const handleId = c.req.query("id");
  if (!handleId) {
    return c.json(statusPayload(false, "id query parameter is required"), 400);
  }
    return c.json(await c.get("services").handle.get(handleId));
  });

  router.get("/list", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleReadRoles);
    return c.json(await c.get("services").handle.list());
  });

  router.put("/modify_by_index", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleWriteRoles);
  const body = await parseJsonBody(c);
  const handleId = typeof body.id === "string" ? body.id : "";
  const value = typeof body.value === "string" ? body.value : "";
  const index = Number(body.index ?? 0);
  if (!handleId || !value || !Number.isInteger(index) || index < 1) {
    return c.json(statusPayload(false, "id, value and positive integer index are required"), 400);
  }
    return c.json(await c.get("services").handle.modifyByIndex(handleId, index, value));
  });

  router.post("/remove_by_index", async (c) => {
  const user = getCurrentUser(c);
  requireAnyRole(user, handleWriteRoles);
  const body = await parseJsonBody(c);
  const handleId = typeof body.id === "string" ? body.id : "";
  const index = Number(body.index ?? 0);
  if (!handleId || !Number.isInteger(index) || index < 1) {
    return c.json(statusPayload(false, "id and positive integer index are required"), 400);
  }
    return c.json(await c.get("services").handle.removeByIndex(handleId, index));
  });

  return router;
};
