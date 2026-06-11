import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../testing.js";
import { ensureSidecars, makeItemRepo, type ItemRepo } from "./items.js";
import { makeAuthRepo, makeLockRepo } from "./sidecars.js";
import { makeEdgeRepo, type EdgeRepo } from "./edges.js";
import { makeGroupRepo, makeHandleRepo, makeJobRepo, makeLinkRepo } from "./auxiliary.js";

let testDb: TestDatabase;
let items: ItemRepo;
let edges: EdgeRepo;

beforeAll(async () => {
  testDb = await createTestDatabase();
  items = makeItemRepo(testDb.db);
  edges = makeEdgeRepo(testDb.db);
});

afterAll(async () => {
  await testDb.teardown();
});

const organisationInfo = (name: string) => ({
  display_name: name,
  name,
  ror: null,
  user_metadata: null,
});

describe("itemRepo", () => {
  it("creates, fetches and updates a complete item with history", async () => {
    await items.createCompleteItem({
      id: "test.1/org1",
      subtype: "ORGANISATION",
      ownerUsername: "alice",
      domainInfo: organisationInfo("CSIRO"),
      historyUsername: "alice",
    });
    const fetched = await items.fetchItem("test.1/org1");
    expect(fetched).not.toBeNull();
    expect(fetched!.base.itemCategory).toBe("AGENT");
    expect(fetched!.domainInfo).toMatchObject({ display_name: "CSIRO", name: "CSIRO" });
    expect(fetched!.history).toHaveLength(1);

    const updated = await items.updateItem({
      id: "test.1/org1",
      domainInfo: organisationInfo("CSIRO Updated"),
      reason: "rename",
      username: "bob",
    });
    expect(updated.domainInfo).toMatchObject({ name: "CSIRO Updated" });
    expect(updated.history).toHaveLength(2);
    expect(updated.history[0]!.id).toBe(1);
    expect(updated.history[0]!.username).toBe("bob");
  });

  it("reverts to a previous history entry", async () => {
    const reverted = await items.revertItem({
      id: "test.1/org1",
      historyId: 0,
      reason: "revert to original",
      username: "alice",
    });
    expect(reverted.domainInfo).toMatchObject({ name: "CSIRO" });
    expect(reverted.history).toHaveLength(3);
  });

  it("supports seed items and promotion via update", async () => {
    await items.createSeedItem({ id: "test.1/seed1", subtype: "MODEL", ownerUsername: "alice" });
    const seed = await items.fetchItem("test.1/seed1");
    expect(seed!.base.recordType).toBe("SEED_ITEM");
    expect(seed!.domainInfo).toBeNull();

    await items.updateItem({
      id: "test.1/seed1",
      domainInfo: {
        display_name: "model",
        name: "model",
        description: "d",
        documentation_url: "https://example.com",
        source_url: "https://example.com",
        user_metadata: null,
      },
      reason: "complete",
      username: "alice",
    });
    const complete = await items.fetchItem("test.1/seed1");
    expect(complete!.base.recordType).toBe("COMPLETE_ITEM");
    expect(complete!.domainInfo).toMatchObject({ name: "model" });
  });

  it("lists with pagination cursors deterministically", async () => {
    for (let i = 0; i < 5; i += 1) {
      await items.createCompleteItem({
        id: `test.1/page${i}`,
        subtype: "PERSON",
        ownerUsername: "alice",
        domainInfo: {
          display_name: `Person ${i}`,
          email: `p${i}@example.com`,
          first_name: "P",
          last_name: `${i}`,
          orcid: null,
          ethics_approved: false,
          user_metadata: null,
        },
        historyUsername: "alice",
      });
    }
    const page1 = await items.listItems({
      subtype: "PERSON",
      sortType: "DISPLAY_NAME",
      ascending: true,
      pageSize: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.totalCount).toBe(5);
    expect(page1.paginationKey).not.toBeNull();
    const page2 = await items.listItems({
      subtype: "PERSON",
      sortType: "DISPLAY_NAME",
      ascending: true,
      pageSize: 2,
      paginationKey: page1.paginationKey,
    });
    const page3 = await items.listItems({
      subtype: "PERSON",
      sortType: "DISPLAY_NAME",
      ascending: true,
      pageSize: 2,
      paginationKey: page2.paginationKey,
    });
    const allNames = [...page1.items, ...page2.items, ...page3.items].map(
      (i) => i.base.displayName,
    );
    expect(allNames).toEqual(["Person 0", "Person 1", "Person 2", "Person 3", "Person 4"]);
    expect(page3.paginationKey).toBeNull();
  });

  it("searches items via FTS", async () => {
    await items.createCompleteItem({
      id: "test.1/searchable",
      subtype: "ORGANISATION",
      ownerUsername: "alice",
      domainInfo: organisationInfo("Quantum Hydrology Institute"),
      historyUsername: "alice",
    });
    const results = await items.searchItems("hydrology", {});
    expect(results.map((r) => r.id)).toContain("test.1/searchable");
    expect(results[0]!.score).toBeGreaterThan(0);
  });
});

describe("sidecars", () => {
  it("manages auth settings and locks", async () => {
    await ensureSidecars(testDb.db, "test.1/org1", "alice", ["metadata-read"]);
    const auth = makeAuthRepo(testDb.db);
    const settings = await auth.getAccessSettings("test.1/org1");
    expect(settings).toEqual({ owner: "alice", general: ["metadata-read"], groups: {} });

    await auth.putAccessSettings("test.1/org1", {
      owner: "alice",
      general: [],
      groups: { g1: ["metadata-read", "metadata-write"] },
    });
    const updated = await auth.getAccessSettings("test.1/org1");
    expect(updated!.groups.g1).toContain("metadata-write");

    const locks = makeLockRepo(testDb.db);
    expect(await locks.isLocked("test.1/org1")).toBe(false);
    await locks.setLocked("test.1/org1", true, {
      username: "alice",
      email: null,
      reason: "freeze",
      timestamp: 1,
    });
    expect(await locks.isLocked("test.1/org1")).toBe(true);
    const history = await locks.lockHistory("test.1/org1");
    expect(history).toHaveLength(1);
    expect(history[0]!.action_type).toBe("LOCK");
  });
});

describe("edgeRepo", () => {
  it("upserts edges with record attribution and traverses with depth limits", async () => {
    /*
     * Graph: run1 --used--> ds1, ds2 --wasGeneratedBy--> run1,
     *        run1 --wasAssociatedWith--> person1, ds1 --wasAttributedTo--> person1
     * Upstream from run1 should find ds1 + person1 at depth 1.
     */
    await edges.upsertEdges(
      [
        { sourceId: "run1", targetId: "ds1", relation: "used" },
        { sourceId: "ds2", targetId: "run1", relation: "wasGeneratedBy" },
        { sourceId: "run1", targetId: "person1", relation: "wasAssociatedWith" },
        { sourceId: "ds1", targetId: "person1", relation: "wasAttributedTo" },
      ],
      "run1",
    );

    const upstream1 = await edges.traverse("run1", 1, "upstream");
    const upstreamTargets = upstream1.map((r) => r.target_id).sort();
    expect(upstreamTargets).toEqual(["ds1", "person1"]);

    const upstream2 = await edges.traverse("run1", 2, "upstream");
    expect(upstream2).toHaveLength(3);

    const downstream = await edges.traverse("run1", 1, "downstream");
    expect(downstream.map((r) => r.source_id)).toEqual(["ds2"]);

    /* merging - second record asserting an existing edge */
    await edges.upsertEdges([{ sourceId: "run1", targetId: "ds1", relation: "used" }], "run2");
    const forRecord2 = await edges.edgesForRecord("run2");
    expect(forRecord2).toHaveLength(1);
    expect(forRecord2[0]!.recordIds.sort()).toEqual(["run1", "run2"]);

    /* removal - record removal only deletes solely-attributed edges */
    const removed = await edges.removeRecordEdges("run1");
    expect(removed).toHaveLength(3);
    const remaining = await edges.edgesForRecord("run2");
    expect(remaining).toHaveLength(1);
  });

  it("builds node_link_data graphs", async () => {
    const rows = await edges.traverse("run1", 2, "upstream");
    const graph = await edges.buildNodeLinkGraph(rows);
    expect(graph.directed).toBe(true);
    expect(graph.multigraph).toBe(false);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.links[0]).toHaveProperty("source");
    expect(graph.links[0]).toHaveProperty("type");
  });
});

describe("auxiliary repos", () => {
  it("groups CRUD + membership", async () => {
    const groups = makeGroupRepo(testDb.db);
    await groups.putGroup({ id: "g1", display_name: "Group 1", description: "d" });
    await groups.addMember("g1", { username: "alice", email: "a@example.com" });
    expect(await groups.isMember("g1", "alice")).toBe(true);
    expect((await groups.groupsForUser("alice")).map((g) => g.id)).toEqual(["g1"]);
    await groups.removeMember("g1", "alice");
    expect(await groups.isMember("g1", "alice")).toBe(false);
  });

  it("handles mint with sequence", async () => {
    const handles = makeHandleRepo(testDb.db);
    const id1 = await handles.mint("10378.1", { type: "DESC", value: "x", index: 1 });
    const id2 = await handles.mint("10378.1", { type: "DESC", value: "y", index: 1 });
    expect(id1).toMatch(/^10378\.1\/\d+$/);
    expect(id1).not.toBe(id2);
    const props = await handles.get(id1);
    expect(props![0]!.value).toBe("x");
  });

  it("job sessions lifecycle + listing", async () => {
    const jobs = makeJobRepo(testDb.db);
    const created = await jobs.create({
      username: "alice",
      jobType: "EMAIL",
      jobSubType: "SEND_EMAIL",
      payload: { email_to: "x@example.com" },
    });
    expect(created.status).toBe("PENDING");
    await jobs.setStatus(created.session_id, "SUCCEEDED", null, { ok: true });
    const fetched = await jobs.get(created.session_id);
    expect(fetched!.status).toBe("SUCCEEDED");
    expect(fetched!.result).toEqual({ ok: true });
    const listed = await jobs.list({ username: "alice" });
    expect(listed.jobs.map((j) => j.session_id)).toContain(created.session_id);
  });

  it("user person links", async () => {
    const links = makeLinkRepo(testDb.db);
    await links.assign("alice", "test.1/person-alice");
    expect(await links.lookup("alice")).toBe("test.1/person-alice");
    expect(await links.reverseLookup("test.1/person-alice")).toEqual(["alice"]);
    await links.clear("alice");
    expect(await links.lookup("alice")).toBeNull();
  });
});
