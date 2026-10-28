import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { hashPassword, passwordHashParams, verifyPassword } from "./password";

if (process.env.HP_HASH_TEST === "1") {
  throw new Error(
    "HP_HASH_TEST must be set inside tests only, not in the environment",
  );
}

// What the process inherited, read before any test or hook sets it.
const inheritedHashTest = process.env.HP_HASH_TEST;

const PRODUCTION = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

const TEST_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 8,
  timeCost: 1,
  parallelism: 1,
  hashLength: 32,
} as const;

function encodedParams(hash: string): { id: string; m: number; t: number; p: number } {
  const match = /^\$(argon2id)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  expect(match).not.toBeNull();
  return {
    id: match![1]!,
    m: Number(match![2]),
    t: Number(match![3]),
    p: Number(match![4]),
  };
}

afterEach(() => {
  delete process.env.HP_HASH_TEST;
});

describe("passwordHashParams", () => {
  it("uses strong argon2id parameters unless HP_HASH_TEST is exactly 1", () => {
    delete process.env.HP_HASH_TEST;
    expect(passwordHashParams()).toEqual(PRODUCTION);

    for (const value of ["", "0", "true", "yes", "2"]) {
      process.env.HP_HASH_TEST = value;
      expect(passwordHashParams()).toEqual(PRODUCTION);
    }

    process.env.HP_HASH_TEST = "1";
    expect(passwordHashParams()).toEqual(TEST_PARAMS);
    expect(TEST_PARAMS.type).toBe(argon2.argon2id);
    expect(PRODUCTION.type).toBe(argon2.argon2id);
  });
});

describe("HP_HASH_TEST", () => {
  it("T-001-91/AC-5 T-001-05/AC-2 HP_HASH_TEST=1 is the only weaker argon2 setting, and tests are the only place it is set", async () => {
    // Only HP_HASH_TEST=1 weakens: other values, and other likely knobs, keep the strong set.
    delete process.env.HP_HASH_TEST;
    const knobs = ["NODE_ENV", "HP_HASH_FAST", "ARGON2_MEMORY_COST", "ARGON2_TIME_COST", "VITEST"];
    const saved = Object.fromEntries(knobs.map((name) => [name, process.env[name]]));
    try {
      for (const name of knobs) {
        process.env[name] = name === "NODE_ENV" ? "test" : "1";
      }
      expect(passwordHashParams()).toEqual(PRODUCTION);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
    for (const value of ["", "0", "true", "yes", "2", " 1", "1 "]) {
      process.env.HP_HASH_TEST = value;
      expect(passwordHashParams()).toEqual(PRODUCTION);
    }
    process.env.HP_HASH_TEST = "1";
    expect(passwordHashParams()).toEqual(TEST_PARAMS);
    const weak = await hashPassword("a-secret-pass");
    expect(encodedParams(weak)).toEqual({ id: "argon2id", m: 8, t: 1, p: 1 });
    delete process.env.HP_HASH_TEST;

    // Tests are the only place it is set: the test process did not inherit it, and neither the
    // app's run scripts nor an env file set it.
    expect(inheritedHashTest).toBeUndefined();
    const root = process.cwd();
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const name of ["dev", "build", "start"]) {
      expect(manifest.scripts[name], name).toBeDefined();
      expect(manifest.scripts[name], name).not.toContain("HP_HASH_TEST");
    }
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development"]) {
      const path = resolve(root, file);
      if (!existsSync(path)) continue;
      const keys = readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.replace(/^export\s+/, "").split("=", 1)[0]!.trim());
      expect(keys, file).not.toContain("HP_HASH_TEST");
    }
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hashes with argon2id and verifies without trimming the password", async () => {
    process.env.HP_HASH_TEST = "1";
    const password = "a-secret-pass";
    const padded = ` ${password} `;
    const hash = await hashPassword(password);
    const paddedHash = await hashPassword(padded);

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(encodedParams(hash)).toEqual({ id: "argon2id", m: 8, t: 1, p: 1 });
    expect(hash).not.toBe(paddedHash);

    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, padded)).toBe(false);
    expect(await verifyPassword(paddedHash, padded)).toBe(true);
    expect(await verifyPassword(paddedHash, padded.trim())).toBe(false);
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("salts each hash", async () => {
    process.env.HP_HASH_TEST = "1";
    const password = "a-secret-pass";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, password)).toBe(true);
    expect(await verifyPassword(second, password)).toBe(true);
  });

  it("rejects hashes that are not argon2id", async () => {
    expect(
      await verifyPassword(
        "$argon2i$v=19$m=8,t=1,p=1$c2FsdA$aGFzaA",
        "a-secret-pass",
      ),
    ).toBe(false);
    expect(
      await verifyPassword(
        "$argon2d$v=19$m=8,t=1,p=1$c2FsdA$aGFzaA",
        "a-secret-pass",
      ),
    ).toBe(false);
    expect(await verifyPassword("$argon2id$not-a-digest", "a-secret-pass")).toBe(false);
    expect(await verifyPassword("", "a-secret-pass")).toBe(false);
  });

  it("T-001-91/AC-5 T-001-05/AC-1 hashes with the strong parameters when HP_HASH_TEST is unset", async () => {
    delete process.env.HP_HASH_TEST;
    expect(process.env.HP_HASH_TEST).not.toBe("1");

    const password = "a-secret-pass";
    const hash = await hashPassword(password);
    expect(encodedParams(hash)).toEqual({
      id: "argon2id",
      m: PRODUCTION.memoryCost,
      t: PRODUCTION.timeCost,
      p: PRODUCTION.parallelism,
    });
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, `${password} `)).toBe(false);
  });
});
