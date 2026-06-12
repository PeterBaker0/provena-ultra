import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getConfig } from "@provena/config";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Database | undefined;

export const getPool = (): pg.Pool => {
  if (!pool) {
    pool = new pg.Pool({ connectionString: getConfig().DATABASE_URL, max: 10 });
  }
  return pool;
};

export const getDb = (): Database => {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
};

/** Create an isolated client/db pair (used by tests and the migrator). */
export const createDb = (
  connectionString: string,
): { db: Database; pool: pg.Pool } => {
  const isolatedPool = new pg.Pool({ connectionString, max: 5 });
  return { db: drizzle(isolatedPool, { schema }), pool: isolatedPool };
};

export const closeDb = async (): Promise<void> => {
  await pool?.end();
  pool = undefined;
  db = undefined;
};
