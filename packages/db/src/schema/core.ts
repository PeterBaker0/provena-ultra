import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const itemCategoryEnum = pgEnum("item_category", ["activity", "entity", "agent"]);
export const itemSubtypeEnum = pgEnum("item_subtype", [
  "person",
  "organisation",
  "dataset",
  "model",
  "study",
  "create",
  "version",
  "model_run",
  "model_run_workflow_template",
  "dataset_template",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "PENDING",
  "DEQUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
]);
export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nameUnique: uniqueIndex("groups_name_unique").on(table.name),
  }),
);

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupName: varchar("group_name", { length: 255 })
      .notNull()
      .references(() => groups.name, { onDelete: "cascade" }),
    username: varchar("username", { length: 255 }).notNull(),
    addedBy: varchar("added_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    membershipUnique: uniqueIndex("group_members_group_name_username_unique").on(
      table.groupName,
      table.username,
    ),
    usernameIdx: index("group_members_username_idx").on(table.username),
  }),
);

export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 255 }).notNull(),
    requestedRoles: jsonb("requested_roles").$type<string[]>().default([]).notNull(),
    reason: text("reason").notNull(),
    status: accessRequestStatusEnum("status").default("PENDING").notNull(),
    notes: jsonb("notes").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usernameIdx: index("access_requests_username_idx").on(table.username),
    statusIdx: index("access_requests_status_idx").on(table.status),
  }),
);

export const usernamePersonLinks = pgTable(
  "username_person_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 255 }).notNull(),
    personId: varchar("person_id", { length: 255 }).notNull(),
    linkedBy: varchar("linked_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex("username_person_links_username_unique").on(table.username),
    personUnique: uniqueIndex("username_person_links_person_id_unique").on(table.personId),
  }),
);

export const registryItems = pgTable(
  "registry_items",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    category: itemCategoryEnum("category").notNull(),
    subtype: itemSubtypeEnum("subtype").notNull(),
    version: integer("version").default(0).notNull(),
    displayName: varchar("display_name", { length: 512 }).notNull(),
    ownerUsername: varchar("owner_username", { length: 255 }).notNull(),
    record: jsonb("record").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    categorySubtypeIdx: index("registry_items_category_subtype_idx").on(table.category, table.subtype),
    ownerIdx: index("registry_items_owner_username_idx").on(table.ownerUsername),
    displayNameIdx: index("registry_items_display_name_idx").on(table.displayName),
  }),
);

export const registryItemHistory = pgTable(
  "registry_item_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: varchar("item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    record: jsonb("record").$type<Record<string, unknown>>().notNull(),
    changedBy: varchar("changed_by", { length: 255 }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemVersionUnique: uniqueIndex("registry_item_history_item_version_unique").on(table.itemId, table.version),
  }),
);

export const registryAccessSettings = pgTable(
  "registry_access_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: varchar("item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    openAccess: boolean("open_access").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemUnique: uniqueIndex("registry_access_settings_item_unique").on(table.itemId),
  }),
);

export const registryAccessGroupRoles = pgTable(
  "registry_access_group_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: varchar("item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    groupName: varchar("group_name", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
  },
  (table) => ({
    itemGroupRoleUnique: uniqueIndex("registry_access_group_roles_item_group_role_unique").on(
      table.itemId,
      table.groupName,
      table.role,
    ),
  }),
);

export const registryLocks = pgTable(
  "registry_locks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: varchar("item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    locked: boolean("locked").default(false).notNull(),
    reason: text("reason"),
    lockedBy: varchar("locked_by", { length: 255 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemUnique: uniqueIndex("registry_locks_item_unique").on(table.itemId),
  }),
);

export const registryLockEvents = pgTable(
  "registry_lock_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: varchar("item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 16 }).notNull(),
    actorUsername: varchar("actor_username", { length: 255 }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemCreatedIdx: index("registry_lock_events_item_created_idx").on(table.itemId, table.createdAt),
  }),
);

export const datasetReviewers = pgTable(
  "dataset_reviewers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 255 }).notNull(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex("dataset_reviewers_username_unique").on(table.username),
  }),
);

export const datasetReleaseRequests = pgTable(
  "dataset_release_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: varchar("dataset_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    requesterUsername: varchar("requester_username", { length: 255 }).notNull(),
    notes: text("notes"),
    status: varchar("status", { length: 16 }).default("PENDING").notNull(),
    decidedBy: varchar("decided_by", { length: 255 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    datasetIdx: index("dataset_release_requests_dataset_idx").on(table.datasetId),
    requesterIdx: index("dataset_release_requests_requester_idx").on(table.requesterUsername),
    statusIdx: index("dataset_release_requests_status_idx").on(table.status),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").defaultRandom().notNull(),
    batchId: uuid("batch_id"),
    username: varchar("username", { length: 255 }).notNull(),
    jobType: varchar("job_type", { length: 128 }).notNull(),
    jobSubType: varchar("job_sub_type", { length: 128 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    status: jobStatusEnum("status").default("PENDING").notNull(),
    statusInfo: jsonb("status_info").$type<Record<string, unknown> | null>(),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionUnique: uniqueIndex("jobs_session_unique").on(table.sessionId),
    batchIdx: index("jobs_batch_idx").on(table.batchId),
    usernameIdx: index("jobs_username_idx").on(table.username),
  }),
);

export const provEdges = pgTable(
  "prov_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: varchar("source_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    relation: varchar("relation", { length: 64 }).notNull(),
    recordId: varchar("record_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceIdx: index("prov_edges_source_idx").on(table.sourceId),
    targetIdx: index("prov_edges_target_idx").on(table.targetId),
  }),
);

export const handles = pgTable(
  "handles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    handle: varchar("handle", { length: 255 }).notNull(),
    values: jsonb("values")
      .$type<Array<{ index: number; type: string; value: string }>>()
      .default([])
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    handleUnique: uniqueIndex("handles_handle_unique").on(table.handle),
  }),
);

export const searchDocuments = pgTable(
  "search_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registryItemId: varchar("registry_item_id", { length: 255 })
      .notNull()
      .references(() => registryItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    subtype: itemSubtypeEnum("subtype").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    registryItemUnique: uniqueIndex("search_documents_registry_item_unique").on(table.registryItemId),
    subtypeIdx: index("search_documents_subtype_idx").on(table.subtype),
  }),
);
