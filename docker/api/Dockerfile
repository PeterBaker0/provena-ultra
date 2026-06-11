# Multi-stage build for the Provena API / worker (monorepo aware).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @provena/api... --filter @provena/worker...
RUN pnpm --filter @provena/interfaces build \
    && pnpm --filter @provena/config build \
    && pnpm --filter @provena/db build \
    && pnpm --filter @provena/auth build \
    && pnpm --filter @provena/storage build \
    && pnpm --filter @provena/email build \
    && pnpm --filter @provena/jobs build \
    && pnpm --filter @provena/api build \
    && pnpm --filter @provena/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8080
# API by default; worker via: command: ["node", "apps/worker/dist/main.js"]
CMD ["node", "apps/api/dist/main.js"]
