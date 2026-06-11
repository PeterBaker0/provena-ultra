/**
 * Item category / subtype configuration.
 *
 * Ported from legacy `registry-api/main.py` route configuration and
 * `ProvenaInterfaces/RegistryModels.py` type maps.
 */
import type { ItemCategory, ItemSubType } from "../types/RegistryModels.js";
import {
  DATASET_ROLE_LIST,
  ENTITY_BASE_ROLE_LIST,
  METADATA_READ_ROLE,
  DATASET_READ_ROLE,
  type Roles,
} from "./roles.js";

/** Category to URL segment, e.g. ACTIVITY -> activity. */
export const ITEM_CATEGORY_ROUTE_MAP: Record<ItemCategory, string> = {
  ACTIVITY: "activity",
  ENTITY: "entity",
  AGENT: "agent",
};

/** Subtype to URL segment for the per-subtype registry routers. */
export const ITEM_SUB_TYPE_ROUTE_MAP: Partial<Record<ItemSubType, string>> = {
  MODEL_RUN: "model_run",
  MODEL: "model",
  ORGANISATION: "organisation",
  PERSON: "person",
  MODEL_RUN_WORKFLOW_TEMPLATE: "model_run_workflow",
  DATASET_TEMPLATE: "dataset_template",
  DATASET: "dataset",
  STUDY: "study",
  CREATE: "create",
  VERSION: "version",
};

/** Subtype -> category for all instantiable subtypes. */
export const SUBTYPE_CATEGORY_MAP: Partial<Record<ItemSubType, ItemCategory>> = {
  MODEL_RUN: "ACTIVITY",
  STUDY: "ACTIVITY",
  CREATE: "ACTIVITY",
  VERSION: "ACTIVITY",
  PERSON: "AGENT",
  ORGANISATION: "AGENT",
  MODEL: "ENTITY",
  MODEL_RUN_WORKFLOW_TEMPLATE: "ENTITY",
  DATASET: "ENTITY",
  DATASET_TEMPLATE: "ENTITY",
};

export const INSTANTIABLE_SUBTYPES = Object.keys(SUBTYPE_CATEGORY_MAP) as ItemSubType[];

export const categoryForSubtype = (subtype: ItemSubType): ItemCategory => {
  const category = SUBTYPE_CATEGORY_MAP[subtype];
  if (!category) throw new Error(`No category configured for subtype ${subtype}.`);
  return category;
};

/** Subtypes with provenance-enabled versioning (legacy PROV_VERSIONING_ENABLED_SUBTYPES). */
export const PROV_VERSIONING_ENABLED_SUBTYPES: ItemSubType[] = [
  "MODEL",
  "MODEL_RUN_WORKFLOW_TEMPLATE",
  "DATASET",
  "DATASET_TEMPLATE",
];

/** Read-only subtypes - managed exclusively by system activities. */
export const READ_ONLY_SUBTYPES: ItemSubType[] = ["CREATE", "VERSION"];

/**
 * Subtypes whose create/update routes are not exposed on the registry router -
 * they are managed by the data store (DATASET) and prov (MODEL_RUN) routers.
 */
export const SERVICE_MANAGED_SUBTYPES: ItemSubType[] = ["DATASET", "MODEL_RUN"];

/** Available item-level roles per subtype. */
export const availableRolesForSubtype = (subtype: ItemSubType): Roles =>
  subtype === "DATASET" ? DATASET_ROLE_LIST : ENTITY_BASE_ROLE_LIST;

/** Default general-access roles applied to newly created items. */
export const defaultRolesForSubtype = (subtype: ItemSubType): Roles =>
  subtype === "DATASET" ? [METADATA_READ_ROLE, DATASET_READ_ROLE] : [METADATA_READ_ROLE];

/** Subtypes which require a linked Person before modifying actions. */
export const ENFORCED_LINK_SUBTYPES: ItemSubType[] = [
  "MODEL",
  "MODEL_RUN_WORKFLOW_TEMPLATE",
  "DATASET_TEMPLATE",
  "DATASET",
  "STUDY",
  "CREATE",
  "VERSION",
];

export const subtypeRequiresLinkedPerson = (subtype: ItemSubType): boolean =>
  ENFORCED_LINK_SUBTYPES.includes(subtype);

export const subtypeHasVersioning = (subtype: ItemSubType): boolean =>
  PROV_VERSIONING_ENABLED_SUBTYPES.includes(subtype);
