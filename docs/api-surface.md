# API Surface Compatibility Checklist

Each legacy service maps to a base path of the monolith. Set the legacy
endpoint env vars to these bases and all relative paths remain identical.

| Legacy service | Env var | v2 base path |
| -------------- | ------- | ------------ |
| auth-api | `VITE_AUTH_API_ENDPOINT` | `/api/auth` |
| registry-api | `VITE_REGISTRY_API_ENDPOINT` | `/api/registry` |
| data-store-api | `VITE_DATA_STORE_API_ENDPOINT` | `/api/data-store` |
| prov-api | `VITE_PROV_API_ENDPOINT` | `/api/prov` |
| search-api | `VITE_SEARCH_API_ENDPOINT` | `/api/search` |
| id-service-api | n/a (internal) | `/api/handle` |
| job-api | `VITE_JOB_API_ENDPOINT` | `/api/job` |
| warmer | `VITE_WARMER_API_ENDPOINT` | `/api/warmer` |

Legend: ✅ implemented + covered by integration tests · ⚠️ implemented with noted differences · ❌ intentionally dropped (rationale given)

## registry-api (`/api/registry`)

Per-subtype routers at `/registry/<category>/<subtype>` for: `agent/organisation`,
`agent/person`, `entity/model`, `entity/model_run_workflow`, `entity/dataset_template`,
`entity/dataset`, `activity/study`, `activity/create`, `activity/version`,
`activity/model_run`.

| Route | Status | Notes |
| ----- | ------ | ----- |
| `GET /registry/<t>/fetch` | ✅ | incl. `seed_allowed`; roles/locked/item_is_seed in response |
| `POST /registry/<t>/list` | ✅ | sorts, filters, opaque pagination_key |
| `POST /registry/<t>/seed` | ✅ | standard subtypes only (as legacy) |
| `POST /registry/<t>/create` | ✅ | spawns Create activity job for versioning-enabled subtypes |
| `PUT /registry/<t>/update` | ✅ | `id`, `reason`, `exclude_history_update` query params; seed→complete spawns Create activity |
| `PUT /registry/<t>/revert` | ✅ | |
| `POST /registry/<t>/version` | ✅ | MODEL / MRWT / DATASET_TEMPLATE (+ DATASET via data-store) |
| `DELETE /registry/<t>/delete` | ✅ | registry-admin only |
| `GET /registry/<t>/schema` | ✅ | byte-identical legacy pydantic JSON schema (generated fixture) |
| `GET /registry/<t>/ui_schema` | ✅ | legacy UI schema overrides (generated fixture) |
| `POST /registry/<t>/validate` | ✅ | |
| `GET /registry/<t>/auth/evaluate` | ✅ | |
| `GET/PUT /registry/<t>/auth/configuration` | ✅ | owner change rejected (legacy parity) |
| `GET /registry/<t>/auth/roles` | ✅ | |
| `PUT /registry/<t>/locks/lock` / `unlock` | ✅ | item admin required |
| `GET /registry/<t>/locks/history` / `locked` | ✅ | |
| `*/proxy/seed|create|update|revert|version|fetch` | ❌ | legacy service-to-service proxy workflow removed by design; dataset/model-run management is in-process via `/api/data-store` and `/api/prov` |
| `POST /registry/general/list` | ✅ | extended filters incl. release status/reviewer |
| `GET /registry/general/fetch` | ✅ | untyped fetch |
| `DELETE /registry/general/delete` | ✅ | |
| `GET /registry/general/about/version` | ✅ | reports v2 version details |
| `POST /registry/entity/dataset/user/releases` | ✅ | reviewer-scoped pagination |
| `GET /admin/export` | ✅ | BundledItem shape (item/auth/lock payloads) |
| `POST /admin/import` | ✅ | all import modes, trial mode, statistics |
| `POST /admin/restore_from_table` | ❌ | DynamoDB-specific; returns 400 pointing at `/admin/import` |
| `POST /admin/restore-prov-graph` | ✅ | re-derives edges via lodge jobs |
| `GET /check-access/*` | ✅ | all four checks |
| `GET /admin/sentry-debug` | ❌ | Sentry-specific debug trigger dropped |
| `POST /admin/batch_create_junk` | ❌ | hidden legacy test fixture endpoint dropped |

## data-store-api (`/api/data-store`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `POST /metadata/validate-metadata` | ✅ | schema + field + linked-entity validation |
| `GET /metadata/dataset-schema` | ✅ | legacy CollectionFormat JSON schema fixture |
| `POST /register/mint-dataset` | ✅ | storage path seeding, metadata.json write, Create activity |
| `POST /register/update-metadata` | ✅ | `handle_id`/`reason` query params |
| `PUT /register/revert-metadata` | ✅ | preserves s3/release state |
| `POST /register/version` | ✅ | new storage location for new version |
| `POST /registry/items/list` | ✅ | |
| `GET /registry/items/fetch-dataset` | ✅ | `handle_id` query param |
| `POST /registry/items/generate-presigned-url` | ✅ | expiry 1s-24h |
| `POST /registry/credentials/generate-read-access-credentials` | ✅ | STS AssumeRole + scoped session policy (RustFS verified) |
| `POST /registry/credentials/generate-write-access-credentials` | ✅ | lock + release-state guards |
| | ⚠️ | `console_session_url` is `null` unless `STORAGE_CONSOLE_URL_TEMPLATE` configured (AWS console federation is AWS-only) |
| `GET /release/sys-reviewers/list` | ✅ | |
| `POST /release/sys-reviewers/add` | ✅ | validates Person |
| `DELETE /release/sys-reviewers/delete` | ✅ | |
| `POST /release/approval-request` | ✅ | emails approver |
| `PUT /release/action-approval-request` | ✅ | emails requester |
| `GET /check-access/*` | ✅ | |

## prov-api (`/api/prov`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `POST /model_run/register` | ✅ | async job, session_id response |
| `POST /model_run/register_sync` | ✅ | hidden legacy route kept |
| `POST /model_run/register_batch` | ✅ | batch_id-grouped child jobs |
| `POST /model_run/update` | ✅ | graph + record replacement job |
| `POST /model_run/edit/link_to_study` | ✅ | |
| `POST /model_run/delete` | ✅ | admin, trial mode diff |
| `GET /explore/upstream` / `downstream` | ✅ | depth default 2, max 10; node_link_data graph shape |
| `GET /explore/special/contributing_datasets` / `effected_datasets` | ✅ | path-filtered traversal |
| `GET /explore/special/contributing_agents` / `effected_agents` | ✅ | |
| `POST /explore/generate/report` | ✅ | DOCX via job; presigned report_url result |
| `GET /bulk/generate_template/csv` | ✅ | legacy header names preserved exactly |
| `POST /bulk/convert_model_runs/csv` | ✅ | multipart or raw body |
| `GET /bulk/regenerate_from_batch/csv` | ✅ | |
| `POST /admin/store_record(s)` | ✅ | |
| `POST /admin/store_all_registry_records` | ✅ | |
| `DELETE /graph/admin/clear` | ✅ | requires `i_am_sure=true` |
| `GET /check-access/*` | ✅ | |

## auth-api (`/api/auth`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `GET /check-access/public` / `general` | ✅ | |
| `GET /access-control/user/generate-access-report` | ✅ | |
| `POST /access-control/user/request-change` | ✅ | diff + email to `ACCESS_REQUEST_EMAIL_ADDRESS` |
| `GET /access-control/user/request-history` / `pending-request-history` | ✅ | |
| `GET /access-control/admin/all-request-history` / `all-pending-request-history` | ✅ | |
| `GET /access-control/admin/user-request-history` / `user-pending-request-history` | ✅ | |
| `POST /access-control/admin/add-note` | ✅ | |
| `POST /access-control/admin/change-request-state` | ✅ | optional email alert |
| `POST /access-control/admin/delete-request` | ✅ | |
| `GET /groups/user/*` (5 routes) | ✅ | member-only list_members (legacy parity) |
| `GET/POST/PUT/DELETE /groups/admin/*` (11 routes) | ✅ | |
| `GET /groups/admin/export`, `POST /groups/admin/import` | ✅ | |
| `POST /groups/admin/restore_from_table` | ❌ | DynamoDB-specific; 400 with guidance |
| `GET /link/user/lookup`, `POST /link/user/assign` / `validate` | ✅ | |
| `GET /link/admin/lookup` / `reverse_lookup`, `POST /link/admin/assign`, `DELETE /link/admin/clear` | ✅ | |

## search-api (`/api/search`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `GET /search/entity-registry` | ✅ | Postgres FTS + trigram; `{results: [{id, score}]}` |
| `GET /search/global` | ✅ | mixed result type decoration |
| `GET /check-access/*` | ✅ | |

## id-service-api (`/api/handle`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `POST /handle/mint` | ⚠️ | internal Postgres-backed minting (`HANDLE_PREFIX/<seq>`); ARDC dependency removed by design |
| `GET /handle/get` / `list` | ✅ | |
| `POST /handle/add_value` / `add_value_by_index` / `remove_by_index` | ✅ | |
| `PUT /handle/modify_by_index` | ✅ | |
| `GET /check-access/*` | ✅ | |

## job-api (`/api/job`)

| Route | Status | Notes |
| ----- | ------ | ----- |
| `GET /jobs/user/fetch` | ✅ | legacy JobStatusTable shape incl. `gsi_status` |
| `POST /jobs/user/list` / `list_batch` | ✅ | |
| `POST /jobs/user/retry` | ✅ | produces new session |
| `POST /jobs/admin/launch` | ✅ | payload validated per job sub type |
| `GET /jobs/admin/fetch`, `POST /jobs/admin/list` / `list_batch` / `retry` | ✅ | |
| `*_WAKE_UP` job types | ✅ | accepted; succeed immediately (no lambdas to warm) |
| `GET /check-access/*` | ✅ | |

## Cross-cutting differences

- **Error shape**: 4xx/5xx return `{"detail": ...}` (FastAPI compatible); zod
  validation failures return FastAPI-style 422 detail arrays.
- **Pagination keys** remain opaque JSON objects; internals are SQL cursors
  rather than DynamoDB keys (clients must treat them as opaque, as before).
- **Proxy routes & encrypted user contexts** are gone - they were artifacts of
  the service-to-service architecture.
- **Sentry debug endpoints** dropped; monitoring is env-optional.
