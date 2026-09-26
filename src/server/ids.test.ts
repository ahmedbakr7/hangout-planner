import { describe, expect, it } from "vitest";
import {
  DISTINGUISHER_ALPHABET,
  DISTINGUISHER_LENGTH,
  ID_BODY_ALPHABET,
  ID_BODY_LENGTH,
  ID_PREFIXES,
  JOIN_TOKEN_BODY_LENGTH,
  JOIN_TOKEN_PREFIX,
  generateDistinguisher,
  generateId,
  generateJoinToken,
  isDistinguisher,
  isId,
  isIdPrefix,
  isJoinToken,
} from "./ids";

describe("id prefixes", () => {
  it("are acc_, pln_, win_, stp_, opt_, prt_, and inv_", () => {
    expect(ID_PREFIXES).toEqual([
      "acc_",
      "pln_",
      "win_",
      "stp_",
      "opt_",
      "prt_",
      "inv_",
    ]);
    for (const prefix of ID_PREFIXES) {
      expect(isIdPrefix(prefix)).toBe(true);
    }
    expect(isIdPrefix("jt_")).toBe(false);
    expect(isIdPrefix("acc")).toBe(false);
  });
});

describe("generateId / isId", () => {
  it("is prefix_ plus 22 lowercase base32 characters", () => {
    expect(ID_BODY_ALPHABET).toBe("abcdefghijklmnopqrstuvwxyz234567");
    expect(new Set(ID_BODY_ALPHABET).size).toBe(32);
    expect(ID_BODY_LENGTH).toBe(22);

    for (const prefix of ID_PREFIXES) {
      const id = generateId(prefix);
      expect(id.startsWith(prefix)).toBe(true);
      expect(id.length).toBe(prefix.length + ID_BODY_LENGTH);
      expect(isId(id)).toBe(true);
      expect(isId(id, prefix)).toBe(true);
      const body = id.slice(prefix.length);
      expect(body).toHaveLength(22);
      expect([...body].every((char) => ID_BODY_ALPHABET.includes(char))).toBe(
        true,
      );
    }
  });

  it("rejects the wrong prefix, length, case, or alphabet", () => {
    const body = "a".repeat(22);
    expect(isId(`acc_${body}`)).toBe(true);
    expect(isId(`acc_${body}`, "pln_")).toBe(false);
    expect(isId(`foo_${body}`)).toBe(false);
    expect(isId(`acc_${"a".repeat(21)}`)).toBe(false);
    expect(isId(`acc_${"a".repeat(23)}`)).toBe(false);
    expect(isId(`acc_${"A".repeat(22)}`)).toBe(false);
    expect(isId(`acc_${"0".repeat(22)}`)).toBe(false);
    expect(isId(`acc_${"8".repeat(22)}`)).toBe(false);
    expect(isId(`ACC_${body}`)).toBe(false);
    expect(isId(null)).toBe(false);
    expect(() => generateId("foo_" as (typeof ID_PREFIXES)[number])).toThrow(
      /unknown id prefix/,
    );
  });
});

describe("generateJoinToken / isJoinToken", () => {
  it("is jt_ plus 43 unpadded base64url characters", () => {
    const token = generateJoinToken();
    expect(token.startsWith(JOIN_TOKEN_PREFIX)).toBe(true);
    const body = token.slice(JOIN_TOKEN_PREFIX.length);
    expect(body).toHaveLength(JOIN_TOKEN_BODY_LENGTH);
    expect(body).toHaveLength(43);
    expect(body.includes("=")).toBe(false);
    expect(isJoinToken(token)).toBe(true);
    expect(/^[A-Za-z0-9_-]{43}$/.test(body)).toBe(true);
  });

  it("rejects padded, short, long, or non-base64url bodies", () => {
    const ok = "A".repeat(43);
    expect(isJoinToken(`jt_${ok}`)).toBe(true);
    expect(isJoinToken(`jt_${"A".repeat(42)}=`)).toBe(false);
    expect(isJoinToken(`jt_${"A".repeat(42)}`)).toBe(false);
    expect(isJoinToken(`jt_${"A".repeat(44)}`)).toBe(false);
    expect(isJoinToken(`jt_${"A".repeat(41)}+/`)).toBe(false);
    expect(isJoinToken(`JT_${ok}`)).toBe(false);
    expect(isJoinToken(ok)).toBe(false);
    expect(isJoinToken(null)).toBe(false);
  });
});

describe("generateDistinguisher / isDistinguisher", () => {
  it("is four characters from abcdefghjkmnpqrstuvwxyz23456789", () => {
    expect(DISTINGUISHER_ALPHABET).toBe("abcdefghjkmnpqrstuvwxyz23456789");
    expect(DISTINGUISHER_LENGTH).toBe(4);
    const distinguisher = generateDistinguisher();
    expect(distinguisher).toHaveLength(4);
    expect(
      [...distinguisher].every((char) => DISTINGUISHER_ALPHABET.includes(char)),
    ).toBe(true);
    expect(isDistinguisher(distinguisher)).toBe(true);
    expect(isDistinguisher("a3k9")).toBe(true);
  });

  it("rejects other lengths and ambiguous characters", () => {
    expect(isDistinguisher("a3k")).toBe(false);
    expect(isDistinguisher("a3k9z")).toBe(false);
    expect(isDistinguisher("A3k9")).toBe(false);
    expect(isDistinguisher("ai3k")).toBe(false);
    expect(isDistinguisher("al3k")).toBe(false);
    expect(isDistinguisher("ao3k")).toBe(false);
    expect(isDistinguisher("a03k")).toBe(false);
    expect(isDistinguisher("a13k")).toBe(false);
    expect(isDistinguisher(null)).toBe(false);
  });
});
