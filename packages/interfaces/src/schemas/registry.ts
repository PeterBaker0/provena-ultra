/**
 * Zod schemas for registry domain models.
 *
 * Ported from legacy `ProvenaInterfaces/RegistryModels.py`, including the
 * pydantic root validators. Field optionality follows the legacy models;
 * optional inputs accept `null | undefined`.
 */
import { z } from "zod";
import {
  anyUri,
  httpUrl,
  isoDate,
  iso8601Duration,
  nonEmptyString,
  unixTimestamp,
  userMetadata,
} from "./common.js";
import { modelRunRecordSchema } from "./provenance.js";

export const itemCategorySchema = z.enum(["ACTIVITY", "AGENT", "ENTITY"]);
export const itemSubTypeSchema = z.enum([
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
export const recordTypeSchema = z.enum(["SEED_ITEM", "COMPLETE_ITEM"]);
export const releasedStatusSchema = z.enum(["NOT_RELEASED", "PENDING", "RELEASED"]);
export const releaseActionSchema = z.enum(["REQUEST", "APPROVE", "REJECT"]);

/*
 * ---------------------------------------------------------------------------
 * Domain info bases
 * ---------------------------------------------------------------------------
 */

export const domainInfoBaseSchema = z.object({
  display_name: nonEmptyString,
  user_metadata: userMetadata.nullish(),
});

/*
 * ---------------------------------------------------------------------------
 * Agents
 * ---------------------------------------------------------------------------
 */

export const organisationDomainInfoSchema = domainInfoBaseSchema.extend({
  name: nonEmptyString,
  ror: httpUrl.nullish(),
});

export const personDomainInfoSchema = domainInfoBaseSchema.extend({
  email: z.string().email(),
  first_name: nonEmptyString,
  last_name: nonEmptyString,
  orcid: httpUrl.nullish(),
  ethics_approved: z.boolean().default(false),
});

/*
 * ---------------------------------------------------------------------------
 * Entities
 * ---------------------------------------------------------------------------
 */

export const modelDomainInfoSchema = domainInfoBaseSchema.extend({
  name: nonEmptyString,
  description: nonEmptyString,
  documentation_url: httpUrl,
  source_url: httpUrl,
});

export const templateResourceSchema = z.object({
  template_id: nonEmptyString,
  optional: z.boolean().nullish(),
});

export const workflowTemplateAnnotationsSchema = z
  .object({
    required: z.array(z.string()).default([]),
    optional: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    const keySet = new Set([...value.required, ...value.optional]);
    if (keySet.size !== value.required.length + value.optional.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provided required and/or optional field keys are non-unique.",
      });
    }
  });

const duplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
};

const uniqueTemplateIds = (
  templates: { template_id: string }[],
  ctx: z.RefinementCtx,
  path: string,
) => {
  const dupes = duplicates(templates.map((t) => t.template_id));
  if (dupes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `Cannot support duplicate templates being used twice in just input templates, or twice in just output templates. Duplicates: ${dupes.join(", ")}.`,
    });
  }
};

export const workflowTemplateDomainInfoSchema = domainInfoBaseSchema
  .extend({
    software_id: nonEmptyString,
    input_templates: z.array(templateResourceSchema).default([]),
    output_templates: z.array(templateResourceSchema).default([]),
    annotations: workflowTemplateAnnotationsSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    uniqueTemplateIds(value.input_templates, ctx, "input_templates");
    uniqueTemplateIds(value.output_templates, ctx, "output_templates");
  });

export const modelRunWorkflowTemplateDomainInfoSchema = workflowTemplateDomainInfoSchema;

export const resourceUsageTypeSchema = z.enum([
  "PARAMETER_FILE",
  "CONFIG_FILE",
  "FORCING_DATA",
  "GENERAL_DATA",
]);

export const definedResourceSchema = z.object({
  path: nonEmptyString,
  description: nonEmptyString,
  usage_type: resourceUsageTypeSchema,
  optional: z.boolean().nullish(),
  is_folder: z.boolean().nullish(),
  additional_metadata: z.record(z.string()).nullish(),
});

export const deferredResourceSchema = z.object({
  key: nonEmptyString,
  description: nonEmptyString,
  usage_type: resourceUsageTypeSchema,
  optional: z.boolean().nullish(),
  is_folder: z.boolean().nullish(),
  additional_metadata: z.record(z.string()).nullish(),
});

export const datasetTemplateDomainInfoSchema = domainInfoBaseSchema
  .extend({
    description: z.string().nullish(),
    defined_resources: z.array(definedResourceSchema).default([]),
    deferred_resources: z.array(deferredResourceSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const keys = new Set(value.deferred_resources.map((r) => r.key));
    if (keys.size !== value.deferred_resources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deferred_resources"],
        message: "Non unique resource_key properties in provided deferred resources.",
      });
    }
  });

/*
 * ---------------------------------------------------------------------------
 * Dataset collection format
 * ---------------------------------------------------------------------------
 */

export const collectionFormatAssociationsSchema = z
  .object({
    organisation_id: nonEmptyString,
    data_custodian_id: nonEmptyString.nullish(),
    point_of_contact: nonEmptyString.nullish(),
  })
  .strict();

export const optionallyRequiredCheckSchema = z.object({
  relevant: z.boolean().default(false),
  obtained: z.boolean().default(false),
});

export const collectionFormatApprovalsSchema = z
  .object({
    ethics_registration: optionallyRequiredCheckSchema,
    ethics_access: optionallyRequiredCheckSchema,
    indigenous_knowledge: optionallyRequiredCheckSchema,
    export_controls: optionallyRequiredCheckSchema,
  })
  .strict();

export const accessInfoSchema = z
  .object({
    reposited: z.boolean().default(true),
    uri: anyUri.nullish(),
    description: nonEmptyString.nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.reposited) {
      if (value.uri == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["uri"],
          message:
            "Must provide a URI for external access if data is not reposited in the Data Store.",
        });
      }
      if (value.description == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["description"],
          message:
            "Must provide a description for external access if data is not reposited in the Data Store.",
        });
      }
    } else {
      if (value.uri != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["uri"],
          message:
            "Cannot provide a URI for external access if data is reposited in the Data Store.",
        });
      }
      if (value.description != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["description"],
          message:
            "Cannot provide a description for external access if data is reposited in the Data Store.",
        });
      }
    }
  });

const optionallyRequiredDateSchema = z
  .object({
    relevant: z.boolean().default(false),
    value: isoDate.nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.relevant && value.value == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Must provide a date if the relevant field is set to True.",
      });
    }
    if (!value.relevant && value.value != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Cannot provide a date if the relevant field is set to False.",
      });
    }
  });

export const collectionFormatSpatialInfoSchema = z
  .object({
    coverage: nonEmptyString.max(50000).nullish(),
    resolution: nonEmptyString
      .nullish()
      .superRefine((value, ctx) => {
        if (value == null) return;
        const parsed = Number.parseFloat(value);
        if (Number.isNaN(parsed) || parsed <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Invalid spatial resolution. The value must conform to the Decimal Degrees format. Please provide a positive decimal value.",
          });
        }
      }),
    extent: nonEmptyString.max(50000).nullish(),
  })
  .strict();

export const temporalDurationInfoSchema = z
  .object({
    begin_date: isoDate,
    end_date: isoDate,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.begin_date > value.end_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Begin Date must be before or equal to End Date.",
      });
    }
  });

export const collectionFormatTemporalInfoSchema = z
  .object({
    duration: temporalDurationInfoSchema.nullish(),
    resolution: iso8601Duration.nullish(),
  })
  .strict();

export const collectionFormatDatasetInfoSchema = z
  .object({
    name: nonEmptyString,
    description: nonEmptyString,
    access_info: accessInfoSchema,
    publisher_id: nonEmptyString,
    created_date: optionallyRequiredDateSchema,
    published_date: optionallyRequiredDateSchema,
    license: httpUrl,
    purpose: nonEmptyString.nullish(),
    rights_holder: nonEmptyString.nullish(),
    usage_limitations: nonEmptyString.nullish(),
    preferred_citation: nonEmptyString.nullish(),
    spatial_info: collectionFormatSpatialInfoSchema.nullish(),
    temporal_info: collectionFormatTemporalInfoSchema.nullish(),
    formats: z.array(z.string()).nullish(),
    keywords: z.array(z.string()).nullish(),
    user_metadata: z.record(z.string()).nullish(),
    version: nonEmptyString.nullish(),
  })
  .strict();

export const collectionFormatSchema = z
  .object({
    associations: collectionFormatAssociationsSchema,
    approvals: collectionFormatApprovalsSchema,
    dataset_info: collectionFormatDatasetInfoSchema,
  })
  .strict();

export const s3LocationSchema = z.object({
  bucket_name: nonEmptyString,
  path: nonEmptyString,
  s3_uri: nonEmptyString,
});

export const releaseHistoryEntrySchema = z.object({
  action: releaseActionSchema,
  timestamp: unixTimestamp,
  approver: nonEmptyString,
  requester: nonEmptyString.nullish(),
  notes: z.string(),
});

export const datasetDomainInfoSchema = domainInfoBaseSchema
  .extend({
    collection_format: collectionFormatSchema,
    s3: s3LocationSchema,
    release_history: z.array(releaseHistoryEntrySchema).default([]),
    release_status: releasedStatusSchema,
    release_approver: nonEmptyString.nullish(),
    release_timestamp: unixTimestamp.nullish(),
    access_info_uri: z.string().nullish(),
  })
  .superRefine((value, ctx) => {
    const accessUri = value.collection_format.dataset_info.access_info.uri ?? null;
    const topLevelUri = value.access_info_uri ?? null;
    if (accessUri !== topLevelUri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["access_info_uri"],
        message: `access_info_uri must always match collection_format.access_info.uri. Got access_info_uri=${topLevelUri} and collection_format.access_info.uri=${accessUri}`,
      });
    }
    if ((value.release_approver == null) !== (value.release_timestamp == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["release_approver"],
        message:
          "Cannot provide a release activity timestamp without release approver and vice versa.",
      });
    }
  });

/*
 * ---------------------------------------------------------------------------
 * Activities
 * ---------------------------------------------------------------------------
 */

export const studyDomainInfoSchema = domainInfoBaseSchema.extend({
  title: nonEmptyString,
  description: nonEmptyString,
  study_alternative_id: nonEmptyString.nullish(),
});

export const createDomainInfoSchema = domainInfoBaseSchema.extend({
  created_item_id: nonEmptyString,
});

export const versionDomainInfoSchema = domainInfoBaseSchema.extend({
  reason: nonEmptyString,
  from_item_id: nonEmptyString,
  to_item_id: nonEmptyString,
  new_version_number: z.number().int(),
});

export const workflowRunCompletionStatusSchema = z.enum([
  "INCOMPLETE",
  "COMPLETE",
  "LODGED",
]);

export const modelRunDomainInfoSchema = domainInfoBaseSchema.extend({
  record_status: workflowRunCompletionStatusSchema,
  record: modelRunRecordSchema,
  prov_serialisation: z.string(),
});

/*
 * ---------------------------------------------------------------------------
 * Auth / lock sidecars
 * ---------------------------------------------------------------------------
 */

export const accessSettingsSchema = z.object({
  owner: nonEmptyString,
  general: z.array(z.string()),
  groups: z.record(z.array(z.string())),
});

export const lockActionTypeSchema = z.enum(["LOCK", "UNLOCK"]);

export const lockEventSchema = z.object({
  action_type: lockActionTypeSchema,
  username: nonEmptyString,
  email: z.string().nullish(),
  reason: z.string(),
  timestamp: unixTimestamp,
});

/*
 * ---------------------------------------------------------------------------
 * Domain info dispatch by subtype
 * ---------------------------------------------------------------------------
 */

export type DomainInfoSchema = z.ZodTypeAny;

import type { ItemSubType } from "../types/RegistryModels.js";

export const DOMAIN_INFO_SCHEMA_MAP: Partial<Record<ItemSubType, DomainInfoSchema>> = {
  ORGANISATION: organisationDomainInfoSchema,
  PERSON: personDomainInfoSchema,
  MODEL: modelDomainInfoSchema,
  MODEL_RUN_WORKFLOW_TEMPLATE: modelRunWorkflowTemplateDomainInfoSchema,
  DATASET_TEMPLATE: datasetTemplateDomainInfoSchema,
  DATASET: datasetDomainInfoSchema,
  STUDY: studyDomainInfoSchema,
  CREATE: createDomainInfoSchema,
  VERSION: versionDomainInfoSchema,
  MODEL_RUN: modelRunDomainInfoSchema,
};

export const domainInfoSchemaFor = (subtype: ItemSubType): DomainInfoSchema => {
  const schema = DOMAIN_INFO_SCHEMA_MAP[subtype];
  if (!schema) throw new Error(`No domain info schema for subtype ${subtype}.`);
  return schema;
};
