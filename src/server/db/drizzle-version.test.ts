// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("drizzle-orm security patch", () => {
  it("T-001-81/AC-1 package.json declares drizzle-orm ^0.45.4 and the lockfile and installed package are 0.45.4 or later 0.45.x", () => {
    const pkg = readJson("package.json") as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["drizzle-orm"]).toBe("^0.45.4");

    const lock = readJson("package-lock.json") as {
      packages: Record<string, { version: string }>;
    };
    const lockedVersion = lock.packages["node_modules/drizzle-orm"].version;
    const [major, minor, patch] = lockedVersion.split(".").map(Number);
    expect(major).toBe(0);
    expect(minor).toBe(45);
    expect(patch).toBeGreaterThanOrEqual(4);

    const installed = readJson("node_modules/drizzle-orm/package.json") as {
      version: string;
    };
    expect(installed.version).toBe(lockedVersion);
  });

  it("T-001-81/AC-2 sql.identifier doubles a double quote inside a Postgres identifier", () => {
    const query = new PgDialect().sqlToQuery(
      sql`select ${sql.identifier('a"b')}`,
    );
    expect(query.sql).toBe('select "a""b"');
  });
});
