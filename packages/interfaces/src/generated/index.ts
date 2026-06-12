/**
 * Schemas generated from the legacy pydantic models via
 * `scripts/generate-legacy-schemas.py` - served verbatim by the /schema and
 * /ui_schema registry endpoints for full rjsf form compatibility.
 */
import registrySchemasJson from "./registrySchemas.json" with { type: "json" };
import type { ItemSubType } from "../types/RegistryModels.js";

interface SchemaEntry {
  json_schema: Record<string, unknown>;
  ui_schema: Record<string, unknown>;
}

const registrySchemas = registrySchemasJson as unknown as Record<string, SchemaEntry>;

export const jsonSchemaForSubtype = (subtype: ItemSubType): Record<string, unknown> => {
  const entry = registrySchemas[subtype];
  if (!entry) throw new Error(`No generated JSON schema for subtype ${subtype}.`);
  return entry.json_schema;
};

export const uiSchemaForSubtype = (subtype: ItemSubType): Record<string, unknown> => {
  const entry = registrySchemas[subtype];
  if (!entry) throw new Error(`No generated UI schema for subtype ${subtype}.`);
  return entry.ui_schema;
};

export const collectionFormatJsonSchema = (): Record<string, unknown> =>
  registrySchemas["__COLLECTION_FORMAT__"]!.json_schema;
