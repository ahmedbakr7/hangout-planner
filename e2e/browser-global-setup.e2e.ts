import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import setup from "../browser/global-setup";
import { cleanupThenClose } from "./db-cleanup";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// A fresh database, as CI starts with: the browser global setup is what has to create its schema.
const name = `hangout_t63_${randomBytes(6).toString("hex")}`;
const freshUrl = (() => {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
})();
const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
});

afterAll(() =>
  cleanupThenClose(
    async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
    () => admin.end(),
  ),
);

async function tableNames(): Promise<string[]> {
  const fresh = postgres(freshUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await fresh<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `;
    return rows.map((r) => r.table_name);
  } finally {
    await fresh.end();
  }
}

describe("browser global setup", () => {
  it("T-001-63/AC-2 creates the schema on a fresh database and a second run changes nothing", async () => {
    vi.stubEnv("DATABASE_URL", freshUrl);
    try {
      expect(await tableNames()).toEqual([]);
      await setup();
      const first = await tableNames();
      expect(first.length).toBeGreaterThan(0);
      await setup();
      expect(await tableNames()).toEqual(first);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects with DATABASE_URL is required when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    try {
      await expect(setup()).rejects.toThrow("DATABASE_URL is required");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
