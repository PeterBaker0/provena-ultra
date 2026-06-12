/**
 * Provenance edge repository - replaces the Neo4j graph store. Traversals
 * use recursive CTEs with a depth cap; results are emitted in the
 * `networkx.node_link_data` format the legacy lineage endpoints returned.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { provEdge } from "../schema/prov.js";
import { item } from "../schema/items.js";

export type ProvRelation =
  | "wasDerivedFrom"
  | "wasInfluencedBy"
  | "wasRevisionOf"
  | "wasQuotedFrom"
  | "hadPrimarySource"
  | "hadMember"
  | "alternateOf"
  | "specializationOf"
  | "wasGeneratedBy"
  | "used"
  | "wasInvalidatedBy"
  | "wasAttributedTo"
  | "wasInformedBy"
  | "wasAssociatedWith"
  | "actedOnBehalfOf";

export interface EdgeInput {
  sourceId: string;
  targetId: string;
  relation: ProvRelation;
}

export interface GraphNode {
  id: string;
  item_category: string;
  item_subtype: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: ProvRelation;
}

/** networkx.node_link_data compatible shape. */
export interface NodeLinkGraph {
  directed: boolean;
  multigraph: boolean;
  graph: Record<string, never>;
  nodes: GraphNode[];
  links: GraphLink[];
}

const MAX_DEPTH = 10;

export interface TraversalRow {
  source_id: string;
  target_id: string;
  relation: ProvRelation;
}

export const makeEdgeRepo = (db: Database) => {
  /** Insert or merge edges, attributing them to `recordId`. */
  const upsertEdges = async (edges: EdgeInput[], recordId: string): Promise<void> => {
    for (const edge of edges) {
      await db
        .insert(provEdge)
        .values({
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relation: edge.relation,
          recordIds: [recordId],
        })
        .onConflictDoUpdate({
          target: [provEdge.sourceId, provEdge.targetId, provEdge.relation],
          set: {
            recordIds: sql`(
              SELECT array_agg(DISTINCT x) FROM unnest(${provEdge.recordIds} || ARRAY[${recordId}::text]) AS t(x)
            )`,
          },
        });
    }
  };

  /**
   * Remove a record's attribution from all edges; edges left with no
   * attributing records are deleted. Returns the removed/detached edges.
   */
  const removeRecordEdges = async (recordId: string): Promise<EdgeInput[]> => {
    const affected = await db
      .select()
      .from(provEdge)
      .where(sql`${recordId} = ANY(${provEdge.recordIds})`);
    const removed: EdgeInput[] = [];
    for (const edge of affected) {
      const remaining = edge.recordIds.filter((r) => r !== recordId);
      if (remaining.length === 0) {
        await db.delete(provEdge).where(eq(provEdge.id, edge.id));
        removed.push({
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relation: edge.relation,
        });
      } else {
        await db.update(provEdge).set({ recordIds: remaining }).where(eq(provEdge.id, edge.id));
      }
    }
    return removed;
  };

  const edgesForRecord = async (recordId: string) =>
    db
      .select()
      .from(provEdge)
      .where(sql`${recordId} = ANY(${provEdge.recordIds})`);

  const allEdgesTouching = async (nodeId: string) =>
    db
      .select()
      .from(provEdge)
      .where(sql`${provEdge.sourceId} = ${nodeId} OR ${provEdge.targetId} = ${nodeId}`);

  /**
   * Depth-limited traversal. `direction`:
   *  - "upstream": follow edges in their stored direction starting at
   *    `startingId` (legacy: (parent) <-[*1..d]- (start), i.e. edges outgoing
   *    from start, transitively).
   *  - "downstream": follow edges in reverse (children pointing at start).
   */
  const traverse = async (
    startingId: string,
    depth: number,
    direction: "upstream" | "downstream",
  ): Promise<TraversalRow[]> => {
    const cappedDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);
    const result =
      direction === "upstream"
        ? await db.execute(sql`
            WITH RECURSIVE walk AS (
              SELECT e.source_id, e.target_id, e.relation, 1 AS depth,
                     ARRAY[e.source_id, e.target_id] AS path
              FROM prov_edge e
              WHERE e.source_id = ${startingId}
              UNION ALL
              SELECT e.source_id, e.target_id, e.relation, w.depth + 1,
                     w.path || e.target_id
              FROM prov_edge e
              JOIN walk w ON e.source_id = w.target_id
              WHERE w.depth < ${cappedDepth}
                AND NOT e.target_id = ANY(w.path)
            )
            SELECT DISTINCT source_id, target_id, relation FROM walk
          `)
        : await db.execute(sql`
            WITH RECURSIVE walk AS (
              SELECT e.source_id, e.target_id, e.relation, 1 AS depth,
                     ARRAY[e.target_id, e.source_id] AS path
              FROM prov_edge e
              WHERE e.target_id = ${startingId}
              UNION ALL
              SELECT e.source_id, e.target_id, e.relation, w.depth + 1,
                     w.path || e.source_id
              FROM prov_edge e
              JOIN walk w ON e.target_id = w.source_id
              WHERE w.depth < ${cappedDepth}
                AND NOT e.source_id = ANY(w.path)
            )
            SELECT DISTINCT source_id, target_id, relation FROM walk
          `);
    return result.rows as unknown as TraversalRow[];
  };

  /** Decorate node ids with category/subtype from the item table. */
  const decorateNodes = async (ids: string[]): Promise<GraphNode[]> => {
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: item.id,
        itemCategory: item.itemCategory,
        itemSubType: item.itemSubType,
      })
      .from(item)
      .where(inArray(item.id, ids));
    const found = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const row = found.get(id);
      return {
        id,
        item_category: row?.itemCategory ?? "ENTITY",
        item_subtype: row?.itemSubType ?? "DATASET",
      };
    });
  };

  const buildNodeLinkGraph = async (rows: TraversalRow[]): Promise<NodeLinkGraph> => {
    const nodeIds = new Set<string>();
    const links: GraphLink[] = [];
    const seenLinks = new Set<string>();
    for (const row of rows) {
      nodeIds.add(row.source_id);
      nodeIds.add(row.target_id);
      const key = `${row.source_id}|${row.target_id}|${row.relation}`;
      if (!seenLinks.has(key)) {
        seenLinks.add(key);
        links.push({ source: row.source_id, target: row.target_id, type: row.relation });
      }
    }
    const nodes = await decorateNodes([...nodeIds]);
    return { directed: true, multigraph: false, graph: {}, nodes, links };
  };

  /**
   * Lineage query in node_link_data shape, optionally filtered so only paths
   * reaching nodes matching `terminate` (category and/or subtype) are kept -
   * used by the legacy "special" queries (contributing/effected
   * datasets/agents).
   */
  const lineageGraph = async (
    startingId: string,
    depth: number,
    direction: "upstream" | "downstream",
  ): Promise<NodeLinkGraph & { record_count: number }> => {
    const rows = await traverse(startingId, depth, direction);
    const graph = await buildNodeLinkGraph(rows);
    return { ...graph, record_count: graph.nodes.length };
  };

  return {
    upsertEdges,
    removeRecordEdges,
    edgesForRecord,
    allEdgesTouching,
    traverse,
    decorateNodes,
    buildNodeLinkGraph,
    lineageGraph,
  };
};

export type EdgeRepo = ReturnType<typeof makeEdgeRepo>;
