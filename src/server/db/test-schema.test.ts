import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applySchemaOnce } from "./test-schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// Every table the migration declares, so "created once" is checked against the source of truth.
const migrationTables = [
  ...readFileSync(resolve(process.cwd(), "drizzle/0001_init.sql"), "utf8").matchAll(/CREATE TABLE "(\w+)"/g),
].map((m) => m[1]).sort();

const schema = `test_schema_${randomBytes(6).toString("hex")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

function client() {
  return postgres(databaseUrl!, { max: 1, onnotice: () => {}, connection: { search_path: schema } });
}

async function tablesInSchema(): Promise<string[]> {
  const rows = await admin<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema} ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

beforeAll(async () => {
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
});

afterAll(async () => {
  await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

describe("applySchemaOnce", () => {
  it("T-001-31/AC-1 creates the schema once when five connections race on an empty schema", async () => {
    const clients = Array.from({ length: 5 }, client);
    try {
      const applied = await Promise.all(clients.map((sql) => applySchemaOnce(sql)));
      expect(applied.filter(Boolean)).toHaveLength(1);
      expect(await tablesInSchema()).toEqual(migrationTables);
    } finally {
      await Promise.all(clients.map((sql) => sql.end()));
    }
  });

  it("T-001-31/AC-2 leaves an existing schema unchanged", async () => {
    const before = await tablesInSchema();
    expect(before).toEqual(migrationTables);
    const sql = client();
    try {
      await expect(applySchemaOnce(sql)).resolves.toBe(false);
    } finally {
      await sql.end();
    }
    expect(await tablesInSchema()).toEqual(before);
  });
});
