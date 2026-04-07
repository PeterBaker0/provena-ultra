#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  echo "No .env file found. Copying .env.dist to .env"
  cp .env.dist .env
fi

docker compose up -d
