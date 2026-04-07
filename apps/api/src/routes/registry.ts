import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiBindings } from "../types";
import { requiredAuthMiddleware } from "@provena/auth";
import { parseJsonBody, parsePagination, statusPayload, withDatasetAlias } from "../utils/http";

const subtypeMap = {
  person: "agent",
  organisation: "agent",
  model: "entity",
  dataset_template: "entity",
  model_run_workflow_template: "entity",
  dataset: "entity",
  study: "activity",
  create: "activity",
  version: "activity",
  model_run: "activity",
} as const;

type Subtype = keyof typeof subtypeMap;
type ApiContext = Context<ApiBindings>;

const routeForSubtype = (router: Hono<ApiBindings>, subtype: Subtype): void => {
  const category = subtypeMap[subtype];
  const base = `/${category}/${subtype}`;

  router.post(`${base}/list`, async (c) => {
    const body = await parseJsonBody(c);
    const { limit, offset } = parsePagination(body);
    const listed = await c.get("services").registry.list({
      category,
      subtype,
      limit,
      offset,
      filter: typeof body.filter === "string" ? body.filter : undefined,
    });
    return c.json(listed);
  });

  const fetchHandler = async (c: ApiContext) => {
    const id = c.req.query("id") ?? c.req.query("item_id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(await c.get("services").registry.fetch(id));
  };

  router.get(`${base}/fetch`, fetchHandler);
  router.get(`${base}/proxy/fetch`, fetchHandler);

  const createLike = async (c: ApiContext) => {
    const body = await parseJsonBody(c);
    const displayName =
      (typeof body.display_name === "string" && body.display_name) ||
      (typeof body.name === "string" && body.name) ||
      `${subtype}-${Date.now()}`;
    return c.json(
      await c.get("services").registry.create({
        category,
        subtype,
        id: typeof body.id === "string" ? body.id : undefined,
        ownerUsername: c.get("user")?.username ?? "system",
        displayName,
        record: body,
      }),
    );
  };

  router.post(`${base}/seed`, createLike);
  router.post(`${base}/create`, createLike);
  router.post(`${base}/proxy/create`, createLike);

  const updateLike = async (
    c: ApiContext,
    action: "update" | "revert" | "version",
  ) => {
    const body = await parseJsonBody(c);
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    const actor = c.get("user")?.username ?? "system";
    if (action === "revert") {
      return c.json(
        await c.get("services").registry.revert({
          id,
          historyId: typeof body.history_id === "string" ? body.history_id : undefined,
          updatedBy: actor,
        }),
      );
    }
    if (action === "version") {
      return c.json(
        await c.get("services").registry.version({
          id,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          updatedBy: actor,
        }),
      );
    }
    return c.json(
      await c.get("services").registry.update({
        id,
        updatedBy: actor,
        displayName: typeof body.display_name === "string" ? body.display_name : undefined,
        record: body,
      }),
    );
  };

  router.put(`${base}/update`, async (c) => updateLike(c, "update"));
  router.put(`${base}/proxy/update`, async (c) => updateLike(c, "update"));
  router.put(`${base}/revert`, async (c) => updateLike(c, "revert"));
  router.put(`${base}/proxy/revert`, async (c) => updateLike(c, "revert"));
  router.post(`${base}/version`, async (c) => updateLike(c, "version"));
  router.post(`${base}/proxy/version`, async (c) => updateLike(c, "version"));

  router.get(`${base}/schema`, (c) => c.json({ status: statusPayload(true), schema: { type: "object", additionalProperties: true } }));
  router.get(`${base}/ui_schema`, (c) => c.json({ status: statusPayload(true), ui_schema: {} }));
  router.post(`${base}/validate`, (c) => c.json({ status: statusPayload(true, "Validation successful.") }));
  router.get(`${base}/auth/evaluate`, (c) => c.json({ status: statusPayload(true), roles: [] }));
  router.get(`${base}/auth/configuration`, async (c) => {
    const id = c.req.query("id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(await c.get("services").registry.getAuthConfiguration(id));
  });
  router.put(`${base}/auth/configuration`, async (c) => {
    const body = await parseJsonBody(c);
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    const groups = Array.isArray(body.groups)
      ? body.groups.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return [];
          }
          const groupName =
            typeof (entry as Record<string, unknown>).group_name === "string"
              ? ((entry as Record<string, unknown>).group_name as string)
              : null;
          const roles = Array.isArray((entry as Record<string, unknown>).roles)
            ? ((entry as Record<string, unknown>).roles as unknown[]).filter(
                (role): role is string => typeof role === "string",
              )
            : [];
          return groupName ? [{ group_name: groupName, roles }] : [];
        })
      : [];
    return c.json(
      await c.get("services").registry.setAuthConfiguration({
        id,
        openAccess: Boolean(body.open_access),
        groups,
      }),
    );
  });
  router.get(`${base}/auth/roles`, (c) => c.json({ status: statusPayload(true), roles: [] }));
  router.put(`${base}/locks/lock`, async (c) => {
    const body = await parseJsonBody(c);
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(
      await c.get("services").registry.lock(
        id,
        c.get("user")?.username ?? "system",
        typeof body.reason === "string" ? body.reason : undefined,
      ),
    );
  });
  router.put(`${base}/locks/unlock`, async (c) => {
    const body = await parseJsonBody(c);
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(
      await c.get("services").registry.unlock(
        id,
        c.get("user")?.username ?? "system",
        typeof body.reason === "string" ? body.reason : undefined,
      ),
    );
  });
  router.get(`${base}/locks/history`, async (c) => {
    const id = c.req.query("id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id"), events: [] }, 400);
    }
    return c.json(await c.get("services").registry.lockHistory(id));
  });
  router.get(`${base}/locks/locked`, async (c) => {
    const id = c.req.query("id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id"), locked: false }, 400);
    }
    return c.json(await c.get("services").registry.isLocked(id));
  });
  router.delete(`${base}/delete`, async (c) => {
    const id = c.req.query("id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(await c.get("services").registry.delete(id));
  });
};

export const createRegistryRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.post("/general/list", async (c) => {
    const body = await parseJsonBody(c);
    const { limit, offset } = parsePagination(body);
    const listed = await c.get("services").registry.list({
      category: typeof body.category === "string" ? body.category : undefined,
      subtype: typeof body.subtype === "string" ? body.subtype : undefined,
      filter: typeof body.filter === "string" ? body.filter : undefined,
      limit,
      offset,
    });
    return c.json(listed);
  });

  const fetchGeneral = async (c: ApiContext) => {
    const id = c.req.query("id") ?? c.req.query("item_id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    return c.json(await c.get("services").registry.fetch(id));
  };

  router.get("/general/fetch", fetchGeneral);
  router.get("/general/proxy/fetch", fetchGeneral);
  router.get("/general/about/version", () =>
    new Response(
      JSON.stringify({
        status: statusPayload(true),
        commit_id: process.env.GIT_COMMIT_ID ?? "development",
        release: "v2",
      }),
      { headers: { "content-type": "application/json" } },
    ));

  router.post("/entity/dataset/user/releases", async (c) => {
    const body = await parseJsonBody(c);
    const { limit, offset } = parsePagination(body);
    const listed = await c.get("services").registry.list({
      category: "entity",
      subtype: "dataset",
      limit,
      offset,
      filter: undefined,
    });
    return c.json(
      withDatasetAlias({
        status: listed.status,
        records: listed.records,
        count: listed.count,
      }),
    );
  });

  (Object.keys(subtypeMap) as Subtype[]).forEach((subtype) => routeForSubtype(router, subtype));

  return router;
};
