/**
 * Provenance API router group - mounted at /api/prov. Path layout matches
 * the legacy prov-api service.
 */
import { Hono } from "hono";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import { provSchemas } from "@provena/interfaces";
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import { newBatchId, submitJob } from "@provena/jobs";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { badRequest } from "../../errors.js";
import { successStatus } from "../../serializers.js";
import * as prov from "../../services/provService.js";
import * as csvService from "../../services/csvService.js";
import { getContainer } from "../../container.js";

const DEPTH_DEFAULT = 2;
const DEPTH_MAX = 10;

const parseDepth = (raw: string | undefined): number => {
  if (!raw) return DEPTH_DEFAULT;
  const depth = Number.parseInt(raw, 10);
  if (Number.isNaN(depth) || depth < 1) {
    throw badRequest(`Invalid depth parameter: ${raw}.`);
  }
  if (depth > DEPTH_MAX) {
    throw badRequest(`Depth provided is in excess of depth maximum: ${DEPTH_MAX}.`);
  }
  return depth;
};

export const buildProvRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(guards));

  /* ------------------------------ model run ----------------------------- */

  router.post("/model_run/register", guards.write, async (c) => {
    const record = provSchemas.modelRunRecordSchema.parse(await c.req.json()) as ModelRunRecord;
    /* Validate up-front so obvious failures are synchronous (legacy parity). */
    await prov.validateModelRunRecord(record);
    const { sessionId } = await submitJob({
      username: c.get("user").username,
      jobSubType: "MODEL_RUN_PROV_LODGE",
      payload: { record, revalidate: false },
    });
    return c.json({
      status: successStatus("Successfully lodged model run registration job."),
      session_id: sessionId,
    });
  });

  router.post("/model_run/register_sync", guards.write, async (c) => {
    const record = provSchemas.modelRunRecordSchema.parse(await c.req.json()) as ModelRunRecord;
    const recordInfo = await prov.registerModelRun({
      record,
      username: c.get("user").username,
    });
    return c.json({
      status: successStatus("Successfully registered model run."),
      record_info: recordInfo,
    });
  });

  router.post("/model_run/register_batch", guards.write, async (c) => {
    const body = provSchemas.registerBatchModelRunRequestSchema.parse(await c.req.json());
    const batchId = newBatchId();
    const { sessionId } = await submitJob({
      username: c.get("user").username,
      jobSubType: "MODEL_RUN_BATCH_SUBMIT",
      payload: { records: body.records },
      batchId,
    });
    return c.json({
      status: successStatus(`Successfully lodged batch submission job (batch ${batchId}).`),
      session_id: sessionId,
    });
  });

  router.post("/model_run/update", guards.write, async (c) => {
    const body = provSchemas.postUpdateModelRunInputSchema.parse(await c.req.json());
    await prov.assertModelRunExists(body.model_run_id);
    const { sessionId } = await submitJob({
      username: c.get("user").username,
      jobSubType: "MODEL_RUN_UPDATE",
      payload: {
        model_run_record_id: body.model_run_id,
        updated_record: body.record,
        reason: body.reason,
        revalidate: true,
      },
    });
    return c.json({ session_id: sessionId });
  });

  router.post("/model_run/edit/link_to_study", guards.write, async (c) => {
    const modelRunId = c.req.query("model_run_id");
    const studyId = c.req.query("study_id");
    if (!modelRunId) throw badRequest("Missing required query parameter 'model_run_id'.");
    if (!studyId) throw badRequest("Missing required query parameter 'study_id'.");

    const { record } = await prov.assertModelRunExists(modelRunId);
    const { items } = getContainer();
    const study = await items.fetchItem(studyId);
    if (!study || study.base.itemSubType !== "STUDY") {
      throw badRequest(`Study with id ${studyId} does not exist in the registry.`);
    }
    if (record.study_id) {
      throw badRequest(
        `Model run ${modelRunId} is already linked to study ${record.study_id}.`,
      );
    }
    const updatedRecord = { ...record, study_id: studyId };
    const { sessionId } = await submitJob({
      username: c.get("user").username,
      jobSubType: "MODEL_RUN_UPDATE",
      payload: {
        model_run_record_id: modelRunId,
        updated_record: updatedRecord,
        reason: `(System) Linking model run to study ${studyId}`,
        revalidate: false,
      },
    });
    return c.json({
      status: successStatus(`Successfully submitted study link job.`),
      model_run_id: modelRunId,
      study_id: studyId,
      session_id: sessionId,
    });
  });

  router.post("/model_run/delete", guards.admin, async (c) => {
    const body = provSchemas.postDeleteGraphRequestSchema.parse(await c.req.json());
    const result = await prov.deleteModelRun(body.record_id, body.trial_mode);
    return c.json({ diff: result.diff });
  });

  /* ------------------------------- explore ------------------------------ */

  interface LineageResult {
    record_count: number;
    nodes: unknown[];
    links: unknown[];
    directed: boolean;
    multigraph: boolean;
    graph: Record<string, never>;
  }

  const registerExploreRoute = (
    path: string,
    runner: (id: string, depth: number) => Promise<LineageResult>,
    description: string,
  ): void => {
    router.get(path, guards.read, async (c) => {
      const startingId = c.req.query("starting_id");
      if (!startingId) throw badRequest("Missing required query parameter 'starting_id'.");
      const depth = parseDepth(c.req.query("depth"));
      await prov.assertItemExists(startingId);
      const { record_count: recordCount, ...graphOnly } = await runner(startingId, depth);
      return c.json({
        status: successStatus(`Made ${description} query (with depth ${depth}).`),
        record_count: recordCount,
        graph: graphOnly,
      });
    });
  };

  registerExploreRoute(
    "/explore/upstream",
    (id, depth) => prov.lineage(id, depth, "upstream"),
    "upstream lineage",
  );
  registerExploreRoute(
    "/explore/downstream",
    (id, depth) => prov.lineage(id, depth, "downstream"),
    "downstream lineage",
  );
  registerExploreRoute(
    "/explore/special/contributing_datasets",
    prov.contributingDatasets,
    "contributing datasets",
  );
  registerExploreRoute(
    "/explore/special/effected_datasets",
    prov.effectedDatasets,
    "effected datasets",
  );
  registerExploreRoute(
    "/explore/special/contributing_agents",
    prov.contributingAgents,
    "contributing agents",
  );
  registerExploreRoute(
    "/explore/special/effected_agents",
    prov.effectedAgents,
    "effected agents",
  );

  router.post("/explore/generate/report", guards.read, async (c) => {
    const body = provSchemas.generateReportRequestSchema.parse(await c.req.json());
    const { sessionId } = await submitJob({
      username: c.get("user").username,
      jobSubType: "GENERATE_REPORT",
      payload: { id: body.id, item_subtype: body.item_subtype, depth: body.depth },
    });
    return c.json({ session_id: sessionId });
  });

  /* -------------------------------- bulk -------------------------------- */

  router.get("/bulk/generate_template/csv", guards.read, async (c) => {
    const workflowTemplateId = c.req.query("workflow_template_id");
    if (!workflowTemplateId) {
      throw badRequest("Missing required query parameter 'workflow_template_id'.");
    }
    const csv = await csvService.generateTemplateCsv(workflowTemplateId);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="model_run_template_${workflowTemplateId.replaceAll("/", "_")}.csv"`,
    });
  });

  router.post("/bulk/convert_model_runs/csv", guards.read, async (c) => {
    /* Multipart file upload (field name csv_file) - legacy parity. */
    let content: string | null = null;
    const contentType = c.req.header("Content-Type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("csv_file") ?? form.get("file");
      if (file && typeof file !== "string") {
        content = await file.text();
      }
    } else {
      content = await c.req.text();
    }
    if (!content) throw badRequest("No CSV file content provided.");
    const outcome = await csvService.convertCsvToRecords(content);
    return c.json({
      status: successStatus(
        `Successfully converted ${outcome.newRecords.length} model run record(s).`,
      ),
      new_records: outcome.newRecords,
      existing_records: outcome.existingRecords,
      warnings: outcome.warnings.length > 0 ? outcome.warnings : null,
    });
  });

  router.get("/bulk/regenerate_from_batch/csv", guards.read, async (c) => {
    const batchId = c.req.query("batch_id");
    if (!batchId) throw badRequest("Missing required query parameter 'batch_id'.");
    const { jobs } = getContainer();
    const username = c.get("user").username;
    const sessions = await jobs.list({ batchId, limit: 1000 });
    const userSessions = sessions.jobs.filter((j) => j.username === username);
    if (userSessions.length === 0) {
      throw badRequest(`No jobs found for batch ${batchId} owned by ${username}.`);
    }
    const records: { record: ModelRunRecord }[] = [];
    for (const session of userSessions) {
      const payloadRecord = session.payload.record as ModelRunRecord | undefined;
      if (payloadRecord) records.push({ record: payloadRecord });
    }
    const csv = await csvService.regenerateCsvFromRecords(records);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="batch_${batchId}.csv"`,
    });
  });

  /* -------------------------------- admin ------------------------------- */

  router.post("/admin/store_record", guards.admin, async (c) => {
    const body = (await c.req.json()) as { record_id?: string; validate_record?: boolean };
    if (!body.record_id) throw badRequest("Missing 'record_id' in request body.");
    const { record } = await prov.assertModelRunExists(body.record_id);
    await prov.lodgeModelRunOnly({
      modelRunRecordId: body.record_id,
      record,
      revalidate: body.validate_record ?? false,
    });
    return c.json({ status: successStatus(`Stored graph record for ${body.record_id}.`) });
  });

  router.post("/admin/store_records", guards.admin, async (c) => {
    const body = (await c.req.json()) as { record_ids?: string[]; validate_record?: boolean };
    if (!body.record_ids) throw badRequest("Missing 'record_ids' in request body.");
    for (const id of body.record_ids) {
      const { record } = await prov.assertModelRunExists(id);
      await prov.lodgeModelRunOnly({
        modelRunRecordId: id,
        record,
        revalidate: body.validate_record ?? false,
      });
    }
    return c.json({
      status: successStatus(`Stored graph records for ${body.record_ids.length} items.`),
    });
  });

  router.post("/admin/store_all_registry_records", guards.admin, async (c) => {
    const { items } = getContainer();
    const validate =
      (c.req.query("validate_record") ?? "false").toLowerCase() === "true";
    const all = await items.listAllItemIds();
    let submitted = 0;
    for (const entry of all.filter(
      (e) => e.itemSubType === "MODEL_RUN" && e.recordType === "COMPLETE_ITEM",
    )) {
      const { record } = await prov.assertModelRunExists(entry.id);
      await submitJob({
        username: c.get("user").username,
        jobSubType: "MODEL_RUN_LODGE_ONLY",
        payload: { model_run_record_id: entry.id, record, revalidate: validate },
      });
      submitted += 1;
    }
    return c.json({
      status: successStatus(`Submitted ${submitted} graph restore job(s).`),
    });
  });

  router.delete("/graph/admin/clear", guards.admin, async (c) => {
    const confirm = (c.req.query("i_am_sure") ?? "false").toLowerCase() === "true";
    if (!confirm) {
      throw badRequest("Must confirm graph clear with i_am_sure=true query parameter.");
    }
    const { db } = getContainer();
    const { schema } = await import("@provena/db");
    await db.delete(schema.provEdge);
    return c.json({ status: successStatus("Cleared all graph edges.") });
  });

  return router;
};
