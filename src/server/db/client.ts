import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDb(url: string | undefined = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return drizzle(postgres(url));
}
