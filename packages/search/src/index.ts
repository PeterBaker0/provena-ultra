import { desc, sql } from "drizzle-orm";
import { searchDocuments } from "@provena/db";
import type { DbClient } from "@provena/db";

export interface SearchEntityRegistryInput {
  query: string;
  subtype?: string;
  limit?: number;
}

export interface SearchEntityRegistryResult {
  id: string;
  score: number;
}

export const searchEntityRegistry = async (
  db: DbClient,
  input: SearchEntityRegistryInput,
): Promise<SearchEntityRegistryResult[]> => {
  const trimmed = input.query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 200);
  const ilikePattern = `%${trimmed}%`;

  const rankExpr = sql<number>`
    (
      CASE WHEN ${searchDocuments.title} ILIKE ${ilikePattern} THEN 2 ELSE 0 END
      +
      CASE WHEN ${searchDocuments.body} ILIKE ${ilikePattern} THEN 1 ELSE 0 END
    )::float
  `;

  const whereClause = input.subtype
    ? sql`(${searchDocuments.subtype} = ${input.subtype} AND (${searchDocuments.title} ILIKE ${ilikePattern} OR ${searchDocuments.body} ILIKE ${ilikePattern}))`
    : sql`(${searchDocuments.title} ILIKE ${ilikePattern} OR ${searchDocuments.body} ILIKE ${ilikePattern})`;

  const rows = await db
    .select({
      id: searchDocuments.registryItemId,
      score: rankExpr,
    })
    .from(searchDocuments)
    .where(whereClause)
    .orderBy(desc(rankExpr))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    score: Number(row.score ?? 0),
  }));
};

