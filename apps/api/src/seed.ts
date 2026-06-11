/**
 * Dev demo-data seeder (`pnpm db:seed`).
 *
 * Idempotently creates a small connected demo graph:
 *   Person + Organisation + Model + Dataset Template + Workflow Template +
 *   Study + (best effort) a reposited Dataset, then registers a Model Run
 *   linking them - giving the UIs something to explore immediately.
 *
 * The seed user (SEED_USERNAME, default provena-admin - matching the realm
 * dev user) is linked to the created Person.
 */
import { closeDb, makeJobRepo, getDb } from "@provena/db";
import { startWorker, stopBoss } from "@provena/jobs";
import type { AuthenticatedUser } from "@provena/auth";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import type { DatasetMetadata } from "@provena/interfaces/types/RegistryModels";
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import { getContainer } from "./container.js";
import { registerAllJobHandlers } from "./services/jobHandlers.js";
import * as registry from "./services/registryService.js";
import * as datasets from "./services/datasetService.js";
import * as prov from "./services/provService.js";

const SEED_USERNAME = process.env.SEED_USERNAME ?? "provena-admin";

const seedUser: AuthenticatedUser = {
  username: SEED_USERNAME,
  email: `${SEED_USERNAME}@provena.local`,
  roles: [
    "entity-registry-read",
    "entity-registry-write",
    "entity-registry-admin",
    "handle-read",
    "handle-write",
    "handle-admin",
  ],
  accessToken: "seed",
};

/** Find an existing complete item by subtype + display name. */
const findExisting = async (
  subtype: ItemSubType,
  displayName: string,
): Promise<string | null> => {
  const { items } = getContainer();
  const result = await items.listItems({ subtype, recordType: "COMPLETE_ONLY", pageSize: 100 });
  const match = result.items.find((i) => i.base.displayName === displayName);
  return match?.base.id ?? null;
};

const ensureItem = async (
  subtype: ItemSubType,
  domainInfo: Record<string, unknown>,
): Promise<string> => {
  const displayName = domainInfo.display_name as string;
  const existing = await findExisting(subtype, displayName);
  if (existing) {
    console.log(`[seed] ${subtype} '${displayName}' already exists (${existing})`);
    return existing;
  }
  const created = await registry.createItem({ subtype, domainInfo, user: seedUser });
  console.log(`[seed] created ${subtype} '${displayName}' -> ${created.stored.base.id}`);
  return created.stored.base.id;
};

const waitForPendingJobs = async (timeoutMs = 30000): Promise<void> => {
  const jobs = makeJobRepo(getDb());
  const start = Date.now();
  for (;;) {
    const recent = await jobs.list({ username: SEED_USERNAME, limit: 50 });
    const pending = recent.jobs.filter(
      (j) => j.status === "PENDING" || j.status === "DEQUEUED" || j.status === "IN_PROGRESS",
    );
    if (pending.length === 0) return;
    if (Date.now() - start > timeoutMs) {
      console.warn(`[seed] timed out waiting for ${pending.length} background job(s)`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
};

const main = async (): Promise<void> => {
  const { links, storage } = getContainer();

  registerAllJobHandlers();
  await startWorker({ batchSize: 5 });

  /* 1. Person + user link (required for most registry write operations). */
  const personId = await ensureItem("PERSON", {
    display_name: "Demo Modeller",
    email: "demo.modeller@provena.local",
    first_name: "Demo",
    last_name: "Modeller",
    orcid: null,
    ethics_approved: true,
    user_metadata: null,
  });
  if (!(await links.lookup(SEED_USERNAME))) {
    await links.assign(SEED_USERNAME, personId);
    console.log(`[seed] linked ${SEED_USERNAME} -> ${personId}`);
  }

  /* 2. Agents + entities. */
  const orgId = await ensureItem("ORGANISATION", {
    display_name: "Demo Organisation",
    name: "Demo Organisation",
    ror: null,
    user_metadata: null,
  });

  const modelId = await ensureItem("MODEL", {
    display_name: "Demo Hydrology Model",
    name: "Demo Hydrology Model",
    description: "A demonstration model seeded for local development.",
    documentation_url: "https://docs.provena.io/demo-model",
    source_url: "https://github.com/provena/provena",
    user_metadata: null,
  });

  const datasetTemplateId = await ensureItem("DATASET_TEMPLATE", {
    display_name: "Demo Input Template",
    description: "Expected input data for the demo model.",
    defined_resources: [],
    deferred_resources: [],
    user_metadata: null,
  });

  const workflowTemplateId = await ensureItem("MODEL_RUN_WORKFLOW_TEMPLATE", {
    display_name: "Demo Workflow Template",
    software_id: modelId,
    input_templates: [{ template_id: datasetTemplateId, optional: null }],
    output_templates: [],
    annotations: null,
    user_metadata: null,
  });

  const studyId = await ensureItem("STUDY", {
    display_name: "Demo Study",
    title: "Demo Study",
    description: "A demonstration study grouping seeded model runs.",
    study_alternative_id: null,
    user_metadata: null,
  });
  void studyId;

  /* 3. Dataset (requires the object store - best effort). */
  let datasetId = await findExisting("DATASET", "Demo Dataset");
  if (!datasetId) {
    const collectionFormat = {
      associations: { organisation_id: orgId, data_custodian_id: personId },
      approvals: {
        ethics_registration: { relevant: false, obtained: false },
        ethics_access: { relevant: false, obtained: false },
        indigenous_knowledge: { relevant: false, obtained: false },
        export_controls: { relevant: false, obtained: false },
      },
      dataset_info: {
        name: "Demo Dataset",
        description: "A demonstration dataset seeded for local development.",
        access_info: { reposited: true },
        publisher_id: orgId,
        created_date: { relevant: true, value: "2024-01-01" },
        published_date: { relevant: false },
        license: "https://creativecommons.org/licenses/by/4.0/",
        keywords: ["demo", "seed"],
      },
    } as unknown as DatasetMetadata;
    try {
      await storage.ensureBucket();
      const minted = await datasets.mintDataset(collectionFormat, seedUser);
      datasetId = minted.handle;
      console.log(`[seed] created DATASET 'Demo Dataset' -> ${datasetId}`);
    } catch (error) {
      console.warn(
        `[seed] skipping dataset + model run (object store unavailable): ${(error as Error).message}`,
      );
    }
  } else {
    console.log(`[seed] DATASET 'Demo Dataset' already exists (${datasetId})`);
  }

  /* 4. Model run wiring it all together. */
  if (datasetId) {
    const { items } = getContainer();
    const runs = await items.listItems({ subtype: "MODEL_RUN", pageSize: 100 });
    const exists = runs.items.some((r) => r.base.displayName === "Demo Model Run");
    if (!exists) {
      const record: ModelRunRecord = {
        workflow_template_id: workflowTemplateId,
        inputs: [
          {
            dataset_template_id: datasetTemplateId,
            dataset_id: datasetId,
            dataset_type: "DATA_STORE",
          },
        ],
        outputs: [],
        display_name: "Demo Model Run",
        description: "A demonstration model run seeded for local development.",
        associations: { modeller_id: personId },
        start_time: Math.floor(Date.now() / 1000) - 3600,
        end_time: Math.floor(Date.now() / 1000),
      };
      const registered = await prov.registerModelRun({
        record,
        username: SEED_USERNAME,
      });
      console.log(`[seed] created MODEL_RUN 'Demo Model Run' -> ${registered.id}`);
    } else {
      console.log("[seed] MODEL_RUN 'Demo Model Run' already exists");
    }
  }

  await waitForPendingJobs();
  console.log("[seed] complete");
};

main()
  .then(async () => {
    await stopBoss();
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[seed] failed:", error);
    await stopBoss();
    await closeDb();
    process.exit(1);
  });
