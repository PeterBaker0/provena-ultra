/**
 * Search API router group - mounted at /api/search. Replaces the legacy
 * OpenSearch-backed search-api with Postgres full text search.
 */
import { Hono } from "hono";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { badRequest } from "../../errors.js";
import { successStatus } from "../../serializers.js";
import { getContainer } from "../../container.js";

const DEFAULT_RECORD_LIMIT = 25;
const MAX_RECORD_LIMIT = 100;

export const buildSearchRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(guards));

  router.get("/search/entity-registry", guards.read, async (c) => {
    const query = c.req.query("query");
    if (!query) throw badRequest("Missing required query parameter 'query'.");
    const subtypeFilter = (c.req.query("subtype_filter") as ItemSubType | undefined) ?? null;
    const recordLimitRaw = c.req.query("record_limit");
    let limit = DEFAULT_RECORD_LIMIT;
    if (recordLimitRaw) {
      limit = Number.parseInt(recordLimitRaw, 10);
      if (Number.isNaN(limit) || limit < 1) {
        throw badRequest(`Invalid record_limit: ${recordLimitRaw}.`);
      }
      limit = Math.min(limit, MAX_RECORD_LIMIT);
    }
    const { items } = getContainer();
    const results = await items.searchItems(query, { subtype: subtypeFilter, limit });
    return c.json({
      status: successStatus(`Found ${results.length} results.`),
      results,
      warnings: null,
    });
  });

  router.get("/search/global", guards.read, async (c) => {
    const query = c.req.query("query");
    if (!query) throw badRequest("Missing required query parameter 'query'.");
    const recordLimitRaw = c.req.query("record_limit");
    const limit = recordLimitRaw
      ? Math.min(Number.parseInt(recordLimitRaw, 10) || DEFAULT_RECORD_LIMIT, MAX_RECORD_LIMIT)
      : DEFAULT_RECORD_LIMIT;
    const { items } = getContainer();
    const results = await items.searchItems(query, { limit });
    /* Decorate with result type (DATASET vs REGISTRY_ITEM). */
    const bases = await items.fetchItemsBaseByIds(results.map((r) => r.id));
    const subtypeMap = new Map(bases.map((b) => [b.id, b.itemSubType]));
    return c.json({
      status: successStatus(`Found ${results.length} results.`),
      results: results.map((r) => ({
        ...r,
        type: subtypeMap.get(r.id) === "DATASET" ? "DATASET" : "REGISTRY_ITEM",
      })),
      warnings: null,
    });
  });

  return router;
};
