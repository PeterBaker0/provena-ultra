/**
 * Background job handlers - the v2 replacements for the legacy ECS job
 * containers (registry jobs, prov lodge jobs, email service, report).
 * Registered into the @provena/jobs framework; run embedded in the API
 * process or in the standalone worker.
 */
import { registerJobHandler, submitJob } from "@provena/jobs";
import { jobSchemas, METADATA_READ_ROLE } from "@provena/interfaces";
import type { ItemSubType } from "@provena/interfaces/types/RegistryModels";
import type { ModelRunRecord } from "@provena/interfaces/types/ProvenanceModels";
import { ensureSidecars } from "@provena/db";
import { sendEmail } from "@provena/email";
import { getContainer } from "../container.js";
import * as prov from "./provService.js";
import * as registry from "./registryService.js";
import { generateReport } from "./reportService.js";

let registered = false;

export const registerAllJobHandlers = (): void => {
  if (registered) return;
  registered = true;

  /* ----------------------- REGISTRY job handlers ------------------------ */

  registerJobHandler("REGISTER_CREATE_ACTIVITY", async (rawPayload, context) => {
    const payload = jobSchemas.registryRegisterCreateActivityPayloadSchema.parse(rawPayload);
    const { items, db } = getContainer();

    const handle = await registry.mintHandle();
    await items.createCompleteItem({
      id: handle,
      subtype: "CREATE",
      ownerUsername: context.username,
      domainInfo: {
        display_name: `Created item ${payload.created_item_id}`,
        created_item_id: payload.created_item_id,
        user_metadata: null,
      },
      historyUsername: context.username,
      historyReason: "Seeding create activity",
    });
    await ensureSidecars(db, handle, context.username, [METADATA_READ_ROLE]);

    const { sessionId: lodgeSessionId } = await submitJob({
      username: context.username,
      jobSubType: "LODGE_CREATE_ACTIVITY",
      payload: {
        created_item_id: payload.created_item_id,
        creation_activity_id: handle,
        linked_person_id: payload.linked_person_id,
        created_item_subtype: payload.created_item_subtype,
      },
    });

    return { creation_activity_id: handle, lodge_session_id: lodgeSessionId };
  });

  registerJobHandler("REGISTER_VERSION_ACTIVITY", async (rawPayload, context) => {
    const payload = jobSchemas.registryRegisterVersionActivityPayloadSchema.parse(rawPayload);
    const { items, db } = getContainer();

    const handle = await registry.mintHandle();
    await items.createCompleteItem({
      id: handle,
      subtype: "VERSION",
      ownerUsername: context.username,
      domainInfo: {
        display_name: `(V${payload.version_number}) Version from ${payload.from_version_id} to ${payload.to_version_id}`,
        reason: payload.reason,
        from_item_id: payload.from_version_id,
        to_item_id: payload.to_version_id,
        new_version_number: payload.version_number,
        user_metadata: null,
      },
      historyUsername: context.username,
      historyReason: "Seeding version activity",
    });
    await ensureSidecars(db, handle, context.username, [METADATA_READ_ROLE]);

    const { sessionId: lodgeSessionId } = await submitJob({
      username: context.username,
      jobSubType: "LODGE_VERSION_ACTIVITY",
      payload: {
        from_version_id: payload.from_version_id,
        to_version_id: payload.to_version_id,
        version_activity_id: handle,
        linked_person_id: payload.linked_person_id,
        item_subtype: payload.item_subtype,
      },
    });

    return { version_activity_id: handle, lodge_session_id: lodgeSessionId };
  });

  /* ---------------------- PROV LODGE job handlers ----------------------- */

  registerJobHandler("LODGE_CREATE_ACTIVITY", async (rawPayload) => {
    const payload = jobSchemas.provLodgeCreationPayloadSchema.parse(rawPayload);
    const { edges } = getContainer();
    await edges.upsertEdges(
      prov.createActivityEdges({
        createdItemId: payload.created_item_id,
        createActivityId: payload.creation_activity_id,
        agentId: payload.linked_person_id,
      }),
      payload.creation_activity_id,
    );
    return {};
  });

  registerJobHandler("LODGE_VERSION_ACTIVITY", async (rawPayload) => {
    const payload = jobSchemas.provLodgeVersionPayloadSchema.parse(rawPayload);
    const { edges } = getContainer();
    await edges.upsertEdges(
      prov.versionActivityEdges({
        fromVersionId: payload.from_version_id,
        toVersionId: payload.to_version_id,
        versionActivityId: payload.version_activity_id,
        agentId: payload.linked_person_id,
      }),
      payload.version_activity_id,
    );
    return {};
  });

  registerJobHandler("MODEL_RUN_PROV_LODGE", async (rawPayload, context) => {
    const payload = jobSchemas.provLodgeModelRunPayloadSchema.parse(rawPayload);
    const record = await prov.registerModelRun({
      record: payload.record as ModelRunRecord,
      username: context.username,
      revalidate: payload.revalidate,
    });
    return { record };
  });

  registerJobHandler("MODEL_RUN_LODGE_ONLY", async (rawPayload) => {
    const payload = jobSchemas.provLodgeModelRunLodgeOnlyPayloadSchema.parse(rawPayload);
    const record = await prov.lodgeModelRunOnly({
      modelRunRecordId: payload.model_run_record_id,
      record: payload.record as ModelRunRecord,
      revalidate: payload.revalidate,
    });
    return { record };
  });

  registerJobHandler("MODEL_RUN_UPDATE", async (rawPayload, context) => {
    const payload = jobSchemas.provLodgeUpdatePayloadSchema.parse(rawPayload);
    const record = await prov.updateModelRun({
      modelRunRecordId: payload.model_run_record_id,
      updatedRecord: payload.updated_record as ModelRunRecord,
      reason: payload.reason,
      username: context.username,
      revalidate: payload.revalidate,
    });
    return { record };
  });

  registerJobHandler("MODEL_RUN_UPDATE_LODGE_ONLY", async (rawPayload, context) => {
    const payload = jobSchemas.provLodgeUpdateLodgeOnlyPayloadSchema.parse(rawPayload);
    await prov.updateModelRun({
      modelRunRecordId: payload.model_run_record_id,
      updatedRecord: payload.updated_record as ModelRunRecord,
      reason: "(System) Lodge-only model run update",
      username: context.username,
      revalidate: payload.revalidate,
    });
    return {};
  });

  registerJobHandler("MODEL_RUN_BATCH_SUBMIT", async (rawPayload, context) => {
    const payload = jobSchemas.provLodgeBatchSubmitPayloadSchema.parse(rawPayload);
    const batchId = context.batchId ?? context.sessionId;
    for (const record of payload.records) {
      await submitJob({
        username: context.username,
        jobSubType: "MODEL_RUN_PROV_LODGE",
        payload: { record, revalidate: true },
        batchId,
      });
    }
    return { batch_id: batchId };
  });

  /* --------------------------- EMAIL handler ---------------------------- */

  registerJobHandler("SEND_EMAIL", async (rawPayload) => {
    const payload = jobSchemas.emailSendEmailPayloadSchema.parse(rawPayload);
    await sendEmail({
      to: payload.email_to,
      subject: payload.subject,
      body: payload.body,
    });
    return {};
  });

  /* --------------------------- REPORT handler --------------------------- */

  registerJobHandler("GENERATE_REPORT", async (rawPayload, context) => {
    const payload = jobSchemas.reportGeneratePayloadSchema.parse(rawPayload);
    const { reportUrl } = await generateReport({
      id: payload.id,
      itemSubtype: payload.item_subtype as ItemSubType,
      depth: payload.depth,
      username: context.username,
    });
    return { report_url: reportUrl };
  });
};
