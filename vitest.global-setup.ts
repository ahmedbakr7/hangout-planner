import postgres from "postgres";
import { applySchemaOnce } from "./src/server/db/test-schema";

// Runs once before any test file, so no file has to migrate a fresh database itself.
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return; // database tests fail on their own with "DATABASE_URL is required"
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await applySchemaOnce(sql);
  } finally {
    await sql.end();
  }
}
