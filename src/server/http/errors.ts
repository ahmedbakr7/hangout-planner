export const ERROR_STATUSES = [400, 401, 403, 404, 409, 429, 503] as const;

export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const ERROR_CODE_BY_STATUS = {
  400: "validation_failed",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
  503: "upstream",
} as const;

export type ErrorCode = (typeof ERROR_CODE_BY_STATUS)[ErrorStatus];

export const FIELD_CODES = [
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
] as const;

export type FieldCode = (typeof FIELD_CODES)[number];

export const REASONS_BY_STATUS = {
  400: [] as const,
  401: ["missing_session", "bad_credentials"] as const,
  403: ["csrf", "organizer_only", "not_cohort"] as const,
  404: ["account_not_found"] as const,
  409: [
    "email_taken",
    "field_frozen",
    "plan_locked",
    "responses_closed",
    "not_proposed",
    "not_blocked",
    "not_locked",
    "attempt_in_progress",
    "not_an_alternative",
    "route_unavailable",
    "organizer_cannot_join",
    "cannot_invite_self",
    "plan_full",
  ] as const,
  429: [] as const,
  503: [] as const,
} as const;

export type ErrorReason = (typeof REASONS_BY_STATUS)[ErrorStatus][number];

export type ErrorField = {
  path: string;
  code: FieldCode;
};

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    reason?: ErrorReason;
    message: string;
    fields: ErrorField[];
  };
};

export type HttpError = {
  status: ErrorStatus;
  body: ErrorEnvelope;
};

const ERROR_STATUS_SET: ReadonlySet<number> = new Set(ERROR_STATUSES);
const FIELD_CODE_SET: ReadonlySet<string> = new Set(FIELD_CODES);

export function isErrorStatus(value: unknown): value is ErrorStatus {
  return typeof value === "number" && ERROR_STATUS_SET.has(value);
}

function isFieldCode(value: unknown): value is FieldCode {
  return typeof value === "string" && FIELD_CODE_SET.has(value);
}

function allowedReasons(status: ErrorStatus): readonly string[] {
  return REASONS_BY_STATUS[status];
}

function copyFields(fields: readonly ErrorField[] | undefined): ErrorField[] {
  if (fields === undefined) {
    return [];
  }
  const copied: ErrorField[] = [];
  for (const field of fields) {
    if (typeof field.path !== "string" || field.path.length === 0) {
      throw new Error("error field path must be a non-empty string");
    }
    if (!isFieldCode(field.code)) {
      throw new Error(`unknown error field code: ${String(field.code)}`);
    }
    copied.push({ path: field.path, code: field.code });
  }
  return copied;
}

export function httpError(
  status: ErrorStatus,
  init: {
    message: string;
    reason?: ErrorReason;
    fields?: readonly ErrorField[];
  },
): HttpError {
  if (!isErrorStatus(status)) {
    throw new Error(`unsupported error status: ${String(status)}`);
  }
  if (typeof init.message !== "string" || init.message.length === 0) {
    throw new Error("error message must be log text");
  }

  const fields = copyFields(init.fields);
  const error: ErrorEnvelope["error"] = {
    code: ERROR_CODE_BY_STATUS[status],
    message: init.message,
    fields,
  };

  const allowed = allowedReasons(status);
  if (init.reason === undefined) {
    if (status === 401 || status === 403 || status === 409) {
      throw new Error(`error reason required for ${status}`);
    }
  } else if (!allowed.includes(init.reason)) {
    throw new Error(`unsupported error reason: ${init.reason} for ${status}`);
  } else {
    error.reason = init.reason;
  }

  return { status, body: { error } };
}
