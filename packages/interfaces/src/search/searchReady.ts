/**
 * Builds the flat "search ready" text document for an item, used to populate
 * the Postgres full-text search vector.
 *
 * Ported from the `get_search_ready_object` implementations in legacy
 * `ProvenaInterfaces/RegistryModels.py` and `ProvenanceModels.py`.
 */
import type {
  // NOTE: pydantic2ts generated interface names use JSON-schema titles where
  // set - `DatasetMetadata` is the legacy `CollectionFormat` model.
  DatasetMetadata as CollectionFormat,
  DatasetTemplateDomainInfo,
  DatasetDomainInfo,
  ModelDomainInfo,
  ModelRunDomainInfo,
  ModelRunRecord,
  OrganisationDomainInfo,
  PersonDomainInfo,
  StudyDomainInfo,
  VersionDomainInfo,
  CreateDomainInfo,
  ModelRunWorkflowTemplateDomainInfo as WorkflowTemplateDomainInfo,
  ItemSubType,
} from "../types/RegistryModels.js";

export interface SearchableRecordInfo {
  id: string;
  item_category: string;
  item_subtype: string;
  owner_username: string;
  display_name: string;
  user_metadata?: Record<string, string> | null;
}

const compactRecord = (record?: Record<string, string> | null): string =>
  record ? Object.entries(record).flat().join(" ") : "";

const baseFields = (info: SearchableRecordInfo): string[] => [
  info.id,
  info.item_category,
  info.item_subtype,
  info.owner_username,
  info.display_name,
  compactRecord(info.user_metadata),
];

const modelRunRecordFields = (record: ModelRunRecord): string[] => {
  const templatedDataset = (t: {
    dataset_template_id: string;
    dataset_id: string;
    resources?: Record<string, string> | null;
  }): string =>
    [t.dataset_template_id, t.dataset_id, compactRecord(t.resources)].join(" ");
  return [
    record.workflow_template_id,
    record.display_name,
    record.model_version ?? "",
    record.description ?? "",
    record.inputs.map(templatedDataset).join(" "),
    record.outputs.map(templatedDataset).join(" "),
    compactRecord(record.annotations),
    [record.associations.modeller_id, record.associations.requesting_organisation_id ?? ""].join(
      " ",
    ),
    String(record.start_time),
    String(record.end_time),
  ];
};

const collectionFormatFields = (cf: CollectionFormat): string[] => {
  const di = cf.dataset_info;
  return [
    di.description,
    di.name,
    di.publisher_id,
    cf.associations.organisation_id,
    (di.keywords ?? []).join(" "),
    (di.formats ?? []).join(" "),
    di.preferred_citation ?? "",
    di.usage_limitations ?? "",
    di.rights_holder ?? "",
    di.purpose ?? "",
    cf.associations.data_custodian_id ?? "",
  ];
};

/**
 * Produce the search document text for an item given its record info and
 * domain info. Unknown subtypes fall back to base record fields only.
 */
export const buildSearchDocument = (
  info: SearchableRecordInfo,
  subtype: ItemSubType,
  domainInfo: unknown,
): string => {
  const fields = [...baseFields(info)];
  switch (subtype) {
    case "ORGANISATION": {
      const d = domainInfo as OrganisationDomainInfo;
      fields.push(d.name, d.ror ?? "");
      break;
    }
    case "PERSON": {
      const d = domainInfo as PersonDomainInfo;
      fields.push(d.first_name, d.last_name, d.email, d.orcid ?? "");
      break;
    }
    case "MODEL": {
      const d = domainInfo as ModelDomainInfo;
      fields.push(d.name, d.description, d.documentation_url, d.source_url);
      break;
    }
    case "MODEL_RUN_WORKFLOW_TEMPLATE": {
      const d = domainInfo as WorkflowTemplateDomainInfo;
      fields.push(
        d.software_id,
        (d.input_templates ?? []).map((t) => t.template_id).join(" "),
        (d.output_templates ?? []).map((t) => t.template_id).join(" "),
        d.annotations
          ? [...(d.annotations.required ?? []), ...(d.annotations.optional ?? [])].join(" ")
          : "",
      );
      break;
    }
    case "DATASET_TEMPLATE": {
      const d = domainInfo as DatasetTemplateDomainInfo;
      const definedResource = (r: {
        path: string;
        description: string;
        additional_metadata?: Record<string, string> | null;
      }) => [r.path, r.description, compactRecord(r.additional_metadata)].join(" ");
      const deferredResource = (r: {
        key: string;
        description: string;
        additional_metadata?: Record<string, string> | null;
      }) => [r.key, r.description, compactRecord(r.additional_metadata)].join(" ");
      fields.push(
        d.description ?? "",
        (d.deferred_resources ?? []).map(deferredResource).join(" "),
        (d.defined_resources ?? []).map(definedResource).join(" "),
      );
      break;
    }
    case "DATASET": {
      const d = domainInfo as DatasetDomainInfo;
      fields.push(...collectionFormatFields(d.collection_format));
      break;
    }
    case "STUDY": {
      const d = domainInfo as StudyDomainInfo;
      fields.push(d.title, d.description, d.study_alternative_id ?? "");
      break;
    }
    case "CREATE": {
      const d = domainInfo as CreateDomainInfo;
      fields.push(d.created_item_id);
      break;
    }
    case "VERSION": {
      const d = domainInfo as VersionDomainInfo;
      fields.push(d.from_item_id, d.to_item_id, String(d.new_version_number));
      break;
    }
    case "MODEL_RUN": {
      const d = domainInfo as ModelRunDomainInfo;
      fields.push(...modelRunRecordFields(d.record));
      break;
    }
    default:
      break;
  }
  return fields
    .filter((f) => f && f.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};
