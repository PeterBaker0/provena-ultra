#!/usr/bin/env node
/**
 * Print browser-facing URLs for a given public hostname (dev port layout).
 *
 *   PUBLIC_HOST=adria.it.csiro.au pnpm env:public-urls
 *   pnpm env:public-urls adria.it.csiro.au
 */
const host = process.argv[2] ?? process.env.PUBLIC_HOST ?? "localhost";
const scheme = process.env.PUBLIC_HTTP_SCHEME ?? "http";
const base = `${scheme}://${host}`;
const realm = process.env.KC_REALM_NAME ?? process.env.VITE_KEYCLOAK_REALM ?? "provena";

const urls = {
  PUBLIC_HOST: host,
  CORS_ALLOWED_HOSTS: host === "localhost" ? "localhost" : `${host},localhost`,
  API_PUBLIC_URL: `${base}:8080`,
  KEYCLOAK_ISSUER: `${base}:8081/realms/${realm}`,
  KEYCLOAK_JWKS_URL: `http://localhost:8081/realms/${realm}/protocol/openid-connect/certs`,
  KEYCLOAK_PUBLIC_ISSUER: `${base}:8081/realms/${realm}`,
  KC_ROOT_DOMAIN: host,
  STORAGE_PUBLIC_ENDPOINT: `${base}:9000`,
  VITE_AUTH_API_ENDPOINT: `${base}:8080/api/auth`,
  VITE_REGISTRY_API_ENDPOINT: `${base}:8080/api/registry`,
  VITE_DATA_STORE_API_ENDPOINT: `${base}:8080/api/data-store`,
  VITE_PROV_API_ENDPOINT: `${base}:8080/api/prov`,
  VITE_SEARCH_API_ENDPOINT: `${base}:8080/api/search`,
  VITE_JOB_API_ENDPOINT: `${base}:8080/api/job`,
  VITE_WARMER_API_ENDPOINT: `${base}:8080/api/warmer`,
  VITE_KEYCLOAK_AUTH_ENDPOINT: `${base}:8081`,
  VITE_LANDING_PAGE_LINK: `${base}:8001`,
  VITE_REGISTRY_LINK: `${base}:8002`,
  VITE_DATA_STORE_LINK: `${base}:8003`,
  VITE_PROV_STORE_LINK: `${base}:8004`,
};

console.log(
  [
    `# Browser-facing URLs for PUBLIC_HOST=${host}`,
    "# Copy into .env (keep DATABASE_URL, STORAGE_ENDPOINT, SMTP_HOST on localhost).",
    "",
    ...Object.entries(urls).map(([key, value]) => `${key}=${value}`),
    "",
    "# After changing KC_ROOT_DOMAIN, run: pnpm keycloak:prepare-realm",
    "# Rebuild UI images if using docker compose: docker compose up -d --build",
  ].join("\n"),
);
