# @provena/data-store-ui

Data Store frontend migrated from legacy Provena UI, now running as a pnpm workspace package in the v2 monorepo.

## Development

From repository root:

```bash
pnpm --filter @provena/data-store-ui dev
```

Default dev port: `3003`

## Build

From repository root:

```bash
pnpm --filter @provena/data-store-ui build
```

Output directory: `apps/data-store-ui/build`

## Environment

Use root `.env` (copy from `.env.dist`) for normal monorepo development:

```bash
cp .env.dist .env
```

This app also includes `apps/data-store-ui/.env.example` for app-local reference.

Important variables used by the UI/shared package:

- `VITE_DATA_STORE_API_ENDPOINT`
- `VITE_AUTH_API_ENDPOINT`
- `VITE_REGISTRY_API_ENDPOINT`
- `VITE_PROV_API_ENDPOINT`
- `VITE_SEARCH_API_ENDPOINT`
- `VITE_JOB_API_ENDPOINT`
- `VITE_KEYCLOAK_AUTH_ENDPOINT`
- `VITE_KEYCLOAK_CLIENT_ID`
- `VITE_KEYCLOAK_REALM`
- `VITE_THEME_ID`

In local development defaults, all API endpoints should point to monolith API at `http://localhost:3000`.
