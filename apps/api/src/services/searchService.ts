import type { DbClient } from "@provena/db";
import { searchEntityRegistry } from "@provena/search";

export interface SearchService {
  searchEntityRegistry: (input: {
    query: string;
    subtype?: string;
    limit?: number;
  }) => Promise<Array<{ id: string; score: number }>>;
}

export const createSearchService = (db: DbClient): SearchService => ({
  searchEntityRegistry: async (input) =>
    searchEntityRegistry(db, {
      query: input.query,
      subtype: input.subtype,
      limit: input.limit,
    }),
});
