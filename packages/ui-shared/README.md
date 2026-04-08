# react-libs (`packages/ui-shared`)

Shared React/TypeScript library consumed by all migrated Provena UIs in this monorepo.

## Package role

- Centralises shared UI components, hooks, typed API clients, stores, and utilities.
- Preserves the legacy import contract (`react-libs`, `react-libs/*`) for compatibility.
- Is consumed as a pnpm workspace dependency (no symlink/preinstall hacks).

## Development

From repository root:

```bash
pnpm --filter react-libs build
pnpm --filter react-libs typecheck
```

## Consumption

UI apps depend on this package via:

```json
"react-libs": "workspace:*"
```

and import as:

```ts
import { keycloak, sentryInit } from "react-libs";
import { PageThemeConfig } from "react-libs/util/themeValidation";
```

## Required runtime environment variables

The shared package expects consuming UI environments to provide:

- API endpoints:
  - `VITE_AUTH_API_ENDPOINT`
  - `VITE_DATA_STORE_API_ENDPOINT`
  - `VITE_REGISTRY_API_ENDPOINT`
  - `VITE_PROV_API_ENDPOINT`
  - `VITE_SEARCH_API_ENDPOINT`
  - `VITE_JOB_API_ENDPOINT`
- Keycloak:
  - `VITE_KEYCLOAK_AUTH_ENDPOINT`
  - `VITE_KEYCLOAK_CLIENT_ID`
  - `VITE_KEYCLOAK_REALM`
- UI links:
  - `VITE_LANDING_PAGE_LINK`
  - `VITE_DATA_STORE_LINK`
  - `VITE_PROV_STORE_LINK`
  - `VITE_REGISTRY_LINK`
  - `VITE_DOCUMENTATION_BASE_LINK`
  - `VITE_CONTACT_US_LINK`
- Theme and monitoring:
  - `VITE_THEME_ID`
  - `VITE_SENTRY_DSN`
  - `VITE_GIT_COMMIT_ID`
  - `VITE_MONITORING_ENABLED`
  - `VITE_FEATURE_NUMBER`
  - `VITE_STAGE`
