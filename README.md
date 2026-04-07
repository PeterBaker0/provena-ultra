# Provena Platform v2 (TypeScript Monorepo)

Self-hostable re-architecture of the legacy Provena platform using:

- pnpm + Turbo monorepo
- TypeScript across backend and frontend packages
- Monolithic Hono API (`apps/api`)
- PostgreSQL + Drizzle (`packages/db`)
- PostgreSQL-backed queue workers with `pg-boss` (`apps/worker`, `packages/queue`)
- S3-compatible object storage adapter (`packages/storage`)
- Reused frontend environment contract with shell apps (`apps/*-ui`, `packages/ui-shared`)

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

You can also run specific apps:

```bash
pnpm --filter @provena/api dev
pnpm --filter @provena/worker dev
pnpm --filter @provena/registry-ui dev
pnpm --filter @provena/data-store-ui dev
pnpm --filter @provena/prov-ui dev
pnpm --filter @provena/landing-portal-ui dev
```

## Typecheck

```bash
pnpm typecheck
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

## Notes on storage backend

The storage abstraction is built around S3-compatible APIs. For production, the intended target is Ceph RGW-compatible deployment; the local compose stack uses a compatible object-store service for convenience.
