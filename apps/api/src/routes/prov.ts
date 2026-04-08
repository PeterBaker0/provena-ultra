import { Hono } from "hono";
import type { Context } from "hono";
import { getCurrentUser, requiredAuthMiddleware, requireAnyRole } from "@provena/auth";
import type { ApiBindings } from "../types";
import { parseJson, statusPayload } from "../utils/http";

const PROV_READ_ROLES = [
  "entity-registry-read",
  "entity-registry-write",
  "entity-registry-admin",
  "sys-admin-read",
  "sys-admin-write",
  "sys-admin-admin",
] as const;
const PROV_WRITE_ROLES = ["entity-registry-write", "entity-registry-admin", "sys-admin-write", "sys-admin-admin"] as const;
const PROV_ADMIN_ROLES = ["entity-registry-admin", "sys-admin-admin"] as const;

type ApiContext = Context<ApiBindings>;

const parseDepth = (input: string | undefined, fallback: number): number => {
  const numeric = Number(input ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.min(Math.trunc(numeric), 100);
};

export const createProvRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();
  router.use("*", requiredAuthMiddleware);

  router.post("/model_run/register", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_WRITE_ROLES);
    const payload = await parseJson(c);
    return c.json(
      await c.get("services").prov.registerModelRun({
        username: user.username,
        payload,
      }),
    );
  });

  router.post("/model_run/register_batch", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_WRITE_ROLES);
    const payload = await parseJson(c);
    return c.json(
      await c.get("services").prov.registerBatch({
        username: user.username,
        payload,
      }),
    );
  });

  router.post("/model_run/register_sync", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_ADMIN_ROLES);
    const payload = await parseJson(c);
    return c.json(await c.get("services").prov.registerSync({ payload }));
  });

  router.post("/model_run/update", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_WRITE_ROLES);
    const payload = await parseJson(c);
    return c.json(
      await c.get("services").prov.updateModelRun({
        username: user.username,
        payload,
      }),
    );
  });

  router.post("/model_run/delete", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_ADMIN_ROLES);
    const payload = await parseJson(c);
    return c.json(
      await c.get("services").prov.deleteModelRun({
        username: user.username,
        payload,
      }),
    );
  });

  router.post("/model_run/edit/link_to_study", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_WRITE_ROLES);
    const payload = await parseJson(c);
    return c.json(
      await c.get("services").prov.linkModelRunToStudy({
        username: user.username,
        modelRunId:
          (typeof payload.model_run_id === "string" ? payload.model_run_id : undefined) ??
          (typeof payload.model_run_id === "string" ? payload.model_run_id : undefined),
        studyId: typeof payload.study_id === "string" ? payload.study_id : undefined,
      }),
    );
  });

  const upstreamHandler = async (c: ApiContext) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 10);
    return c.json(await c.get("services").prov.upstream(startingId, depth));
  };

  const downstreamHandler = async (c: ApiContext) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 10);
    return c.json(await c.get("services").prov.downstream(startingId, depth));
  };

  router.get("/explore/upstream", upstreamHandler);
  router.get("/explore/downstream", downstreamHandler);
  router.get("/explore/special/contributing_datasets", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 5);
    return c.json(await c.get("services").prov.specialContributingDatasets(startingId, depth));
  });
  router.get("/explore/special/effected_datasets", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 5);
    return c.json(await c.get("services").prov.specialEffectedDatasets(startingId, depth));
  });
  router.get("/explore/special/contributing_agents", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 5);
    return c.json(await c.get("services").prov.specialContributingAgents(startingId, depth));
  });
  router.get("/explore/special/effected_agents", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const startingId = c.req.query("starting_id");
    if (!startingId) {
      return c.json({ status: statusPayload(false, "Missing starting_id") }, 400);
    }
    const depth = parseDepth(c.req.query("depth"), 5);
    return c.json(await c.get("services").prov.specialEffectedAgents(startingId, depth));
  });

  router.post("/explore/generate/report", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const payload = await parseJson(c);
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id") }, 400);
    }
    const depth = parseDepth(typeof payload.depth === "number" ? String(payload.depth) : undefined, 3);
    const itemSubtype =
      typeof payload.item_subtype === "string" ? payload.item_subtype : "model_run";
    return c.json(
      await c.get("services").prov.generateReport({
        username: user.username,
        id,
        depth,
        itemSubtype,
      }),
    );
  });

  router.get("/bulk/generate_template/csv", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const workflowTemplateId = c.req.query("workflow_template_id");
    if (!workflowTemplateId) {
      return c.json({ status: statusPayload(false, "Missing workflow_template_id") }, 400);
    }
    const csv = await c.get("services").prov.generateTemplateCsv(workflowTemplateId);
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8" });
  });

  router.post("/bulk/convert_model_runs/csv", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const body = await c.req.parseBody();
    const csvInput = typeof body.csv === "string" ? body.csv : "";
    return c.json(await c.get("services").prov.convertModelRunsCsv(csvInput));
  });

  router.get("/bulk/regenerate_from_batch/csv", async (c) => {
    const user = getCurrentUser(c);
    requireAnyRole(user, PROV_READ_ROLES);
    const batchId = c.req.query("batch_id");
    if (!batchId) {
      return c.json({ status: statusPayload(false, "Missing batch_id") }, 400);
    }
    const csv = await c.get("services").prov.regenerateFromBatchCsv(batchId);
    return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8" });
  });

  return router;
};
