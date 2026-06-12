/**
 * Provenance report generation - Word document summarising the upstream
 * lineage of a STUDY or MODEL_RUN (replaces legacy python-docx generator).
 */
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { v4 as uuidv4 } from "uuid";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import { getContainer } from "../container.js";
import { badRequest } from "../errors.js";
import * as prov from "./provService.js";

const HDL_PREFIX = "https://hdl.handle.net/";

const SUBTYPE_LABELS: Partial<Record<string, string>> = {
  DATASET: "Datasets",
  MODEL: "Models",
  MODEL_RUN: "Model Runs",
  MODEL_RUN_WORKFLOW_TEMPLATE: "Workflow Templates",
  DATASET_TEMPLATE: "Dataset Templates",
  PERSON: "People",
  ORGANISATION: "Organisations",
  STUDY: "Studies",
  CREATE: "Create Activities",
  VERSION: "Version Activities",
};

export const generateReport = async (input: {
  id: string;
  itemSubtype: ItemSubType;
  depth: number;
  username: string;
}): Promise<{ reportUrl: string }> => {
  const { items, storage } = getContainer();
  if (input.itemSubtype !== "STUDY" && input.itemSubtype !== "MODEL_RUN") {
    throw badRequest(
      `Report generation only supports STUDY and MODEL_RUN items - got ${input.itemSubtype}.`,
    );
  }
  const rootItem = await items.fetchItem(input.id);
  if (!rootItem || rootItem.base.itemSubType !== input.itemSubtype) {
    throw badRequest(
      `Item ${input.id} does not exist or is not of subtype ${input.itemSubtype}.`,
    );
  }

  /* Collect the upstream neighbourhood. */
  const graph = await prov.lineage(input.id, input.depth, "upstream");
  const downstream = await prov.lineage(input.id, input.depth, "downstream");
  const allNodes = [...graph.nodes, ...downstream.nodes].filter((n) => n.id !== input.id);
  const grouped = new Map<string, Set<string>>();
  for (const node of allNodes) {
    const set = grouped.get(node.item_subtype) ?? new Set<string>();
    set.add(node.id);
    grouped.set(node.item_subtype, set);
  }

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(`Provenance Report: ${rootItem.base.displayName ?? input.id}`)],
    }),
    new Paragraph({
      children: [
        new TextRun(
          `Generated for ${input.itemSubtype} item ${input.id} (traversal depth ${input.depth}) by ${input.username}.`,
        ),
      ],
    }),
  ];

  for (const [subtype, ids] of grouped.entries()) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(SUBTYPE_LABELS[subtype] ?? subtype)],
      }),
    );
    for (const id of ids) {
      const stored = await items.fetchItem(id);
      const name = stored?.base.displayName ?? id;
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun(`${name} - `),
            new ExternalHyperlink({
              link: `${HDL_PREFIX}${id}`,
              children: [new TextRun({ text: id, style: "Hyperlink" })],
            }),
          ],
        }),
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const key = `reports/${input.username}/${uuidv4()}.docx`;
  await storage.putObject(
    key,
    new Uint8Array(buffer),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const reportUrl = await storage.presignedGetUrl(key, 3600);
  return { reportUrl };
};
