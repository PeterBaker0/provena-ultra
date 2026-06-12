/**
 * Registry admin import/export/restore routes - legacy
 * `registry-api/routes/admin/import_export_restore.py`.
 */
import { Hono } from "hono";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import { categoryForSubtype, registryRequestSchemas } from "@provena/interfaces";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import { ensureSidecars, type HistoryEntryRecord } from "@provena/db";
import { submitJob } from "@provena/jobs";
import { getContainer } from "../../container.js";
import { badRequest } from "../../errors.js";
import { failureStatus, serializeItem, successStatus } from "../../serializers.js";

interface ParsedBundle {
  id: string;
  subtype: ItemSubType;
  ownerUsername: string;
  recordType: "SEED_ITEM" | "COMPLETE_ITEM";
  createdTimestamp: number;
  updatedTimestamp: number;
  domainInfo: Record<string, unknown> | null;
  history: HistoryEntryRecord[];
  versioningInfo: {
    previous_version?: string | null;
    version: number;
    reason?: string | null;
    next_version?: string | null;
  } | null;
  workflowLinks: {
    create_activity_workflow_id?: string | null;
    version_activity_workflow_id?: string | null;
  } | null;
  authSettings: { owner: string; general: string[]; groups: Record<string, string[]> };
  locked: boolean;
}

const RECORD_INFO_FIELDS = new Set([
  "id",
  "owner_username",
  "created_timestamp",
  "updated_timestamp",
  "item_category",
  "item_subtype",
  "record_type",
  "workflow_links",
  "versioning_info",
  "history",
]);

const parseBundle = (bundle: {
  id: string;
  item_payload: Record<string, unknown>;
  auth_payload: Record<string, unknown>;
  lock_payload: Record<string, unknown>;
}): ParsedBundle => {
  const item = bundle.item_payload;
  const subtype = item.item_subtype as ItemSubType;
  if (!subtype) throw new Error(`Bundle ${bundle.id} missing item_subtype.`);
  const recordType = (item.record_type as "SEED_ITEM" | "COMPLETE_ITEM") ?? "COMPLETE_ITEM";

  const domainInfo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (!RECORD_INFO_FIELDS.has(key)) domainInfo[key] = value;
  }

  const historyRaw = (item.history as HistoryEntryRecord[] | undefined) ?? [];
  const accessSettings = (bundle.auth_payload.access_settings ?? null) as {
    owner: string;
    general: string[];
    groups: Record<string, string[]>;
  } | null;
  const lockInformation = (bundle.lock_payload.lock_information ?? null) as {
    locked: boolean;
  } | null;

  return {
    id: bundle.id,
    subtype,
    ownerUsername: (item.owner_username as string) ?? accessSettings?.owner ?? "unknown",
    recordType,
    createdTimestamp: (item.created_timestamp as number) ?? Math.floor(Date.now() / 1000),
    updatedTimestamp: (item.updated_timestamp as number) ?? Math.floor(Date.now() / 1000),
    domainInfo: recordType === "COMPLETE_ITEM" ? domainInfo : null,
    history: historyRaw,
    versioningInfo:
      (item.versioning_info as ParsedBundle["versioningInfo"]) ?? null,
    workflowLinks: (item.workflow_links as ParsedBundle["workflowLinks"]) ?? null,
    authSettings: accessSettings ?? { owner: "unknown", general: [], groups: {} },
    locked: lockInformation?.locked ?? false,
  };
};

export const buildRegistryAdminRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  /* GET /export */
  router.get("/export", guards.admin, async (c) => {
    const { items, auth, locks } = getContainer();
    const ids = await items.listAllItemIds();
    const bundles = [];
    for (const { id } of ids) {
      const stored = await items.fetchItem(id);
      if (!stored) continue;
      const settings = await auth.getAccessSettings(id);
      const locked = await locks.isLocked(id);
      const lockEvents = await locks.lockHistory(id);
      bundles.push({
        id,
        item_payload: serializeItem(stored),
        auth_payload: {
          id,
          access_settings: settings ?? { owner: stored.base.ownerUsername, general: [], groups: {} },
        },
        lock_payload: {
          id,
          lock_information: { locked, history: lockEvents },
        },
      });
    }
    return c.json({
      status: successStatus(`Successfully exported ${bundles.length} items.`),
      items: bundles,
    });
  });

  /* POST /import */
  router.post("/import", guards.admin, async (c) => {
    const body = registryRequestSchemas.registryImportRequestSchema.parse(await c.req.json());
    const { items, auth, locks, db } = getContainer();

    const existingIds = new Set((await items.listAllItemIds()).map((r) => r.id));
    const oldSize = existingIds.size;

    const parsed: ParsedBundle[] = [];
    const failures: [string, Record<string, unknown>][] = [];
    for (const bundle of body.items) {
      try {
        parsed.push(parseBundle(bundle));
      } catch (error) {
        failures.push([
          `Failed to parse bundle ${bundle.id}: ${(error as Error).message}`,
          bundle.item_payload,
        ]);
      }
    }
    if (body.parse_items && failures.length > 0) {
      return c.json({
        status: failureStatus(`Failed to parse ${failures.length} items - aborting import.`),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: failures,
      });
    }

    const incomingIds = new Set(parsed.map((p) => p.id));
    const newEntries = parsed.filter((p) => !existingIds.has(p.id));
    const overwritten = parsed.filter((p) => existingIds.has(p.id));
    const unmatched = [...existingIds].filter((id) => !incomingIds.has(id));

    /* Mode validations (legacy semantics). */
    const mode = body.import_mode;
    if (mode === "ADD_ONLY" && overwritten.length > 0) {
      return c.json({
        status: failureStatus(
          `Import mode ADD_ONLY but ${overwritten.length} item(s) already exist.`,
        ),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: null,
      });
    }
    if (mode === "OVERWRITE_ONLY" && newEntries.length > 0) {
      return c.json({
        status: failureStatus(
          `Import mode OVERWRITE_ONLY but ${newEntries.length} item(s) are new.`,
        ),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: null,
      });
    }
    if (mode === "SYNC_ADD_OR_OVERWRITE" && unmatched.length > 0) {
      return c.json({
        status: failureStatus(
          `Import mode SYNC_ADD_OR_OVERWRITE requires no unmatched existing entries but found ${unmatched.length}.`,
        ),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: null,
      });
    }
    const deleting = mode === "SYNC_DELETION_ALLOWED" ? unmatched : [];
    if (deleting.length > 0 && !body.allow_entry_deletion) {
      return c.json({
        status: failureStatus(
          `Import would delete ${deleting.length} entries but allow_entry_deletion is false.`,
        ),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: null,
      });
    }

    const writeList = mode === "ADD_ONLY" ? newEntries : parsed;
    const statistics = {
      old_registry_size: oldSize,
      new_registry_size: oldSize + newEntries.length - deleting.length,
      deleted_entries: deleting.length,
      overwritten_entries: mode === "ADD_ONLY" ? 0 : overwritten.length,
      new_entries: newEntries.length,
    };

    if (!body.trial_mode) {
      for (const bundle of writeList) {
        await items.replaceItem({
          id: bundle.id,
          subtype: bundle.subtype,
          category: categoryForSubtype(bundle.subtype),
          ownerUsername: bundle.ownerUsername,
          recordType: bundle.recordType,
          createdTimestamp: bundle.createdTimestamp,
          updatedTimestamp: bundle.updatedTimestamp,
          domainInfo: bundle.domainInfo,
          history: bundle.history,
          versioningInfo: bundle.versioningInfo,
          workflowLinks: bundle.workflowLinks,
        });
        await ensureSidecars(db, bundle.id, bundle.authSettings.owner, [], {});
        await auth.putAccessSettings(bundle.id, bundle.authSettings);
        const currentlyLocked = await locks.isLocked(bundle.id);
        if (currentlyLocked !== bundle.locked) {
          await locks.setLocked(bundle.id, bundle.locked, {
            username: "admin-import",
            email: null,
            reason: "Registry import restore",
            timestamp: Math.floor(Date.now() / 1000),
          });
        }
      }
      for (const id of deleting) {
        await items.deleteItem(id);
      }
    }

    return c.json({
      status: successStatus(
        body.trial_mode
          ? "Trial import completed successfully - no changes written."
          : "Import completed successfully.",
      ),
      trial_mode: body.trial_mode,
      statistics,
      failure_list: failures.length > 0 ? failures : null,
    });
  });

  /* POST /restore_from_table - DynamoDB specific, unsupported in v2. */
  router.post("/restore_from_table", guards.admin, async () => {
    throw badRequest(
      "restore_from_table is a DynamoDB-specific operation which is not supported in Provena v2. Use the /admin/import endpoint with exported bundled items instead.",
    );
  });

  /* POST /restore-prov-graph - re-derive graph edges from item bundles. */
  router.post("/restore-prov-graph", guards.admin, async (c) => {
    const body = registryRequestSchemas.provGraphRestoreRequestSchema.parse(await c.req.json());
    const user = c.get("user");
    const taskIds: string[] = [];
    const failures: string[] = [];
    for (const bundle of body.items) {
      const subtype = bundle.item_payload.item_subtype as ItemSubType | undefined;
      if (!subtype) {
        failures.push(`Bundle ${bundle.id} missing item_subtype.`);
        continue;
      }
      if (subtype === "MODEL_RUN") {
        const record = bundle.item_payload.record as Record<string, unknown> | undefined;
        if (!record) {
          failures.push(`Model run bundle ${bundle.id} missing record.`);
          continue;
        }
        if (!body.trial_mode) {
          const { sessionId } = await submitJob({
            username: user.username,
            jobSubType: "MODEL_RUN_LODGE_ONLY",
            payload: {
              model_run_record_id: bundle.id,
              record,
              revalidate: false,
            },
          });
          taskIds.push(sessionId);
        }
      }
    }
    if (failures.length > 0 && body.abort_if_failures) {
      return c.json({
        status: failureStatus(`Failures during graph restore: ${failures.join("; ")}`),
        trial_mode: body.trial_mode,
        abort_if_failures: body.abort_if_failures,
        task_ids: null,
      });
    }
    return c.json({
      status: successStatus(
        body.trial_mode
          ? "Trial restore - no jobs submitted."
          : `Submitted ${taskIds.length} graph restore tasks.`,
      ),
      trial_mode: body.trial_mode,
      abort_if_failures: body.abort_if_failures,
      task_ids: body.trial_mode ? null : taskIds,
    });
  });

  return router;
};
