import { Hono } from "hono";
import type { Context } from "hono";
import { requiredAuthMiddleware } from "@provena/auth";
import type { ApiBindings } from "../types";
import { parseJsonObject, readPagination, readStringQuery, statusPayload } from "../utils/http";

type ApiContext = Context<ApiBindings>;

export const createDataStoreRouter = (): Hono<ApiBindings> => {
  const app = new Hono<ApiBindings>();
  app.use("*", requiredAuthMiddleware);

  app.post("/metadata/validate-metadata", async (c) => {
    const body = await parseJsonObject(c);
    const metadata = (body.metadata ?? {}) as Record<string, unknown>;
    return c.json(await c.get("services").dataStore.validateMetadata(metadata));
  });

  app.get("/metadata/dataset-schema", async (c) => c.json(await c.get("services").dataStore.getDatasetSchema()));

  app.post("/register/mint-dataset", async (c) => {
    const body = await parseJsonObject(c);
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const id = await c.get("services").dataStore.mintDataset({
      ownerUsername: user.username,
      displayName:
        (typeof body.display_name === "string" && body.display_name) ||
        (typeof body.name === "string" && body.name) ||
        "Dataset",
      record: body,
    });
    return c.json({ status: statusPayload(true), id, handle: id });
  });

  app.post("/register/update-metadata", async (c) => {
    const body = await parseJsonObject(c);
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.handle_id === "string" ? body.handle_id : undefined);
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id field.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const item = await c.get("services").dataStore.updateDatasetMetadata({
      id,
      metadata: (body.metadata ?? {}) as Record<string, unknown>,
      updatedBy: user.username,
    });
    return c.json({ status: statusPayload(true), item, handle: id });
  });

  app.put("/register/revert-metadata", async (c) => {
    const body = await parseJsonObject(c);
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.handle_id === "string" ? body.handle_id : undefined);
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id field.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const item = await c.get("services").dataStore.revertDatasetMetadata({
      id,
      updatedBy: user.username,
    });
    return c.json({ status: statusPayload(true), item });
  });

  app.post("/register/version", async (c) => {
    const body = await parseJsonObject(c);
    const id =
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.handle_id === "string" ? body.handle_id : undefined);
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing id field.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const item = await c.get("services").dataStore.versionDataset({
      id,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      updatedBy: user.username,
    });
    return c.json({
      status: statusPayload(true),
      item,
      new_version_id: item.id,
      version_job_session_id: null,
    });
  });

  app.post("/registry/items/list", async (c) => {
    const body = await parseJsonObject(c);
    const page = readPagination(body);
    const listed = await c.get("services").dataStore.listDatasets(page.limit, page.offset);
    return c.json({
      status: statusPayload(true),
      items: listed.records,
      records: listed.records,
      count: listed.total,
      total: listed.total,
    });
  });

  app.get("/registry/items/fetch-dataset", async (c) => {
    const id = readStringQuery(c, "handle_id") ?? readStringQuery(c, "id");
    if (!id) {
      return c.json({ status: statusPayload(false, "Missing required handle_id parameter.") }, 400);
    }
    const item = await c.get("services").dataStore.fetchDataset(id);
    if (!item) {
      return c.json({ status: statusPayload(false, "Dataset not found.") }, 404);
    }
    return c.json({ status: statusPayload(true), item });
  });

  app.post("/registry/items/generate-presigned-url", async (c) => {
    const body = await parseJsonObject(c);
    const key =
      (typeof body.file_path === "string" && body.file_path) ||
      (typeof body.key === "string" && body.key) ||
      "";
    if (!key) {
      return c.json({ status: statusPayload(false, "Missing file_path/key in payload.") }, 400);
    }

    const url = await c.get("services").dataStore.generatePresignedUrl({
      key,
      action: body.action === "upload" ? "upload" : "download",
      expiresInSeconds: Number(body.expires_in_seconds ?? body.expires_in ?? body.expiresInSeconds ?? 3600),
    });
    return c.json({
      status: statusPayload(true),
      presigned_url: url,
      url,
      file_path: key,
    });
  });

  const credentialsHandler = async (mode: "read" | "write", c: ApiContext) => {
    const body = await parseJsonObject(c);
    const datasetId = typeof body.dataset_id === "string" ? body.dataset_id : "";
    if (!datasetId) {
      return c.json({ status: statusPayload(false, "Missing dataset_id in payload.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const credentials = await c.get("services").dataStore.generateCredentials({
      username: user.username,
      datasetId,
      mode,
    });
    return c.json({
      status: statusPayload(true),
      access_key_id: credentials.accessKeyId,
      secret_access_key: credentials.secretAccessKey,
      session_token: credentials.sessionToken,
      expires_at: credentials.expiresAt,
      console_url: credentials.consoleUrl,
    });
  };

  app.post("/registry/credentials/generate-read-access-credentials", (c) =>
    credentialsHandler("read", c),
  );
  app.post("/registry/credentials/generate-write-access-credentials", (c) =>
    credentialsHandler("write", c),
  );

  app.delete("/release/sys-reviewers/delete", async (c) => {
    const username = readStringQuery(c, "reviewer_id") ?? readStringQuery(c, "username");
    if (!username) {
      return c.json({ status: statusPayload(false, "Missing required username/reviewer_id parameter.") }, 400);
    }
    await c.get("services").dataStore.removeReviewer(username);
    return c.json({ status: statusPayload(true) });
  });

  app.post("/release/sys-reviewers/add", async (c) => {
    const body = await parseJsonObject(c);
    const username =
      (typeof body.username === "string" ? body.username : undefined) ??
      (typeof body.id === "string" ? body.id : undefined) ??
      (typeof body.reviewer_id === "string" ? body.reviewer_id : undefined);
    if (!username) {
      return c.json({ status: statusPayload(false, "Missing username in payload.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    await c.get("services").dataStore.addReviewer(username, user.username);
    return c.json({ status: statusPayload(true) });
  });

  app.get("/release/sys-reviewers/list", async (c) => {
    const reviewers = await c.get("services").dataStore.listReviewers();
    return c.json({
      status: statusPayload(true),
      reviewers: reviewers.map((id) => ({ id })),
    });
  });

  app.post("/release/approval-request", async (c) => {
    const body = await parseJsonObject(c);
    const datasetId = typeof body.dataset_id === "string" ? body.dataset_id : "";
    if (!datasetId) {
      return c.json({ status: statusPayload(false, "Missing dataset_id.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const requestId = await c.get("services").dataStore.requestApproval({
      datasetId,
      requesterUsername: user.username,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return c.json({
      status: statusPayload(true),
      request_id: requestId,
      dataset_id: datasetId,
      approver_id: typeof body.approver_id === "string" ? body.approver_id : null,
      details: "Successfully sent request to approve dataset release to approver.",
    });
  });

  app.put("/release/action-approval-request", async (c) => {
    const body = await parseJsonObject(c);
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    if (!requestId) {
      return c.json({ status: statusPayload(false, "Missing request_id.") }, 400);
    }
    const user = c.get("user");
    if (!user) {
      return c.json({ status: statusPayload(false, "Authentication required") }, 401);
    }
    const updated = await c.get("services").dataStore.actionApproval({
      requestId,
      action:
        body.action === "APPROVE" || body.action === "approve" || body.approve === true
          ? "APPROVE"
          : "REJECT",
      decidedBy: user.username,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    if (!updated) {
      return c.json({ status: statusPayload(false, "Approval request not found.") }, 404);
    }
    return c.json({
      status: statusPayload(true),
      dataset_id: updated.dataset_id,
      approved: updated.status === "APPROVED",
      details: "Successfully responded to dataset release approval request.",
      request: updated,
    });
  });

  return app;
};
