-- Dedicated database for Keycloak alongside the application database.
-- Runs only on first Postgres boot (empty volume). For existing volumes,
-- docker compose runs keycloak-db-init (ensure-keycloak-db.sh) instead.
CREATE DATABASE keycloak;
