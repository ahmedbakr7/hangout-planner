import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import setup from "../vitest.global-setup";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationTables = [
  ...readFileSync(resolve(process.cwd(), "drizzle/0001_init.sql"), "utf8").matchAll(/CREATE TABLE "(\w+)"/g),
].map((m) => m[1]).sort();

// A fresh database, as CI starts with: the Vitest global setup is what has to create its schema.
const name = `hangout_t31_${randomBytes(6).toString("hex")}`;
const freshUrl = (() => {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
})();
const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
});

afterAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe("Vitest global setup on a fresh database", () => {
  it("T-001-31/AC-1 five concurrent runs create every migration table once and none fails", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = freshUrl;
    try {
      await expect(Promise.all(Array.from({ length: 5 }, () => setup()))).resolves.toHaveLength(5);
    } finally {
      process.env.DATABASE_URL = saved;
    }
    const fresh = postgres(freshUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await fresh<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
      `;
      expect(rows.map((r) => r.table_name)).toEqual(migrationTables);
    } finally {
      await fresh.end();
    }
  });
});
