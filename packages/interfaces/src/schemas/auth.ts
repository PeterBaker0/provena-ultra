/**
 * Zod schemas for auth API requests, ported from legacy
 * `ProvenaInterfaces/AuthAPI.py`.
 */
import { z } from "zod";
import { nonEmptyString } from "./common.js";

export const requestStatusSchema = z.enum([
  "PENDING_APPROVAL",
  "APPROVED_PENDING_ACTION",
  "DENIED_PENDING_DELETION",
  "ACTIONED_PENDING_DELETION",
]);

export const REQUEST_STATUS_TO_USER_EXPLANATION: Record<
  z.infer<typeof requestStatusSchema>,
  string
> = {
  PENDING_APPROVAL: "request received, awaiting action",
  APPROVED_PENDING_ACTION: "request approved, action underway",
  DENIED_PENDING_DELETION: "request denied",
  ACTIONED_PENDING_DELETION: "request approved and completed",
};

/* Access report (request body of request-change) */

export const reportComponentRoleSchema = z.object({
  role_name: nonEmptyString,
  role_display_name: nonEmptyString,
  role_level: z.enum(["READ", "WRITE", "ADMIN"]),
  description: z.string(),
  intended_users: z.array(z.enum(["GENERAL", "ADMINISTRATOR"])),
  access_granted: z.boolean(),
});

export const reportAuthorisationComponentSchema = z.object({
  component_name: z.enum(["handle-service", "sys-admin", "entity-registry", "job-service"]),
  component_roles: z.array(reportComponentRoleSchema),
});

export const accessReportSchema = z.object({
  components: z.array(reportAuthorisationComponentSchema),
});

export const accessRequestStatusChangeSchema = z.object({
  username: nonEmptyString,
  request_id: z.number().int(),
  desired_state: requestStatusSchema,
  additional_note: z.string().nullish(),
});

export const deleteAccessRequestSchema = z.object({
  username: nonEmptyString,
  request_id: z.number().int(),
});

export const requestAddNoteSchema = z.object({
  note: nonEmptyString,
  username: nonEmptyString,
  request_id: z.number().int(),
});

/* Groups */

export const groupUserSchema = z.object({
  username: nonEmptyString,
  email: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
});

export const userGroupMetadataSchema = z.object({
  id: nonEmptyString,
  display_name: nonEmptyString,
  description: nonEmptyString,
  default_data_store_access: z.array(z.string()).nullish(),
});

export const userGroupSchema = userGroupMetadataSchema.extend({
  users: z.array(groupUserSchema),
});

export const removeMembersRequestSchema = z.object({
  group_id: nonEmptyString,
  member_usernames: z.array(nonEmptyString),
});

const groupsImportSettingsShape = {
  import_mode: z.enum([
    "ADD_ONLY",
    "ADD_OR_OVERWRITE",
    "OVERWRITE_ONLY",
    "SYNC_ADD_OR_OVERWRITE",
    "SYNC_DELETION_ALLOWED",
  ]),
  parse_items: z.boolean().default(true),
  allow_entry_deletion: z.boolean().default(false),
  trial_mode: z.boolean().default(true),
};

export const groupsImportRequestSchema = z.object({
  ...groupsImportSettingsShape,
  items: z.array(z.record(z.unknown())),
});

export const groupsRestoreRequestSchema = z.object({
  ...groupsImportSettingsShape,
});

/* Username <-> Person link service */

export const userLinkUserAssignRequestSchema = z.object({
  person_id: nonEmptyString,
});

export const userLinkUserValidateRequestSchema = z.object({
  person_id: nonEmptyString,
});

export const adminLinkUserAssignRequestSchema = z.object({
  username: nonEmptyString,
  person_id: nonEmptyString,
  validate_item: z.boolean().default(true),
  force: z.boolean().default(false),
});
