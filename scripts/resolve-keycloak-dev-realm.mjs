#!/usr/bin/env node
/**
 * Mirrors legacy Provena `customise_realm_config` + `replace_keycloak_vars`
 * (provena/infrastructure/provena/component_constructs/keycloak_infrastructure.py):
 * replaces ${KC_REALM_NAME}, ${KC_ROOT_DOMAIN}, ${KC_DISPLAY_NAME}, ${KC_THEME_NAME}
 * in the realm JSON before Keycloak imports it.
 *
 * Other ${...} tokens (e.g. ${role_*}, ${client_*}) are left for Keycloak to resolve at import.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SOURCE = path.join(
  repoRoot,
  "provena/infrastructure/provena/keycloak/realms/DEV-realm.json",
);
const OUT_DIR = path.join(repoRoot, "docker/keycloak/import");
const OUT_FILE = path.join(OUT_DIR, "DEV-realm.json");

/** Same keys/order as legacy KeycloakReplacementList for local compose. */
const REPLACEMENTS = [
  ["KC_REALM_NAME", process.env.KC_REALM_NAME ?? "DEV"],
  ["KC_ROOT_DOMAIN", process.env.KC_ROOT_DOMAIN ?? "localhost"],
  ["KC_DISPLAY_NAME", process.env.KC_DISPLAY_NAME ?? "Provena Dev"],
  /** Custom theme folder under provena/.../keycloak/themes/ (baked into provena-keycloak:local image). */
  ["KC_THEME_NAME", process.env.KC_THEME_NAME ?? "default"],
];

function main() {
  let text = fs.readFileSync(SOURCE, "utf8");
  for (const [key, value] of REPLACEMENTS) {
    text = text.replaceAll(`\${${key}}`, value);
  }
  if (text.includes("${KC_")) {
    console.warn(
      "resolve-keycloak-dev-realm: warning: unresolved ${KC_...} placeholders remain",
    );
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, text, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, OUT_FILE)}`);
}

main();
