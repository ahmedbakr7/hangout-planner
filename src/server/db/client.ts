import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Create a Drizzle client for PostgreSQL.
 * Reads DATABASE_URL from the environment when no url is passed.
 */
export function createDb(url: string | undefined = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const client = postgres(url);
  return drizzle(client);
}
