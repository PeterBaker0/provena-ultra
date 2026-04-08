# @provena/landing-portal-ui

Migrated landing portal UI from legacy Provena, integrated into the pnpm/turbo monorepo.

## Development

From the repository root:

```bash
cp .env.dist .env
pnpm install
pnpm --filter @provena/landing-portal-ui dev
```

Default dev port: **3005**

## Build

```bash
pnpm --filter @provena/landing-portal-ui build
```

## Environment

This app expects Vite env vars from root `.env` (or this app's `.env.example`).
For local monolith development, all API endpoint vars should point to:

```txt
http://localhost:3000
```

Keycloak defaults should point to local Keycloak:

```txt
VITE_KEYCLOAK_AUTH_ENDPOINT=http://localhost:8080
VITE_KEYCLOAK_REALM=DEV
VITE_KEYCLOAK_CLIENT_ID=landing-portal-ui
```
