# Provena Platform (v2)

Self-hostable re-architecture of [Provena](https://github.com/provena/provena) as an
all-TypeScript monorepo. The legacy system (kept for reference in `provena/`) was a suite of
Python FastAPI microservices on AWS (DynamoDB, Neo4j, S3/STS, SNS/SQS/ECS jobs, OpenSearch).
This version provides feature parity without any AWS dependency:

| Concern            | Legacy                          | v2                                            |
| ------------------ | ------------------------------- | --------------------------------------------- |
| APIs               | 7 FastAPI lambdas               | 1 monolithic [Hono](https://hono.dev) API     |
| Database           | DynamoDB + Neo4j                | PostgreSQL (sole DB), Drizzle ORM             |
| Graph queries      | Neo4j / Cypher                  | Relational edge table + recursive CTEs        |
| Background jobs    | SNS/SQS/ECS "job system"        | pg-boss (Postgres queue) + typed tasks        |
| Search             | OpenSearch                      | Postgres full-text search                     |
| Object storage     | AWS S3 + STS federation         | Any S3+STS store (RustFS default)             |
| Identity           | Keycloak                        | Keycloak (unchanged, reused as-is)            |
| Handles (IDs)      | ARDC Handle Service             | Internal minting (configurable prefix)        |
| Email              | SES                             | SMTP (nodemailer)                             |
| Frontends          | 4 React UIs + react-libs        | Same UIs, as pnpm workspace packages          |

The HTTP API surface is kept compatible with the legacy services so existing client tools and
the UIs continue to work — each legacy service maps to a base path of the monolith
(`/api/registry`, `/api/data-store`, `/api/prov`, `/api/auth`, `/api/search`, `/api/handle`,
`/api/job`).

## Quickstart (dev)

```bash
cp .env.dist .env
pnpm install
pnpm infra:up        # postgres + keycloak + rustfs + mailpit (docker)
pnpm db:migrate
pnpm dev             # turbo: API + worker + all UIs
```

## Production

```bash
cp .env.dist .env    # adjust secrets/hosts
pnpm keycloak:prepare-realm
docker compose up -d --build
```

See `docs/` for architecture notes and the API surface compatibility checklist.
