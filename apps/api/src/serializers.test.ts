import { describe, expect, it } from "vitest";
import type { StoredItem } from "@provena/db";
import { serializeCompleteItem, serializeSeedItem } from "./serializers.js";

const baseRow = {
  id: "10378.1/1",
  itemCategory: "AGENT" as const,
  itemSubType: "ORGANISATION" as const,
  ownerUsername: "alice",
  createdTimestamp: 100,
  updatedTimestamp: 200,
  recordType: "COMPLETE_ITEM" as const,
  displayName: "Org",
  userMetadata: null,
  versioningPreviousVersion: null,
  versioningVersion: null,
  versioningReason: null,
  versioningNextVersion: null,
  createActivityWorkflowId: null,
  versionActivityWorkflowId: null,
  searchText: null,
};

describe("serializers", () => {
  it("serializes complete items with record info + domain info + history", () => {
    const stored: StoredItem = {
      base: { ...baseRow },
      domainInfo: { display_name: "Org", name: "Org", ror: null, user_metadata: null },
      history: [
        { id: 0, timestamp: 100, reason: "Created item", username: "alice", item: { name: "Org" } },
      ],
    };
    const wire = serializeCompleteItem(stored);
    expect(wire).toMatchObject({
      id: "10378.1/1",
      owner_username: "alice",
      created_timestamp: 100,
      updated_timestamp: 200,
      item_category: "AGENT",
      item_subtype: "ORGANISATION",
      record_type: "COMPLETE_ITEM",
      display_name: "Org",
      name: "Org",
      workflow_links: null,
      versioning_info: null,
    });
    expect((wire.history as unknown[]).length).toBe(1);
  });

  it("serializes seed items with record info only (no display name)", () => {
    const stored: StoredItem = {
      base: { ...baseRow, recordType: "SEED_ITEM", displayName: null },
      domainInfo: null,
      history: [],
    };
    const wire = serializeSeedItem(stored);
    expect(wire.record_type).toBe("SEED_ITEM");
    expect(wire).not.toHaveProperty("display_name");
    expect(wire).not.toHaveProperty("history");
  });

  it("emits versioning info and workflow links when present", () => {
    const stored: StoredItem = {
      base: {
        ...baseRow,
        versioningVersion: 2,
        versioningPreviousVersion: "10378.1/0",
        versioningReason: "upgrade",
        createActivityWorkflowId: "session-1",
      },
      domainInfo: { display_name: "Org", name: "Org" },
      history: [],
    };
    const wire = serializeCompleteItem(stored);
    expect(wire.versioning_info).toEqual({
      previous_version: "10378.1/0",
      version: 2,
      reason: "upgrade",
      next_version: null,
    });
    expect(wire.workflow_links).toEqual({
      create_activity_workflow_id: "session-1",
      version_activity_workflow_id: null,
    });
  });
});
