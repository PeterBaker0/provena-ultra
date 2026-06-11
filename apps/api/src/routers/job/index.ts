/**
 * Job API router group - mounted at /api/job. Backed by the job_session
 * table + pg-boss; preserves the legacy job-api surface used by the UIs for
 * session polling.
 */
import { Hono } from "hono";
import { jobGuards, requireUser, type AuthEnv } from "@provena/auth";
import { jobSchemas } from "@provena/interfaces";
import { newBatchId, retryJob, submitJob } from "@provena/jobs";
import { buildCheckAccessRouter } from "../checkAccess.js";
import { badRequest, unauthorized } from "../../errors.js";
import { getContainer } from "../../container.js";
import type { JobSessionRecord } from "@provena/db";

/** Wire shape: legacy JobStatusTable (includes gsi_status field). */
const serializeJob = (job: JobSessionRecord) => ({
  session_id: job.session_id,
  created_timestamp: job.created_timestamp,
  username: job.username,
  batch_id: job.batch_id,
  payload: job.payload,
  job_type: job.job_type,
  job_sub_type: job.job_sub_type,
  gsi_status: "ok",
  status: job.status,
  info: job.info,
  result: job.result,
});

export const buildJobRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();
  const guards = jobGuards;

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildCheckAccessRouter(guards));

  /* -------------------------------- user -------------------------------- */

  router.get("/jobs/user/fetch", requireUser(), async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) throw badRequest("Missing required query parameter 'session_id'.");
    const { jobs } = getContainer();
    const job = await jobs.get(sessionId);
    if (!job) throw badRequest(`Job with session id ${sessionId} does not exist.`);
    /* users can only view their own jobs unless they hold job service read */
    const user = c.get("user");
    if (job.username !== user.username && !user.roles.includes(guards.readRole)) {
      throw unauthorized("You can only view your own jobs.");
    }
    return c.json({ job: serializeJob(job) });
  });

  router.post("/jobs/user/list", requireUser(), async (c) => {
    const body = jobSchemas.listJobsRequestSchema.parse(await c.req.json().catch(() => ({})));
    const { jobs } = getContainer();
    const result = await jobs.list({
      username: c.get("user").username,
      limit: body.limit,
      paginationKey: body.pagination_key ?? null,
    });
    return c.json({
      jobs: result.jobs.map(serializeJob),
      pagination_key: result.paginationKey,
    });
  });

  router.post("/jobs/user/list_batch", requireUser(), async (c) => {
    const body = jobSchemas.listByBatchRequestSchema.parse(await c.req.json());
    const { jobs } = getContainer();
    const result = await jobs.list({
      batchId: body.batch_id,
      limit: body.limit,
      paginationKey: body.pagination_key ?? null,
    });
    const user = c.get("user");
    const visible = result.jobs.filter(
      (j) => j.username === user.username || user.roles.includes(guards.readRole),
    );
    return c.json({
      jobs: visible.map(serializeJob),
      pagination_key: result.paginationKey,
    });
  });

  router.post("/jobs/user/retry", requireUser(), async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) throw badRequest("Missing required query parameter 'session_id'.");
    const { jobs } = getContainer();
    const job = await jobs.get(sessionId);
    if (!job) throw badRequest(`Job with session id ${sessionId} does not exist.`);
    const user = c.get("user");
    if (job.username !== user.username && !user.roles.includes(guards.adminRole)) {
      throw unauthorized("You can only retry your own jobs.");
    }
    if (job.status !== "FAILED") {
      throw badRequest(`Only FAILED jobs can be retried - job is ${job.status}.`);
    }
    const retried = await retryJob(sessionId);
    return c.json({ session_id: retried.sessionId });
  });

  /* -------------------------------- admin ------------------------------- */

  router.post("/jobs/admin/launch", guards.write, async (c) => {
    const body = jobSchemas.adminLaunchJobRequestSchema.parse(await c.req.json());
    /* Validate the payload against the expected schema for the sub type. */
    const payloadSchema = jobSchemas.JOB_PAYLOAD_SCHEMA_MAP[body.job_sub_type];
    const payload = payloadSchema.parse(body.job_payload) as Record<string, unknown>;
    const batchId = body.request_batch_id ? newBatchId() : (body.add_to_batch ?? null);
    const submitted = await submitJob({
      username: body.username ?? c.get("user").username,
      jobType: body.job_type,
      jobSubType: body.job_sub_type,
      payload,
      batchId,
    });
    return c.json({
      session_id: submitted.sessionId,
      batch_id: body.request_batch_id ? batchId : null,
    });
  });

  router.get("/jobs/admin/fetch", guards.read, async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) throw badRequest("Missing required query parameter 'session_id'.");
    const { jobs } = getContainer();
    const job = await jobs.get(sessionId);
    if (!job) throw badRequest(`Job with session id ${sessionId} does not exist.`);
    return c.json({ job: serializeJob(job) });
  });

  router.post("/jobs/admin/list", guards.read, async (c) => {
    const body = jobSchemas.adminListJobsRequestSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const { jobs } = getContainer();
    const result = await jobs.list({
      username: body.username_filter ?? null,
      limit: body.limit,
      paginationKey: body.pagination_key ?? null,
    });
    return c.json({
      jobs: result.jobs.map(serializeJob),
      pagination_key: result.paginationKey,
    });
  });

  router.post("/jobs/admin/list_batch", guards.read, async (c) => {
    const body = jobSchemas.adminListByBatchRequestSchema.parse(await c.req.json());
    const { jobs } = getContainer();
    const result = await jobs.list({
      batchId: body.batch_id,
      username: body.username_filter ?? null,
      limit: body.limit,
      paginationKey: body.pagination_key ?? null,
    });
    return c.json({
      jobs: result.jobs.map(serializeJob),
      pagination_key: result.paginationKey,
    });
  });

  router.post("/jobs/admin/retry", guards.write, async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) throw badRequest("Missing required query parameter 'session_id'.");
    const { jobs } = getContainer();
    const job = await jobs.get(sessionId);
    if (!job) throw badRequest(`Job with session id ${sessionId} does not exist.`);
    const retried = await retryJob(sessionId);
    return c.json({ session_id: retried.sessionId });
  });

  return router;
};
