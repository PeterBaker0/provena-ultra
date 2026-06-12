/**
 * General (cross-subtype) registry routes - legacy
 * `registry-api/routes/registry_general/registry_general.py`.
 */
import { Hono } from "hono";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import { registryRequestSchemas } from "@provena/interfaces";
import { getConfig } from "@provena/config";
import { badRequest } from "../../errors.js";
import { serializeItem, successStatus } from "../../serializers.js";
import * as registry from "../../services/registryService.js";

export const buildRegistryGeneralRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  /* POST /list - general list across subtypes with extended filters. */
  router.post("/list", guards.read, async (c) => {
    const body = registryRequestSchemas.generalListRequestSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const sort = body.sort_by ?? null;
    const filters = body.filter_by ?? null;
    const result = await registry.listItemsWithAccess(
      {
        subtype: filters?.item_subtype ?? null,
        recordType: filters?.record_type ?? "COMPLETE_ONLY",
        releaseStatus: filters?.release_status ?? null,
        releaseReviewer: filters?.release_reviewer ?? null,
        sortType: sort?.sort_type ?? null,
        ascending: sort?.ascending ?? false,
        beginsWith: sort?.begins_with ?? null,
        pageSize: body.page_size,
        paginationKey: body.pagination_key ?? null,
      },
      c.get("user"),
    );
    const wireItems = [...result.items, ...result.seedItems].map(serializeItem);
    return c.json({
      status: successStatus(`Successfully listed ${wireItems.length} items.`),
      items: wireItems,
      total_item_count: result.totalCount,
      pagination_key: result.paginationKey,
    });
  });

  /* GET /fetch - untyped fetch of any item. */
  router.get("/fetch", guards.read, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const result = await registry.fetchItemWithAccess({
      id,
      user: c.get("user"),
      seedAllowed: true,
    });
    return c.json({
      status: successStatus(`Successfully fetched item with id ${id}.`),
      item: serializeItem(result.stored),
      roles: result.roles,
      locked: result.locked,
    });
  });

  /* DELETE /delete - admin only generic delete. */
  router.delete("/delete", guards.admin, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    await registry.deleteItem(id);
    return c.json({ status: successStatus(`Successfully deleted item ${id}.`) });
  });

  /* GET /about/version - VersionDetails shape. */
  router.get("/about/version", guards.read, async (c) => {
    const config = getConfig();
    return c.json({
      commit_id: config.GIT_COMMIT_ID ?? null,
      commit_url: null,
      tag_name: config.VERSION_TAG,
      release_title: `Provena v2 (${config.VERSION_TAG})`,
      release_url: null,
    });
  });

  return router;
};
