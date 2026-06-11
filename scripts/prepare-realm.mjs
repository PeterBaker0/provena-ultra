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
 * Output: docker/keycloak/import/realm.json (mounted into the compose
 * Keycloak with --import-realm).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const outDir = join(root, "docker/keycloak/import");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "realm.json");
writeFileSync(outPath, JSON.stringify(realm, null, 2));
console.log(`Wrote ${outPath} (realm '${REALM_NAME}', theme '${THEME_NAME}')`);
