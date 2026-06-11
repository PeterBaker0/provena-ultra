/**
 * Job type configuration, ported from legacy `ProvenaInterfaces/AsyncJobModels.py`.
 */
import type { JobType, JobSubType } from "../types/AsyncJobModels.js";

export const JOB_TYPES: JobType[] = ["PROV_LODGE", "REGISTRY", "EMAIL", "REPORT"];

export const JOB_SUB_TYPES_BY_TYPE: Record<JobType, JobSubType[]> = {
  PROV_LODGE: [
    "PROV_LODGE_WAKE_UP",
    "MODEL_RUN_PROV_LODGE",
    "MODEL_RUN_LODGE_ONLY",
    "MODEL_RUN_BATCH_SUBMIT",
    "LODGE_CREATE_ACTIVITY",
    "LODGE_VERSION_ACTIVITY",
    "MODEL_RUN_UPDATE",
    "MODEL_RUN_UPDATE_LODGE_ONLY",
  ],
  REGISTRY: ["REGISTRY_WAKE_UP", "REGISTER_CREATE_ACTIVITY", "REGISTER_VERSION_ACTIVITY"],
  EMAIL: ["EMAIL_WAKE_UP", "SEND_EMAIL"],
  REPORT: ["GENERATE_REPORT"],
};

export const WAKE_UP_SUB_TYPES: JobSubType[] = [
  "PROV_LODGE_WAKE_UP",
  "REGISTRY_WAKE_UP",
  "EMAIL_WAKE_UP",
];

export const jobTypeForSubType = (subType: JobSubType): JobType => {
  for (const [jobType, subTypes] of Object.entries(JOB_SUB_TYPES_BY_TYPE)) {
    if (subTypes.includes(subType)) return jobType as JobType;
  }
  throw new Error(`Unknown job sub type ${subType}.`);
};
