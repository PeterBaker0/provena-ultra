/**
 * Registry API router group - mounted at /api/registry. Path layout matches
 * the legacy registry-api service exactly (relative to the mount).
 */
import { Hono } from "hono";
import { entityRegistryGuards, type AuthEnv } from "@provena/auth";
import {
  ITEM_CATEGORY_ROUTE_MAP,
  ITEM_SUB_TYPE_ROUTE_MAP,
  categoryForSubtype,
  registryRequestSchemas,
} from "@provena/interfaces";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { buildSubtypeRouter, type SubtypeRouteOptions } from "./factory.js";
import { buildRegistryGeneralRouter } from "./general.js";
import { buildRegistryAdminRouter } from "./admin.js";
import { badRequest } from "../../errors.js";
import { serializeCompleteItem, successStatus } from "../../serializers.js";
import * as registry from "../../services/registryService.js";

const SUBTYPE_ROUTER_CONFIG: SubtypeRouteOptions[] = [
  { subtype: "ORGANISATION", mode: "STANDARD" },
  { subtype: "PERSON", mode: "STANDARD" },
  { subtype: "MODEL", mode: "STANDARD_WITH_VERSION" },
  { subtype: "MODEL_RUN_WORKFLOW_TEMPLATE", mode: "STANDARD_WITH_VERSION" },
  { subtype: "DATASET_TEMPLATE", mode: "STANDARD_WITH_VERSION" },
  { subtype: "DATASET", mode: "SERVICE_MANAGED" },
  { subtype: "STUDY", mode: "STANDARD" },
  { subtype: "CREATE", mode: "READ_ONLY" },
  { subtype: "VERSION", mode: "READ_ONLY" },
  { subtype: "MODEL_RUN", mode: "SERVICE_MANAGED" },
];

const buildDatasetReleasesRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  router.post("/user/releases", entityRegistryGuards.read, async (c) => {
    const body = registryRequestSchemas.listUserReviewingDatasetsRequestSchema.parse(
      await c.req.json(),
    );
    const reviewer = body.filter_by.release_reviewer;
    if (!reviewer) {
      throw badRequest("Must provide a release_reviewer in filter_by for this endpoint.");
    }
    const sort = body.sort_by ?? null;
    const result = await registry.listItemsWithAccess(
      {
        subtype: "DATASET",
        recordType: "COMPLETE_ONLY",
        releaseReviewer: reviewer,
        releaseStatus: body.filter_by.release_status ?? null,
        sortType: sort?.sort_type ?? "RELEASE_TIMESTAMP",
        ascending: sort?.ascending ?? false,
        pageSize: body.page_size,
        paginationKey: body.pagination_key ?? null,
      },
      c.get("user"),
    );
    return c.json({
      status: successStatus(`Successfully listed ${result.items.length} datasets.`),
      dataset_items: result.items.map(serializeCompleteItem),
      total_dataset_count: result.totalCount,
      pagination_key: result.paginationKey,
    });
  });
  return router;
};

export const buildRegistryRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(entityRegistryGuards));

  /* Per-subtype routers under /registry/<category>/<subtype-route> */
  for (const config of SUBTYPE_ROUTER_CONFIG) {
    const subtype: ItemSubType = config.subtype;
    const categorySegment = ITEM_CATEGORY_ROUTE_MAP[categoryForSubtype(subtype)];
    const subtypeSegment = ITEM_SUB_TYPE_ROUTE_MAP[subtype];
    if (!subtypeSegment) continue;
    router.route(`/registry/${categorySegment}/${subtypeSegment}`, buildSubtypeRouter(config));
  }

  /* Dataset-specific extra routes (releases listing). */
  router.route("/registry/entity/dataset", buildDatasetReleasesRouter());

  /* General + admin */
  router.route("/registry/general", buildRegistryGeneralRouter());
  router.route("/admin", buildRegistryAdminRouter());

  return router;
};
