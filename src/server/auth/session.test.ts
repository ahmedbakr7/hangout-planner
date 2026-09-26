import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "../clock";
import { generateJoinToken, isJoinToken } from "../ids";
import {
  AUTH_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  authCookieOptions,
  generateCookieToken,
  hashCookieToken,
  planJoinTokenForStorage,
  sessionExpiresAt,
} from "./session";

const originalSecure = process.env.HP_COOKIE_SECURE;

afterEach(() => {
  resetClock();
  if (originalSecure === undefined) {
    delete process.env.HP_COOKIE_SECURE;
  } else {
    process.env.HP_COOKIE_SECURE = originalSecure;
  }
});

describe("auth cookies", () => {
  it("sets httpOnly, SameSite=Lax, Path=/, and a 30-day sliding expiry", () => {
    delete process.env.HP_COOKIE_SECURE;
    setClock(new Date("2026-03-01T00:00:00.000Z"));

    expect(AUTH_COOKIE_NAMES).toEqual(["hp_session", "hp_guest", "hp_link"]);
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);

    for (const name of AUTH_COOKIE_NAMES) {
      expect(authCookieOptions(name)).toEqual({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
        maxAge: SESSION_MAX_AGE_SECONDS,
        expires: new Date("2026-03-31T00:00:00.000Z"),
      });
    }

    setClock(new Date("2026-03-11T08:30:00.000Z"));
    const slid = authCookieOptions("hp_session");
    expect(slid.expires.toISOString()).toBe("2026-04-10T08:30:00.000Z");
    expect(slid.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    expect(sessionExpiresAt().toISOString()).toBe("2026-04-10T08:30:00.000Z");
  });

  it("sets Secure only when HP_COOKIE_SECURE is exactly 1", () => {
    setClock(new Date("2026-03-01T00:00:00.000Z"));

    for (const value of [undefined, "", "0", "true", "yes"]) {
      if (value === undefined) {
        delete process.env.HP_COOKIE_SECURE;
      } else {
        process.env.HP_COOKIE_SECURE = value;
      }
      for (const name of AUTH_COOKIE_NAMES) {
        expect(authCookieOptions(name).secure).toBe(false);
      }
    }

    process.env.HP_COOKIE_SECURE = "1";
    for (const name of AUTH_COOKIE_NAMES) {
      const options = authCookieOptions(name);
      expect(options.secure).toBe(true);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.path).toBe("/");
    }
  });

  it("rejects an unknown cookie name", () => {
    expect(() => authCookieOptions("hp_locale" as "hp_session")).toThrow(
      /unknown auth cookie/,
    );
  });
});

describe("cookie token storage", () => {
  it("stores the SHA-256 of the cookie token and does not hash the plan join token", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const token = generateCookieToken();
      tokens.add(token);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isJoinToken(token)).toBe(false);

      const digest = hashCookieToken(token);
      expect(digest).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).not.toBe(token);
      expect(hashCookieToken(token)).toBe(digest);
    }
    expect(tokens.size).toBe(8);

    const joinToken = generateJoinToken();
    expect(isJoinToken(joinToken)).toBe(true);
    expect(planJoinTokenForStorage(joinToken)).toBe(joinToken);
    expect(planJoinTokenForStorage(joinToken)).not.toBe(hashCookieToken(joinToken));
  });

  it("rejects an empty cookie token or join token", () => {
    expect(() => hashCookieToken("")).toThrow(/cookie token/);
    expect(() => planJoinTokenForStorage("")).toThrow(/join token/);
  });
});
