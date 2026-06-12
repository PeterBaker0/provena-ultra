/**
 * Marshalling between API-shaped DomainInfo objects and the per-subtype
 * satellite tables. The `display_name` / `user_metadata` fields of domain
 * info live on the base `item` table; everything else lives in the satellite.
 */
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  item,
  itemCreate,
  itemDataset,
  itemDatasetTemplate,
  itemModel,
  itemModelRun,
  itemModelRunWorkflowTemplate,
  itemOrganisation,
  itemPerson,
  itemStudy,
  itemVersion,
} from "../schema/items.js";

export type ItemRow = InferSelectModel<typeof item>;

export type DomainInfoObject = Record<string, unknown>;

/** Splits a domain info object into base-table fields + satellite payload. */
export interface SplitDomainInfo {
  displayName: string;
  userMetadata: Record<string, string> | null;
  satellite: DomainInfoObject;
}

export const splitDomainInfo = (domainInfo: DomainInfoObject): SplitDomainInfo => {
  const { display_name, user_metadata, ...rest } = domainInfo as {
    display_name: string;
    user_metadata?: Record<string, string> | null;
  } & DomainInfoObject;
  return {
    displayName: display_name,
    userMetadata: user_metadata ?? null,
    satellite: rest,
  };
};

type OrganisationRow = InferSelectModel<typeof itemOrganisation>;
type PersonRow = InferSelectModel<typeof itemPerson>;
type ModelRow = InferSelectModel<typeof itemModel>;
type MrwtRow = InferSelectModel<typeof itemModelRunWorkflowTemplate>;
type DatasetTemplateRow = InferSelectModel<typeof itemDatasetTemplate>;
type DatasetRow = InferSelectModel<typeof itemDataset>;
type StudyRow = InferSelectModel<typeof itemStudy>;
type CreateRow = InferSelectModel<typeof itemCreate>;
type VersionRow = InferSelectModel<typeof itemVersion>;
type ModelRunRow = InferSelectModel<typeof itemModelRun>;

export interface SubtypeMarshaller {
  table:
    | typeof itemOrganisation
    | typeof itemPerson
    | typeof itemModel
    | typeof itemModelRunWorkflowTemplate
    | typeof itemDatasetTemplate
    | typeof itemDataset
    | typeof itemStudy
    | typeof itemCreate
    | typeof itemVersion
    | typeof itemModelRun;
  /** Convert satellite domain payload -> row insert values (minus itemId). */
  toRow: (satellite: DomainInfoObject) => Record<string, unknown>;
  /** Convert satellite row -> domain payload fragment. */
  fromRow: (row: Record<string, unknown>) => DomainInfoObject;
}

const orDefault = <T>(value: T | null | undefined, fallback: T): T =>
  value === null || value === undefined ? fallback : value;

export const SUBTYPE_MARSHALLERS: Partial<Record<ItemSubType, SubtypeMarshaller>> = {
  ORGANISATION: {
    table: itemOrganisation,
    toRow: (s) => ({ name: s.name, ror: s.ror ?? null }),
    fromRow: (r) => {
      const row = r as OrganisationRow;
      return { name: row.name, ror: row.ror };
    },
  },
  PERSON: {
    table: itemPerson,
    toRow: (s) => ({
      email: s.email,
      firstName: s.first_name,
      lastName: s.last_name,
      orcid: s.orcid ?? null,
      ethicsApproved: orDefault(s.ethics_approved as boolean | undefined, false),
    }),
    fromRow: (r) => {
      const row = r as PersonRow;
      return {
        email: row.email,
        first_name: row.firstName,
        last_name: row.lastName,
        orcid: row.orcid,
        ethics_approved: row.ethicsApproved,
      };
    },
  },
  MODEL: {
    table: itemModel,
    toRow: (s) => ({
      name: s.name,
      description: s.description,
      documentationUrl: s.documentation_url,
      sourceUrl: s.source_url,
    }),
    fromRow: (r) => {
      const row = r as ModelRow;
      return {
        name: row.name,
        description: row.description,
        documentation_url: row.documentationUrl,
        source_url: row.sourceUrl,
      };
    },
  },
  MODEL_RUN_WORKFLOW_TEMPLATE: {
    table: itemModelRunWorkflowTemplate,
    toRow: (s) => ({
      softwareId: s.software_id,
      inputTemplates: orDefault(s.input_templates, []),
      outputTemplates: orDefault(s.output_templates, []),
      annotations: s.annotations ?? null,
    }),
    fromRow: (r) => {
      const row = r as MrwtRow;
      return {
        software_id: row.softwareId,
        input_templates: row.inputTemplates,
        output_templates: row.outputTemplates,
        annotations: row.annotations,
      };
    },
  },
  DATASET_TEMPLATE: {
    table: itemDatasetTemplate,
    toRow: (s) => ({
      description: s.description ?? null,
      definedResources: orDefault(s.defined_resources, []),
      deferredResources: orDefault(s.deferred_resources, []),
    }),
    fromRow: (r) => {
      const row = r as DatasetTemplateRow;
      return {
        description: row.description,
        defined_resources: row.definedResources,
        deferred_resources: row.deferredResources,
      };
    },
  },
  DATASET: {
    table: itemDataset,
    toRow: (s) => {
      const s3 = s.s3 as { bucket_name: string; path: string; s3_uri: string };
      return {
        collectionFormat: s.collection_format,
        s3BucketName: s3.bucket_name,
        s3Path: s3.path,
        s3Uri: s3.s3_uri,
        releaseStatus: orDefault(s.release_status, "NOT_RELEASED"),
        releaseApprover: s.release_approver ?? null,
        releaseTimestamp: s.release_timestamp ?? null,
        accessInfoUri: s.access_info_uri ?? null,
        releaseHistory: orDefault(s.release_history, []),
      };
    },
    fromRow: (r) => {
      const row = r as DatasetRow;
      return {
        collection_format: row.collectionFormat,
        s3: {
          bucket_name: row.s3BucketName,
          path: row.s3Path,
          s3_uri: row.s3Uri,
        },
        release_history: row.releaseHistory,
        release_status: row.releaseStatus,
        release_approver: row.releaseApprover,
        release_timestamp: row.releaseTimestamp,
        access_info_uri: row.accessInfoUri,
      };
    },
  },
  STUDY: {
    table: itemStudy,
    toRow: (s) => ({
      title: s.title,
      description: s.description,
      studyAlternativeId: s.study_alternative_id ?? null,
    }),
    fromRow: (r) => {
      const row = r as StudyRow;
      return {
        title: row.title,
        description: row.description,
        study_alternative_id: row.studyAlternativeId,
      };
    },
  },
  CREATE: {
    table: itemCreate,
    toRow: (s) => ({ createdItemId: s.created_item_id }),
    fromRow: (r) => {
      const row = r as CreateRow;
      return { created_item_id: row.createdItemId };
    },
  },
  VERSION: {
    table: itemVersion,
    toRow: (s) => ({
      reason: s.reason,
      fromItemId: s.from_item_id,
      toItemId: s.to_item_id,
      newVersionNumber: s.new_version_number,
    }),
    fromRow: (r) => {
      const row = r as VersionRow;
      return {
        reason: row.reason,
        from_item_id: row.fromItemId,
        to_item_id: row.toItemId,
        new_version_number: row.newVersionNumber,
      };
    },
  },
  MODEL_RUN: {
    table: itemModelRun,
    toRow: (s) => {
      const record = s.record as { study_id?: string | null };
      return {
        record: s.record,
        provSerialisation: orDefault(s.prov_serialisation as string | undefined, ""),
        recordStatus: orDefault(s.record_status, "INCOMPLETE"),
        studyId: record?.study_id ?? null,
      };
    },
    fromRow: (r) => {
      const row = r as ModelRunRow;
      return {
        record: row.record,
        prov_serialisation: row.provSerialisation,
        record_status: row.recordStatus,
      };
    },
  },
};

export const marshallerFor = (subtype: ItemSubType): SubtypeMarshaller => {
  const marshaller = SUBTYPE_MARSHALLERS[subtype];
  if (!marshaller) throw new Error(`No satellite marshaller for subtype ${subtype}.`);
  return marshaller;
};
