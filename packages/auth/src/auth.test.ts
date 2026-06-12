import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { overrideConfigForTesting } from "@provena/config";
import { signTestToken } from "./testTokens.js";
import { requireAllRoles, requireUser } from "./middleware.js";
import { describeAccessRoles, determineUserAccess, evaluateUserAccess } from "./itemAccess.js";
import { entityRegistryGuards } from "./components.js";
import type { AuthEnv } from "./types.js";

const SECRET = "test-secret-for-auth-tests";
let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

const makeApp = () => {
  restore = overrideConfigForTesting({ AUTH_TEST_SHARED_SECRET: SECRET });
  const app = new Hono<AuthEnv>();
  app.get("/general", requireUser(), (c) => c.json({ username: c.get("user").username }));
  app.get("/write", requireAllRoles(["entity-registry-read", "entity-registry-write"]), (c) =>
    c.json({ ok: true }),
  );
  return app;
};

describe("auth middleware", () => {
  it("rejects missing/invalid tokens", async () => {
    const app = makeApp();
    const noToken = await app.request("/general");
    expect(noToken.status).toBe(401);
    const badToken = await app.request("/general", {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(badToken.status).toBe(401);
    expect((await badToken.json()).detail).toBeTruthy();
  });

  it("accepts valid test tokens and extracts the user", async () => {
    const app = makeApp();
    const token = await signTestToken({ username: "alice", roles: ["x"], secret: SECRET });
    const res = await app.request("/general", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "alice" });
  });

  it("enforces ALL-roles semantics", async () => {
    const app = makeApp();
    const readOnly = await signTestToken({
      username: "bob",
      roles: ["entity-registry-read"],
      secret: SECRET,
    });
    const both = await signTestToken({
      username: "carol",
      roles: ["entity-registry-read", "entity-registry-write"],
      secret: SECRET,
    });
    expect(
      (await app.request("/write", { headers: { Authorization: `Bearer ${readOnly}` } })).status,
    ).toBe(401);
    expect(
      (await app.request("/write", { headers: { Authorization: `Bearer ${both}` } })).status,
    ).toBe(200);
  });

  it("rejects expired tokens", async () => {
    const app = makeApp();
    const token = await signTestToken({
      username: "dave",
      secret: SECRET,
      expiresInSeconds: -10,
    });
    const res = await app.request("/general", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("item access evaluation", () => {
  const settings = {
    owner: "alice",
    general: ["metadata-read"],
    groups: { g1: ["metadata-write"], g2: ["dataset-data-read"] },
  };
  const available = ["metadata-read", "metadata-write", "admin"];

  it("owner gets all available roles", () => {
    expect(
      describeAccessRoles({
        username: "alice",
        isRegistryAdmin: false,
        settings,
        userGroupIds: new Set(),
        availableRoles: available,
      }),
    ).toEqual(available);
  });

  it("admin override gets all available roles", () => {
    expect(
      describeAccessRoles({
        username: "rando",
        isRegistryAdmin: true,
        settings,
        userGroupIds: new Set(),
        availableRoles: available,
      }),
    ).toEqual(available);
  });

  it("merges general + group roles limited to available", () => {
    const roles = describeAccessRoles({
      username: "bob",
      isRegistryAdmin: false,
      settings,
      userGroupIds: new Set(["g1", "g2"]),
      availableRoles: available,
    });
    expect(roles.sort()).toEqual(["metadata-read", "metadata-write"]);
  });

  it("evaluateUserAccess matches ANY semantics", () => {
    expect(evaluateUserAccess(["a"], ["a", "b"])).toBe(true);
    expect(evaluateUserAccess(["c"], ["a", "b"])).toBe(false);
  });

  it("determineUserAccess only includes user's groups", () => {
    expect(determineUserAccess(settings, new Set(["g2"])).sort()).toEqual([
      "dataset-data-read",
      "metadata-read",
    ]);
  });
});

describe("component guards", () => {
  it("exposes the correct legacy role names", () => {
    expect(entityRegistryGuards.readRole).toBe("entity-registry-read");
    expect(entityRegistryGuards.writeRole).toBe("entity-registry-write");
    expect(entityRegistryGuards.adminRole).toBe("entity-registry-admin");
  });
});
