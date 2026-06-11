/**
 * Jobs framework integration test - requires Postgres (uses an isolated
 * test database).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overrideConfigForTesting } from "@provena/config";
import { closeDb, createTestDatabase, getDb, makeJobRepo, type TestDatabase } from "@provena/db";
import {
  newBatchId,
  registerJobHandler,
  retryJob,
  startWorker,
  stopBoss,
  submitJob,
} from "./index.js";

let testDb: TestDatabase;
let restore: () => void;

const waitForStatus = async (
  sessionId: string,
  statuses: string[],
  timeoutMs = 20000,
): Promise<string> => {
  const jobs = makeJobRepo(getDb());
  const start = Date.now();
  for (;;) {
    const session = await jobs.get(sessionId);
    if (session && statuses.includes(session.status)) return session.status;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for session ${sessionId} to reach ${statuses.join("/")} (currently ${session?.status}).`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  restore = overrideConfigForTesting({ DATABASE_URL: testDb.url });
  await closeDb(); /* drop any cached pool pointing at the old URL */
  await startWorker({ batchSize: 2 });
});

afterAll(async () => {
  await stopBoss();
  await closeDb();
  restore();
  await testDb.teardown();
});

describe("jobs framework", () => {
  it("processes wake-up jobs instantly (no-op success)", async () => {
    const { sessionId } = await submitJob({
      username: "alice",
      jobSubType: "REGISTRY_WAKE_UP",
      payload: { reason: "warm up" },
    });
    const status = await waitForStatus(sessionId, ["SUCCEEDED", "FAILED"]);
    expect(status).toBe("SUCCEEDED");
  });

  it("runs registered handlers and stores results", async () => {
    registerJobHandler("SEND_EMAIL", async (payload) => ({
      echoed: payload.subject,
    }));
    const { sessionId } = await submitJob({
      username: "alice",
      jobSubType: "SEND_EMAIL",
      payload: { email_to: "x@y.z", subject: "hi", body: "b", reason: "r" },
    });
    await waitForStatus(sessionId, ["SUCCEEDED"]);
    const session = await makeJobRepo(getDb()).get(sessionId);
    expect(session!.result).toEqual({ echoed: "hi" });
    expect(session!.job_type).toBe("EMAIL");
  });

  it("marks failing handlers as FAILED with error info", async () => {
    registerJobHandler("GENERATE_REPORT", async () => {
      throw new Error("boom");
    });
    const { sessionId } = await submitJob({
      username: "alice",
      jobSubType: "GENERATE_REPORT",
      payload: { id: "x", item_subtype: "STUDY", depth: 1 },
    });
    await waitForStatus(sessionId, ["FAILED"]);
    const session = await makeJobRepo(getDb()).get(sessionId);
    expect(session!.info).toContain("boom");
  });

  it("supports batches and retry produces a new session", async () => {
    const batchId = newBatchId();
    const first = await submitJob({
      username: "alice",
      jobSubType: "EMAIL_WAKE_UP",
      payload: {},
      batchId,
    });
    const second = await submitJob({
      username: "alice",
      jobSubType: "EMAIL_WAKE_UP",
      payload: {},
      batchId,
    });
    await waitForStatus(first.sessionId, ["SUCCEEDED"]);
    await waitForStatus(second.sessionId, ["SUCCEEDED"]);
    const listed = await makeJobRepo(getDb()).list({ batchId });
    expect(listed.jobs).toHaveLength(2);

    const retried = await retryJob(first.sessionId);
    expect(retried.sessionId).not.toBe(first.sessionId);
    await waitForStatus(retried.sessionId, ["SUCCEEDED"]);
    const retriedSession = await makeJobRepo(getDb()).get(retried.sessionId);
    expect(retriedSession!.batch_id).toBe(batchId);
  });
});
