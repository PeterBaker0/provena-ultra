import { pgEnum } from "drizzle-orm/pg-core";

export const itemCategoryEnum = pgEnum("item_category", ["ACTIVITY", "AGENT", "ENTITY"]);

export const itemSubTypeEnum = pgEnum("item_subtype", [
  "WORKFLOW_RUN",
  "MODEL_RUN",
  "STUDY",
  "CREATE",
  "VERSION",
  "PERSON",
  "ORGANISATION",
  "SOFTWARE",
  "MODEL",
  "WORKFLOW_TEMPLATE",
  "MODEL_RUN_WORKFLOW_TEMPLATE",
  "DATASET",
  "DATASET_TEMPLATE",
]);

export const recordTypeEnum = pgEnum("record_type", ["SEED_ITEM", "COMPLETE_ITEM"]);

export const releasedStatusEnum = pgEnum("released_status", [
  "NOT_RELEASED",
  "PENDING",
  "RELEASED",
]);

export const workflowRunCompletionStatusEnum = pgEnum("workflow_run_completion_status", [
  "INCOMPLETE",
  "COMPLETE",
  "LODGED",
]);

export const lockActionTypeEnum = pgEnum("lock_action_type", ["LOCK", "UNLOCK"]);

export const provRelationEnum = pgEnum("prov_relation", [
  "wasInfluencedBy",
  "wasGeneratedBy",
  "used",
  "wasAttributedTo",
  "wasAssociatedWith",
  "actedOnBehalfOf",
]);

export const jobTypeEnum = pgEnum("job_type", ["PROV_LODGE", "REGISTRY", "EMAIL", "REPORT"]);

export const jobSubTypeEnum = pgEnum("job_sub_type", [
  "PROV_LODGE_WAKE_UP",
  "MODEL_RUN_PROV_LODGE",
  "MODEL_RUN_LODGE_ONLY",
  "MODEL_RUN_BATCH_SUBMIT",
  "LODGE_CREATE_ACTIVITY",
  "LODGE_VERSION_ACTIVITY",
  "MODEL_RUN_UPDATE",
  "MODEL_RUN_UPDATE_LODGE_ONLY",
  "REGISTRY_WAKE_UP",
  "REGISTER_CREATE_ACTIVITY",
  "REGISTER_VERSION_ACTIVITY",
  "EMAIL_WAKE_UP",
  "SEND_EMAIL",
  "GENERATE_REPORT",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "PENDING",
  "DEQUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING_APPROVAL",
  "APPROVED_PENDING_ACTION",
  "DENIED_PENDING_DELETION",
  "ACTIONED_PENDING_DELETION",
]);
