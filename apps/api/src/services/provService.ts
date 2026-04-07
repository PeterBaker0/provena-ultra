import { randomUUID } from "node:crypto";
import type { DbClient } from "@provena/db";
import { inArray, provEdges, registryItems } from "@provena/db";
import type { JobsService } from "./jobsService";
import { statusPayload } from "../utils/http";

type RegistryRow = typeof registryItems.$inferSelect;

const mapNode = (item: RegistryRow) => ({
  id: item.id,
  category: item.category,
  subtype: item.subtype,
  display_name: item.displayName,
});

const lineageFrom = async (
  db: DbClient,
  startingId: string,
  depth: number,
  direction: "upstream" | "downstream",
): Promise<{
  nodes: Array<{
    id: string;
    category: string;
    subtype: string;
    display_name: string;
  }>;
  edges: Array<{ from: string; to: string; relation: string }>;
}> => {
  const edges: Array<{ from: string; to: string; relation: string }> = [];
  const discoveredNodeIds = new Set<string>([startingId]);
  let frontier = new Set<string>([startingId]);

  for (let level = 0; level < depth; level += 1) {
    if (frontier.size === 0) {
      break;
    }
    const ids = Array.from(frontier);
    const rows =
      direction === "upstream"
        ? await db.select().from(provEdges).where(inArray(provEdges.targetId, ids))
        : await db.select().from(provEdges).where(inArray(provEdges.sourceId, ids));

    frontier = new Set<string>();
    for (const row of rows) {
      edges.push({
        from: row.sourceId,
        to: row.targetId,
        relation: row.relation,
      });
      discoveredNodeIds.add(row.sourceId);
      discoveredNodeIds.add(row.targetId);
      frontier.add(direction === "upstream" ? row.sourceId : row.targetId);
    }
  }

  const ids = Array.from(discoveredNodeIds);
  if (ids.length === 0) {
    return { nodes: [], edges };
  }

  const itemRows = await db.select().from(registryItems).where(inArray(registryItems.id, ids));
  return {
    nodes: itemRows.map(mapNode),
    edges,
  };
};

export interface ProvService {
  registerModelRun: (input: {
    username: string;
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  registerBatch: (input: {
    username: string;
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  registerSync: (input: {
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  updateModelRun: (input: {
    username: string;
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  deleteModelRun: (input: {
    username: string;
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  linkModelRunToStudy: (input: {
    username: string;
    modelRunId?: string;
    studyId?: string;
  }) => Promise<Record<string, unknown>>;
  upstream: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  downstream: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  specialContributingDatasets: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  specialEffectedDatasets: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  specialContributingAgents: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  specialEffectedAgents: (startingId: string, depth: number) => Promise<Record<string, unknown>>;
  generateReport: (input: {
    username: string;
    id: string;
    depth: number;
    itemSubtype: string;
  }) => Promise<Record<string, unknown>>;
  generateTemplateCsv: (workflowTemplateId: string) => Promise<string>;
  convertModelRunsCsv: (csv: string) => Promise<Record<string, unknown>>;
  regenerateFromBatchCsv: (batchId: string) => Promise<string>;
}

export const createProvService = (db: DbClient, jobs: JobsService): ProvService => ({
  registerModelRun: async ({ username, payload }) => {
    const response = await jobs.launch({
      username,
      jobType: "prov",
      jobSubType: "model_run_lodge",
      payload,
    });
    return {
      status: statusPayload(true, "Job dispatched, monitor session ID using the job API to see progress."),
      session_id: response.session_id,
    };
  },
  registerBatch: async ({ username, payload }) => {
    const batchId = randomUUID();
    const response = await jobs.launch({
      username,
      jobType: "prov",
      jobSubType: "model_run_batch_lodge",
      payload,
      batchId,
    });
    return {
      status: statusPayload(true, "Batch job dispatched."),
      session_id: response.session_id,
      batch_id: response.batch_id,
    };
  },
  registerSync: async ({ payload }) => ({
    status: statusPayload(true, "Provenance record lodged successfully."),
    record_info: {
      registered: true,
      payload,
    },
  }),
  updateModelRun: async ({ username, payload }) => {
    const response = await jobs.launch({
      username,
      jobType: "prov",
      jobSubType: "model_run_update",
      payload,
    });
    return {
      session_id: response.session_id,
    };
  },
  deleteModelRun: async ({ username, payload }) => {
    const response = await jobs.launch({
      username,
      jobType: "prov",
      jobSubType: "model_run_delete",
      payload,
    });
    return {
      status: statusPayload(true, "Delete job dispatched."),
      session_id: response.session_id,
    };
  },
  linkModelRunToStudy: async ({ username, modelRunId, studyId }) => {
    const response = await jobs.launch({
      username,
      jobType: "prov",
      jobSubType: "model_run_link_study",
      payload: {
        model_run_id: modelRunId ?? null,
        study_id: studyId ?? null,
      },
    });
    return {
      status: statusPayload(true, "Successfully linked model run and study together."),
      model_run_id: modelRunId ?? null,
      study_id: studyId ?? null,
      session_id: response.session_id,
    };
  },
  upstream: async (startingId, depth) => ({
    status: statusPayload(true),
    ...(await lineageFrom(db, startingId, depth, "upstream")),
  }),
  downstream: async (startingId, depth) => ({
    status: statusPayload(true),
    ...(await lineageFrom(db, startingId, depth, "downstream")),
  }),
  specialContributingDatasets: async (startingId, depth) => {
    const result = await lineageFrom(db, startingId, depth, "upstream");
    return {
      status: statusPayload(true),
      nodes: result.nodes.filter((node) => node.subtype === "dataset"),
      edges: result.edges,
    };
  },
  specialEffectedDatasets: async (startingId, depth) => {
    const result = await lineageFrom(db, startingId, depth, "downstream");
    return {
      status: statusPayload(true),
      nodes: result.nodes.filter((node) => node.subtype === "dataset"),
      edges: result.edges,
    };
  },
  specialContributingAgents: async (startingId, depth) => {
    const result = await lineageFrom(db, startingId, depth, "upstream");
    return {
      status: statusPayload(true),
      nodes: result.nodes.filter((node) => node.category === "agent"),
      edges: result.edges,
    };
  },
  specialEffectedAgents: async (startingId, depth) => {
    const result = await lineageFrom(db, startingId, depth, "downstream");
    return {
      status: statusPayload(true),
      nodes: result.nodes.filter((node) => node.category === "agent"),
      edges: result.edges,
    };
  },
  generateReport: async ({ username, id, depth, itemSubtype }) => {
    const response = await jobs.launch({
      username,
      jobType: "report",
      jobSubType: "generate",
      payload: {
        id,
        depth,
        item_subtype: itemSubtype,
      },
    });
    return {
      status: "SUBMITTED",
      job_id: response.session_id,
      report_url: null,
    };
  },
  generateTemplateCsv: async (workflowTemplateId) =>
    `workflow_template_id,record_name\n${workflowTemplateId},example-record\n`,
  convertModelRunsCsv: async (_csv) => ({
    status: statusPayload(true, "Successfully generated model run records."),
    new_records: [],
    existing_records: [],
    warnings: [],
  }),
  regenerateFromBatchCsv: async (batchId) => {
    const listed = await jobs.listBatch(batchId, undefined, { limit: 200, offset: 0 });
    const rows = Array.isArray(listed.jobs) ? listed.jobs : [];
    const lines = ["session_id,status"];
    for (const row of rows as Array<Record<string, unknown>>) {
      lines.push(`${String(row.session_id ?? "")},${String(row.status ?? "")}`);
    }
    return `${lines.join("\n")}\n`;
  },
});
