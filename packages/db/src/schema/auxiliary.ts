/**
 * Groups, access requests, username<->person links, handles, job sessions
 * and dataset reviewers.
 */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type { HandleProperty } from "@provena/interfaces/types/HandleModels";
import { jobStatusEnum, jobSubTypeEnum, jobTypeEnum, requestStatusEnum } from "./enums.js";

/* Groups */

export const userGroup = pgTable("user_group", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  defaultDataStoreAccess: text("default_data_store_access").array(),
});

export const userGroupMember = pgTable(
  "user_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.username] }),
    index("user_group_member_username_idx").on(t.username),
  ],
);

/* Access requests */

export const accessRequest = pgTable(
  "access_request",
  {
    username: text("username").notNull(),
    requestId: integer("request_id").notNull(),
    email: text("email").notNull(),
    status: requestStatusEnum("status").notNull(),
    uiFriendlyStatus: text("ui_friendly_status").notNull(),
    createdTimestamp: bigint("created_timestamp", { mode: "number" }).notNull(),
    updatedTimestamp: bigint("updated_timestamp", { mode: "number" }).notNull(),
    expiry: bigint("expiry", { mode: "number" }).notNull(),
    requestDiffContents: text("request_diff_contents").notNull(),
    completeContents: text("complete_contents").notNull(),
    notes: text("notes").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.username, t.requestId] })],
);

/* Username <-> Person link service */

export const userPersonLink = pgTable(
  "user_person_link",
  {
    username: text("username").primaryKey(),
    personId: text("person_id").notNull(),
  },
  (t) => [index("user_person_link_person_idx").on(t.personId)],
);

/* Handle registry (internal ID minting) */

export const handle = pgTable("handle", {
  id: text("id").primaryKey(),
  properties: jsonb("properties").$type<HandleProperty[]>().notNull().default([]),
});

/* Job sessions (legacy JobStatusTable shape) */

export const jobSession = pgTable(
  "job_session",
  {
    sessionId: text("session_id").primaryKey(),
    createdTimestamp: bigint("created_timestamp", { mode: "number" }).notNull(),
    username: text("username").notNull(),
    batchId: text("batch_id"),
    jobType: jobTypeEnum("job_type").notNull(),
    jobSubType: jobSubTypeEnum("job_sub_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum("status").notNull().default("PENDING"),
    info: text("info"),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("job_session_username_idx").on(t.username, t.createdTimestamp),
    index("job_session_batch_idx").on(t.batchId),
    index("job_session_created_idx").on(t.createdTimestamp),
  ],
);

/* Dataset release sys reviewers */

export const datasetReviewer = pgTable("dataset_reviewer", {
  id: text("id").primaryKey(),
});
