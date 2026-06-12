/**
 * Bulk CSV template generation + conversion for model runs - port of legacy
 * `prov-api/helpers/template_helpers.py` (header names preserved exactly).
 */
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import { getContainer } from "../container.js";
import { badRequest } from "../errors.js";
import { fetchWorkflowTemplate } from "./provService.js";

/* Header constants (legacy prov-api config defaults). */
const TEMPLATE_INTERNAL_PREFIX = "_";
const WORKFLOW_TEMPLATE_MARKER_PREFIX = "workflow template id";
const INPUT_DATASET_TEMPLATE_PREFIX = "Input dataset id for template: ";
const OUTPUT_DATASET_TEMPLATE_PREFIX = "Output dataset id for template: ";
const INPUT_TEMPLATE_RESOURCE_PREFIX = "Input resource: ";
const OUTPUT_TEMPLATE_RESOURCE_PREFIX = "Output resource: ";
const DISPLAY_NAME_HEADER = "display name";
const MODEL_VERSION_HEADER = "model version (optional)";
const DESCRIPTION_HEADER = "description";
const AGENT_HEADER = "agent id";
const STUDY_HEADER = "study id";
const START_TIME_HEADER = "execution start time (YYYY-MM-DD HH:MM:SS+HH:MM)";
const END_TIME_HEADER = "execution end time (YYYY-MM-DD HH:MM:SS+HH:MM)";
const ANNOTATION_PREFIX = "annotation: ";

const workflowTemplateFlag = (workflowTemplateId: string): string =>
  `${TEMPLATE_INTERNAL_PREFIX}${WORKFLOW_TEMPLATE_MARKER_PREFIX} ${workflowTemplateId}`;

const WORKFLOW_FLAG_REGEX = new RegExp(
  `^${TEMPLATE_INTERNAL_PREFIX}${WORKFLOW_TEMPLATE_MARKER_PREFIX}\\s(\\S*)$`,
);

interface DatasetTemplateHeaders {
  datasetTemplateId: string;
  templateIdHeader: string;
  resourceHeaders: { key: string; header: string }[];
  isInput: boolean;
}

interface TemplateHeaderSet {
  workflowTemplateId: string;
  datasetTemplates: DatasetTemplateHeaders[];
  requiredAnnotations: string[];
  optionalAnnotations: string[];
}

const buildHeaderSet = async (workflowTemplateId: string): Promise<TemplateHeaderSet> => {
  const { items } = getContainer();
  const template = await fetchWorkflowTemplate(workflowTemplateId);
  const datasetTemplates: DatasetTemplateHeaders[] = [];

  const resolve = async (
    refs: { template_id: string }[],
    isInput: boolean,
  ): Promise<void> => {
    for (const [index, ref] of refs.entries()) {
      const stored = await items.fetchItem(ref.template_id);
      if (!stored || stored.base.itemSubType !== "DATASET_TEMPLATE" || !stored.domainInfo) {
        throw badRequest(`Dataset template ${ref.template_id} not found or incomplete.`);
      }
      const name =
        (stored.base.displayName as string | null) ?? `template ${index + 1}`;
      const deferred = (stored.domainInfo.deferred_resources as { key: string }[]) ?? [];
      const prefix = isInput ? INPUT_DATASET_TEMPLATE_PREFIX : OUTPUT_DATASET_TEMPLATE_PREFIX;
      const resourcePrefix = isInput
        ? INPUT_TEMPLATE_RESOURCE_PREFIX
        : OUTPUT_TEMPLATE_RESOURCE_PREFIX;
      datasetTemplates.push({
        datasetTemplateId: ref.template_id,
        templateIdHeader: `${prefix}${name} [template id: ${ref.template_id}]`,
        resourceHeaders: deferred.map((d) => ({
          key: d.key,
          header: `${resourcePrefix}${d.key}`,
        })),
        isInput,
      });
    }
  };
  await resolve(template.inputTemplates, true);
  await resolve(template.outputTemplates, false);

  return {
    workflowTemplateId,
    datasetTemplates,
    requiredAnnotations: template.annotations?.required ?? [],
    optionalAnnotations: template.annotations?.optional ?? [],
  };
};

const compileHeaders = (headerSet: TemplateHeaderSet): string[] => {
  const headers: string[] = [workflowTemplateFlag(headerSet.workflowTemplateId)];
  for (const dt of headerSet.datasetTemplates) {
    headers.push(dt.templateIdHeader);
    headers.push(...dt.resourceHeaders.map((r) => r.header));
  }
  headers.push(
    DISPLAY_NAME_HEADER,
    DESCRIPTION_HEADER,
    MODEL_VERSION_HEADER,
    AGENT_HEADER,
    STUDY_HEADER,
    START_TIME_HEADER,
    END_TIME_HEADER,
  );
  headers.push(...headerSet.requiredAnnotations.map((a) => `${ANNOTATION_PREFIX}${a}`));
  headers.push(...headerSet.optionalAnnotations.map((a) => `${ANNOTATION_PREFIX}${a}`));
  return headers;
};

export const generateTemplateCsv = async (workflowTemplateId: string): Promise<string> => {
  const headerSet = await buildHeaderSet(workflowTemplateId);
  return stringify([compileHeaders(headerSet)]);
};

/* ------------------------------ conversion ------------------------------- */

const isoToEpoch = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw badRequest(
      `Could not parse timestamp '${value}'. Expected format YYYY-MM-DD HH:MM:SS+HH:MM.`,
    );
  }
  return Math.floor(parsed / 1000);
};

const epochToIso = (epoch: number): string => {
  const date = new Date(epoch * 1000);
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00:00");
};

export interface ConversionOutcome {
  newRecords: ModelRunRecord[];
  existingRecords: string[];
  warnings: string[];
}

export const convertCsvToRecords = async (csvContent: string): Promise<ConversionOutcome> => {
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (rows.length === 0) {
    throw badRequest("Provided CSV contained no data rows.");
  }

  /* Find the workflow template id from the marker header. */
  const headers = Object.keys(rows[0]!);
  let workflowTemplateId: string | null = null;
  for (const header of headers) {
    const match = WORKFLOW_FLAG_REGEX.exec(header);
    if (match?.[1]) {
      workflowTemplateId = match[1];
      break;
    }
  }
  if (!workflowTemplateId) {
    throw badRequest(
      "Could not derive workflow template id from the CSV headers - is the template marker column present?",
    );
  }

  const headerSet = await buildHeaderSet(workflowTemplateId);
  const expectedHeaders = compileHeaders(headerSet);
  for (const expected of expectedHeaders) {
    /* optional annotations may be absent */
    const isOptionalAnnotation = headerSet.optionalAnnotations.some(
      (a) => `${ANNOTATION_PREFIX}${a}` === expected,
    );
    if (!headers.includes(expected) && !isOptionalAnnotation) {
      throw badRequest(`Expected header '${expected}' not in headers!`);
    }
  }

  const warnings: string[] = [];
  const newRecords: ModelRunRecord[] = [];
  const existingRecords: string[] = [];

  for (const row of rows) {
    const inputs = headerSet.datasetTemplates
      .filter((dt) => dt.isInput)
      .map((dt) => ({
        dataset_template_id: dt.datasetTemplateId,
        dataset_id: row[dt.templateIdHeader] ?? "",
        dataset_type: "DATA_STORE" as const,
        resources:
          dt.resourceHeaders.length > 0
            ? Object.fromEntries(dt.resourceHeaders.map((r) => [r.key, row[r.header] ?? ""]))
            : null,
      }));
    const outputs = headerSet.datasetTemplates
      .filter((dt) => !dt.isInput)
      .map((dt) => ({
        dataset_template_id: dt.datasetTemplateId,
        dataset_id: row[dt.templateIdHeader] ?? "",
        dataset_type: "DATA_STORE" as const,
        resources:
          dt.resourceHeaders.length > 0
            ? Object.fromEntries(dt.resourceHeaders.map((r) => [r.key, row[r.header] ?? ""]))
            : null,
      }));

    const annotations: Record<string, string> = {};
    for (const key of [...headerSet.requiredAnnotations, ...headerSet.optionalAnnotations]) {
      const value = row[`${ANNOTATION_PREFIX}${key}`];
      if (value) annotations[key] = value;
    }

    const record: ModelRunRecord = {
      workflow_template_id: workflowTemplateId,
      model_version: row[MODEL_VERSION_HEADER] || undefined,
      inputs: inputs as ModelRunRecord["inputs"],
      outputs: outputs as ModelRunRecord["outputs"],
      annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
      display_name: row[DISPLAY_NAME_HEADER] ?? "",
      description: row[DESCRIPTION_HEADER] ?? "",
      study_id: row[STUDY_HEADER] || undefined,
      associations: { modeller_id: row[AGENT_HEADER] ?? "" },
      start_time: isoToEpoch(row[START_TIME_HEADER] ?? ""),
      end_time: isoToEpoch(row[END_TIME_HEADER] ?? ""),
    };
    if (!record.display_name) {
      throw badRequest("Expected display name to be non-empty string.");
    }
    if (!record.description) {
      throw badRequest("Expected description to be non-empty string.");
    }
    newRecords.push(record);
  }

  return { newRecords, existingRecords, warnings };
};

/* --------------------------- batch regeneration -------------------------- */

export const regenerateCsvFromRecords = async (
  records: { record: ModelRunRecord; id?: string }[],
): Promise<string> => {
  if (records.length === 0) throw badRequest("No records found for this batch.");
  const workflowTemplateId = records[0]!.record.workflow_template_id;
  const headerSet = await buildHeaderSet(workflowTemplateId);
  const headers = compileHeaders(headerSet);

  const rows: string[][] = [headers];
  for (const { record } of records) {
    const row: string[] = [""];
    for (const dt of headerSet.datasetTemplates) {
      const entries = dt.isInput ? record.inputs : record.outputs;
      const entry = entries.find((e) => e.dataset_template_id === dt.datasetTemplateId);
      if (!entry) {
        throw badRequest(
          `No ${dt.isInput ? "input" : "output"} found in model run record for dataset template: ${dt.datasetTemplateId}.`,
        );
      }
      row.push(entry.dataset_id);
      for (const resource of dt.resourceHeaders) {
        row.push(entry.resources?.[resource.key] ?? "");
      }
    }
    row.push(
      record.display_name,
      record.description ?? "",
      record.model_version ?? "",
      record.associations.modeller_id,
      record.study_id ?? "",
      epochToIso(record.start_time),
      epochToIso(record.end_time),
    );
    for (const key of [...headerSet.requiredAnnotations, ...headerSet.optionalAnnotations]) {
      row.push(record.annotations?.[key] ?? "");
    }
    rows.push(row);
  }
  return stringify(rows);
};
