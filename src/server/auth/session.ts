import { createHash, randomBytes } from "node:crypto";
import { now } from "../clock";

export const AUTH_COOKIE_NAMES = ["hp_session", "hp_guest", "hp_link"] as const;

export type AuthCookieName = (typeof AUTH_COOKIE_NAMES)[number];

export const SESSION_TTL_DAYS = 30;
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;
export const SESSION_TTL_MS = SESSION_MAX_AGE_SECONDS * 1000;

const COOKIE_TOKEN_BYTES = 32;

const AUTH_COOKIE_NAME_SET: ReadonlySet<string> = new Set(AUTH_COOKIE_NAMES);

export type AuthCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
  expires: Date;
};

export function sessionExpiresAt(): Date {
  return new Date(now().getTime() + SESSION_TTL_MS);
}

export function authCookieOptions(name: AuthCookieName): AuthCookieOptions {
  if (!AUTH_COOKIE_NAME_SET.has(name)) {
    throw new Error(`unknown auth cookie: ${String(name)}`);
  }
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.HP_COOKIE_SECURE === "1",
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: sessionExpiresAt(),
  };
}

export function generateCookieToken(): string {
  return randomBytes(COOKIE_TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of a cookie token for database storage. */
export function hashCookieToken(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("cookie token must be a non-empty string");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Plan join tokens are stored as issued so the organizer can keep showing the link.
 * This module does not hash them.
 */
export function planJoinTokenForStorage(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("join token must be a non-empty string");
  }
  return token;
}
