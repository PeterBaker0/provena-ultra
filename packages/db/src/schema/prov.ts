/**
 * Provenance graph edges (replaces Neo4j). Nodes are registry items; edges
 * carry the PROV-O relation and the set of record ids asserting the edge.
 */
import { index, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { provRelationEnum } from "./enums.js";

export const provEdge = pgTable(
  "prov_edge",
  {
    id: serial("id").primaryKey(),
    /** Source node item id (edge direction: source --relation--> target). */
    sourceId: text("source_id").notNull(),
    targetId: text("target_id").notNull(),
    relation: provRelationEnum("relation").notNull(),
    /** Registry record ids which assert this edge (legacy record_ids prop). */
    recordIds: text("record_ids").array().notNull().default([]),
  },
  (t) => [
    uniqueIndex("prov_edge_unique_idx").on(t.sourceId, t.targetId, t.relation),
    index("prov_edge_source_idx").on(t.sourceId),
    index("prov_edge_target_idx").on(t.targetId),
  ],
);
