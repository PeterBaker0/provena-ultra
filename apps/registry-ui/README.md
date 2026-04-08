# @provena/registry-ui

React/Vite frontend for the Registry experience in the Provena v2 monorepo.

## Development

From the workspace root:

```bash
pnpm --filter @provena/registry-ui dev
```

The app runs on `http://localhost:3002`.

## Build / Typecheck

```bash
pnpm --filter @provena/registry-ui typecheck
pnpm --filter @provena/registry-ui build
```

## Environment

- Copy root `.env.dist` to `.env`, or copy this package `.env.example` to `.env` for standalone runs.
- API endpoints should target the monolithic API (`http://localhost:3000`) in local development.
- This UI depends on `react-libs` from the workspace package at `packages/ui-shared` (no symlink step required).
