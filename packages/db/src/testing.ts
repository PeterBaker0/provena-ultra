/**
 * Test helpers - create an isolated, migrated database for integration
 * tests. Requires a reachable Postgres superuser connection (defaults to the
 * dev credentials used in docker-compose.dev.yml).
 */
import pg from "pg";
import { createDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://provena:provena@localhost:8432/provena";

export interface TestDatabase {
  db: Database;
  url: string;
  teardown: () => Promise<void>;
}

export const createTestDatabase = async (name?: string): Promise<TestDatabase> => {
  const dbName = (name ?? `provena_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const adminClient = new pg.Client({ connectionString: ADMIN_URL });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  await adminClient.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const testUrl = url.toString();

  await runMigrations(testUrl);
  const { db, pool } = createDb(testUrl);

  return {
    db,
    url: testUrl,
    teardown: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: ADMIN_URL });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await cleanup.end();
    },
  };
};
