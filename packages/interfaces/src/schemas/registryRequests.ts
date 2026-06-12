/**
 * Zod schemas for registry API request payloads, ported from legacy
 * `ProvenaInterfaces/RegistryAPI.py`.
 */
import { z } from "zod";
import { nonEmptyString, paginationKeySchema } from "./common.js";
import { itemCategorySchema, itemSubTypeSchema } from "./registry.js";

export const DEFAULT_PAGE_SIZE = 20;

export const queryRecordTypesSchema = z.enum(["ALL", "SEED_ONLY", "COMPLETE_ONLY"]);

export const queryDatasetReleaseStatusTypeSchema = z.enum([
  "NOT_RELEASED",
  "PENDING",
  "RELEASED",
]);

export const sortTypeSchema = z.enum([
  "CREATED_TIME",
  "UPDATED_TIME",
  "DISPLAY_NAME",
  "RELEASE_TIMESTAMP",
  "ACCESS_INFO_URI_BEGINS_WITH",
]);

const BEGINS_WITH_SORT_TYPES = ["ACCESS_INFO_URI_BEGINS_WITH"];

export const sortOptionsSchema = z
  .object({
    sort_type: sortTypeSchema.nullish(),
    ascending: z.boolean().default(false),
    begins_with: z.string().nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.begins_with != null) {
      if (value.sort_type == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cannot filter by begins_with without specifying sort_type",
        });
      } else if (!BEGINS_WITH_SORT_TYPES.includes(value.sort_type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cannot filter by begins_with without specifying a valid sort_type. Must be one of ${BEGINS_WITH_SORT_TYPES.join(", ")}`,
        });
      }
    } else if (value.sort_type != null && BEGINS_WITH_SORT_TYPES.includes(value.sort_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Cannot filter by begins-with sort_type ${value.sort_type} without specifying a begins_with value`,
      });
    }
  });

export const subtypeFilterOptionsSchema = z.object({
  record_type: queryRecordTypesSchema.default("COMPLETE_ONLY"),
});

export const filterOptionsSchema = z
  .object({
    record_type: queryRecordTypesSchema.default("COMPLETE_ONLY"),
    item_subtype: itemSubTypeSchema.nullish(),
    release_reviewer: nonEmptyString.nullish(),
    release_status: queryDatasetReleaseStatusTypeSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.item_subtype != null && value.release_status != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot filter by both item_subtype and release_status",
      });
    }
  });

export const queryFilterSchema = z.object({
  item_category: itemCategorySchema.nullish(),
  item_subtype: itemSubTypeSchema.nullish(),
  record_type: queryRecordTypesSchema.default("COMPLETE_ONLY"),
});

export const subtypeListRequestSchema = z.object({
  filter_by: subtypeFilterOptionsSchema.nullish(),
  sort_by: sortOptionsSchema.nullish(),
  pagination_key: paginationKeySchema.nullish(),
  page_size: z.number().int().positive().default(DEFAULT_PAGE_SIZE),
});

export const noFilterSubtypeListRequestSchema = z.object({
  sort_by: sortOptionsSchema.nullish(),
  pagination_key: paginationKeySchema.nullish(),
  page_size: z.number().int().positive().default(DEFAULT_PAGE_SIZE),
});

export const generalListRequestSchema = z.object({
  filter_by: filterOptionsSchema.nullish(),
  sort_by: sortOptionsSchema.nullish(),
  pagination_key: paginationKeySchema.nullish(),
  page_size: z.number().int().positive().default(DEFAULT_PAGE_SIZE),
});

export const listUserReviewingDatasetsRequestSchema = z.object({
  pagination_key: paginationKeySchema.nullish(),
  page_size: z.number().int().positive().default(DEFAULT_PAGE_SIZE),
  sort_by: sortOptionsSchema.nullish(),
  filter_by: filterOptionsSchema,
});

export const lockChangeRequestSchema = z.object({
  id: nonEmptyString,
  reason: nonEmptyString,
});

export const itemRevertRequestSchema = z.object({
  id: nonEmptyString,
  history_id: z.number().int(),
  reason: nonEmptyString,
});

export const versionRequestSchema = z.object({
  id: nonEmptyString,
  reason: nonEmptyString,
});

export const fetchItemRequestSchema = z.object({
  item_id: nonEmptyString,
});

export const accessSettingsPutSchema = z.object({
  owner: nonEmptyString,
  general: z.array(z.string()),
  groups: z.record(z.array(z.string())),
});

/* Admin import/export/restore */

export const bundledItemSchema = z.object({
  id: nonEmptyString,
  item_payload: z.record(z.unknown()),
  auth_payload: z.record(z.unknown()),
  lock_payload: z.record(z.unknown()),
});

export const importModeSchema = z.enum([
  "ADD_ONLY",
  "ADD_OR_OVERWRITE",
  "OVERWRITE_ONLY",
  "SYNC_ADD_OR_OVERWRITE",
  "SYNC_DELETION_ALLOWED",
]);

const registryImportSettingsShape = {
  import_mode: importModeSchema,
  parse_items: z.boolean().default(true),
  allow_entry_deletion: z.boolean().default(false),
  trial_mode: z.boolean().default(true),
};

export const registryImportRequestSchema = z.object({
  ...registryImportSettingsShape,
  items: z.array(bundledItemSchema),
});

export const tableNamesSchema = z.object({
  resource_table_name: nonEmptyString,
  auth_table_name: nonEmptyString,
  lock_table_name: nonEmptyString,
});

export const registryRestoreRequestSchema = z.object({
  ...registryImportSettingsShape,
  table_names: tableNamesSchema,
});

export const provGraphRestoreRequestSchema = z.object({
  trial_mode: z.boolean().default(true),
  abort_if_failures: z.boolean().default(true),
  items: z.array(bundledItemSchema),
});
