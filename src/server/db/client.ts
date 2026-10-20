import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDb(url: string | undefined = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return drizzle(postgres(url));
}

type Database = ReturnType<typeof createDb>;

let database: Database | undefined;

export function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  const current = database;
  if (!current) {
    return;
  }
  database = undefined;
  await current.$client.end({ timeout: 5 });
}
