/**
 * Data store API router group - mounted at /api/data-store. Path layout
 * matches the legacy data-store-api service.
 */
import { Hono } from "hono";
import { entityRegistryGuards, requireUser, type AuthEnv } from "@provena/auth";
import {
  collectionFormatJsonSchema,
  datastoreSchemas,
  registryRequestSchemas,
  registrySchemas,
} from "@provena/interfaces";
import type { DatasetMetadata } from "@provena/interfaces/types/RegistryModels";
import { z } from "zod";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { badRequest } from "../../errors.js";
import {
  failureStatus,
  serializeCompleteItem,
  serializeItem,
  successStatus,
} from "../../serializers.js";
import * as registry from "../../services/registryService.js";
import * as datasets from "../../services/datasetService.js";
import { getContainer } from "../../container.js";

export const buildDataStoreRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = entityRegistryGuards;

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(guards));

  /* ------------------------------ metadata ------------------------------ */

  router.post("/metadata/validate-metadata", guards.read, async (c) => {
    try {
      const cf = registrySchemas.collectionFormatSchema.parse(
        await c.req.json(),
      ) as unknown as DatasetMetadata;
      datasets.validateCollectionFormatFields(cf);
      await datasets.validateLinkedEntities(cf);
      return c.json(successStatus("Metadata is valid."));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          failureStatus(
            `Failed to validate metadata against schema. Error: ${error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          ),
        );
      }
      return c.json(failureStatus(`Failed field value validation. Error: ${(error as Error).message}`));
    }
  });

  router.get("/metadata/dataset-schema", guards.read, async (c) =>
    c.json({ json_schema: collectionFormatJsonSchema() }),
  );

  /* ------------------------------ register ------------------------------ */

  router.post("/register/mint-dataset", guards.write, async (c) => {
    let cf: DatasetMetadata;
    try {
      cf = registrySchemas.collectionFormatSchema.parse(
        await c.req.json(),
      ) as unknown as DatasetMetadata;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({
          status: failureStatus(
            `Failed to validate metadata against schema. Error: ${error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          ),
          handle: null,
          s3_location: null,
          register_create_activity_session_id: null,
        });
      }
      throw error;
    }
    try {
      const result = await datasets.mintDataset(cf, c.get("user"));
      return c.json({
        status: successStatus(`Successfully minted dataset ${result.handle}.`),
        handle: result.handle,
        s3_location: result.s3Location,
        register_create_activity_session_id: result.registerCreateActivitySessionId,
      });
    } catch (error) {
      /* Field/link validation failures return unsuccessful status (legacy). */
      if (error instanceof Error && !("statusCode" in error)) {
        return c.json({
          status: failureStatus(`Failed field value validation. Error: ${error.message}`),
          handle: null,
          s3_location: null,
          register_create_activity_session_id: null,
        });
      }
      throw error;
    }
  });

  router.post("/register/update-metadata", guards.write, async (c) => {
    const handleId = c.req.query("handle_id");
    const reason = c.req.query("reason");
    if (!handleId) throw badRequest("Missing required query parameter 'handle_id'.");
    if (!reason) throw badRequest("Missing required query parameter 'reason'.");
    const cf = registrySchemas.collectionFormatSchema.parse(
      await c.req.json(),
    ) as unknown as DatasetMetadata;
    const result = await datasets.updateDatasetMetadata({
      handleId,
      cf,
      reason,
      user: c.get("user"),
    });
    return c.json({
      status: successStatus(`Successfully updated dataset ${handleId}.`),
      handle: result.handle,
      s3_location: result.s3Location,
    });
  });

  router.put("/register/revert-metadata", guards.write, async (c) => {
    const body = registryRequestSchemas.itemRevertRequestSchema.parse(await c.req.json());
    await datasets.revertDatasetMetadata({
      id: body.id,
      historyId: body.history_id,
      reason: body.reason,
      user: c.get("user"),
    });
    return c.json({
      status: successStatus(
        `Successfully reverted dataset ${body.id} to history entry ${body.history_id}.`,
      ),
    });
  });

  router.post("/register/version", guards.write, async (c) => {
    const body = registryRequestSchemas.versionRequestSchema.parse(await c.req.json());
    const result = await datasets.versionDataset({
      id: body.id,
      reason: body.reason,
      user: c.get("user"),
    });
    return c.json({
      new_version_id: result.newVersionId,
      version_job_session_id: result.versionJobSessionId,
    });
  });

  /* --------------------------- registry items --------------------------- */

  router.post("/registry/items/list", guards.read, async (c) => {
    const body = registryRequestSchemas.noFilterSubtypeListRequestSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const sort = body.sort_by ?? null;
    const result = await registry.listItemsWithAccess(
      {
        subtype: "DATASET",
        recordType: "COMPLETE_ONLY",
        sortType: sort?.sort_type ?? null,
        ascending: sort?.ascending ?? false,
        beginsWith: sort?.begins_with ?? null,
        pageSize: body.page_size,
        paginationKey: body.pagination_key ?? null,
      },
      c.get("user"),
    );
    return c.json({
      status: successStatus(`Successfully listed ${result.items.length} datasets.`),
      items: result.items.map(serializeCompleteItem),
      seed_items: result.seedItems.map(serializeItem),
      unparsable_items: [],
      total_item_count: result.items.length + result.seedItems.length,
      complete_item_count: result.items.length,
      seed_item_count: result.seedItems.length,
      unparsable_item_count: 0,
      not_authorised_count: result.notAuthorisedCount,
      pagination_key: result.paginationKey,
    });
  });

  router.get("/registry/items/fetch-dataset", guards.read, async (c) => {
    const handleId = c.req.query("handle_id");
    if (!handleId) throw badRequest("Missing required query parameter 'handle_id'.");
    const fetched = await datasets.fetchDatasetWithAccess(handleId, c.get("user"));
    return c.json({
      status: successStatus(`Successfully fetched dataset ${handleId}.`),
      item: serializeItem(fetched.stored),
      roles: fetched.roles,
      locked: fetched.locked,
    });
  });

  router.post("/registry/items/generate-presigned-url", guards.read, async (c) => {
    const body = datastoreSchemas.presignedUrlRequestSchema.parse(await c.req.json());
    const url = await datasets.generatePresignedUrl({
      datasetId: body.dataset_id,
      filePath: body.file_path,
      expiresIn: body.expires_in,
      user: c.get("user"),
    });
    return c.json({
      dataset_id: body.dataset_id,
      file_path: body.file_path,
      presigned_url: url,
    });
  });

  /* ----------------------------- credentials ---------------------------- */

  router.post("/registry/credentials/generate-read-access-credentials", guards.read, async (c) => {
    const body = datastoreSchemas.credentialsRequestSchema.parse(await c.req.json());
    const result = await datasets.generateCredentials({
      datasetId: body.dataset_id,
      write: false,
      consoleSessionRequired: body.console_session_required,
      user: c.get("user"),
    });
    return c.json({
      status: successStatus("STS credentials generated successfully for specified path."),
      credentials: result.credentials,
      console_session_url: result.consoleSessionUrl,
    });
  });

  router.post(
    "/registry/credentials/generate-write-access-credentials",
    guards.write,
    async (c) => {
      const body = datastoreSchemas.credentialsRequestSchema.parse(await c.req.json());
      const result = await datasets.generateCredentials({
        datasetId: body.dataset_id,
        write: true,
        consoleSessionRequired: body.console_session_required,
        user: c.get("user"),
      });
      return c.json({
        status: successStatus("STS credentials generated successfully for specified path."),
        credentials: result.credentials,
        console_session_url: result.consoleSessionUrl,
      });
    },
  );

  /* ------------------------------- release ------------------------------ */

  router.get("/release/sys-reviewers/list", guards.read, async (c) => {
    const { reviewers } = getContainer();
    return c.json(await reviewers.list());
  });

  router.post("/release/sys-reviewers/add", guards.admin, async (c) => {
    const reviewerId = c.req.query("reviewer_id");
    if (!reviewerId) throw badRequest("Missing required query parameter 'reviewer_id'.");
    const { reviewers, items } = getContainer();
    const person = await items.fetchItem(reviewerId);
    if (!person || person.base.itemSubType !== "PERSON") {
      throw badRequest(`Reviewer id ${reviewerId} must reference a registered Person.`);
    }
    await reviewers.add(reviewerId);
    return c.json(successStatus(`Added reviewer ${reviewerId}.`));
  });

  router.delete("/release/sys-reviewers/delete", guards.admin, async (c) => {
    const reviewerId = c.req.query("reviewer_id");
    if (!reviewerId) throw badRequest("Missing required query parameter 'reviewer_id'.");
    const { reviewers } = getContainer();
    const removed = await reviewers.remove(reviewerId);
    if (!removed) throw badRequest(`Reviewer ${reviewerId} was not present.`);
    return c.json(successStatus(`Removed reviewer ${reviewerId}.`));
  });

  router.post("/release/approval-request", requireUser(), async (c) => {
    const body = datastoreSchemas.releaseApprovalRequestSchema.parse(await c.req.json());
    await datasets.requestDatasetReview({
      datasetId: body.dataset_id,
      approverId: body.approver_id,
      notes: body.notes,
      user: c.get("user"),
    });
    return c.json({
      dataset_id: body.dataset_id,
      approver_id: body.approver_id,
      details: "Successfully requested release review.",
    });
  });

  router.put("/release/action-approval-request", requireUser(), async (c) => {
    const body = datastoreSchemas.actionApprovalRequestSchema.parse(await c.req.json());
    await datasets.actionDatasetReview({
      datasetId: body.dataset_id,
      approve: body.approve,
      notes: body.notes,
      user: c.get("user"),
    });
    return c.json({
      dataset_id: body.dataset_id,
      approved: body.approve,
      details: `Successfully ${body.approve ? "approved" : "rejected"} release request.`,
    });
  });

  return router;
};
