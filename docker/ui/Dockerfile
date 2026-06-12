# Parameterised static build + nginx serve for any of the four UIs.
#   docker build -f docker/ui/Dockerfile --build-arg UI_NAME=registry-ui .
# VITE_* configuration is baked at build time from build args / .env file
# passed via compose.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

ARG UI_NAME
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/react-libs ./packages/react-libs
COPY apps/${UI_NAME} ./apps/${UI_NAME}
RUN pnpm install --frozen-lockfile --filter "@provena/${UI_NAME}..."

# Vite env (build-time)
ARG VITE_AUTH_API_ENDPOINT
ARG VITE_REGISTRY_API_ENDPOINT
ARG VITE_DATA_STORE_API_ENDPOINT
ARG VITE_PROV_API_ENDPOINT
ARG VITE_SEARCH_API_ENDPOINT
ARG VITE_JOB_API_ENDPOINT
ARG VITE_WARMER_API_ENDPOINT
ARG VITE_KEYCLOAK_AUTH_ENDPOINT
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID
ARG VITE_LANDING_PAGE_LINK
ARG VITE_REGISTRY_LINK
ARG VITE_DATA_STORE_LINK
ARG VITE_PROV_STORE_LINK
ARG VITE_THEME_ID=default
ARG VITE_STAGE=PROD
ARG VITE_DOCUMENTATION_BASE_LINK=https://docs.provena.io
ARG VITE_CONTACT_US_LINK=https://docs.provena.io/contact
ARG VITE_MONITORING_ENABLED=false
ARG VITE_GIT_COMMIT_ID=unknown

RUN pnpm --filter "@provena/${UI_NAME}" build

FROM nginx:1.27-alpine
ARG UI_NAME
COPY docker/ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/${UI_NAME}/build /usr/share/nginx/html
EXPOSE 80
