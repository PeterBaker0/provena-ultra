/**
 * Handle (ID service) API router group - mounted at /api/handle. Internal
 * Postgres-backed handle registry replacing the ARDC Handle Service wrapper.
 */
import { Hono } from "hono";
import { handleGuards, type AuthEnv } from "@provena/auth";
import { handleSchemas } from "@provena/interfaces";
import type { HandleProperty } from "@provena/interfaces/types/HandleModels";
import { getConfig } from "@provena/config";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { badRequest } from "../../errors.js";
import { getContainer } from "../../container.js";

const serializeHandle = (id: string, properties: HandleProperty[]) => ({
  id,
  properties,
});

export const buildHandleRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = handleGuards;

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(guards));

  router.post("/handle/mint", guards.write, async (c) => {
    const body = handleSchemas.mintRequestSchema.parse(await c.req.json());
    const { handles } = getContainer();
    const id = await handles.mint(getConfig().HANDLE_PREFIX, {
      type: body.value_type,
      value: body.value,
      index: 1,
    });
    const properties = await handles.get(id);
    return c.json(serializeHandle(id, properties ?? []));
  });

  router.get("/handle/get", guards.read, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { handles } = getContainer();
    const properties = await handles.get(id);
    if (!properties) throw badRequest(`Handle ${id} does not exist.`);
    return c.json(serializeHandle(id, properties));
  });

  router.get("/handle/list", guards.read, async (c) => {
    const { handles } = getContainer();
    return c.json({ ids: await handles.list() });
  });

  router.post("/handle/add_value", guards.write, async (c) => {
    const body = handleSchemas.addValueRequestSchema.parse(await c.req.json());
    const { handles } = getContainer();
    const properties = await handles.get(body.id);
    if (!properties) throw badRequest(`Handle ${body.id} does not exist.`);
    const nextIndex = properties.reduce((max, p) => Math.max(max, p.index), 0) + 1;
    const updated = [...properties, { type: body.value_type, value: body.value, index: nextIndex }];
    await handles.setProperties(body.id, updated);
    return c.json(serializeHandle(body.id, updated));
  });

  router.post("/handle/add_value_by_index", guards.write, async (c) => {
    const body = handleSchemas.addValueIndexRequestSchema.parse(await c.req.json());
    const { handles } = getContainer();
    const properties = await handles.get(body.id);
    if (!properties) throw badRequest(`Handle ${body.id} does not exist.`);
    if (properties.some((p) => p.index === body.index)) {
      throw badRequest(`Handle ${body.id} already has a value at index ${body.index}.`);
    }
    const updated = [
      ...properties,
      { type: body.value_type, value: body.value, index: body.index },
    ].sort((a, b) => a.index - b.index);
    await handles.setProperties(body.id, updated);
    return c.json(serializeHandle(body.id, updated));
  });

  router.put("/handle/modify_by_index", guards.write, async (c) => {
    const body = handleSchemas.modifyRequestSchema.parse(await c.req.json());
    const { handles } = getContainer();
    const properties = await handles.get(body.id);
    if (!properties) throw badRequest(`Handle ${body.id} does not exist.`);
    const target = properties.find((p) => p.index === body.index);
    if (!target) {
      throw badRequest(`Handle ${body.id} has no value at index ${body.index}.`);
    }
    const updated = properties.map((p) =>
      p.index === body.index ? { ...p, value: body.value } : p,
    );
    await handles.setProperties(body.id, updated);
    return c.json(serializeHandle(body.id, updated));
  });

  router.post("/handle/remove_by_index", guards.write, async (c) => {
    const body = handleSchemas.removeRequestSchema.parse(await c.req.json());
    const { handles } = getContainer();
    const properties = await handles.get(body.id);
    if (!properties) throw badRequest(`Handle ${body.id} does not exist.`);
    if (!properties.some((p) => p.index === body.index)) {
      throw badRequest(`Handle ${body.id} has no value at index ${body.index}.`);
    }
    const updated = properties.filter((p) => p.index !== body.index);
    await handles.setProperties(body.id, updated);
    return c.json(serializeHandle(body.id, updated));
  });

  return router;
};
