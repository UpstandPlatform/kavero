import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

/**
 * `pglite:<folder>` (or `pglite:memory`) runs Postgres embedded in this process
 * (PGlite) — what the desktop app uses when no server database is configured.
 * Anything else is a normal Postgres connection string.
 */
export const PGLITE_PREFIX = "pglite:";

export function isEmbedded(url: string) {
  return url.startsWith(PGLITE_PREFIX);
}

const nodePostgres = (url: string) => drizzle(url, { relations });
export type Database = ReturnType<typeof nodePostgres>;

// One PGlite per data folder per process: Next.js loads route modules separately, and
// two instances on the same folder would corrupt it.
const embedded = ((globalThis as { __kaveroPglite?: Map<string, Database> }).__kaveroPglite ??= new Map());

export function createDb(env: DatabaseConfig): Database {
  const url = env.DATABASE_URL;
  if (!isEmbedded(url)) return nodePostgres(url);
  const dataDir = url.slice(PGLITE_PREFIX.length);
  let db = embedded.get(dataDir);
  if (!db) {
    const client = new PGlite(dataDir === "memory" ? undefined : dataDir);
    // Same query builder and dialect as node-postgres; only the driver differs.
    db = drizzlePglite({ client, relations }) as unknown as Database;
    embedded.set(dataDir, db);
  }
  return db;
}

/** Apply the SQL migrations in `folder` (packages/db/src/migrations), for either driver. */
export async function runMigrations(db: Database, url: string, folder: string) {
  if (isEmbedded(url)) await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder: folder });
  else await migratePg(db, { migrationsFolder: folder });
}
