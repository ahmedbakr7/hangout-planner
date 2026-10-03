import { resolve } from "node:path";
import type { Sql } from "postgres";

// The key the per-file test setup already takes, so both serialize on one lock.
export const TEST_SCHEMA_LOCK_KEY = 60106;

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");

/**
 * Apply drizzle/0001_init.sql to the connection's current schema unless its tables
 * already exist. Concurrent callers serialize on one advisory lock, so the schema is
 * created once. Returns true when this call applied it.
 */
export async function applySchemaOnce(sql: Sql): Promise<boolean> {
  // Lock, check, migrate and unlock on one connection: advisory locks are per session.
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${TEST_SCHEMA_LOCK_KEY})`;
    try {
      const rows = await conn<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'accounts'
        ) AS exists
      `;
      if (rows[0]?.exists) {
        return false;
      }
      await conn.file(migrationPath);
      return true;
    } finally {
      await conn`SELECT pg_advisory_unlock(${TEST_SCHEMA_LOCK_KEY})`;
    }
  } finally {
    conn.release();
  }
}
