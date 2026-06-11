# Provena Platform (v2)

Self-hostable re-architecture of [Provena](https://github.com/provena/provena) as an
all-TypeScript monorepo. The legacy system (kept for reference in `provena/`) was a suite of
Python FastAPI microservices on AWS (DynamoDB, Neo4j, S3/STS federation, SNS/SQS/ECS job
system, OpenSearch). This version provides feature parity with **zero AWS dependencies**:

| Concern            | Legacy                          | v2                                            |
| ------------------ | ------------------------------- | --------------------------------------------- |
| APIs               | 7 FastAPI lambdas               | 1 monolithic [Hono](https://hono.dev) API     |
| Database           | DynamoDB + Neo4j                | PostgreSQL (sole DB), Drizzle ORM/migrations  |
| Graph queries      | Neo4j / Cypher                  | Relational edge table + recursive CTEs        |
| Background jobs    | SNS/SQS/ECS "job system"        | pg-boss (Postgres queue) + typed tasks        |
| Search             | OpenSearch                      | Postgres full-text search (+ trigram)         |
| Object storage     | AWS S3 + STS OIDC federation    | Any S3+STS store - RustFS default             |
| Identity           | Keycloak                        | Keycloak (unchanged, reused as-is)            |
| Handles (IDs)      | ARDC Handle Service             | Internal minting (configurable prefix)        |
| Email              | SES                             | SMTP (nodemailer; MailPit in dev)             |
| Frontends          | 4 React UIs + react-libs        | Same UIs, as pnpm workspace packages          |

The HTTP API surface is kept compatible with the legacy services so existing client tools and
the UIs keep working — each legacy service maps to a base path of the monolith
(see [docs/api-surface.md](docs/api-surface.md) for the full compatibility checklist):

```
auth-api       -> /api/auth          search-api     -> /api/search
registry-api   -> /api/registry      id-service-api -> /api/handle
data-store-api -> /api/data-store    job-api        -> /api/job
prov-api       -> /api/prov          warmer         -> /api/warmer (stub)
```

## Repository layout

```
apps/
  api/                 # monolithic Hono API (embedded worker by default)
  worker/              # standalone queue worker (same handlers)
  landing-portal-ui/   # legacy UIs as workspace packages
  registry-ui/  data-store-ui/  prov-ui/
packages/
  interfaces/          # shared wire types (generated from legacy pydantic) + zod schemas
  config/              # zod-validated env config
  db/                  # drizzle schema, migrations, repositories
  auth/                # Keycloak JWT verification + role guards + item access
  storage/             # S3 ops + STS credential broker (scoped short-lived creds)
  jobs/                # pg-boss task framework + legacy job-session compat
  email/               # SMTP
  react-libs/          # shared UI library (consumed as source by Vite)
docker/                # keycloak / api / ui images, compose support files
provena/               # legacy codebase (reference only - do not modify)
```

## Local development

Requirements: Node >= 22, pnpm >= 10, Docker (for infra), or locally-running
Postgres 16 + an S3/STS store.

```bash
cp .env.dist .env
pnpm install
pnpm keycloak:prepare-realm   # builds docker/keycloak/import/realm.json from the legacy template
pnpm infra:up                 # postgres + keycloak + rustfs + mailpit
pnpm db:migrate
pnpm dev                      # turbo: API (8080) + worker + 4 UIs (3001-3004)
```

- Landing portal: http://localhost:3001 · Registry: http://localhost:3002 ·
  Data store: http://localhost:3003 · Prov store: http://localhost:3004
- Keycloak: http://localhost:8081 (admin/admin in dev) · MailPit: http://localhost:8025
- Create dev users via the Keycloak admin console (realm `provena`), assigning the
  legacy realm roles (`entity-registry-read/write/admin`, `sys-admin-*`, `handle-*`,
  `job-service-*`).

## Production (docker compose)

```bash
cp .env.dist .env             # set secrets, public URLs, SMTP
pnpm keycloak:prepare-realm
docker compose up -d --build
```

The stack composes Postgres, Keycloak (legacy realm + restrict-client-auth SPI on
Keycloak 26), RustFS, the API, a dedicated worker, and the four UIs served by nginx.
Put a reverse proxy (Caddy/Traefik/nginx) in front for TLS + hostnames in real
deployments, and point the `VITE_*` endpoint vars at the public URLs before building.

## Object storage options

The data store needs an S3-compatible store **with STS `AssumeRole` + inline session
policies** (this powers Provena's scoped short-lived dataset credentials):

- **RustFS** (default in compose) - Apache 2.0, S3 + STS, MinIO migration path.
- **Ceph RGW** / **AWS S3** - work with the same broker, set `STORAGE_*` accordingly.
- **MinIO** (legacy images) - works, but its community edition is archived (2026).

Note: the session policies use fully-expanded S3 action names (no `s3:GetObject*`
wildcards) for RustFS compatibility - these are valid on all backends.

## Keycloak notes

- The realm is generated from the **legacy realm template** so all client ids, realm
  roles and authentication flows (including `restrict-client-auth`) are preserved -
  existing user federation/config can be migrated with standard Keycloak exports.
- The API validates RS256 JWTs against `KEYCLOAK_ISSUER`'s JWKS; role extraction
  (`realm_access.roles`) matches the legacy services.

## Testing

```bash
pnpm typecheck            # all packages, strict TS
pnpm test                 # unit tests
pnpm test:integration     # DB/storage/jobs/API integration suites
                          # (needs postgres + an S3/STS store; see .env.dist)
```

The API integration suite (`apps/api/src/api.itest.ts`) exercises the legacy-compatible
flows end-to-end: registry CRUD/locks/versioning with background activity jobs, dataset
minting + scoped credentials + release reviews, provenance registration + lineage
queries, CSV templates, report generation, search, groups, access requests and handles.
