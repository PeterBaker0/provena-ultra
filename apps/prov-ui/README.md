# Provena Provenance UI (`@provena/prov-ui`)

The provenance UI is migrated into the monorepo and consumes shared UI code
from `react-libs` (workspace package in `packages/ui-shared`).

## Development

From repo root:

```bash
pnpm --filter @provena/prov-ui dev
```

Runs on port `3004`.

## Build

```bash
pnpm --filter @provena/prov-ui build
```

## Typecheck

```bash
pnpm --filter @provena/prov-ui typecheck
```

## Environment

Copy root `.env.dist` to `.env` for local monorepo development:

```bash
cp .env.dist .env
```

This app reads Vite variables from the root `.env` (via `envDir` in
`vite.config.ts`). See `.env.example` for app-specific defaults.

