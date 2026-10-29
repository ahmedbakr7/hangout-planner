import { describe, expect, it } from "vitest";
import { parseError, readJson } from "./api-error";

describe("readJson", () => {
  it("returns the parsed body for a JSON response", async () => {
    const response = new Response(JSON.stringify({ a: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
    expect(await readJson(response)).toEqual({ a: 1 });
  });

  it("returns null for a body that is not JSON", async () => {
    expect(await readJson(new Response("<html>oops</html>"))).toBeNull();
  });

  it("returns null for an empty body", async () => {
    expect(await readJson(new Response(""))).toBeNull();
  });
});

describe("parseError", () => {
  it("returns no code, reason or fields for null", () => {
    expect(parseError(null)).toEqual({ fields: [] });
  });

  it("returns no code, reason or fields for a non-object body", () => {
    expect(parseError("error")).toEqual({ fields: [] });
    expect(parseError(42)).toEqual({ fields: [] });
    expect(parseError(undefined)).toEqual({ fields: [] });
  });

  it("returns no code, reason or fields when error is missing or not an object", () => {
    expect(parseError({})).toEqual({ fields: [] });
    expect(parseError({ error: "conflict" })).toEqual({ fields: [] });
    expect(parseError({ error: null })).toEqual({ fields: [] });
    expect(parseError({ error: 7 })).toEqual({ fields: [] });
  });

  it("reads a full envelope", () => {
    expect(
      parseError({
        error: {
          code: "conflict",
          reason: "plan_locked",
          fields: [{ path: "title", code: "required" }],
        },
      }),
    ).toEqual({
      code: "conflict",
      reason: "plan_locked",
      fields: [{ path: "title", code: "required" }],
    });
  });

  it("drops malformed fields entries and keeps the well-formed ones", () => {
    expect(
      parseError({
        error: {
          code: "validation_failed",
          fields: [
            { path: "title", code: "required" },
            { path: 1, code: "required" },
            { path: "title", code: 2 },
            { path: "title" },
            "junk",
            null,
            7,
            { path: "budget", code: "too_small" },
          ],
        },
      }),
    ).toEqual({
      code: "validation_failed",
      reason: undefined,
      fields: [
        { path: "title", code: "required" },
        { path: "budget", code: "too_small" },
      ],
    });
  });

  it("returns no fields when fields is not an array", () => {
    expect(
      parseError({ error: { code: "validation_failed", fields: "title" } }),
    ).toEqual({ code: "validation_failed", reason: undefined, fields: [] });
  });

  it("drops a code or reason that is not a string", () => {
    expect(parseError({ error: { code: 409, reason: 1 } })).toEqual({
      code: undefined,
      reason: undefined,
      fields: [],
    });
    expect(
      parseError({ error: { code: null, reason: "plan_locked" } }),
    ).toEqual({ code: undefined, reason: "plan_locked", fields: [] });
  });
});
