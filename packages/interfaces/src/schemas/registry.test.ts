import { describe, expect, it } from "vitest";
import {
  accessInfoSchema,
  collectionFormatSchema,
  datasetTemplateDomainInfoSchema,
  organisationDomainInfoSchema,
  personDomainInfoSchema,
  temporalDurationInfoSchema,
  workflowTemplateDomainInfoSchema,
} from "./registry.js";
import { modelRunRecordSchema } from "./provenance.js";
import { expandRoles, ADMIN_ROLE, METADATA_READ_ROLE } from "../constants/roles.js";

describe("accessInfoSchema", () => {
  it("accepts reposited default", () => {
    const parsed = accessInfoSchema.parse({ reposited: true });
    expect(parsed.reposited).toBe(true);
  });
  it("requires uri + description when not reposited", () => {
    expect(() => accessInfoSchema.parse({ reposited: false })).toThrow();
    const ok = accessInfoSchema.parse({
      reposited: false,
      uri: "https://example.com/data",
      description: "hosted elsewhere",
    });
    expect(ok.uri).toBe("https://example.com/data");
  });
  it("rejects uri when reposited", () => {
    expect(() =>
      accessInfoSchema.parse({ reposited: true, uri: "https://example.com" }),
    ).toThrow();
  });
});

describe("temporalDurationInfoSchema", () => {
  it("enforces date ordering", () => {
    expect(() =>
      temporalDurationInfoSchema.parse({ begin_date: "2024-02-01", end_date: "2024-01-01" }),
    ).toThrow();
    expect(
      temporalDurationInfoSchema.parse({ begin_date: "2024-01-01", end_date: "2024-02-01" }),
    ).toBeTruthy();
  });
});

describe("collectionFormatSchema", () => {
  const valid = {
    associations: { organisation_id: "1234.5/org" },
    approvals: {
      ethics_registration: { relevant: false, obtained: false },
      ethics_access: { relevant: false, obtained: false },
      indigenous_knowledge: { relevant: false, obtained: false },
      export_controls: { relevant: false, obtained: false },
    },
    dataset_info: {
      name: "Test dataset",
      description: "A test dataset",
      access_info: { reposited: true },
      publisher_id: "1234.5/pub",
      created_date: { relevant: true, value: "2024-01-01" },
      published_date: { relevant: false },
      license: "https://creativecommons.org/licenses/by/4.0/",
    },
  };
  it("accepts a valid collection format", () => {
    const parsed = collectionFormatSchema.parse(valid);
    expect(parsed.dataset_info.name).toBe("Test dataset");
  });
  it("rejects relevant date without value", () => {
    const bad = structuredClone(valid);
    bad.dataset_info.created_date = { relevant: true } as never;
    expect(() => collectionFormatSchema.parse(bad)).toThrow();
  });
  it("rejects extra fields (strict)", () => {
    const bad = { ...valid, unexpected: 1 };
    expect(() => collectionFormatSchema.parse(bad)).toThrow();
  });
});

describe("domain info schemas", () => {
  it("validates organisations", () => {
    expect(
      organisationDomainInfoSchema.parse({ display_name: "Org", name: "Org" }).name,
    ).toBe("Org");
    expect(() =>
      organisationDomainInfoSchema.parse({ display_name: "Org", name: "Org", ror: "nope" }),
    ).toThrow();
  });
  it("validates people", () => {
    expect(() =>
      personDomainInfoSchema.parse({
        display_name: "P",
        email: "not-an-email",
        first_name: "A",
        last_name: "B",
      }),
    ).toThrow();
  });
  it("rejects duplicate deferred keys in dataset templates", () => {
    expect(() =>
      datasetTemplateDomainInfoSchema.parse({
        display_name: "T",
        deferred_resources: [
          { key: "a", description: "d", usage_type: "GENERAL_DATA" },
          { key: "a", description: "d2", usage_type: "GENERAL_DATA" },
        ],
      }),
    ).toThrow();
  });
  it("rejects duplicate template ids per end in workflow templates", () => {
    expect(() =>
      workflowTemplateDomainInfoSchema.parse({
        display_name: "W",
        software_id: "1234.5/model",
        input_templates: [{ template_id: "t1" }, { template_id: "t1" }],
      }),
    ).toThrow();
  });
});

describe("modelRunRecordSchema", () => {
  it("enforces start <= end", () => {
    expect(() =>
      modelRunRecordSchema.parse({
        workflow_template_id: "wt",
        inputs: [],
        outputs: [],
        display_name: "run",
        description: "desc",
        associations: { modeller_id: "person" },
        start_time: 100,
        end_time: 50,
      }),
    ).toThrow();
  });
});

describe("expandRoles", () => {
  it("expands admin to all item roles", () => {
    const expanded = expandRoles([ADMIN_ROLE]);
    expect(expanded.has(METADATA_READ_ROLE)).toBe(true);
    expect(expanded.has("dataset-data-write")).toBe(true);
    expect(expanded.size).toBe(5);
  });
});
