import { randomBytes } from "node:crypto";

export const ID_PREFIXES = [
  "acc_",
  "pln_",
  "win_",
  "stp_",
  "opt_",
  "prt_",
  "inv_",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

/** RFC 4648 base32 alphabet, lowercase. */
export const ID_BODY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const ID_BODY_LENGTH = 22;

export const JOIN_TOKEN_PREFIX = "jt_";
export const JOIN_TOKEN_BODY_LENGTH = 43;
export const JOIN_TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const DISTINGUISHER_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const DISTINGUISHER_LENGTH = 4;

const ID_PREFIX_SET: ReadonlySet<string> = new Set(ID_PREFIXES);
const ID_BODY_CHARS = new Set(ID_BODY_ALPHABET);
const JOIN_TOKEN_CHARS = new Set(JOIN_TOKEN_ALPHABET);
const DISTINGUISHER_CHARS = new Set(DISTINGUISHER_ALPHABET);

function randomChars(length: number, alphabet: string): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length - out.length);
    for (const byte of bytes) {
      if (byte >= limit) {
        continue;
      }
      out += alphabet[byte % n];
      if (out.length === length) {
        break;
      }
    }
  }
  return out;
}

function charsInAlphabet(value: string, alphabet: ReadonlySet<string>): boolean {
  for (const char of value) {
    if (!alphabet.has(char)) {
      return false;
    }
  }
  return true;
}

export function isIdPrefix(value: unknown): value is IdPrefix {
  return typeof value === "string" && ID_PREFIX_SET.has(value);
}

export function generateId(prefix: IdPrefix): string {
  if (!isIdPrefix(prefix)) {
    throw new Error(`unknown id prefix: ${String(prefix)}`);
  }
  return prefix + randomChars(ID_BODY_LENGTH, ID_BODY_ALPHABET);
}

export function isId(value: unknown, prefix?: IdPrefix): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const found = ID_PREFIXES.find((candidate) => value.startsWith(candidate));
  if (!found) {
    return false;
  }
  if (prefix !== undefined && found !== prefix) {
    return false;
  }
  const body = value.slice(found.length);
  return body.length === ID_BODY_LENGTH && charsInAlphabet(body, ID_BODY_CHARS);
}

export function generateJoinToken(): string {
  return JOIN_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function isJoinToken(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith(JOIN_TOKEN_PREFIX)) {
    return false;
  }
  const body = value.slice(JOIN_TOKEN_PREFIX.length);
  return (
    body.length === JOIN_TOKEN_BODY_LENGTH &&
    charsInAlphabet(body, JOIN_TOKEN_CHARS)
  );
}

export function generateDistinguisher(): string {
  return randomChars(DISTINGUISHER_LENGTH, DISTINGUISHER_ALPHABET);
}

export function isDistinguisher(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length === DISTINGUISHER_LENGTH &&
    charsInAlphabet(value, DISTINGUISHER_CHARS)
  );
}
