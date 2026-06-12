/**
 * Per-subtype registry router factory - the TypeScript port of legacy
 * `registry-api/helpers/item_type_route_generator.py`.
 *
 * Public proxy/* routes are intentionally not ported: dataset and model-run
 * management happens in-process via the data-store and prov routers.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  jsonSchemaForSubtype,
  registryRequestSchemas,
  registrySchemas,
  uiSchemaForSubtype,
} from "@provena/interfaces";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import { badRequest } from "../../errors.js";
import {
  serializeCompleteItem,
  serializeItem,
  serializeSeedItem,
  successStatus,
} from "../../serializers.js";
import * as registry from "../../services/registryService.js";

export type RouteAction =
  | "SEED"
  | "UPDATE"
  | "CREATE"
  | "REVERT"
  | "VERSION"
  | "DELETE"
  | "FETCH"
  | "LIST"
  | "SCHEMA"
  | "UI_SCHEMA"
  | "VALIDATE"
  | "AUTH_EVALUATE"
  | "AUTH_CONFIGURATION_GET"
  | "AUTH_CONFIGURATION_PUT"
  | "AUTH_ROLES"
  | "LOCK"
  | "UNLOCK"
  | "LOCK_HISTORY"
  | "LOCKED";

const READ_ONLY_ACTIONS: RouteAction[] = [
  "DELETE",
  "FETCH",
  "LIST",
  "SCHEMA",
  "UI_SCHEMA",
  "VALIDATE",
  "AUTH_EVALUATE",
  "AUTH_CONFIGURATION_GET",
  "AUTH_CONFIGURATION_PUT",
  "AUTH_ROLES",
  "LOCK",
  "UNLOCK",
  "LOCK_HISTORY",
  "LOCKED",
];

const STANDARD_ACTIONS: RouteAction[] = [...READ_ONLY_ACTIONS, "SEED", "UPDATE", "CREATE", "REVERT"];

export interface SubtypeRouteOptions {
  subtype: ItemSubType;
  mode: "STANDARD" | "STANDARD_WITH_VERSION" | "READ_ONLY" | "SERVICE_MANAGED";
}

const actionsForMode = (mode: SubtypeRouteOptions["mode"]): Set<RouteAction> => {
  switch (mode) {
    case "STANDARD":
      return new Set(STANDARD_ACTIONS);
    case "STANDARD_WITH_VERSION":
      return new Set([...STANDARD_ACTIONS, "VERSION"]);
    case "READ_ONLY":
    case "SERVICE_MANAGED":
      return new Set(READ_ONLY_ACTIONS);
  }
};

const requireIdQuery = (id: string | undefined): string => {
  if (!id) throw badRequest("Missing required query parameter 'id'.");
  return id;
};

export const buildSubtypeRouter = (options: SubtypeRouteOptions): Hono<AuthEnv> => {
  const { subtype } = options;
  const actions = actionsForMode(options.mode);
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  /* ------------------------------- FETCH -------------------------------- */
  if (actions.has("FETCH")) {
    router.get("/fetch", guards.read, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const seedAllowed = (c.req.query("seed_allowed") ?? "false").toLowerCase() === "true";
      const result = await registry.fetchItemWithAccess({
        id,
        user: c.get("user"),
        subtype,
        seedAllowed,
      });
      return c.json({
        status: successStatus(`Successfully fetched item with id ${id}.`),
        item: serializeItem(result.stored),
        roles: result.roles,
        locked: result.locked,
        item_is_seed: result.stored.base.recordType === "SEED_ITEM",
      });
    });
  }

  /* -------------------------------- LIST -------------------------------- */
  if (actions.has("LIST")) {
    router.post("/list", guards.read, async (c) => {
      const body = registryRequestSchemas.subtypeListRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      const sort = body.sort_by ?? null;
      const result = await registry.listItemsWithAccess(
        {
          subtype,
          recordType: body.filter_by?.record_type ?? "COMPLETE_ONLY",
          sortType: sort?.sort_type ?? null,
          ascending: sort?.ascending ?? false,
          beginsWith: sort?.begins_with ?? null,
          pageSize: body.page_size,
          paginationKey: body.pagination_key ?? null,
        },
        c.get("user"),
      );
      const completeCount = result.items.length;
      const seedCount = result.seedItems.length;
      return c.json({
        status: successStatus(`Successfully listed ${completeCount + seedCount} items.`),
        items: result.items.map(serializeCompleteItem),
        seed_items: result.seedItems.map(serializeSeedItem),
        unparsable_items: [],
        total_item_count: completeCount + seedCount,
        complete_item_count: completeCount,
        seed_item_count: seedCount,
        unparsable_item_count: 0,
        not_authorised_count: result.notAuthorisedCount,
        pagination_key: result.paginationKey,
      });
    });
  }

  /* -------------------------------- SEED -------------------------------- */
  if (actions.has("SEED")) {
    router.post("/seed", guards.write, async (c) => {
      const stored = await registry.seedItem({ subtype, user: c.get("user") });
      return c.json({
        status: successStatus(`Successfully seeded item ${stored.base.id}.`),
        seeded_item: serializeSeedItem(stored),
      });
    });
  }

  /* ------------------------------- CREATE ------------------------------- */
  if (actions.has("CREATE")) {
    router.post("/create", guards.write, async (c) => {
      const domainInfo = registrySchemas
        .domainInfoSchemaFor(subtype)
        .parse(await c.req.json()) as Record<string, unknown>;
      const result = await registry.createItem({
        subtype,
        domainInfo,
        user: c.get("user"),
      });
      return c.json({
        status: successStatus(`Successfully created item ${result.stored.base.id}.`),
        created_item: serializeCompleteItem(result.stored),
        register_create_activity_session_id: result.registerCreateActivitySessionId,
      });
    });
  }

  /* ------------------------------- UPDATE ------------------------------- */
  if (actions.has("UPDATE")) {
    router.put("/update", guards.write, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const reason = c.req.query("reason") ?? null;
      const excludeHistory =
        (c.req.query("exclude_history_update") ?? "false").toLowerCase() === "true";
      const domainInfo = registrySchemas
        .domainInfoSchemaFor(subtype)
        .parse(await c.req.json()) as Record<string, unknown>;
      const result = await registry.updateItem({
        id,
        subtype,
        domainInfo,
        reason,
        user: c.get("user"),
        excludeHistoryUpdate: excludeHistory,
      });
      return c.json({
        status: successStatus(`Successfully updated item ${id}.`),
        register_create_activity_session_id: result.registerCreateActivitySessionId,
      });
    });
  }

  /* ------------------------------- REVERT ------------------------------- */
  if (actions.has("REVERT")) {
    router.put("/revert", guards.write, async (c) => {
      const body = registryRequestSchemas.itemRevertRequestSchema.parse(await c.req.json());
      await registry.revertItem({
        id: body.id,
        historyId: body.history_id,
        reason: body.reason,
        subtype,
        user: c.get("user"),
      });
      return c.json({
        status: successStatus(
          `Successfully reverted item ${body.id} to history entry ${body.history_id}.`,
        ),
      });
    });
  }

  /* ------------------------------- VERSION ------------------------------ */
  if (actions.has("VERSION")) {
    router.post("/version", guards.write, async (c) => {
      const body = registryRequestSchemas.versionRequestSchema.parse(await c.req.json());
      const result = await registry.versionItem({
        id: body.id,
        reason: body.reason,
        subtype,
        user: c.get("user"),
      });
      return c.json({
        new_version_id: result.newVersionId,
        version_job_session_id: result.versionJobSessionId,
      });
    });
  }

  /* ------------------------------- DELETE ------------------------------- */
  if (actions.has("DELETE")) {
    router.delete("/delete", guards.admin, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      await registry.deleteItem(id);
      return c.json({
        status: successStatus(`Successfully deleted item ${id}.`),
      });
    });
  }

  /* ------------------------------- SCHEMA ------------------------------- */
  if (actions.has("SCHEMA")) {
    router.get("/schema", guards.read, async (c) =>
      c.json({
        status: successStatus("Successfully returned autogenerated pydantic model json schema."),
        json_schema: jsonSchemaForSubtype(subtype),
      }),
    );
  }

  if (actions.has("UI_SCHEMA")) {
    router.get("/ui_schema", guards.read, async (c) =>
      c.json({
        status: successStatus("Delivered UI Schema override"),
        ui_schema: uiSchemaForSubtype(subtype),
      }),
    );
  }

  /* ------------------------------ VALIDATE ------------------------------ */
  if (actions.has("VALIDATE")) {
    router.post("/validate", guards.read, async (c) => {
      try {
        registrySchemas.domainInfoSchemaFor(subtype).parse(await c.req.json());
        return c.json(successStatus("Validation successful."));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({
            success: false,
            details: `Validation failed: ${error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          });
        }
        throw error;
      }
    });
  }

  /* -------------------------------- AUTH -------------------------------- */
  if (actions.has("AUTH_EVALUATE")) {
    router.get("/auth/evaluate", guards.read, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const result = await registry.fetchItemWithAccess({
        id,
        user: c.get("user"),
        subtype,
        seedAllowed: true,
      });
      return c.json({ roles: result.roles });
    });
  }

  if (actions.has("AUTH_CONFIGURATION_GET")) {
    router.get("/auth/configuration", guards.read, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const settings = await registry.getAuthConfiguration(id, c.get("user"));
      return c.json(settings);
    });
  }

  if (actions.has("AUTH_CONFIGURATION_PUT")) {
    router.put("/auth/configuration", guards.write, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const settings = registryRequestSchemas.accessSettingsPutSchema.parse(await c.req.json());
      await registry.putAuthConfiguration(id, settings, c.get("user"));
      return c.json({
        status: successStatus(`Successfully updated the auth configuration for item ${id}.`),
      });
    });
  }

  if (actions.has("AUTH_ROLES")) {
    router.get("/auth/roles", guards.read, async (c) => c.json(registry.authRoles(subtype)));
  }

  /* -------------------------------- LOCKS ------------------------------- */
  if (actions.has("LOCK")) {
    router.put("/locks/lock", guards.write, async (c) => {
      const body = registryRequestSchemas.lockChangeRequestSchema.parse(await c.req.json());
      await registry.lockItem({
        id: body.id,
        reason: body.reason,
        subtype,
        user: c.get("user"),
      });
      return c.json({ status: successStatus(`Successfully locked item ${body.id}.`) });
    });
  }

  if (actions.has("UNLOCK")) {
    router.put("/locks/unlock", guards.write, async (c) => {
      const body = registryRequestSchemas.lockChangeRequestSchema.parse(await c.req.json());
      await registry.unlockItem({
        id: body.id,
        reason: body.reason,
        subtype,
        user: c.get("user"),
      });
      return c.json({ status: successStatus(`Successfully unlocked item ${body.id}.`) });
    });
  }

  if (actions.has("LOCK_HISTORY")) {
    router.get("/locks/history", guards.read, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const history = await registry.lockHistory(id, c.get("user"), subtype);
      return c.json({
        status: successStatus(`Successfully fetched lock history for item ${id}.`),
        history,
      });
    });
  }

  if (actions.has("LOCKED")) {
    router.get("/locks/locked", guards.read, async (c) => {
      const id = requireIdQuery(c.req.query("id"));
      const locked = await registry.lockedStatus(id);
      return c.json({ locked });
    });
  }

  return router;
};
