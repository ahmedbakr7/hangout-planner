import { createDb } from "@/server/db/client";

type Database = ReturnType<typeof createDb>;

let database: Database | undefined;

export function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  await database.$client.end({ timeout: 5 });
  database = undefined;
}
