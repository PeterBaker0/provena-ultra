# Provena Platform v2 (TypeScript Monorepo)

Self-hostable re-architecture of the legacy Provena platform using:

- pnpm + Turbo monorepo
- TypeScript across backend and frontend packages
- Monolithic Hono API (`apps/api`)
- PostgreSQL + Drizzle (`packages/db`)
- PostgreSQL-backed queue workers with `pg-boss` (`apps/worker`, `packages/queue`)
- S3-compatible object storage adapter (`packages/storage`)
- Migrated frontend applications (`apps/*-ui`) backed by shared `react-libs` (`packages/ui-shared`)

## Repository layout

```txt
apps/
  api/
  worker/
  registry-ui/
  data-store-ui/
  prov-ui/
  landing-portal-ui/
packages/
  ui-shared/   # package name: react-libs
  ...
```

## Quick start (local development)

1. Copy environment file:

```bash
cp .env.dist .env
```

2. Install dependencies:

```bash
pnpm install
```

3. Run everything in dev mode:

```bash
pnpm dev
```

or use the helper script:

```bash
pnpm dev:all
```

## Run specific services/apps

```bash
pnpm --filter @provena/api dev
pnpm --filter @provena/worker dev
pnpm --filter @provena/registry-ui dev
pnpm --filter @provena/data-store-ui dev
pnpm --filter @provena/prov-ui dev
pnpm --filter @provena/landing-portal-ui dev
```

Default local ports:

- API: `3000`
- Registry UI: `3002`
- Data Store UI: `3003`
- Provenance UI: `3004`
- Landing Portal UI: `3005`

## Typecheck and build

```bash
pnpm typecheck
pnpm build
```

## Database (Drizzle)

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:push
```

## Docker Compose (production-like local stack)

The compose stack includes:

- PostgreSQL
- Keycloak
- S3-compatible object storage service
- MailPit (SMTP dev sink)
- API
- Worker
- UI applications

Run:

```bash
cp .env.dist .env
docker compose up -d
```

or use:

```bash
pnpm compose:up
```

## UI environment notes

- Root `.env` (from `.env.dist`) is used by the UI apps through Vite `envDir` configuration.
- API endpoints default to the monolith (`http://localhost:3000`) to preserve compatibility routes.
- `VITE_WARMER_API_ENDPOINT` defaults to `http://localhost:3000/warmer` and is served by the API compatibility endpoint.

## CI

GitHub Actions workflow is included at `.github/workflows/ci.yml` and validates:

- install
- typecheck
- build

## Notes on storage backend

The storage abstraction is built around S3-compatible APIs. For production, the intended target is Ceph RGW-compatible deployment; the local compose stack uses a compatible object-store service for convenience.
