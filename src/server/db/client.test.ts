import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createDb } from "./client";

vi.mock("postgres", () => ({
  default: vi.fn(() => ({})),
}));

const root = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("package.json", () => {
  const pkg = readJson("package.json") as {
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("declares Node 22 in engines", () => {
    expect(pkg.engines?.node).toBe("22");
  });

  it("has the locked dependency set", () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(
      [
        "argon2",
        "drizzle-orm",
        "next",
        "next-intl",
        "postgres",
        "react",
        "react-dom",
      ].sort(),
    );
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(
      [
        "@testing-library/react",
        "@types/node",
        "@types/react",
        "@types/react-dom",
        "drizzle-kit",
        "jsdom",
        "typescript",
        "vitest",
      ].sort(),
    );
  });

  it("does not include Tailwind, Prisma, NextAuth, or a second HTTP client", () => {
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const forbidden = [
      "tailwindcss",
      "@tailwindcss/postcss",
      "prisma",
      "@prisma/client",
      "next-auth",
      "axios",
      "ky",
      "got",
      "node-fetch",
      "superagent",
      "undici",
    ];
    expect(names.filter((name) => forbidden.includes(name))).toEqual([]);
  });
});

describe("tsconfig.json", () => {
  const tsconfig = readJson("tsconfig.json") as {
    compilerOptions?: { strict?: boolean; paths?: Record<string, string[]> };
  };

  it("is TypeScript strict and maps @/ to src/", () => {
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.paths?.["@/*"]).toEqual(["./src/*"]);
  });
});

describe("createDb", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    vi.mocked(postgres).mockClear();
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => createDb()).toThrow(/DATABASE_URL/);
    expect(postgres).not.toHaveBeenCalled();
  });

  it("reads DATABASE_URL and constructs a Drizzle client", () => {
    const url = "postgres://user:pass@127.0.0.1:5432/testdb";
    process.env.DATABASE_URL = url;
    const db = createDb();
    expect(postgres).toHaveBeenCalledWith(url);
    expect(db).toBeDefined();
  });

  it("accepts an explicit connection string", () => {
    delete process.env.DATABASE_URL;
    const url = "postgres://explicit@127.0.0.1:5432/db";
    createDb(url);
    expect(postgres).toHaveBeenCalledWith(url);
  });
});

describe("drizzle.config", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("reads DATABASE_URL", async () => {
    const url = "postgres://user:pass@127.0.0.1:5432/testdb";
    process.env.DATABASE_URL = url;
    vi.resetModules();
    const { default: config } = await import("../../../drizzle.config.ts");
    expect(config.dbCredentials).toMatchObject({ url });
  });
});
