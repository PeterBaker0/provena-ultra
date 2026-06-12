#!/usr/bin/env node
/**
 * Prepares the Keycloak realm import file from the legacy realm template
 * (provena/infrastructure/provena/keycloak/realms/DEV-realm.json),
 * substituting the same variables the legacy CDK deployment substituted:
 *
 *   KC_REALM_NAME    - realm name (default: provena)
 *   KC_ROOT_DOMAIN   - base domain used in client URL templates
 *   KC_DISPLAY_NAME  - display name
 *   KC_THEME_NAME    - login theme (default: keycloak built-in)
 *
 * Output: docker/keycloak/import/{realm}-realm.json (Keycloak 26 directory
 * import naming; mounted into compose Keycloak with --import-realm).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REALM_NAME = process.env.KC_REALM_NAME ?? "provena";
const ROOT_DOMAIN = process.env.KC_ROOT_DOMAIN ?? "localhost";
const DISPLAY_NAME = process.env.KC_DISPLAY_NAME ?? "Provena";
const THEME_NAME = process.env.KC_THEME_NAME ?? "keycloak";

const templatePath = join(
  root,
  "provena/infrastructure/provena/keycloak/realms/DEV-realm.json",
);
let content = readFileSync(templatePath, "utf8");

const replacements = [
  ["${KC_REALM_NAME}", REALM_NAME],
  ["${KC_ROOT_DOMAIN}", ROOT_DOMAIN],
  ["${KC_DISPLAY_NAME}", DISPLAY_NAME],
  ["${KC_THEME_NAME}", THEME_NAME],
];
for (const [needle, value] of replacements) {
  content = content.replaceAll(needle, value);
}

const realm = JSON.parse(content);

/*
 * KC16 -> KC26 adjustments:
 *  - drop keys no longer accepted on import
 *  - dev-friendly redirect/web origins for the UI clients are already "*"
 */
delete realm.defaultRoles; /* replaced by defaultRole composite in modern KC */

/*
 * Strip fixed internal UUIDs from nested resources (clients, roles, flows,
 * components). Keycloak regenerates them on import; keeping the legacy
 * export's UUIDs causes conflicts when importing alongside other realms.
 */
const stripIds = (node) => {
  if (Array.isArray(node)) {
    for (const entry of node) stripIds(entry);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "id" && typeof value === "string" && node !== realm) {
        delete node.id;
      } else {
        stripIds(value);
      }
    }
  }
};
for (const [key, value] of Object.entries(realm)) {
  if (key !== "id" && key !== "realm") stripIds(value);
}

/*
 * Keycloak 25+ no longer includes the `nonce` claim in access tokens, but the
 * legacy UIs use keycloak-js v21 which validates it there. Keycloak ships a
 * backwards-compatibility protocol mapper for exactly this case - attach it
 * to all public (browser) clients.
 */
const NONCE_MAPPER = {
  name: "nonce-backwards-compatible",
  protocol: "openid-connect",
  protocolMapper: "oidc-nonce-backwards-compatible-mapper",
  consentRequired: false,
  config: { "access.token.claim": "true" },
};
for (const client of realm.clients ?? []) {
  if (!client.publicClient) continue;
  client.protocolMappers = client.protocolMappers ?? [];
  if (!client.protocolMappers.some((m) => m.protocolMapper === NONCE_MAPPER.protocolMapper)) {
    client.protocolMappers.push(structuredClone(NONCE_MAPPER));
  }
}

/*
 * Dev user seeding (KC_SEED_DEV_USERS, default on): registers an admin user
 * holding every Provena realm role and a general test user. DISABLE THIS IN
 * PRODUCTION (`KC_SEED_DEV_USERS=false`) or change the passwords immediately.
 */
const ALL_PROVENA_ROLES = [
  "entity-registry-read",
  "entity-registry-write",
  "entity-registry-admin",
  "sys-admin-read",
  "sys-admin-write",
  "sys-admin-admin",
  "handle-read",
  "handle-write",
  "handle-admin",
  "job-service-read",
  "job-service-write",
  "job-service-admin",
];
const GENERAL_ROLES = ["entity-registry-read", "entity-registry-write"];

const seedDevUsers = (process.env.KC_SEED_DEV_USERS ?? "true") !== "false";
if (seedDevUsers) {
  const makeUser = (username, password, roles) => ({
    username,
    enabled: true,
    emailVerified: true,
    email: `${username}@provena.local`,
    firstName: username,
    lastName: "Dev",
    credentials: [{ type: "password", value: password, temporary: false }],
    realmRoles: roles,
  });
  realm.users = [
    ...(realm.users ?? []),
    makeUser(
      process.env.KC_DEV_ADMIN_USERNAME ?? "provena-admin",
      process.env.KC_DEV_ADMIN_PASSWORD ?? "admin",
      ALL_PROVENA_ROLES,
    ),
    makeUser(
      process.env.KC_DEV_USER_USERNAME ?? "provena-user",
      process.env.KC_DEV_USER_PASSWORD ?? "user",
      GENERAL_ROLES,
    ),
  ];
  console.warn(
    "WARNING: dev users seeded into the realm (KC_SEED_DEV_USERS=false to disable for production).",
  );
}

const outDir = join(root, "docker/keycloak/import");
const outPath = join(outDir, `${REALM_NAME}-realm.json`);
const legacyPath = join(outDir, "realm.json");
try {
  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  writeFileSync(outPath, JSON.stringify(realm, null, 2), { mode: 0o644 });
  chmodSync(outDir, 0o755);
  chmodSync(outPath, 0o644);
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath);
  }
} catch (error) {
  if (error && (error.code === "EACCES" || error.code === "EPERM")) {
    console.error(
      [
        `Permission denied writing ${outPath}.`,
        "",
        "This usually happens when `docker compose up` ran before this script:",
        "Docker creates missing bind-mount directories owned by root, so your",
        "user can no longer write into docker/keycloak/import.",
        "",
        "Fix it with ONE of:",
        `  sudo chown -R "$USER" ${outDir}`,
        `  sudo rm -rf ${outDir}    # it will be recreated by this script`,
        "",
        "then re-run: pnpm keycloak:prepare-realm",
      ].join("\n"),
    );
    process.exit(1);
  }
  throw error;
}
console.log(`Wrote ${outPath} (realm '${REALM_NAME}', theme '${THEME_NAME}')`);
