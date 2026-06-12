/**
 * Auth + lock sidecar tables (legacy parallel DynamoDB tables).
 */
import { bigint, index, jsonb, pgTable, serial, text, boolean } from "drizzle-orm/pg-core";
import { item } from "./items.js";
import { lockActionTypeEnum } from "./enums.js";

export const itemAuth = pgTable("item_auth", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  generalRoles: text("general_roles").array().notNull().default([]),
  /** group id -> granted roles */
  groupRoles: jsonb("group_roles").$type<Record<string, string[]>>().notNull().default({}),
});

export const itemLock = pgTable("item_lock", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  locked: boolean("locked").notNull().default(false),
});

export const lockEvent = pgTable(
  "lock_event",
  {
    id: serial("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    actionType: lockActionTypeEnum("action_type").notNull(),
    username: text("username").notNull(),
    email: text("email"),
    reason: text("reason").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  },
  (t) => [index("lock_event_item_idx").on(t.itemId)],
);
