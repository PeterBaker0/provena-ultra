import path from "node:path";
import { loadEnv } from "vite";

/** Fallback Keycloak public client IDs when not set in root or app `.env` (see each app’s `.env.example`). */
const KEYCLOAK_CLIENT_DEFAULTS: Record<string, string> = {
  "registry-ui": "entity-registry-ui",
  "data-store-ui": "data-store-ui",
  "prov-ui": "provenance-store-ui",
  "landing-portal-ui": "landing-portal-ui",
};

/**
 * Merge monorepo root `.env` with optional `apps/<app>/.env*`, then expose all `VITE_*` on
 * `import.meta.env` so each UI can use its own Keycloak client while sharing root API URLs.
 */
export function viteMergedEnvDefine(mode: string, appDir: string): Record<string, string> {
  const root = path.resolve(appDir, "../..");
  const merged: Record<string, string> = {
    ...loadEnv(mode, root, ""),
    ...loadEnv(mode, appDir, ""),
  };
  const app = path.basename(appDir);
  if (!merged.VITE_KEYCLOAK_CLIENT_ID?.trim() && KEYCLOAK_CLIENT_DEFAULTS[app]) {
    merged.VITE_KEYCLOAK_CLIENT_ID = KEYCLOAK_CLIENT_DEFAULTS[app];
  }
  return Object.fromEntries(
    Object.entries(merged)
      .filter(([k]) => k.startsWith("VITE_"))
      .map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  );
}
