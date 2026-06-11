/**
 * Provenance domain service - model run registration, graph construction
 * (port of legacy prov-api `prov_helpers.py` / `prov_connector.py`), and
 * lineage queries over the relational edge store.
 */
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import type { AuthenticatedUser } from "@provena/auth";
import type { EdgeInput, NodeLinkGraph, ProvRelation, TraversalRow } from "@provena/db";
import { getContainer } from "../container.js";
import { badRequest } from "../errors.js";

/* ------------------------- record validation ----------------------------- */

interface WorkflowTemplateInfo {
  id: string;
  softwareId: string;
  inputTemplates: { template_id: string; optional?: boolean | null }[];
  outputTemplates: { template_id: string; optional?: boolean | null }[];
  annotations: { required?: string[]; optional?: string[] } | null;
}

const fetchExpectedSubtype = async (
  id: string,
  subtype: ItemSubType,
  label: string,
): Promise<Record<string, unknown>> => {
  const { items } = getContainer();
  const stored = await items.fetchItem(id);
  if (!stored) {
    throw badRequest(`${label} with id ${id} does not exist in the registry.`);
  }
  if (stored.base.itemSubType !== subtype) {
    throw badRequest(
      `${label} with id ${id} has subtype ${stored.base.itemSubType}, expected ${subtype}.`,
    );
  }
  if (stored.base.recordType !== "COMPLETE_ITEM" || !stored.domainInfo) {
    throw badRequest(`${label} with id ${id} is an incomplete (seed) item.`);
  }
  return stored.domainInfo;
};

export const fetchWorkflowTemplate = async (id: string): Promise<WorkflowTemplateInfo> => {
  const info = await fetchExpectedSubtype(id, "MODEL_RUN_WORKFLOW_TEMPLATE", "Workflow template");
  return {
    id,
    softwareId: info.software_id as string,
    inputTemplates: (info.input_templates as WorkflowTemplateInfo["inputTemplates"]) ?? [],
    outputTemplates: (info.output_templates as WorkflowTemplateInfo["outputTemplates"]) ?? [],
    annotations: (info.annotations as WorkflowTemplateInfo["annotations"]) ?? null,
  };
};

/**
 * Validation of a model run record against the registry, ported from legacy
 * `validate_model_run_record.py`:
 *  - workflow template + datasets + agents must exist with correct subtypes
 *  - all non-optional dataset templates must be satisfied on each end
 *  - deferred resource keys of used templates must be provided
 *  - required template annotations must be present
 */
export const validateModelRunRecord = async (
  record: ModelRunRecord,
): Promise<WorkflowTemplateInfo> => {
  const template = await fetchWorkflowTemplate(record.workflow_template_id);

  /* Agents */
  await fetchExpectedSubtype(record.associations.modeller_id, "PERSON", "Modeller");
  if (record.associations.requesting_organisation_id) {
    await fetchExpectedSubtype(
      record.associations.requesting_organisation_id,
      "ORGANISATION",
      "Requesting organisation",
    );
  }
  if (record.study_id) {
    await fetchExpectedSubtype(record.study_id, "STUDY", "Study");
  }

  const validateEnd = async (
    provided: ModelRunRecord["inputs"],
    expected: WorkflowTemplateInfo["inputTemplates"],
    label: string,
  ): Promise<void> => {
    const providedByTemplate = new Map<string, ModelRunRecord["inputs"]>();
    for (const entry of provided) {
      const list = providedByTemplate.get(entry.dataset_template_id) ?? [];
      list.push(entry);
      providedByTemplate.set(entry.dataset_template_id, list);
    }
    /* All non-optional templates satisfied */
    for (const expectedTemplate of expected) {
      if (expectedTemplate.optional) continue;
      if (!providedByTemplate.has(expectedTemplate.template_id)) {
        throw badRequest(
          `Missing ${label} dataset for required dataset template ${expectedTemplate.template_id}.`,
        );
      }
    }
    const expectedIds = new Set(expected.map((t) => t.template_id));
    for (const [templateId, entries] of providedByTemplate.entries()) {
      if (!expectedIds.has(templateId)) {
        throw badRequest(
          `Provided ${label} dataset(s) reference template ${templateId} which is not part of the workflow template.`,
        );
      }
      const templateInfo = await fetchExpectedSubtype(
        templateId,
        "DATASET_TEMPLATE",
        "Dataset template",
      );
      const deferred = (templateInfo.deferred_resources as { key: string }[]) ?? [];
      for (const entry of entries) {
        await fetchExpectedSubtype(entry.dataset_id, "DATASET", `${label} dataset`);
        for (const resource of deferred) {
          const value = entry.resources?.[resource.key];
          if (!value) {
            throw badRequest(
              `Dataset ${entry.dataset_id} fulfilling template ${templateId} is missing required deferred resource key '${resource.key}'.`,
            );
          }
        }
      }
    }
  };

  await validateEnd(record.inputs, template.inputTemplates, "input");
  await validateEnd(record.outputs, template.outputTemplates, "output");

  /* Required annotations */
  const required = template.annotations?.required ?? [];
  for (const key of required) {
    if (!record.annotations?.[key]) {
      throw badRequest(`Missing required annotation '${key}' configured on workflow template.`);
    }
  }

  return template;
};

/* --------------------------- graph construction -------------------------- */

/** Port of legacy `model_run_to_graph` - returns the typed edge list. */
export const modelRunEdges = (
  record: ModelRunRecord,
  recordId: string,
  template: WorkflowTemplateInfo,
): EdgeInput[] => {
  const edges: EdgeInput[] = [];
  const push = (sourceId: string, targetId: string, relation: ProvRelation) => {
    edges.push({ sourceId, targetId, relation });
  };

  const inputDatasetIds = record.inputs.map((i) => i.dataset_id);
  const outputDatasetIds = record.outputs.map((o) => o.dataset_id);
  const inputTemplateIds = new Set(record.inputs.map((i) => i.dataset_template_id));
  const outputTemplateIds = new Set(record.outputs.map((o) => o.dataset_template_id));
  const allTemplateIds = new Set([...inputTemplateIds, ...outputTemplateIds]);

  /* model run --wasInformedBy--> study */
  if (record.study_id) push(recordId, record.study_id, "wasInformedBy");

  /* model run --used--> input datasets */
  for (const datasetId of inputDatasetIds) push(recordId, datasetId, "used");

  /* output datasets --wasGeneratedBy--> model run */
  for (const datasetId of outputDatasetIds) push(datasetId, recordId, "wasGeneratedBy");

  /* model run --used--> model, workflow template */
  push(recordId, template.softwareId, "used");
  push(recordId, template.id, "used");

  /* model run --wasAssociatedWith--> modeller (+ requesting organisation) */
  push(recordId, record.associations.modeller_id, "wasAssociatedWith");
  if (record.associations.requesting_organisation_id) {
    push(recordId, record.associations.requesting_organisation_id, "wasAssociatedWith");
  }

  /* output datasets --wasAttributedTo--> modeller */
  for (const datasetId of outputDatasetIds) {
    push(datasetId, record.associations.modeller_id, "wasAttributedTo");
  }

  /* templates: workflow template --hadMember--> dataset template,
     datasets --wasInfluencedBy--> dataset template */
  for (const templateId of allTemplateIds) {
    push(template.id, templateId, "hadMember");
  }
  for (const entry of record.inputs) {
    push(entry.dataset_id, entry.dataset_template_id, "wasInfluencedBy");
  }
  for (const entry of record.outputs) {
    push(entry.dataset_id, entry.dataset_template_id, "wasInfluencedBy");
  }

  /* workflow template --hadMember--> model */
  push(template.id, template.softwareId, "hadMember");

  /* de-duplicate */
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.sourceId}|${e.targetId}|${e.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Create activity edges (port of `create_to_graph`). */
export const createActivityEdges = (input: {
  createdItemId: string;
  createActivityId: string;
  agentId: string;
}): EdgeInput[] => [
  { sourceId: input.createdItemId, targetId: input.createActivityId, relation: "wasGeneratedBy" },
  { sourceId: input.createActivityId, targetId: input.agentId, relation: "wasAssociatedWith" },
  { sourceId: input.createdItemId, targetId: input.agentId, relation: "wasAttributedTo" },
];

/** Version activity edges (port of `version_to_graph`). */
export const versionActivityEdges = (input: {
  fromVersionId: string;
  toVersionId: string;
  versionActivityId: string;
  agentId: string;
}): EdgeInput[] => [
  { sourceId: input.toVersionId, targetId: input.versionActivityId, relation: "wasGeneratedBy" },
  {
    sourceId: input.versionActivityId,
    targetId: input.agentId,
    relation: "wasAssociatedWith",
  },
  { sourceId: input.toVersionId, targetId: input.agentId, relation: "wasAttributedTo" },
  { sourceId: input.versionActivityId, targetId: input.fromVersionId, relation: "used" },
];

/* ------------------------- PROV-JSON serialisation ----------------------- */

/**
 * Produces a PROV-JSON document (the same serialisation family the legacy
 * python-prov produced) for a model run record. Stored on the item as
 * `prov_serialisation`.
 */
export const buildProvJson = (
  recordId: string,
  record: ModelRunRecord,
  template: WorkflowTemplateInfo,
): string => {
  const ns = (id: string): string => id;
  const entity: Record<string, unknown> = {};
  const activity: Record<string, unknown> = {};
  const agent: Record<string, unknown> = {};

  const itemAttrs = (id: string, category: string, subtype: string) => ({
    id: ns(id),
    item_category: category,
    item_subtype: subtype,
  });

  activity[ns(recordId)] = itemAttrs(recordId, "ACTIVITY", "MODEL_RUN");
  if (record.study_id) {
    activity[ns(record.study_id)] = itemAttrs(record.study_id, "ACTIVITY", "STUDY");
  }
  for (const input of record.inputs) {
    entity[ns(input.dataset_id)] = itemAttrs(input.dataset_id, "ENTITY", "DATASET");
    entity[ns(input.dataset_template_id)] = itemAttrs(
      input.dataset_template_id,
      "ENTITY",
      "DATASET_TEMPLATE",
    );
  }
  for (const output of record.outputs) {
    entity[ns(output.dataset_id)] = itemAttrs(output.dataset_id, "ENTITY", "DATASET");
    entity[ns(output.dataset_template_id)] = itemAttrs(
      output.dataset_template_id,
      "ENTITY",
      "DATASET_TEMPLATE",
    );
  }
  entity[ns(template.id)] = itemAttrs(template.id, "ENTITY", "MODEL_RUN_WORKFLOW_TEMPLATE");
  entity[ns(template.softwareId)] = itemAttrs(template.softwareId, "ENTITY", "MODEL");
  agent[ns(record.associations.modeller_id)] = itemAttrs(
    record.associations.modeller_id,
    "AGENT",
    "PERSON",
  );
  if (record.associations.requesting_organisation_id) {
    agent[ns(record.associations.requesting_organisation_id)] = itemAttrs(
      record.associations.requesting_organisation_id,
      "AGENT",
      "ORGANISATION",
    );
  }

  const relationSections: Record<string, Record<string, unknown>> = {
    used: {},
    wasGeneratedBy: {},
    wasAssociatedWith: {},
    wasAttributedTo: {},
    wasInfluencedBy: {},
    wasInformedBy: {},
    hadMember: {},
  };
  let counter = 0;
  const addRelation = (
    section: string,
    args: Record<string, string>,
  ): void => {
    counter += 1;
    relationSections[section]![`_:id${counter}`] = args;
  };

  for (const edge of modelRunEdges(record, recordId, template)) {
    switch (edge.relation) {
      case "used":
        addRelation("used", {
          "prov:activity": ns(edge.sourceId),
          "prov:entity": ns(edge.targetId),
        });
        break;
      case "wasGeneratedBy":
        addRelation("wasGeneratedBy", {
          "prov:entity": ns(edge.sourceId),
          "prov:activity": ns(edge.targetId),
        });
        break;
      case "wasAssociatedWith":
        addRelation("wasAssociatedWith", {
          "prov:activity": ns(edge.sourceId),
          "prov:agent": ns(edge.targetId),
        });
        break;
      case "wasAttributedTo":
        addRelation("wasAttributedTo", {
          "prov:entity": ns(edge.sourceId),
          "prov:agent": ns(edge.targetId),
        });
        break;
      case "wasInfluencedBy":
        addRelation("wasInfluencedBy", {
          "prov:influencee": ns(edge.sourceId),
          "prov:influencer": ns(edge.targetId),
        });
        break;
      case "wasInformedBy":
        addRelation("wasInformedBy", {
          "prov:informed": ns(edge.sourceId),
          "prov:informant": ns(edge.targetId),
        });
        break;
      case "hadMember":
        addRelation("hadMember", {
          "prov:collection": ns(edge.sourceId),
          "prov:entity": ns(edge.targetId),
        });
        break;
      default:
        break;
    }
  }

  return JSON.stringify({
    prefix: { default: "http://hdl.handle.net/" },
    entity,
    activity,
    agent,
    ...Object.fromEntries(
      Object.entries(relationSections).filter(([, v]) => Object.keys(v).length > 0),
    ),
  });
};

/* ------------------------------ traversal -------------------------------- */

export interface EdgeRecord {
  sourceId: string;
  targetId: string;
  relation: ProvRelation;
}

interface PathStep {
  edge: EdgeRecord;
  /** Node reached by taking this step. */
  node: string;
}

type Path = PathStep[];

/**
 * Collect all simple paths from `startingId` up to `depth` steps.
 * Direction semantics match the legacy cypher:
 *  - upstream:  follow stored edges source->target starting at start
 *  - downstream: follow edges in reverse (find nodes whose paths reach start)
 */
const collectPaths = async (
  startingId: string,
  depth: number,
  direction: "upstream" | "downstream",
): Promise<Path[]> => {
  const { edges } = getContainer();
  const rows = await edges.traverse(startingId, depth, direction);
  /* Build adjacency from the depth-limited subgraph. */
  const adjacency = new Map<string, EdgeRecord[]>();
  for (const row of rows) {
    const record: EdgeRecord = {
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation,
    };
    const fromNode = direction === "upstream" ? record.sourceId : record.targetId;
    const list = adjacency.get(fromNode) ?? [];
    list.push(record);
    adjacency.set(fromNode, list);
  }

  const paths: Path[] = [];
  const walk = (node: string, current: Path, visited: Set<string>): void => {
    if (current.length >= depth) return;
    for (const edge of adjacency.get(node) ?? []) {
      const nextNode = direction === "upstream" ? edge.targetId : edge.sourceId;
      if (visited.has(nextNode)) continue;
      const nextPath = [...current, { edge, node: nextNode }];
      paths.push(nextPath);
      walk(nextNode, nextPath, new Set([...visited, nextNode]));
    }
  };
  walk(startingId, [], new Set([startingId]));
  return paths;
};

const graphFromPaths = async (paths: Path[], alwaysInclude: string[]): Promise<NodeLinkGraph> => {
  const { edges } = getContainer();
  const nodeIds = new Set<string>(alwaysInclude);
  const links: { source: string; target: string; type: ProvRelation }[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (const step of path) {
      nodeIds.add(step.edge.sourceId);
      nodeIds.add(step.edge.targetId);
      const key = `${step.edge.sourceId}|${step.edge.targetId}|${step.edge.relation}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({
          source: step.edge.sourceId,
          target: step.edge.targetId,
          type: step.edge.relation,
        });
      }
    }
  }
  const nodes = await edges.decorateNodes([...nodeIds]);
  return { directed: true, multigraph: false, graph: {}, nodes, links };
};

export const lineage = async (
  startingId: string,
  depth: number,
  direction: "upstream" | "downstream",
): Promise<NodeLinkGraph & { record_count: number }> => {
  const { edges } = getContainer();
  return edges.lineageGraph(startingId, depth, direction);
};

const subtypeOfNodes = async (ids: string[]): Promise<Map<string, { category: string; subtype: string }>> => {
  const { edges } = getContainer();
  const nodes = await edges.decorateNodes(ids);
  return new Map(nodes.map((n) => [n.id, { category: n.item_category, subtype: n.item_subtype }]));
};

/**
 * Special queries - keep only paths terminating at nodes matching the
 * given predicate (legacy cypher MATCH (parent:<filter>) <-[*1..d]- (start)).
 */
const filteredLineage = async (
  startingId: string,
  depth: number,
  direction: "upstream" | "downstream",
  predicate: (info: { category: string; subtype: string }) => boolean,
): Promise<NodeLinkGraph & { record_count: number }> => {
  const paths = await collectPaths(startingId, depth, direction);
  const terminalIds = [...new Set(paths.map((p) => p[p.length - 1]!.node))];
  const nodeInfo = await subtypeOfNodes(terminalIds);
  const kept = paths.filter((p) => {
    const info = nodeInfo.get(p[p.length - 1]!.node);
    return info ? predicate(info) : false;
  });
  const graph = await graphFromPaths(kept, kept.length > 0 ? [startingId] : []);
  return { ...graph, record_count: graph.nodes.length };
};

export const contributingDatasets = (startingId: string, depth: number) =>
  filteredLineage(startingId, depth, "upstream", (i) => i.subtype === "DATASET");

export const effectedDatasets = (startingId: string, depth: number) =>
  filteredLineage(startingId, depth, "downstream", (i) => i.subtype === "DATASET");

export const contributingAgents = (startingId: string, depth: number) =>
  filteredLineage(startingId, depth, "upstream", (i) => i.category === "AGENT");

/**
 * Effected agents - legacy: (agent:AGENT) <-[]- (downstream) -[*0..d]-> (start):
 * agents directly attached to any node downstream of start (including start).
 */
export const effectedAgents = async (
  startingId: string,
  depth: number,
): Promise<NodeLinkGraph & { record_count: number }> => {
  const { edges } = getContainer();
  const downstreamRows = await edges.traverse(startingId, depth, "downstream");
  const downstreamNodes = new Set<string>([startingId]);
  for (const row of downstreamRows) downstreamNodes.add(row.source_id);

  const agentLinks: { source: string; target: string; type: ProvRelation }[] = [];
  const nodeIds = new Set<string>();
  for (const nodeId of downstreamNodes) {
    const touching = await edges.allEdgesTouching(nodeId);
    for (const edge of touching) {
      if (edge.sourceId !== nodeId) continue;
      const targetInfo = await subtypeOfNodes([edge.targetId]);
      const info = targetInfo.get(edge.targetId);
      if (info?.category === "AGENT") {
        agentLinks.push({ source: edge.sourceId, target: edge.targetId, type: edge.relation });
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      }
    }
  }
  /* Include the downstream scaffolding paths for context. */
  const seen = new Set(agentLinks.map((l) => `${l.source}|${l.target}|${l.type}`));
  for (const row of downstreamRows) {
    const key = `${row.source_id}|${row.target_id}|${row.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      agentLinks.push({ source: row.source_id, target: row.target_id, type: row.relation });
      nodeIds.add(row.source_id);
      nodeIds.add(row.target_id);
    }
  }
  const nodes = await edges.decorateNodes([...nodeIds]);
  return {
    directed: true,
    multigraph: false,
    graph: {},
    nodes,
    links: agentLinks,
    record_count: nodes.length,
  };
};

/* ----------------------- model run registration -------------------------- */

export interface ProvenanceRecordInfo {
  id: string;
  prov_json: string;
  record: ModelRunRecord;
}

/**
 * Register a model run: validates the record, mints a handle, writes the
 * ItemModelRun registry item (status LODGED) and asserts the graph edges.
 * Replaces the legacy proxy-create + lodge workflow with direct calls.
 */
export const registerModelRun = async (input: {
  record: ModelRunRecord;
  username: string;
  revalidate?: boolean;
}): Promise<ProvenanceRecordInfo> => {
  const { items, edges, db } = getContainer();
  const template = await validateModelRunRecord(input.record);

  const { mintHandle } = await import("./registryService.js");
  const { ensureSidecars } = await import("@provena/db");
  const handle = await mintHandle();
  const provJson = buildProvJson(handle, input.record, template);

  await items.createCompleteItem({
    id: handle,
    subtype: "MODEL_RUN",
    ownerUsername: input.username,
    domainInfo: {
      display_name: input.record.display_name,
      record: input.record,
      prov_serialisation: provJson,
      record_status: "LODGED",
      user_metadata: null,
    },
    historyUsername: input.username,
    historyReason: "Registered model run",
  });
  await ensureSidecars(db, handle, input.username, ["metadata-read"]);
  await edges.upsertEdges(modelRunEdges(input.record, handle, template), handle);

  return { id: handle, prov_json: provJson, record: input.record };
};

/** Lodge-only: re-assert edges for an existing model run item. */
export const lodgeModelRunOnly = async (input: {
  modelRunRecordId: string;
  record: ModelRunRecord;
  revalidate?: boolean;
}): Promise<ProvenanceRecordInfo> => {
  const { items, edges } = getContainer();
  const template = input.revalidate
    ? await validateModelRunRecord(input.record)
    : await fetchWorkflowTemplate(input.record.workflow_template_id);
  const provJson = buildProvJson(input.modelRunRecordId, input.record, template);
  await edges.upsertEdges(
    modelRunEdges(input.record, input.modelRunRecordId, template),
    input.modelRunRecordId,
  );
  /* Mark item LODGED if it exists. */
  const stored = await items.fetchItem(input.modelRunRecordId);
  if (stored?.domainInfo) {
    await items.updateItem({
      id: input.modelRunRecordId,
      domainInfo: { ...stored.domainInfo, record_status: "LODGED", prov_serialisation: provJson },
      reason: "(System) Lodged provenance graph",
      username: stored.base.ownerUsername,
      excludeHistoryUpdate: true,
    });
  }
  return { id: input.modelRunRecordId, prov_json: provJson, record: input.record };
};

/** Update an existing model run record + graph. */
export const updateModelRun = async (input: {
  modelRunRecordId: string;
  updatedRecord: ModelRunRecord;
  reason: string;
  username: string;
  revalidate?: boolean;
}): Promise<ProvenanceRecordInfo> => {
  const { items, edges } = getContainer();
  const existing = await assertModelRunExists(input.modelRunRecordId);
  void existing;
  const template = await validateModelRunRecord(input.updatedRecord);
  const provJson = buildProvJson(input.modelRunRecordId, input.updatedRecord, template);

  /* Replace graph assertions for this record. */
  await edges.removeRecordEdges(input.modelRunRecordId);
  await edges.upsertEdges(
    modelRunEdges(input.updatedRecord, input.modelRunRecordId, template),
    input.modelRunRecordId,
  );

  const stored = await items.fetchItem(input.modelRunRecordId);
  await items.updateItem({
    id: input.modelRunRecordId,
    domainInfo: {
      ...(stored?.domainInfo ?? {}),
      display_name: input.updatedRecord.display_name,
      record: input.updatedRecord,
      prov_serialisation: provJson,
      record_status: "LODGED",
    },
    reason: input.reason,
    username: input.username,
  });
  return { id: input.modelRunRecordId, prov_json: provJson, record: input.updatedRecord };
};

/** Delete a model run + its graph assertions (admin only route). */
export const deleteModelRun = async (
  id: string,
  trialMode: boolean,
): Promise<{ diff: Record<string, unknown>[] }> => {
  const { items, edges } = getContainer();
  await assertModelRunExists(id);
  const affected = await edges.edgesForRecord(id);
  const diff = affected.map((e) => ({
    action: "REMOVE_EDGE",
    source: e.sourceId,
    target: e.targetId,
    relation: e.relation,
    sole_assertion: e.recordIds.length === 1,
  }));
  if (!trialMode) {
    await edges.removeRecordEdges(id);
    await items.deleteItem(id);
    diff.push({
      action: "REMOVE_ITEM",
      source: id,
      target: id,
      relation: "item" as never,
      sole_assertion: true,
    });
  }
  return { diff };
};

/* --------------------------- existence checks ---------------------------- */

export const assertItemExists = async (id: string): Promise<void> => {
  const { items } = getContainer();
  const stored = await items.fetchItem(id);
  if (!stored) {
    throw badRequest(
      `Item with id ${id} does not exist in the registry - cannot explore lineage.`,
    );
  }
};

export const assertModelRunExists = async (
  id: string,
): Promise<{ record: ModelRunRecord; ownerUsername: string }> => {
  const { items } = getContainer();
  const stored = await items.fetchItem(id);
  if (!stored || stored.base.itemSubType !== "MODEL_RUN" || !stored.domainInfo) {
    throw badRequest(`Model run with id ${id} does not exist or is incomplete.`);
  }
  return {
    record: stored.domainInfo.record as ModelRunRecord,
    ownerUsername: stored.base.ownerUsername,
  };
};

export type { AuthenticatedUser };
