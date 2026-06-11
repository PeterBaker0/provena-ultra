/**
 * Item repository - CRUD, history and listing over the item + satellite
 * tables.
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  like,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  ItemCategory,
  ItemSubType,
  RecordType,
} from "@provena/interfaces/types/RegistryModels";
import { buildSearchDocument, categoryForSubtype } from "@provena/interfaces";
import type { Database } from "../client.js";
import { item, itemDataset, itemHistory } from "../schema/items.js";
import { itemAuth, itemLock } from "../schema/sidecars.js";
import {
  marshallerFor,
  splitDomainInfo,
  type DomainInfoObject,
  type ItemRow,
} from "./domainInfo.js";

export interface HistoryEntryRecord {
  id: number;
  timestamp: number;
  reason: string;
  username: string;
  item: DomainInfoObject;
}

export interface StoredItem {
  base: ItemRow;
  /** Full domain info (incl display_name / user_metadata), null for seeds. */
  domainInfo: DomainInfoObject | null;
  history: HistoryEntryRecord[];
}

export interface VersioningInfoInput {
  previous_version?: string | null;
  version: number;
  reason?: string | null;
  next_version?: string | null;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/* ------------------------------- cursors -------------------------------- */

export interface ListCursor {
  /** Sort value of the last row. */
  s: string | number | null;
  /** Id of the last row (tiebreak). */
  id: string;
}

export const encodePaginationKey = (cursor: ListCursor): Record<string, unknown> => ({
  pk: Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"),
});

export const decodePaginationKey = (
  key: Record<string, unknown> | null | undefined,
): ListCursor | null => {
  if (!key || typeof key.pk !== "string") return null;
  try {
    return JSON.parse(Buffer.from(key.pk, "base64url").toString("utf8")) as ListCursor;
  } catch {
    return null;
  }
};

/* ------------------------------ list options ----------------------------- */

export type SortTypeOption =
  | "CREATED_TIME"
  | "UPDATED_TIME"
  | "DISPLAY_NAME"
  | "RELEASE_TIMESTAMP"
  | "ACCESS_INFO_URI_BEGINS_WITH";

export interface ListItemsOptions {
  subtype?: ItemSubType | null;
  category?: ItemCategory | null;
  recordType?: "ALL" | "SEED_ONLY" | "COMPLETE_ONLY";
  releaseStatus?: "NOT_RELEASED" | "PENDING" | "RELEASED" | null;
  releaseReviewer?: string | null;
  sortType?: SortTypeOption | null;
  ascending?: boolean;
  beginsWith?: string | null;
  pageSize?: number;
  paginationKey?: Record<string, unknown> | null;
}

export interface ListItemsResult {
  items: StoredItem[];
  paginationKey: Record<string, unknown> | null;
  totalCount: number;
}

/* ------------------------------- factory --------------------------------- */

export interface CreateSeedInput {
  id: string;
  subtype: ItemSubType;
  ownerUsername: string;
  versioningInfo?: VersioningInfoInput | null;
}

export interface CreateCompleteInput {
  id: string;
  subtype: ItemSubType;
  ownerUsername: string;
  domainInfo: DomainInfoObject;
  historyUsername: string;
  historyReason?: string;
  versioningInfo?: VersioningInfoInput | null;
  createActivityWorkflowId?: string | null;
  versionActivityWorkflowId?: string | null;
  /** Optionally override created/updated timestamps (import/restore). */
  createdTimestamp?: number;
  updatedTimestamp?: number;
}

export interface UpdateItemInput {
  id: string;
  domainInfo: DomainInfoObject;
  reason: string;
  username: string;
  excludeHistoryUpdate?: boolean;
  /** When converting a seed to a complete item. */
  promoteFromSeed?: boolean;
}

export const makeItemRepo = (db: Database) => {
  const loadHistory = async (id: string): Promise<HistoryEntryRecord[]> => {
    const rows = await db
      .select()
      .from(itemHistory)
      .where(eq(itemHistory.itemId, id))
      .orderBy(desc(itemHistory.historyId));
    return rows.map((r) => ({
      id: r.historyId,
      timestamp: r.timestamp,
      reason: r.reason,
      username: r.username,
      item: r.domainInfo as DomainInfoObject,
    }));
  };

  const loadDomainInfo = async (
    base: ItemRow,
  ): Promise<DomainInfoObject | null> => {
    if (base.recordType === "SEED_ITEM") return null;
    const marshaller = marshallerFor(base.itemSubType);
    const rows = await db
      .select()
      .from(marshaller.table)
      .where(eq(marshaller.table.itemId, base.id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      display_name: base.displayName,
      ...marshaller.fromRow(row),
      user_metadata: base.userMetadata ?? null,
    };
  };

  const fetchItem = async (id: string): Promise<StoredItem | null> => {
    const rows = await db.select().from(item).where(eq(item.id, id)).limit(1);
    const base = rows[0];
    if (!base) return null;
    const [domainInfo, history] = await Promise.all([loadDomainInfo(base), loadHistory(id)]);
    return { base, domainInfo, history };
  };

  const refreshSearchText = async (id: string): Promise<void> => {
    const stored = await fetchItem(id);
    if (!stored) return;
    const text = buildSearchDocument(
      {
        id: stored.base.id,
        item_category: stored.base.itemCategory,
        item_subtype: stored.base.itemSubType,
        owner_username: stored.base.ownerUsername,
        display_name: stored.base.displayName ?? "",
        user_metadata: stored.base.userMetadata,
      },
      stored.base.itemSubType,
      stored.domainInfo ?? {},
    );
    await db.update(item).set({ searchText: text }).where(eq(item.id, id));
  };

  const createSeedItem = async (input: CreateSeedInput): Promise<StoredItem> => {
    const timestamp = nowSeconds();
    await db.insert(item).values({
      id: input.id,
      itemCategory: categoryForSubtype(input.subtype),
      itemSubType: input.subtype,
      ownerUsername: input.ownerUsername,
      createdTimestamp: timestamp,
      updatedTimestamp: timestamp,
      recordType: "SEED_ITEM",
      versioningPreviousVersion: input.versioningInfo?.previous_version ?? null,
      versioningVersion: input.versioningInfo?.version ?? null,
      versioningReason: input.versioningInfo?.reason ?? null,
      versioningNextVersion: input.versioningInfo?.next_version ?? null,
    });
    const stored = await fetchItem(input.id);
    if (!stored) throw new Error("Failed to read back created seed item.");
    return stored;
  };

  const createCompleteItem = async (input: CreateCompleteInput): Promise<StoredItem> => {
    const timestamp = nowSeconds();
    const created = input.createdTimestamp ?? timestamp;
    const updated = input.updatedTimestamp ?? timestamp;
    const { displayName, userMetadata, satellite } = splitDomainInfo(input.domainInfo);
    const marshaller = marshallerFor(input.subtype);
    await db.transaction(async (tx) => {
      await tx.insert(item).values({
        id: input.id,
        itemCategory: categoryForSubtype(input.subtype),
        itemSubType: input.subtype,
        ownerUsername: input.ownerUsername,
        createdTimestamp: created,
        updatedTimestamp: updated,
        recordType: "COMPLETE_ITEM",
        displayName,
        userMetadata: userMetadata ?? undefined,
        versioningPreviousVersion: input.versioningInfo?.previous_version ?? null,
        versioningVersion: input.versioningInfo?.version ?? null,
        versioningReason: input.versioningInfo?.reason ?? null,
        versioningNextVersion: input.versioningInfo?.next_version ?? null,
        createActivityWorkflowId: input.createActivityWorkflowId ?? null,
        versionActivityWorkflowId: input.versionActivityWorkflowId ?? null,
      });
      await tx
        .insert(marshaller.table)
        .values({ itemId: input.id, ...marshaller.toRow(satellite) } as never);
      await tx.insert(itemHistory).values({
        itemId: input.id,
        historyId: 0,
        timestamp: updated,
        reason: input.historyReason ?? "Created item",
        username: input.historyUsername,
        domainInfo: input.domainInfo,
      });
    });
    await refreshSearchText(input.id);
    const stored = await fetchItem(input.id);
    if (!stored) throw new Error("Failed to read back created item.");
    return stored;
  };

  const updateItem = async (input: UpdateItemInput): Promise<StoredItem> => {
    const existing = await fetchItem(input.id);
    if (!existing) throw new Error(`Item ${input.id} not found.`);
    const subtype = existing.base.itemSubType;
    const marshaller = marshallerFor(subtype);
    const { displayName, userMetadata, satellite } = splitDomainInfo(input.domainInfo);
    const timestamp = nowSeconds();

    await db.transaction(async (tx) => {
      await tx
        .update(item)
        .set({
          displayName,
          userMetadata: userMetadata ?? null,
          updatedTimestamp: timestamp,
          recordType: "COMPLETE_ITEM",
        })
        .where(eq(item.id, input.id));
      if (existing.base.recordType === "SEED_ITEM") {
        await tx
          .insert(marshaller.table)
          .values({ itemId: input.id, ...marshaller.toRow(satellite) } as never);
      } else {
        await tx
          .update(marshaller.table)
          .set(marshaller.toRow(satellite) as never)
          .where(eq(marshaller.table.itemId, input.id));
      }
      if (!input.excludeHistoryUpdate) {
        const nextHistoryId =
          existing.history.length > 0 ? Math.max(...existing.history.map((h) => h.id)) + 1 : 0;
        await tx.insert(itemHistory).values({
          itemId: input.id,
          historyId: nextHistoryId,
          timestamp,
          reason: input.reason,
          username: input.username,
          domainInfo: input.domainInfo,
        });
      }
    });
    await refreshSearchText(input.id);
    const stored = await fetchItem(input.id);
    if (!stored) throw new Error("Failed to read back updated item.");
    return stored;
  };

  const revertItem = async (input: {
    id: string;
    historyId: number;
    reason: string;
    username: string;
  }): Promise<StoredItem> => {
    const existing = await fetchItem(input.id);
    if (!existing) throw new Error(`Item ${input.id} not found.`);
    const target = existing.history.find((h) => h.id === input.historyId);
    if (!target) {
      throw new Error(`History entry ${input.historyId} not found for item ${input.id}.`);
    }
    return updateItem({
      id: input.id,
      domainInfo: target.item,
      reason: input.reason,
      username: input.username,
    });
  };

  const setWorkflowLinks = async (
    id: string,
    links: { createActivityWorkflowId?: string | null; versionActivityWorkflowId?: string | null },
  ): Promise<void> => {
    const updateSet: Record<string, unknown> = {};
    if (links.createActivityWorkflowId !== undefined) {
      updateSet.createActivityWorkflowId = links.createActivityWorkflowId;
    }
    if (links.versionActivityWorkflowId !== undefined) {
      updateSet.versionActivityWorkflowId = links.versionActivityWorkflowId;
    }
    if (Object.keys(updateSet).length === 0) return;
    await db.update(item).set(updateSet).where(eq(item.id, id));
  };

  const setVersioningNextVersion = async (id: string, nextVersion: string): Promise<void> => {
    await db.update(item).set({ versioningNextVersion: nextVersion }).where(eq(item.id, id));
  };

  const deleteItem = async (id: string): Promise<boolean> => {
    const deleted = await db.delete(item).where(eq(item.id, id)).returning({ id: item.id });
    return deleted.length > 0;
  };

  /* ------------------------------- listing ------------------------------- */

  const sortExpression = (sortType: SortTypeOption | null | undefined): SQL<unknown> => {
    switch (sortType) {
      case "DISPLAY_NAME":
        return sql`coalesce(${item.displayName}, '')`;
      case "RELEASE_TIMESTAMP":
        return sql`coalesce(${itemDataset.releaseTimestamp}, 0)`;
      case "ACCESS_INFO_URI_BEGINS_WITH":
        return sql`coalesce(${itemDataset.accessInfoUri}, '')`;
      case "UPDATED_TIME":
        return sql`${item.updatedTimestamp}`;
      case "CREATED_TIME":
      default:
        return sql`${item.createdTimestamp}`;
    }
  };

  const listItems = async (options: ListItemsOptions): Promise<ListItemsResult> => {
    const pageSize = options.pageSize ?? 20;
    const ascending = options.ascending ?? false;
    const needsDatasetJoin =
      options.sortType === "RELEASE_TIMESTAMP" ||
      options.sortType === "ACCESS_INFO_URI_BEGINS_WITH" ||
      options.releaseStatus != null ||
      options.releaseReviewer != null;

    const conditions: SQL<unknown>[] = [];
    if (options.subtype) conditions.push(eq(item.itemSubType, options.subtype));
    if (options.category) conditions.push(eq(item.itemCategory, options.category));
    const recordType = options.recordType ?? "ALL";
    if (recordType === "SEED_ONLY") conditions.push(eq(item.recordType, "SEED_ITEM"));
    if (recordType === "COMPLETE_ONLY") conditions.push(eq(item.recordType, "COMPLETE_ITEM"));
    if (options.releaseStatus) {
      conditions.push(eq(itemDataset.releaseStatus, options.releaseStatus));
    }
    if (options.releaseReviewer) {
      conditions.push(eq(itemDataset.releaseApprover, options.releaseReviewer));
    }
    if (options.beginsWith != null && options.sortType === "ACCESS_INFO_URI_BEGINS_WITH") {
      conditions.push(like(itemDataset.accessInfoUri, `${options.beginsWith}%`));
    }

    const sortExpr = sortExpression(options.sortType);

    const cursor = decodePaginationKey(options.paginationKey);
    if (cursor) {
      const cmp = ascending ? gt : lt;
      const sortVal = cursor.s;
      const cursorCondition = or(
        cmp(sortExpr, sortVal),
        and(eq(sortExpr, sortVal), cmp(sql`${item.id}`, cursor.id)),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = db
      .select({ base: item, sortVal: sortExpr.as("sort_val") })
      .from(item)
      .$dynamic();
    const joined = needsDatasetJoin
      ? baseQuery.innerJoin(itemDataset, eq(item.id, itemDataset.itemId))
      : baseQuery;
    const ordered = joined
      .where(whereClause)
      .orderBy(
        ascending ? asc(sortExpr) : desc(sortExpr),
        ascending ? asc(item.id) : desc(item.id),
      )
      .limit(pageSize + 1);

    const rows = await ordered;

    /* Total count (without pagination cursor). */
    const countConditions = conditions.filter((c) => c !== undefined);
    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(item)
      .$dynamic();
    const countJoined = needsDatasetJoin
      ? countQuery.innerJoin(itemDataset, eq(item.id, itemDataset.itemId))
      : countQuery;
    /* Rebuild conditions without the cursor for an accurate total. */
    const totalConditions: SQL<unknown>[] = [];
    if (options.subtype) totalConditions.push(eq(item.itemSubType, options.subtype));
    if (options.category) totalConditions.push(eq(item.itemCategory, options.category));
    if (recordType === "SEED_ONLY") totalConditions.push(eq(item.recordType, "SEED_ITEM"));
    if (recordType === "COMPLETE_ONLY")
      totalConditions.push(eq(item.recordType, "COMPLETE_ITEM"));
    if (options.releaseStatus)
      totalConditions.push(eq(itemDataset.releaseStatus, options.releaseStatus));
    if (options.releaseReviewer)
      totalConditions.push(eq(itemDataset.releaseApprover, options.releaseReviewer));
    if (options.beginsWith != null && options.sortType === "ACCESS_INFO_URI_BEGINS_WITH") {
      totalConditions.push(like(itemDataset.accessInfoUri, `${options.beginsWith}%`));
    }
    const countRows = await countJoined.where(
      totalConditions.length > 0 ? and(...totalConditions) : undefined,
    );
    const totalCount = countRows[0]?.count ?? 0;

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    const storedItems: StoredItem[] = [];
    for (const row of page) {
      const [domainInfo, history] = await Promise.all([
        loadDomainInfo(row.base),
        loadHistory(row.base.id),
      ]);
      storedItems.push({ base: row.base, domainInfo, history });
    }

    let paginationKey: Record<string, unknown> | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]!;
      paginationKey = encodePaginationKey({
        s: (last.sortVal as string | number | null) ?? null,
        id: last.base.id,
      });
    }

    return { items: storedItems, paginationKey, totalCount };
  };

  /** Fetch many items by id (used for graph node decoration / validation). */
  const fetchItemsBaseByIds = async (ids: string[]): Promise<ItemRow[]> => {
    if (ids.length === 0) return [];
    return db.select().from(item).where(inArray(item.id, ids));
  };

  /** Stream all item ids + subtypes (admin export / restore). */
  const listAllItemIds = async (): Promise<
    { id: string; itemSubType: ItemSubType; recordType: RecordType }[]
  > => {
    const rows = await db
      .select({ id: item.id, itemSubType: item.itemSubType, recordType: item.recordType })
      .from(item);
    return rows;
  };

  /* search via Postgres FTS */
  const searchItems = async (
    query: string,
    options: { subtype?: ItemSubType | null; limit?: number },
  ): Promise<{ id: string; score: number }[]> => {
    const limit = options.limit ?? 25;
    const conditions: SQL<unknown>[] = [
      sql`(
        to_tsvector('english', coalesce(${item.searchText}, '')) @@ websearch_to_tsquery('english', ${query})
        OR ${item.searchText} ILIKE ${"%" + query + "%"}
      )`,
    ];
    if (options.subtype) conditions.push(eq(item.itemSubType, options.subtype));
    const rows = await db
      .select({
        id: item.id,
        score: sql<number>`greatest(
          ts_rank(to_tsvector('english', coalesce(${item.searchText}, '')), websearch_to_tsquery('english', ${query})),
          similarity(coalesce(${item.searchText}, ''), ${query})
        )::float`,
      })
      .from(item)
      .where(and(...conditions))
      .orderBy(sql`2 DESC`)
      .limit(limit);
    return rows;
  };

  return {
    fetchItem,
    createSeedItem,
    createCompleteItem,
    updateItem,
    revertItem,
    deleteItem,
    listItems,
    fetchItemsBaseByIds,
    listAllItemIds,
    setWorkflowLinks,
    setVersioningNextVersion,
    refreshSearchText,
    searchItems,
    loadHistory,
  };
};

export type ItemRepo = ReturnType<typeof makeItemRepo>;

/* Sidecar bootstrap helper used when creating items. */
export const ensureSidecars = async (
  db: Database,
  itemId: string,
  owner: string,
  generalRoles: string[],
  groupRoles: Record<string, string[]> = {},
): Promise<void> => {
  await db
    .insert(itemAuth)
    .values({ itemId, owner, generalRoles, groupRoles })
    .onConflictDoNothing();
  await db.insert(itemLock).values({ itemId, locked: false }).onConflictDoNothing();
};
