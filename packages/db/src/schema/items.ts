/**
 * Registry item tables: a shared `item` base table plus one satellite table
 * per instantiable subtype holding the typed domain information, and an
 * append-only history table storing domain info snapshots.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type {
  DatasetMetadata,
  ReleaseHistoryEntry,
  DefinedResource,
  DeferredResource,
  TemplateResource,
  WorkflowTemplateAnnotations,
} from "@provena/interfaces/types/RegistryModels";
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import {
  itemCategoryEnum,
  itemSubTypeEnum,
  recordTypeEnum,
  releasedStatusEnum,
  workflowRunCompletionStatusEnum,
} from "./enums.js";

export const item = pgTable(
  "item",
  {
    /** Handle identifier, e.g. "10378.1/1234567". */
    id: text("id").primaryKey(),
    itemCategory: itemCategoryEnum("item_category").notNull(),
    itemSubType: itemSubTypeEnum("item_subtype").notNull(),
    ownerUsername: text("owner_username").notNull(),
    createdTimestamp: bigint("created_timestamp", { mode: "number" }).notNull(),
    updatedTimestamp: bigint("updated_timestamp", { mode: "number" }).notNull(),
    recordType: recordTypeEnum("record_type").notNull(),
    /** Null for seed items (legacy SeededItem has no display name). */
    displayName: text("display_name"),
    userMetadata: jsonb("user_metadata").$type<Record<string, string>>(),
    /* Versioning info (nullable - only versioning-enabled subtypes). */
    versioningPreviousVersion: text("versioning_previous_version"),
    versioningVersion: integer("versioning_version"),
    versioningReason: text("versioning_reason"),
    versioningNextVersion: text("versioning_next_version"),
    /* Workflow links - spun-off activity job session ids. */
    createActivityWorkflowId: text("create_activity_workflow_id"),
    versionActivityWorkflowId: text("version_activity_workflow_id"),
    /** Flat search document maintained by the application. */
    searchText: text("search_text"),
  },
  (t) => [
    index("item_subtype_updated_idx").on(t.itemSubType, t.updatedTimestamp),
    index("item_subtype_created_idx").on(t.itemSubType, t.createdTimestamp),
    index("item_subtype_display_idx").on(t.itemSubType, t.displayName),
    index("item_owner_idx").on(t.ownerUsername),
  ],
);

export const itemOrganisation = pgTable("item_organisation", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ror: text("ror"),
});

export const itemPerson = pgTable("item_person", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  orcid: text("orcid"),
  ethicsApproved: boolean("ethics_approved").notNull().default(false),
});

export const itemModel = pgTable("item_model", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  documentationUrl: text("documentation_url").notNull(),
  sourceUrl: text("source_url").notNull(),
});

export const itemModelRunWorkflowTemplate = pgTable("item_model_run_workflow_template", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  softwareId: text("software_id").notNull(),
  inputTemplates: jsonb("input_templates").$type<TemplateResource[]>().notNull().default([]),
  outputTemplates: jsonb("output_templates").$type<TemplateResource[]>().notNull().default([]),
  annotations: jsonb("annotations").$type<WorkflowTemplateAnnotations>(),
});

export const itemDatasetTemplate = pgTable("item_dataset_template", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  description: text("description"),
  definedResources: jsonb("defined_resources").$type<DefinedResource[]>().notNull().default([]),
  deferredResources: jsonb("deferred_resources")
    .$type<DeferredResource[]>()
    .notNull()
    .default([]),
});

export const itemDataset = pgTable(
  "item_dataset",
  {
    itemId: text("item_id")
      .primaryKey()
      .references(() => item.id, { onDelete: "cascade" }),
    collectionFormat: jsonb("collection_format").$type<DatasetMetadata>().notNull(),
    s3BucketName: text("s3_bucket_name").notNull(),
    s3Path: text("s3_path").notNull(),
    s3Uri: text("s3_uri").notNull(),
    releaseStatus: releasedStatusEnum("release_status").notNull().default("NOT_RELEASED"),
    releaseApprover: text("release_approver"),
    releaseTimestamp: bigint("release_timestamp", { mode: "number" }),
    accessInfoUri: text("access_info_uri"),
    releaseHistory: jsonb("release_history")
      .$type<ReleaseHistoryEntry[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    index("item_dataset_release_status_idx").on(t.releaseStatus),
    index("item_dataset_release_approver_idx").on(t.releaseApprover),
    index("item_dataset_access_info_uri_idx").on(t.accessInfoUri),
  ],
);

export const itemStudy = pgTable("item_study", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  studyAlternativeId: text("study_alternative_id"),
});

export const itemCreate = pgTable("item_create", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  createdItemId: text("created_item_id").notNull(),
});

export const itemVersion = pgTable("item_version", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  fromItemId: text("from_item_id").notNull(),
  toItemId: text("to_item_id").notNull(),
  newVersionNumber: integer("new_version_number").notNull(),
});

export const itemModelRun = pgTable(
  "item_model_run",
  {
    itemId: text("item_id")
      .primaryKey()
      .references(() => item.id, { onDelete: "cascade" }),
    record: jsonb("record").$type<ModelRunRecord>().notNull(),
    provSerialisation: text("prov_serialisation").notNull(),
    recordStatus: workflowRunCompletionStatusEnum("record_status")
      .notNull()
      .default("INCOMPLETE"),
    /** Denormalised from record.study_id for efficient lookups. */
    studyId: text("study_id"),
  },
  (t) => [index("item_model_run_study_idx").on(t.studyId)],
);

/** Append-only history of domain info snapshots per item. */
export const itemHistory = pgTable(
  "item_history",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    historyId: integer("history_id").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    username: text("username").notNull(),
    domainInfo: jsonb("domain_info").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.historyId] })],
);
