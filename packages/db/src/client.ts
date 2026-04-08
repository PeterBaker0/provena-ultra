import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@provena/config";
import * as schema from "./schema";

let pool: Pool | undefined;

const createPool = (): Pool => {
  const env = getEnv();

  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
};

export const getDb = () => {
  if (!pool) {
    pool = createPool();
  }

  return drizzle(pool, { schema });
};

export type DbClient = ReturnType<typeof getDb>;
export type ProvenaDatabase = DbClient;

export const closeDb = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};
