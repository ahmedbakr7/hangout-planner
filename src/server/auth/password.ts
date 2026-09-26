import argon2 from "argon2";

type Argon2Params = {
  type: typeof argon2.argon2id;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

/** 64 MiB, 3 iterations, 1 lane. Above the OWASP argon2id floor. */
const PRODUCTION_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
}) satisfies Argon2Params;

/** Minimum-cost argon2id. Selected only when HP_HASH_TEST=1. */
const TEST_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 8,
  timeCost: 1,
  parallelism: 1,
  hashLength: 32,
}) satisfies Argon2Params;

export function passwordHashParams(): Argon2Params {
  // HP_HASH_TEST=1 is the only weaker parameter set. Tests set it; production does not.
  if (process.env.HP_HASH_TEST === "1") {
    return TEST_PARAMS;
  }
  return PRODUCTION_PARAMS;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string") {
    throw new Error("password must be a string");
  }
  return argon2.hash(password, { ...passwordHashParams() });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (typeof passwordHash !== "string" || typeof password !== "string") {
    throw new Error("password verify expects strings");
  }
  if (!passwordHash.startsWith("$argon2id$")) {
    return false;
  }
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
