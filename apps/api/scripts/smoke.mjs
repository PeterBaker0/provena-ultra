/**
 * End-to-end smoke test of the running API at localhost:8080 using test
 * tokens (AUTH_TEST_SHARED_SECRET=smoke-secret).
 */
import { signTestToken } from "@provena/auth";

const BASE = "http://localhost:8080";

const token = async (username, roles) =>
  signTestToken({ username, roles, secret: "smoke-secret" });

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

const RUN = Date.now().toString(36);
const adminToken = await token(`admin_${RUN}`, ALL_ROLES);
const ALICE = `alice_${RUN}`;
const aliceToken = await token(ALICE, WRITE_ROLES);

let failures = 0;
const check = (name, condition, extra) => {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${name}${extra ? ` -- ${JSON.stringify(extra).slice(0, 400)}` : ""}`);
  }
};

const req = async (method, path, { body, tok, raw } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, json, text };
};

const waitJob = async (sessionId, tok, timeout = 20000) => {
  const start = Date.now();
  for (;;) {
    const r = await req("GET", `/api/job/jobs/user/fetch?session_id=${sessionId}`, { tok });
    const status = r.json?.job?.status;
    if (status === "SUCCEEDED" || status === "FAILED") return r.json.job;
    if (Date.now() - start > timeout) throw new Error(`job ${sessionId} timed out (${status})`);
    await new Promise((r2) => setTimeout(r2, 300));
  }
};

/* 1. auth checks */
{
  const unauth = await req("GET", "/api/registry/check-access/check-general-access");
  check("401 without token", unauth.status === 401, unauth);
  const ok = await req("GET", "/api/registry/check-access/check-general-access", {
    tok: aliceToken,
  });
  check("general access with token", ok.status === 200 && ok.json.username === ALICE, ok);
  const writeOk = await req("GET", "/api/registry/check-access/check-write-access", {
    tok: aliceToken,
  });
  check("write access granted", writeOk.status === 200, writeOk);
  const adminBlocked = await req("GET", "/api/registry/check-access/check-admin-access", {
    tok: aliceToken,
  });
  check("admin access denied for alice", adminBlocked.status === 401, adminBlocked);
}

/* 2. create person + organisation, link alice */
let personId, orgId;
{
  const person = await req("POST", "/api/registry/registry/agent/person/create", {
    tok: aliceToken,
    body: {
      display_name: "Alice Smith",
      email: "alice@test.local",
      first_name: "Alice",
      last_name: "Smith",
      ethics_approved: true,
    },
  });
  check("create person", person.status === 200 && person.json.status.success, person);
  personId = person.json.created_item?.id;

  const link = await req("POST", "/api/auth/link/user/assign", {
    tok: aliceToken,
    body: { person_id: personId },
  });
  check("assign user link", link.status === 200, link);

  const lookup = await req("GET", "/api/auth/link/user/lookup", { tok: aliceToken });
  check("link lookup", lookup.json?.person_id === personId, lookup);

  const org = await req("POST", "/api/registry/registry/agent/organisation/create", {
    tok: aliceToken,
    body: { display_name: "CSIRO", name: "CSIRO" },
  });
  check("create organisation", org.status === 200 && org.json.status.success, org);
  orgId = org.json.created_item?.id;
}

/* 3. create model (versioning-enabled -> create activity job) */
let modelId, createSessionId;
{
  const model = await req("POST", "/api/registry/registry/entity/model/create", {
    tok: aliceToken,
    body: {
      display_name: "Test Model",
      name: "Test Model",
      description: "A model",
      documentation_url: "https://example.com/docs",
      source_url: "https://example.com/src",
    },
  });
  check("create model", model.status === 200 && model.json.status?.success, model);
  modelId = model.json.created_item?.id;
  createSessionId = model.json.register_create_activity_session_id;
  check("create returns session id", typeof createSessionId === "string", model.json);

  const job = await waitJob(createSessionId, aliceToken);
  check("create activity job succeeded", job.status === "SUCCEEDED", job);
  check("create activity result has lodge session", !!job.result?.lodge_session_id, job);
  const lodge = await waitJob(job.result.lodge_session_id, aliceToken);
  check("lodge create activity succeeded", lodge.status === "SUCCEEDED", lodge);
}

/* 4. fetch + list + update + history */
{
  const fetch1 = await req("GET", `/api/registry/registry/entity/model/fetch?id=${modelId}`, {
    tok: aliceToken,
  });
  check(
    "fetch model",
    fetch1.status === 200 &&
      fetch1.json.item.id === modelId &&
      fetch1.json.roles.includes("admin") &&
      fetch1.json.locked === false,
    fetch1,
  );

  const list = await req("POST", "/api/registry/registry/entity/model/list", {
    tok: aliceToken,
    body: { page_size: 10 },
  });
  check(
    "list models",
    list.status === 200 && list.json.items.length >= 1 && list.json.complete_item_count >= 1,
    list,
  );

  const update = await req(
    "PUT",
    `/api/registry/registry/entity/model/update?id=${modelId}&reason=test%20update`,
    {
      tok: aliceToken,
      body: {
        display_name: "Test Model v2",
        name: "Test Model v2",
        description: "A model",
        documentation_url: "https://example.com/docs",
        source_url: "https://example.com/src",
      },
    },
  );
  check("update model", update.status === 200 && update.json.status.success, update);

  const fetch2 = await req("GET", `/api/registry/registry/entity/model/fetch?id=${modelId}`, {
    tok: aliceToken,
  });
  check(
    "history grew after update",
    fetch2.json.item.history.length === 2 && fetch2.json.item.display_name === "Test Model v2",
    fetch2.json.item.history,
  );

  const revert = await req("PUT", "/api/registry/registry/entity/model/revert", {
    tok: aliceToken,
    body: { id: modelId, history_id: 0, reason: "revert test" },
  });
  check("revert model", revert.status === 200 && revert.json.status.success, revert);
}

/* 5. schema + ui schema */
{
  const schema = await req("GET", "/api/registry/registry/agent/organisation/schema", {
    tok: aliceToken,
  });
  check(
    "json schema served",
    schema.status === 200 && schema.json.json_schema.title === "OrganisationDomainInfo",
    schema,
  );
  const ui = await req("GET", "/api/registry/registry/agent/organisation/ui_schema", {
    tok: aliceToken,
  });
  check("ui schema served", ui.status === 200 && !!ui.json.ui_schema["ui:title"], ui);
}

/* 6. locks */
{
  const lock = await req("PUT", "/api/registry/registry/entity/model/locks/lock", {
    tok: aliceToken,
    body: { id: modelId, reason: "freeze" },
  });
  check("lock item", lock.status === 200, lock);
  const update = await req(
    "PUT",
    `/api/registry/registry/entity/model/update?id=${modelId}&reason=should%20fail`,
    {
      tok: aliceToken,
      body: {
        display_name: "x",
        name: "x",
        description: "x",
        documentation_url: "https://example.com",
        source_url: "https://example.com",
      },
    },
  );
  check("update blocked while locked", update.status === 401, update);
  const unlock = await req("PUT", "/api/registry/registry/entity/model/locks/unlock", {
    tok: aliceToken,
    body: { id: modelId, reason: "unfreeze" },
  });
  check("unlock item", unlock.status === 200, unlock);
  const history = await req(
    "GET",
    `/api/registry/registry/entity/model/locks/history?id=${modelId}`,
    { tok: aliceToken },
  );
  check("lock history has 2 events", history.json.history.length === 2, history);
}

/* 7. versioning */
{
  const version = await req("POST", "/api/registry/registry/entity/model/version", {
    tok: aliceToken,
    body: { id: modelId, reason: "new version" },
  });
  check(
    "version model",
    version.status === 200 && !!version.json.new_version_id && !!version.json.version_job_session_id,
    version,
  );
  const job = await waitJob(version.json.version_job_session_id, aliceToken);
  check("version activity job succeeded", job.status === "SUCCEEDED", job);
}

/* 8. dataset mint + creds + presigned + release */
let datasetId;
{
  const cf = {
    associations: { organisation_id: orgId },
    approvals: {
      ethics_registration: { relevant: false, obtained: false },
      ethics_access: { relevant: false, obtained: false },
      indigenous_knowledge: { relevant: false, obtained: false },
      export_controls: { relevant: false, obtained: false },
    },
    dataset_info: {
      name: "Smoke Dataset",
      description: "A dataset for smoke testing",
      access_info: { reposited: true },
      publisher_id: orgId,
      created_date: { relevant: true, value: "2024-01-01" },
      published_date: { relevant: false },
      license: "https://creativecommons.org/licenses/by/4.0/",
      keywords: ["smoke", "test"],
    },
  };
  const mint = await req("POST", "/api/data-store/register/mint-dataset", {
    tok: aliceToken,
    body: cf,
  });
  check(
    "mint dataset",
    mint.status === 200 && mint.json.status.success && !!mint.json.handle,
    mint,
  );
  datasetId = mint.json.handle;
  check("mint returns s3 location", mint.json.s3_location?.path?.includes("datasets/"), mint.json);

  const fetchDs = await req(
    "GET",
    `/api/data-store/registry/items/fetch-dataset?handle_id=${datasetId}`,
    { tok: aliceToken },
  );
  check(
    "fetch dataset",
    fetchDs.status === 200 && fetchDs.json.item.collection_format.dataset_info.name === "Smoke Dataset",
    fetchDs,
  );

  const readCreds = await req(
    "POST",
    "/api/data-store/registry/credentials/generate-read-access-credentials",
    { tok: aliceToken, body: { dataset_id: datasetId, console_session_required: false } },
  );
  check(
    "read credentials",
    readCreds.status === 200 && !!readCreds.json.credentials.aws_access_key_id,
    readCreds,
  );

  const writeCreds = await req(
    "POST",
    "/api/data-store/registry/credentials/generate-write-access-credentials",
    { tok: aliceToken, body: { dataset_id: datasetId, console_session_required: false } },
  );
  check(
    "write credentials",
    writeCreds.status === 200 && !!writeCreds.json.credentials.aws_session_token,
    writeCreds,
  );

  const presigned = await req("POST", "/api/data-store/registry/items/generate-presigned-url", {
    tok: aliceToken,
    body: { dataset_id: datasetId, file_path: "metadata.json", expires_in: 60 },
  });
  check("presigned url for metadata.json", presigned.status === 200, presigned);
  if (presigned.status === 200) {
    const dl = await fetch(presigned.json.presigned_url);
    const body = await dl.json();
    check("presigned download works", dl.status === 200 && body.handle === datasetId, body);
  }

  /* release flow */
  const addReviewer = await req(
    "POST",
    `/api/data-store/release/sys-reviewers/add?reviewer_id=${personId}`,
    { tok: adminToken },
  );
  check("add reviewer", addReviewer.status === 200, addReviewer);

  const requestReview = await req("POST", "/api/data-store/release/approval-request", {
    tok: aliceToken,
    body: { dataset_id: datasetId, approver_id: personId, notes: "please review" },
  });
  check("request review", requestReview.status === 200, requestReview);

  const action = await req("PUT", "/api/data-store/release/action-approval-request", {
    tok: aliceToken,
    body: { dataset_id: datasetId, approve: true, notes: "looks good" },
  });
  check("approve release", action.status === 200, action);

  const fetchAfter = await req(
    "GET",
    `/api/data-store/registry/items/fetch-dataset?handle_id=${datasetId}`,
    { tok: aliceToken },
  );
  check(
    "dataset released",
    fetchAfter.json.item.release_status === "RELEASED" &&
      fetchAfter.json.item.release_history.length === 2,
    fetchAfter.json.item.release_status,
  );
}

/* 9. prov: templates + model run + lineage */
{
  const dt = await req("POST", "/api/registry/registry/entity/dataset_template/create", {
    tok: aliceToken,
    body: { display_name: "Input template", description: "input data" },
  });
  check("create dataset template", dt.status === 200 && dt.json.status.success, dt);
  const templateId = dt.json.created_item.id;
  await waitJob(dt.json.register_create_activity_session_id, aliceToken);

  const wt = await req("POST", "/api/registry/registry/entity/model_run_workflow/create", {
    tok: aliceToken,
    body: {
      display_name: "Workflow",
      software_id: modelId,
      input_templates: [{ template_id: templateId }],
      output_templates: [],
    },
  });
  check("create workflow template", wt.status === 200 && wt.json.status.success, wt);
  const workflowTemplateId = wt.json.created_item.id;
  await waitJob(wt.json.register_create_activity_session_id, aliceToken);

  const record = {
    workflow_template_id: workflowTemplateId,
    inputs: [
      { dataset_template_id: templateId, dataset_id: datasetId, dataset_type: "DATA_STORE" },
    ],
    outputs: [],
    display_name: "Smoke run",
    description: "smoke model run",
    associations: { modeller_id: personId },
    start_time: 1700000000,
    end_time: 1700000500,
  };

  const sync = await req("POST", "/api/prov/model_run/register_sync", {
    tok: aliceToken,
    body: record,
  });
  check(
    "register model run sync",
    sync.status === 200 && !!sync.json.record_info?.id,
    sync,
  );
  const runId = sync.json.record_info.id;

  const asyncReg = await req("POST", "/api/prov/model_run/register", {
    tok: aliceToken,
    body: { ...record, display_name: "Smoke run async" },
  });
  check("register model run async", asyncReg.status === 200 && !!asyncReg.json.session_id, asyncReg);
  const asyncJob = await waitJob(asyncReg.json.session_id, aliceToken);
  check("async model run job succeeded", asyncJob.status === "SUCCEEDED", asyncJob);

  const upstream = await req(
    "GET",
    `/api/prov/explore/upstream?starting_id=${runId}&depth=2`,
    { tok: aliceToken },
  );
  check(
    "upstream lineage",
    upstream.status === 200 &&
      upstream.json.graph.nodes.length >= 4 &&
      upstream.json.graph.directed === true,
    upstream.json.graph?.nodes,
  );
  const datasets = await req(
    "GET",
    `/api/prov/explore/special/contributing_datasets?starting_id=${runId}&depth=2`,
    { tok: aliceToken },
  );
  check(
    "contributing datasets finds dataset",
    datasets.status === 200 && datasets.json.graph.nodes.some((n) => n.id === datasetId),
    datasets.json.graph?.nodes,
  );

  const downstreamFromDataset = await req(
    "GET",
    `/api/prov/explore/downstream?starting_id=${datasetId}&depth=2`,
    { tok: aliceToken },
  );
  check(
    "downstream from dataset finds runs",
    downstreamFromDataset.json.graph.nodes.length >= 2,
    downstreamFromDataset.json.graph?.nodes,
  );

  /* CSV template */
  const csv = await req(
    "GET",
    `/api/prov/bulk/generate_template/csv?workflow_template_id=${workflowTemplateId}`,
    { tok: aliceToken },
  );
  check(
    "csv template generated",
    csv.status === 200 && csv.text.includes("workflow template id") && csv.text.includes("display name"),
    csv.text?.slice(0, 200),
  );
}

/* 10. search */
{
  const search = await req("GET", "/api/search/search/entity-registry?query=smoke", {
    tok: aliceToken,
  });
  check(
    "search finds dataset",
    search.status === 200 && search.json.results.some((r) => r.id === datasetId),
    search.json,
  );
}

/* 11. general registry list + admin export */
{
  const list = await req("POST", "/api/registry/registry/general/list", {
    tok: aliceToken,
    body: { page_size: 50 },
  });
  check("general list", list.status === 200 && list.json.items.length >= 6, list.json?.total_item_count);

  const exportRes = await req("GET", "/api/registry/admin/export", { tok: adminToken });
  check(
    "admin export bundles",
    exportRes.status === 200 &&
      exportRes.json.items.length >= 6 &&
      !!exportRes.json.items[0].item_payload &&
      !!exportRes.json.items[0].auth_payload,
    exportRes.json?.items?.length,
  );
}

/* 12. handle service */
{
  const minted = await req("POST", "/api/handle/handle/mint", {
    tok: adminToken,
    body: { value_type: "URL", value: "https://example.com" },
  });
  check("handle mint", minted.status === 200 && !!minted.json.id, minted);
}

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
