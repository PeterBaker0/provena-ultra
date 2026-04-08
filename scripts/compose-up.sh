#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  echo "No .env file found. Copying .env.dist to .env"
  cp .env.dist .env
fi

node scripts/resolve-keycloak-dev-realm.mjs

docker compose up -d
