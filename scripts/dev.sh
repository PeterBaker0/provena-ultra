#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  echo "No .env file found. Copying .env.dist to .env"
  cp .env.dist .env
fi

corepack enable
pnpm install
pnpm dev
