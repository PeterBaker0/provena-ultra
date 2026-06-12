/**
 * Applies all pending drizzle migrations. Used by `pnpm db:migrate`, the
 * compose entrypoint, and integration test setup.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getConfig } from "@provena/config";
import { createDb } from "./client.js";

export const runMigrations = async (databaseUrl?: string): Promise<void> => {
  const url = databaseUrl ?? getConfig().DATABASE_URL;
  const { db, pool } = createDb(url);
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied successfully.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
