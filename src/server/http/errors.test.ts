import { describe, expect, it } from "vitest";
import {
  ERROR_CODE_BY_STATUS,
  ERROR_STATUSES,
  FIELD_CODES,
  REASONS_BY_STATUS,
  httpError,
  isErrorStatus,
} from "./errors";

function envelopeJson(
  status: Parameters<typeof httpError>[0],
  init: Parameters<typeof httpError>[1],
) {
  return JSON.parse(JSON.stringify(httpError(status, init).body)) as {
    error: {
      code: string;
      reason?: string;
      message: string;
      fields: unknown;
    };
  };
}

describe("ERROR_STATUSES", () => {
  it("is only 400, 401, 403, 404, 409, 429, and 503", () => {
    expect(ERROR_STATUSES).toEqual([400, 401, 403, 404, 409, 429, 503]);
    for (const status of ERROR_STATUSES) {
      expect(isErrorStatus(status)).toBe(true);
    }
    expect(isErrorStatus(200)).toBe(false);
    expect(isErrorStatus(201)).toBe(false);
    expect(isErrorStatus(204)).toBe(false);
    expect(isErrorStatus(422)).toBe(false);
    expect(isErrorStatus(500)).toBe(false);
  });
});

describe("httpError envelope", () => {
  it("builds code, message, and fields, and fields is always an array", () => {
    const result = httpError(400, {
      message: "title is required",
      fields: [{ path: "title", code: "required" }],
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: {
        code: "validation_failed",
        message: "title is required",
        fields: [{ path: "title", code: "required" }],
      },
    });
    expect(Array.isArray(result.body.error.fields)).toBe(true);

    const empty = httpError(429, { message: "place search hour cap" });
    expect(empty.body.error.fields).toEqual([]);
    expect(Array.isArray(empty.body.error.fields)).toBe(true);

    const serialized = envelopeJson(503, { message: "places details failed" });
    expect(Array.isArray(serialized.error.fields)).toBe(true);
    expect(serialized.error.fields).toEqual([]);
  });

  it("omits reason when the code is enough, and message is log text rather than product chrome", () => {
    const validation = envelopeJson(400, {
      message: "title is required",
      fields: [{ path: "title", code: "required" }],
    });
    expect(validation.error).toEqual({
      code: "validation_failed",
      message: "title is required",
      fields: [{ path: "title", code: "required" }],
    });
    expect("reason" in validation.error).toBe(false);

    const notFound = envelopeJson(404, { message: "plan not found" });
    expect("reason" in notFound.error).toBe(false);
    expect(notFound.error.message).toBe("plan not found");

    const rateLimited = envelopeJson(429, { message: "20 runs in the rolling hour" });
    expect("reason" in rateLimited.error).toBe(false);

    const upstream = envelopeJson(503, { message: "routes matrix failed" });
    expect("reason" in upstream.error).toBe(false);

    const withReason = envelopeJson(401, {
      reason: "bad_credentials",
      message: "sign-in rejected",
    });
    expect(withReason.error.reason).toBe("bad_credentials");
    expect(withReason.error.message).toBe("sign-in rejected");
    expect(withReason.error.message).not.toMatch(/please|try again|عذرا/i);
  });

  it("maps each allowed status to its contract code and copies fields", () => {
    expect(ERROR_CODE_BY_STATUS).toEqual({
      400: "validation_failed",
      401: "unauthenticated",
      403: "forbidden",
      404: "not_found",
      409: "conflict",
      429: "rate_limited",
      503: "upstream",
    });

    const csrf = httpError(403, {
      reason: "csrf",
      message: "missing X-HP-Request",
    });
    expect(csrf.body.error.code).toBe("forbidden");
    expect(csrf.body.error.reason).toBe("csrf");

    const invite = httpError(404, {
      reason: "account_not_found",
      message: "invite email is not registered",
    });
    expect(invite.body.error.code).toBe("not_found");
    expect(invite.body.error.reason).toBe("account_not_found");

    const conflict = httpError(409, {
      reason: "field_frozen",
      message: "windows cannot change after the first answer",
      fields: [{ path: "windows", code: "frozen" }],
    });
    expect(conflict.body.error.code).toBe("conflict");
    expect(conflict.body.error.reason).toBe("field_frozen");
    expect(conflict.body.error.fields).toEqual([
      { path: "windows", code: "frozen" },
    ]);

    const fields: { path: string; code: (typeof FIELD_CODES)[number] }[] = [
      { path: "email", code: "bad_email" },
    ];
    const copied = httpError(400, {
      message: "email is not an email",
      fields,
    });
    fields[0] = { path: "mutated", code: "unknown" };
    expect(copied.body.error.fields).toEqual([{ path: "email", code: "bad_email" }]);
  });

  it("rejects statuses outside 400, 401, 403, 404, 409, 429, and 503", () => {
    for (const status of [200, 201, 204, 422, 500]) {
      expect(() =>
        httpError(status as (typeof ERROR_STATUSES)[number], {
          message: "not an error status",
        }),
      ).toThrow(/unsupported error status/);
    }
  });

  it("rejects a reason when the code is enough, and unknown reasons or field codes", () => {
    expect(REASONS_BY_STATUS[400]).toEqual([]);
    expect(REASONS_BY_STATUS[429]).toEqual([]);
    expect(REASONS_BY_STATUS[503]).toEqual([]);
    expect(() =>
      httpError(400, {
        message: "title is required",
        reason: "field_frozen" as never,
      }),
    ).toThrow(/unsupported error reason/);
    expect(() =>
      httpError(401, {
        message: "missing session",
        reason: "csrf" as never,
      }),
    ).toThrow(/unsupported error reason/);
    expect(() => httpError(401, { message: "missing session" })).toThrow(
      /error reason required/,
    );
    expect(() =>
      httpError(409, { message: "plan is locked" }),
    ).toThrow(/error reason required/);
    expect(() =>
      httpError(400, {
        message: "bad field",
        fields: [{ path: "title", code: "nope" as never }],
      }),
    ).toThrow(/unknown error field code/);
    expect(FIELD_CODES).toEqual([
      "required",
      "too_long",
      "not_positive",
      "below_min",
      "above_max",
      "end_before_start",
      "bad_timezone",
      "bad_currency",
      "bad_email",
      "bad_time",
      "outside_window",
      "not_one",
      "frozen",
      "unknown",
    ]);
  });
});
