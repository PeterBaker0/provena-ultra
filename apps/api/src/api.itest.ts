/**
 * Full API integration test - boots the Hono app in-process with an
 * isolated database and the embedded worker, against a live S3+STS store
 * (RustFS in dev/CI).
 *
 * Covers the core legacy-compatible flows: auth guards, registry CRUD +
 * history + locks + versioning (with background activity jobs), dataset
 * mint/credentials/release, provenance registration + lineage, CSV
 * templates, search, admin export and handle minting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { overrideConfigForTesting } from "@provena/config";
import { closeDb, createTestDatabase, type TestDatabase } from "@provena/db";
import { startWorker, stopBoss } from "@provena/jobs";
import { signTestToken, type AuthEnv } from "@provena/auth";
import { resetStorageService } from "@provena/storage";

const SECRET = "api-itest-secret";
const ALL_ROLES = [
  "entity-registry-read",
  "entity-registry-write",
  "entity-registry-admin",
  "sys-admin-read",
  "sys-admin-write",
  "sys-admin-admin",
  "handle-read",
  "handle-write",
  "handle-admin",
  "job-service-read",
  "job-service-write",
  "job-service-admin",
];
const WRITE_ROLES = ["entity-registry-read", "entity-registry-write"];

let testDb: TestDatabase;
let restoreConfig: () => void;
let app: Hono<AuthEnv>;
let aliceToken: string;
let adminToken: string;
const ALICE = `alice_${Date.now().toString(36)}`;

interface ApiResponse {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

const req = async (
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<ApiResponse> => {
  const response = await app.request(path, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: response.status, json, text };
};

const waitJob = async (
  sessionId: string,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> => {
  const start = Date.now();
  for (;;) {
    const r = await req("GET", `/api/job/jobs/user/fetch?session_id=${sessionId}`, {
      token: aliceToken,
    });
    const job = r.json?.job as Record<string, unknown> | undefined;
    if (job && (job.status === "SUCCEEDED" || job.status === "FAILED")) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Job ${sessionId} timed out (${job?.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  restoreConfig = overrideConfigForTesting({
    DATABASE_URL: testDb.url,
    AUTH_TEST_SHARED_SECRET: SECRET,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
    STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY ?? "provena-root",
    STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY ?? "provena-secret",
  });
  await closeDb();
  resetStorageService();
  const { resetContainer } = await import("./container.js");
  resetContainer();
  const { getStorageService } = await import("@provena/storage");
  await getStorageService().ensureBucket();
  const { registerAllJobHandlers } = await import("./services/jobHandlers.js");
  registerAllJobHandlers();
  await startWorker({ batchSize: 3 });
  const { buildApp } = await import("./app.js");
  app = buildApp();
  aliceToken = await signTestToken({ username: ALICE, roles: WRITE_ROLES, secret: SECRET });
  adminToken = await signTestToken({ username: "admin", roles: ALL_ROLES, secret: SECRET });
});

afterAll(async () => {
  await stopBoss();
  await closeDb();
  restoreConfig();
  await testDb.teardown();
});

/* Shared ids across the ordered test flow. */
let personId: string;
let orgId: string;
let modelId: string;
let datasetId: string;
let workflowTemplateId: string;
let datasetTemplateId: string;
let modelRunId: string;

describe("auth", () => {
  it("rejects unauthenticated requests and enforces role levels", async () => {
    expect((await req("GET", "/api/registry/check-access/check-general-access")).status).toBe(
      401,
    );
    const general = await req("GET", "/api/registry/check-access/check-general-access", {
      token: aliceToken,
    });
    expect(general.status).toBe(200);
    expect(general.json?.username).toBe(ALICE);
    expect(
      (await req("GET", "/api/registry/check-access/check-admin-access", { token: aliceToken }))
        .status,
    ).toBe(401);
    expect(
      (await req("GET", "/api/registry/check-access/check-admin-access", { token: adminToken }))
        .status,
    ).toBe(200);
  });
});

describe("registry lifecycle", () => {
  it("creates agents and links the user", async () => {
    const person = await req("POST", "/api/registry/registry/agent/person/create", {
      token: aliceToken,
      body: {
        display_name: "Alice Smith",
        email: "alice@test.local",
        first_name: "Alice",
        last_name: "Smith",
        ethics_approved: true,
      },
    });
    expect(person.status).toBe(200);
    personId = (person.json?.created_item as { id: string }).id;
    expect(personId).toMatch(/^10378\.1\//);

    const link = await req("POST", "/api/auth/link/user/assign", {
      token: aliceToken,
      body: { person_id: personId },
    });
    expect(link.status).toBe(200);
    const lookup = await req("GET", "/api/auth/link/user/lookup", { token: aliceToken });
    expect(lookup.json?.person_id).toBe(personId);

    const org = await req("POST", "/api/registry/registry/agent/organisation/create", {
      token: aliceToken,
      body: { display_name: "CSIRO", name: "CSIRO" },
    });
    expect(org.status).toBe(200);
    orgId = (org.json?.created_item as { id: string }).id;
  });

  it("creates a versioning-enabled item and runs the create-activity chain", async () => {
    const model = await req("POST", "/api/registry/registry/entity/model/create", {
      token: aliceToken,
      body: {
        display_name: "Test Model",
        name: "Test Model",
        description: "A model",
        documentation_url: "https://example.com/docs",
        source_url: "https://example.com/src",
      },
    });
    expect(model.status).toBe(200);
    modelId = (model.json?.created_item as { id: string }).id;
    const sessionId = model.json?.register_create_activity_session_id as string;
    expect(sessionId).toBeTruthy();

    const job = await waitJob(sessionId);
    expect(job.status).toBe("SUCCEEDED");
    const result = job.result as { creation_activity_id: string; lodge_session_id: string };
    expect(result.creation_activity_id).toBeTruthy();
    const lodgeJob = await waitJob(result.lodge_session_id);
    expect(lodgeJob.status).toBe("SUCCEEDED");

    /* The Create activity is fetchable on its read-only router. */
    const createFetch = await req(
      "GET",
      `/api/registry/registry/activity/create/fetch?id=${result.creation_activity_id}`,
      { token: aliceToken },
    );
    expect(createFetch.status).toBe(200);
    expect((createFetch.json?.item as { created_item_id: string }).created_item_id).toBe(
      modelId,
    );
  });

  it("fetch includes roles, locked and full item shape", async () => {
    const fetch1 = await req("GET", `/api/registry/registry/entity/model/fetch?id=${modelId}`, {
      token: aliceToken,
    });
    expect(fetch1.status).toBe(200);
    const item = fetch1.json?.item as Record<string, unknown>;
    expect(item.id).toBe(modelId);
    expect(item.item_category).toBe("ENTITY");
    expect(item.record_type).toBe("COMPLETE_ITEM");
    expect(Array.isArray(item.history)).toBe(true);
    expect(fetch1.json?.roles).toContain("admin");
    expect(fetch1.json?.locked).toBe(false);
    expect(fetch1.json?.item_is_seed).toBe(false);
  });

  it("update appends history; revert restores", async () => {
    const update = await req(
      "PUT",
      `/api/registry/registry/entity/model/update?id=${modelId}&reason=rename`,
      {
        token: aliceToken,
        body: {
          display_name: "Test Model v2",
          name: "Test Model v2",
          description: "A model",
          documentation_url: "https://example.com/docs",
          source_url: "https://example.com/src",
        },
      },
    );
    expect(update.status).toBe(200);
    const afterUpdate = await req(
      "GET",
      `/api/registry/registry/entity/model/fetch?id=${modelId}`,
      { token: aliceToken },
    );
    const item = afterUpdate.json?.item as { history: unknown[]; display_name: string };
    expect(item.history).toHaveLength(2);
    expect(item.display_name).toBe("Test Model v2");

    const revert = await req("PUT", "/api/registry/registry/entity/model/revert", {
      token: aliceToken,
      body: { id: modelId, history_id: 0, reason: "undo" },
    });
    expect(revert.status).toBe(200);
    const reverted = await req(
      "GET",
      `/api/registry/registry/entity/model/fetch?id=${modelId}`,
      { token: aliceToken },
    );
    expect((reverted.json?.item as { display_name: string }).display_name).toBe("Test Model");
  });

  it("serves legacy-generated json + ui schemas", async () => {
    const schema = await req("GET", "/api/registry/registry/agent/organisation/schema", {
      token: aliceToken,
    });
    expect((schema.json?.json_schema as { title: string }).title).toBe(
      "OrganisationDomainInfo",
    );
    const ui = await req("GET", "/api/registry/registry/agent/person/ui_schema", {
      token: aliceToken,
    });
    expect((ui.json?.ui_schema as Record<string, unknown>)["ui:title"]).toBe("Person");
  });

  it("locks block writes and lock history accumulates", async () => {
    await req("PUT", "/api/registry/registry/entity/model/locks/lock", {
      token: aliceToken,
      body: { id: modelId, reason: "freeze" },
    });
    const blocked = await req(
      "PUT",
      `/api/registry/registry/entity/model/update?id=${modelId}&reason=fail`,
      {
        token: aliceToken,
        body: {
          display_name: "x",
          name: "x",
          description: "x",
          documentation_url: "https://example.com",
          source_url: "https://example.com",
        },
      },
    );
    expect(blocked.status).toBe(401);
    await req("PUT", "/api/registry/registry/entity/model/locks/unlock", {
      token: aliceToken,
      body: { id: modelId, reason: "unfreeze" },
    });
    const history = await req(
      "GET",
      `/api/registry/registry/entity/model/locks/history?id=${modelId}`,
      { token: aliceToken },
    );
    expect((history.json?.history as unknown[]).length).toBe(2);
  });

  it("versions an item with version-activity job + chain links", async () => {
    const version = await req("POST", "/api/registry/registry/entity/model/version", {
      token: aliceToken,
      body: { id: modelId, reason: "major upgrade" },
    });
    expect(version.status).toBe(200);
    const newId = version.json?.new_version_id as string;
    const job = await waitJob(version.json?.version_job_session_id as string);
    expect(job.status).toBe("SUCCEEDED");

    const newItem = await req("GET", `/api/registry/registry/entity/model/fetch?id=${newId}`, {
      token: aliceToken,
    });
    const versioning = (newItem.json?.item as { versioning_info: Record<string, unknown> })
      .versioning_info;
    expect(versioning.previous_version).toBe(modelId);
    expect(versioning.version).toBe(2);
    const oldItem = await req("GET", `/api/registry/registry/entity/model/fetch?id=${modelId}`, {
      token: aliceToken,
    });
    expect(
      (oldItem.json?.item as { versioning_info: Record<string, unknown> }).versioning_info
        .next_version,
    ).toBe(newId);

    /* Cannot version a non-latest item. */
    const again = await req("POST", "/api/registry/registry/entity/model/version", {
      token: aliceToken,
      body: { id: modelId, reason: "should fail" },
    });
    expect(again.status).toBe(400);
  });

  it("validates payloads (422 FastAPI-style) and supports /validate", async () => {
    const invalid = await req("POST", "/api/registry/registry/agent/organisation/create", {
      token: aliceToken,
      body: { display_name: "", name: "" },
    });
    expect(invalid.status).toBe(422);
    expect(Array.isArray(invalid.json?.detail)).toBe(true);

    const validate = await req("POST", "/api/registry/registry/agent/organisation/validate", {
      token: aliceToken,
      body: { display_name: "Org", name: "Org" },
    });
    expect(validate.status).toBe(200);
    expect(validate.json?.success).toBe(true);
  });

  it("paginates lists with stable cursors", async () => {
    for (let i = 0; i < 4; i += 1) {
      await req("POST", "/api/registry/registry/activity/study/create", {
        token: aliceToken,
        body: {
          display_name: `Study ${i}`,
          title: `Study ${i}`,
          description: "study",
        },
      });
    }
    const page1 = await req("POST", "/api/registry/registry/activity/study/list", {
      token: aliceToken,
      body: {
        page_size: 2,
        sort_by: { sort_type: "DISPLAY_NAME", ascending: true },
      },
    });
    expect((page1.json?.items as unknown[]).length).toBe(2);
    expect(page1.json?.pagination_key).toBeTruthy();
    const page2 = await req("POST", "/api/registry/registry/activity/study/list", {
      token: aliceToken,
      body: {
        page_size: 2,
        sort_by: { sort_type: "DISPLAY_NAME", ascending: true },
        pagination_key: page1.json?.pagination_key,
      },
    });
    const names1 = (page1.json?.items as { display_name: string }[]).map((i) => i.display_name);
    const names2 = (page2.json?.items as { display_name: string }[]).map((i) => i.display_name);
    expect(names1).toEqual(["Study 0", "Study 1"]);
    expect(names2).toEqual(["Study 2", "Study 3"]);
  });

  it("auth configuration get/put with owner enforcement", async () => {
    const get = await req(
      "GET",
      `/api/registry/registry/entity/model/auth/configuration?id=${modelId}`,
      { token: aliceToken },
    );
    expect(get.status).toBe(200);
    expect(get.json?.owner).toBe(ALICE);

    const put = await req(
      "PUT",
      `/api/registry/registry/entity/model/auth/configuration?id=${modelId}`,
      {
        token: aliceToken,
        body: { owner: ALICE, general: ["metadata-read", "metadata-write"], groups: {} },
      },
    );
    expect(put.status).toBe(200);

    const changeOwner = await req(
      "PUT",
      `/api/registry/registry/entity/model/auth/configuration?id=${modelId}`,
      { token: aliceToken, body: { owner: "bob", general: [], groups: {} } },
    );
    expect(changeOwner.status).toBe(400);
  });
});

describe("data store", () => {
  const collectionFormat = () => ({
    associations: { organisation_id: orgId },
    approvals: {
      ethics_registration: { relevant: false, obtained: false },
      ethics_access: { relevant: false, obtained: false },
      indigenous_knowledge: { relevant: false, obtained: false },
      export_controls: { relevant: false, obtained: false },
    },
    dataset_info: {
      name: "Integration Dataset",
      description: "A dataset for integration testing",
      access_info: { reposited: true },
      publisher_id: orgId,
      created_date: { relevant: true, value: "2024-01-01" },
      published_date: { relevant: false },
      license: "https://creativecommons.org/licenses/by/4.0/",
      keywords: ["integration", "quantum"],
    },
  });

  it("mints a dataset with storage seeding and create activity", async () => {
    const mint = await req("POST", "/api/data-store/register/mint-dataset", {
      token: aliceToken,
      body: collectionFormat(),
    });
    expect(mint.status).toBe(200);
    expect((mint.json?.status as { success: boolean }).success).toBe(true);
    datasetId = mint.json?.handle as string;
    expect((mint.json?.s3_location as { path: string }).path).toContain("datasets/");
    const job = await waitJob(mint.json?.register_create_activity_session_id as string);
    expect(job.status).toBe("SUCCEEDED");
  });

  it("rejects invalid approvals (relevant but not obtained)", async () => {
    const bad = collectionFormat();
    bad.approvals.export_controls = { relevant: true, obtained: false };
    const mint = await req("POST", "/api/data-store/register/mint-dataset", {
      token: aliceToken,
      body: bad,
    });
    expect((mint.json?.status as { success: boolean }).success).toBe(false);
  });

  it("brokers scoped read/write credentials", async () => {
    const read = await req(
      "POST",
      "/api/data-store/registry/credentials/generate-read-access-credentials",
      { token: aliceToken, body: { dataset_id: datasetId, console_session_required: false } },
    );
    expect(read.status).toBe(200);
    const creds = read.json?.credentials as Record<string, string>;
    expect(creds.aws_access_key_id).toBeTruthy();
    expect(creds.aws_session_token).toBeTruthy();
    expect(read.json?.console_session_url).toBeNull();

    const write = await req(
      "POST",
      "/api/data-store/registry/credentials/generate-write-access-credentials",
      { token: aliceToken, body: { dataset_id: datasetId, console_session_required: false } },
    );
    expect(write.status).toBe(200);
  });

  it("serves presigned URLs for dataset files", async () => {
    const presigned = await req("POST", "/api/data-store/registry/items/generate-presigned-url", {
      token: aliceToken,
      body: { dataset_id: datasetId, file_path: "metadata.json", expires_in: 120 },
    });
    expect(presigned.status).toBe(200);
    const download = await fetch(presigned.json?.presigned_url as string);
    expect(download.status).toBe(200);
    const body = (await download.json()) as { handle: string };
    expect(body.handle).toBe(datasetId);
  });

  it("runs the release review workflow", async () => {
    expect(
      (
        await req("POST", `/api/data-store/release/sys-reviewers/add?reviewer_id=${personId}`, {
          token: adminToken,
        })
      ).status,
    ).toBe(200);
    const reviewers = await req("GET", "/api/data-store/release/sys-reviewers/list", {
      token: aliceToken,
    });
    expect(reviewers.json).toContain(personId);

    const request = await req("POST", "/api/data-store/release/approval-request", {
      token: aliceToken,
      body: { dataset_id: datasetId, approver_id: personId, notes: "please review" },
    });
    expect(request.status).toBe(200);

    /* Write credentials blocked while pending. */
    const blocked = await req(
      "POST",
      "/api/data-store/registry/credentials/generate-write-access-credentials",
      { token: aliceToken, body: { dataset_id: datasetId, console_session_required: false } },
    );
    expect(blocked.status).toBe(403);

    const action = await req("PUT", "/api/data-store/release/action-approval-request", {
      token: aliceToken,
      body: { dataset_id: datasetId, approve: true, notes: "approved" },
    });
    expect(action.status).toBe(200);

    const after = await req(
      "GET",
      `/api/data-store/registry/items/fetch-dataset?handle_id=${datasetId}`,
      { token: aliceToken },
    );
    const item = after.json?.item as { release_status: string; release_history: unknown[] };
    expect(item.release_status).toBe("RELEASED");
    expect(item.release_history).toHaveLength(2);
  });
});

describe("provenance", () => {
  it("registers model runs and explores lineage", async () => {
    const dt = await req("POST", "/api/registry/registry/entity/dataset_template/create", {
      token: aliceToken,
      body: { display_name: "Input template", description: "input data" },
    });
    datasetTemplateId = (dt.json?.created_item as { id: string }).id;

    const wt = await req("POST", "/api/registry/registry/entity/model_run_workflow/create", {
      token: aliceToken,
      body: {
        display_name: "Workflow",
        software_id: modelId,
        input_templates: [{ template_id: datasetTemplateId }],
        output_templates: [],
      },
    });
    workflowTemplateId = (wt.json?.created_item as { id: string }).id;

    const record = {
      workflow_template_id: workflowTemplateId,
      inputs: [
        {
          dataset_template_id: datasetTemplateId,
          dataset_id: datasetId,
          dataset_type: "DATA_STORE",
        },
      ],
      outputs: [],
      display_name: "Integration run",
      description: "model run",
      associations: { modeller_id: personId },
      start_time: 1700000000,
      end_time: 1700000500,
    };

    const sync = await req("POST", "/api/prov/model_run/register_sync", {
      token: aliceToken,
      body: record,
    });
    expect(sync.status).toBe(200);
    modelRunId = (sync.json?.record_info as { id: string }).id;
    const provJson = JSON.parse(
      (sync.json?.record_info as { prov_json: string }).prov_json,
    ) as Record<string, unknown>;
    expect(provJson.activity).toBeTruthy();
    expect(provJson.entity).toBeTruthy();

    const asyncReg = await req("POST", "/api/prov/model_run/register", {
      token: aliceToken,
      body: { ...record, display_name: "Integration run async" },
    });
    const asyncJob = await waitJob(asyncReg.json?.session_id as string);
    expect(asyncJob.status).toBe("SUCCEEDED");

    const upstream = await req(
      "GET",
      `/api/prov/explore/upstream?starting_id=${modelRunId}&depth=2`,
      { token: aliceToken },
    );
    const graph = upstream.json?.graph as {
      directed: boolean;
      multigraph: boolean;
      nodes: { id: string }[];
      links: { source: string; target: string; type: string }[];
    };
    expect(graph.directed).toBe(true);
    expect(graph.multigraph).toBe(false);
    expect(graph.nodes.map((n) => n.id)).toContain(datasetId);
    expect(graph.links.every((l) => l.type.length > 0)).toBe(true);

    const contributing = await req(
      "GET",
      `/api/prov/explore/special/contributing_datasets?starting_id=${modelRunId}&depth=2`,
      { token: aliceToken },
    );
    expect(
      (contributing.json?.graph as { nodes: { id: string }[] }).nodes.some(
        (n) => n.id === datasetId,
      ),
    ).toBe(true);

    const agents = await req(
      "GET",
      `/api/prov/explore/special/contributing_agents?starting_id=${modelRunId}&depth=2`,
      { token: aliceToken },
    );
    expect(
      (agents.json?.graph as { nodes: { id: string; item_category: string }[] }).nodes.some(
        (n) => n.id === personId,
      ),
    ).toBe(true);
  });

  it("links a model run to a study", async () => {
    const study = await req("POST", "/api/registry/registry/activity/study/create", {
      token: aliceToken,
      body: { display_name: "Linked study", title: "Linked study", description: "study" },
    });
    const studyId = (study.json?.created_item as { id: string }).id;
    const link = await req(
      "POST",
      `/api/prov/model_run/edit/link_to_study?model_run_id=${modelRunId}&study_id=${studyId}`,
      { token: aliceToken },
    );
    expect(link.status).toBe(200);
    const job = await waitJob(link.json?.session_id as string);
    expect(job.status).toBe("SUCCEEDED");

    const upstream = await req(
      "GET",
      `/api/prov/explore/upstream?starting_id=${modelRunId}&depth=1`,
      { token: aliceToken },
    );
    expect(
      (upstream.json?.graph as { nodes: { id: string }[] }).nodes.some((n) => n.id === studyId),
    ).toBe(true);
  });

  it("generates and converts CSV templates", async () => {
    const template = await req(
      "GET",
      `/api/prov/bulk/generate_template/csv?workflow_template_id=${workflowTemplateId}`,
      { token: aliceToken },
    );
    expect(template.status).toBe(200);
    expect(template.text).toContain(`_workflow template id ${workflowTemplateId}`);
    expect(template.text).toContain("display name");

    /* Round trip: fill a row and convert back to records. */
    const headers = template.text.trim().split("\n")[0]!;
    const headerCells = headers.split(",").map((h) => h.replaceAll('"', ""));
    const row = headerCells.map((header) => {
      if (header.startsWith("Input dataset id")) return datasetId;
      if (header === "display name") return "CSV run";
      if (header === "description") return "from csv";
      if (header === "agent id") return personId;
      if (header.startsWith("execution start")) return "2023-11-14 00:00:00+00:00";
      if (header.startsWith("execution end")) return "2023-11-14 01:00:00+00:00";
      return "";
    });
    const csv = `${headers}\n${row.map((v) => `"${v}"`).join(",")}`;
    const convert = await app.request("/api/prov/bulk/convert_model_runs/csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "text/csv" },
      body: csv,
    });
    expect(convert.status).toBe(200);
    const convertJson = (await convert.json()) as {
      new_records: { display_name: string; workflow_template_id: string }[];
    };
    expect(convertJson.new_records).toHaveLength(1);
    expect(convertJson.new_records[0]!.display_name).toBe("CSV run");
    expect(convertJson.new_records[0]!.workflow_template_id).toBe(workflowTemplateId);
  });

  it("generates a provenance report (docx via job)", async () => {
    const report = await req("POST", "/api/prov/explore/generate/report", {
      token: aliceToken,
      body: { id: modelRunId, item_subtype: "MODEL_RUN", depth: 2 },
    });
    expect(report.status).toBe(200);
    const job = await waitJob(report.json?.session_id as string);
    expect(job.status).toBe("SUCCEEDED");
    const url = (job.result as { report_url: string }).report_url;
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(Number(download.headers.get("content-length"))).toBeGreaterThan(1000);
  });
});

describe("search + jobs + groups + handles", () => {
  it("finds items via FTS with subtype filter", async () => {
    const results = await req(
      "GET",
      "/api/search/search/entity-registry?query=integration%20dataset",
      { token: aliceToken },
    );
    expect(
      (results.json?.results as { id: string }[]).some((r) => r.id === datasetId),
    ).toBe(true);

    const filtered = await req(
      "GET",
      `/api/search/search/entity-registry?query=integration&subtype_filter=MODEL_RUN`,
      { token: aliceToken },
    );
    expect(
      (filtered.json?.results as { id: string }[]).every((r) => r.id !== datasetId),
    ).toBe(true);
  });

  it("lists user jobs with pagination", async () => {
    const list = await req("POST", "/api/job/jobs/user/list", {
      token: aliceToken,
      body: { limit: 5 },
    });
    expect((list.json?.jobs as { username: string }[]).every((j) => j.username === ALICE)).toBe(
      true,
    );
    expect((list.json?.jobs as unknown[]).length).toBeGreaterThan(0);
  });

  it("group lifecycle + dataset default access", async () => {
    const add = await req("POST", "/api/auth/groups/admin/add_group", {
      token: adminToken,
      body: {
        id: "team-a",
        display_name: "Team A",
        description: "Test group",
        default_data_store_access: ["metadata-read", "dataset-data-read"],
      },
    });
    expect(add.status).toBe(200);
    await req("POST", "/api/auth/groups/admin/add_member?group_id=team-a", {
      token: adminToken,
      body: { username: ALICE, email: "alice@test.local" },
    });
    const membership = await req("GET", "/api/auth/groups/user/list_user_membership", {
      token: aliceToken,
    });
    expect((membership.json?.groups as { id: string }[]).map((g) => g.id)).toContain("team-a");
  });

  it("access request workflow", async () => {
    const report = await req("GET", "/api/auth/access-control/user/generate-access-report", {
      token: aliceToken,
    });
    expect(report.status).toBe(200);
    const reportBody = report.json?.report as {
      components: {
        component_name: string;
        component_roles: { role_name: string; access_granted: boolean }[];
      }[];
    };
    /* request admin access */
    const desired = structuredClone(reportBody);
    for (const component of desired.components) {
      for (const role of component.component_roles) {
        if (role.role_name === "entity-registry-admin") role.access_granted = true;
      }
    }
    const request = await req(
      "POST",
      "/api/auth/access-control/user/request-change?send_email=false",
      { token: aliceToken, body: desired },
    );
    expect(request.status).toBe(200);

    const pending = await req(
      "GET",
      "/api/auth/access-control/admin/all-pending-request-history",
      { token: adminToken },
    );
    const items = pending.json?.items as { username: string; request_id: number }[];
    const mine = items.find((i) => i.username === ALICE);
    expect(mine).toBeTruthy();

    const change = await req(
      "POST",
      "/api/auth/access-control/admin/change-request-state",
      {
        token: adminToken,
        body: {
          username: ALICE,
          request_id: mine!.request_id,
          desired_state: "APPROVED_PENDING_ACTION",
        },
      },
    );
    expect(change.status).toBe(200);
  });

  it("admin export produces bundled items", async () => {
    const exported = await req("GET", "/api/registry/admin/export", { token: adminToken });
    expect(exported.status).toBe(200);
    const bundles = exported.json?.items as {
      id: string;
      item_payload: Record<string, unknown>;
      auth_payload: Record<string, unknown>;
      lock_payload: Record<string, unknown>;
    }[];
    expect(bundles.length).toBeGreaterThanOrEqual(8);
    const datasetBundle = bundles.find((b) => b.id === datasetId);
    expect(datasetBundle?.auth_payload.access_settings).toBeTruthy();
    expect(datasetBundle?.lock_payload.lock_information).toBeTruthy();
  });

  it("mints + manages handles", async () => {
    const minted = await req("POST", "/api/handle/handle/mint", {
      token: adminToken,
      body: { value_type: "URL", value: "https://example.com" },
    });
    expect(minted.status).toBe(200);
    const id = minted.json?.id as string;
    const added = await req("POST", "/api/handle/handle/add_value", {
      token: adminToken,
      body: { id, value_type: "DESC", value: "a description" },
    });
    expect((added.json?.properties as unknown[]).length).toBe(2);
  });

  it("warmer stub responds", async () => {
    expect((await req("GET", "/api/warmer")).status).toBe(200);
  });
});
