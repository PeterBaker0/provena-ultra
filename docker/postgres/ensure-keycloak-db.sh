#!/bin/bash
# Creates the Keycloak database if missing. Safe on every compose up (idempotent).
set -euo pipefail
psql -v ON_ERROR_STOP=1 <<'EOSQL'
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
EOSQL
echo "keycloak database ready"
