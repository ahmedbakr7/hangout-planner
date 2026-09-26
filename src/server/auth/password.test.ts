import { afterEach, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { hashPassword, passwordHashParams, verifyPassword } from "./password";

if (process.env.HP_HASH_TEST === "1") {
  throw new Error(
    "HP_HASH_TEST must be set inside tests only, not in the environment",
  );
}

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

  it("hashes with the strong parameters when HP_HASH_TEST is unset", async () => {
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
