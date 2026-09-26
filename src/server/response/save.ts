import { httpError, type ErrorField, type HttpError } from "../http/errors";

export const PLACE_SEARCH_Q_MIN = 1;
export const PLACE_SEARCH_Q_MAX = 80;
export const PLACE_SEARCH_LIMIT = 30;
export const PLACE_SEARCH_WINDOW_MS = 60 * 60 * 1000;
export const PLACE_SEARCH_RESULT_CAP = 5;

export type PlanWindowRule = {
  id: string;
  startLocal: string;
  endLocal: string;
};

export type PlanStepRule = {
  id: string;
  optionIds: readonly string[];
};

export type WindowDraft = {
  windowId: string;
  kind: "busy" | "free";
  earliestLocal?: string;
  latestLocal?: string;
};

export type PickDraft = {
  stepId: string;
  optionId: string;
};

export type ParsedResponseBody = {
  fields: ErrorField[];
  windows: unknown;
  picks: unknown;
  startPlaceId: string | undefined;
};

export type ValidatedDraft =
  | { ok: true; windows: WindowDraft[]; picks: PickDraft[] }
  | { ok: false; fields: ErrorField[] };

export type SaveCountDecision =
  | {
      ok: true;
      complete: boolean;
      firstCompletion: boolean;
      incrementCount: boolean;
    }
  | { ok: false };

function parseLocalMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function presentText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseResponseBody(body: Record<string, unknown>): ParsedResponseBody {
  const fields: ErrorField[] = [];
  let startPlaceId: string | undefined;
  if (body.start_place_id !== undefined) {
    if (typeof body.start_place_id !== "string" || body.start_place_id.length === 0) {
      fields.push({ path: "start_place_id", code: "required" });
    } else {
      startPlaceId = body.start_place_id;
    }
  }

  let windows: unknown = [];
  if (body.windows !== undefined) {
    if (!Array.isArray(body.windows)) {
      fields.push({ path: "windows", code: "required" });
      windows = undefined;
    } else {
      windows = body.windows;
    }
  }

  let picks: unknown = [];
  if (body.picks !== undefined) {
    if (!Array.isArray(body.picks)) {
      fields.push({ path: "picks", code: "required" });
      picks = undefined;
    } else {
      picks = body.picks;
    }
  }

  return { fields, windows, picks, startPlaceId };
}

function validateWindowItem(
  value: unknown,
  path: string,
  planWindows: ReadonlyMap<string, PlanWindowRule>,
  seen: Set<string>,
  fields: ErrorField[],
): WindowDraft | null {
  const record = asRecord(value);
  if (!record) {
    fields.push({ path, code: "required" });
    return null;
  }

  if (!presentText(record.window_id)) {
    fields.push({ path: `${path}.window_id`, code: "required" });
    return null;
  }
  const windowId = record.window_id;
  if (seen.has(windowId)) {
    fields.push({ path: `${path}.window_id`, code: "not_one" });
    return null;
  }
  seen.add(windowId);
  const planWindow = planWindows.get(windowId);
  if (!planWindow) {
    fields.push({ path: `${path}.window_id`, code: "unknown" });
    return null;
  }

  if (typeof record.kind !== "string" || record.kind.length === 0) {
    fields.push({ path: `${path}.kind`, code: "required" });
    return null;
  }
  if (record.kind !== "busy" && record.kind !== "free") {
    fields.push({ path: `${path}.kind`, code: "not_one" });
    return null;
  }

  if (record.kind === "busy") {
    if (record.earliest_local != null) {
      fields.push({ path: `${path}.earliest_local`, code: "unknown" });
    }
    if (record.latest_local != null) {
      fields.push({ path: `${path}.latest_local`, code: "unknown" });
    }
    if (record.earliest_local != null || record.latest_local != null) {
      return null;
    }
    return { windowId, kind: "busy" };
  }

  let earliestLocal: string | undefined;
  let earliestMinutes: number | null = null;
  if (!presentText(record.earliest_local)) {
    fields.push({ path: `${path}.earliest_local`, code: "required" });
  } else {
    earliestMinutes = parseLocalMinutes(record.earliest_local);
    if (earliestMinutes === null) {
      fields.push({ path: `${path}.earliest_local`, code: "bad_time" });
    } else {
      earliestLocal = record.earliest_local;
    }
  }

  let latestLocal: string | undefined;
  let latestMinutes: number | null = null;
  if (!presentText(record.latest_local)) {
    fields.push({ path: `${path}.latest_local`, code: "required" });
  } else {
    latestMinutes = parseLocalMinutes(record.latest_local);
    if (latestMinutes === null) {
      fields.push({ path: `${path}.latest_local`, code: "bad_time" });
    } else {
      latestLocal = record.latest_local;
    }
  }

  const startMinutes = parseLocalMinutes(planWindow.startLocal);
  const endMinutes = parseLocalMinutes(planWindow.endLocal);
  if (earliestMinutes !== null && latestMinutes !== null) {
    if (latestMinutes <= earliestMinutes) {
      fields.push({ path: `${path}.latest_local`, code: "end_before_start" });
    }
    if (
      startMinutes !== null &&
      endMinutes !== null &&
      (earliestMinutes < startMinutes || latestMinutes > endMinutes)
    ) {
      fields.push({
        path:
          earliestMinutes < startMinutes
            ? `${path}.earliest_local`
            : `${path}.latest_local`,
        code: "outside_window",
      });
    }
  }

  if (
    !earliestLocal ||
    !latestLocal ||
    earliestMinutes === null ||
    latestMinutes === null ||
    latestMinutes <= earliestMinutes ||
    startMinutes === null ||
    endMinutes === null ||
    earliestMinutes < startMinutes ||
    latestMinutes > endMinutes
  ) {
    return null;
  }
  return {
    windowId,
    kind: "free",
    earliestLocal,
    latestLocal,
  };
}

function validatePickItem(
  value: unknown,
  path: string,
  planSteps: ReadonlyMap<string, PlanStepRule>,
  seen: Set<string>,
  fields: ErrorField[],
): PickDraft | null {
  const record = asRecord(value);
  if (!record) {
    fields.push({ path, code: "required" });
    return null;
  }
  if (!presentText(record.step_id)) {
    fields.push({ path: `${path}.step_id`, code: "required" });
    return null;
  }
  const stepId = record.step_id;
  if (seen.has(stepId)) {
    fields.push({ path: `${path}.step_id`, code: "not_one" });
    return null;
  }
  seen.add(stepId);
  const step = planSteps.get(stepId);
  if (!step) {
    fields.push({ path: `${path}.step_id`, code: "unknown" });
    return null;
  }
  if (!presentText(record.option_id)) {
    fields.push({ path: `${path}.option_id`, code: "required" });
    return null;
  }
  if (!step.optionIds.includes(record.option_id)) {
    fields.push({ path: `${path}.option_id`, code: "unknown" });
    return null;
  }
  return { stepId, optionId: record.option_id };
}

export function validateWindowsAndPicks(
  planWindows: readonly PlanWindowRule[],
  planSteps: readonly PlanStepRule[],
  windows: unknown,
  picks: unknown,
): ValidatedDraft {
  const fields: ErrorField[] = [];
  const windowById = new Map(planWindows.map((window) => [window.id, window]));
  const stepById = new Map(planSteps.map((step) => [step.id, step]));

  const draftWindows: WindowDraft[] = [];
  if (!Array.isArray(windows)) {
    fields.push({ path: "windows", code: "required" });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of windows.entries()) {
      const parsed = validateWindowItem(
        item,
        `windows[${index}]`,
        windowById,
        seen,
        fields,
      );
      if (parsed) {
        draftWindows.push(parsed);
      }
    }
  }

  const draftPicks: PickDraft[] = [];
  if (!Array.isArray(picks)) {
    fields.push({ path: "picks", code: "required" });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of picks.entries()) {
      const parsed = validatePickItem(
        item,
        `picks[${index}]`,
        stepById,
        seen,
        fields,
      );
      if (parsed) {
        draftPicks.push(parsed);
      }
    }
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }
  return { ok: true, windows: draftWindows, picks: draftPicks };
}

export function draftIsComplete(
  planWindows: readonly PlanWindowRule[],
  planSteps: readonly PlanStepRule[],
  windows: readonly WindowDraft[],
  picks: readonly PickDraft[],
  startStored: boolean,
): boolean {
  if (!startStored) {
    return false;
  }
  if (windows.length !== planWindows.length) {
    return false;
  }
  const windowIds = new Set(windows.map((window) => window.windowId));
  for (const window of planWindows) {
    if (!windowIds.has(window.id)) {
      return false;
    }
  }
  if (picks.length !== planSteps.length) {
    return false;
  }
  const picksByStep = new Map(picks.map((pick) => [pick.stepId, pick]));
  for (const step of planSteps) {
    if (!picksByStep.has(step.id)) {
      return false;
    }
  }
  return true;
}

export function incompleteFields(
  planWindows: readonly PlanWindowRule[],
  planSteps: readonly PlanStepRule[],
  windows: readonly WindowDraft[],
  picks: readonly PickDraft[],
  startStored: boolean,
): ErrorField[] {
  const fields: ErrorField[] = [];
  if (windows.length !== planWindows.length) {
    fields.push({ path: "windows", code: "below_min" });
  } else {
    const windowIds = new Set(windows.map((window) => window.windowId));
    if (planWindows.some((window) => !windowIds.has(window.id))) {
      fields.push({ path: "windows", code: "below_min" });
    }
  }
  if (!startStored) {
    fields.push({ path: "start_place_id", code: "required" });
  }
  if (picks.length !== planSteps.length) {
    fields.push({ path: "picks", code: "not_one" });
  } else {
    const picksByStep = new Map(picks.map((pick) => [pick.stepId, pick]));
    if (planSteps.some((step) => !picksByStep.has(step.id))) {
      fields.push({ path: "picks", code: "not_one" });
    }
  }
  return fields;
}

export function saveCountDecision(
  callerComplete: boolean,
  draftComplete: boolean,
): SaveCountDecision {
  if (!draftComplete && callerComplete) {
    return { ok: false };
  }
  if (!draftComplete) {
    return {
      ok: true,
      complete: false,
      firstCompletion: false,
      incrementCount: false,
    };
  }
  if (!callerComplete) {
    return {
      ok: true,
      complete: true,
      firstCompletion: true,
      incrementCount: true,
    };
  }
  return {
    ok: true,
    complete: true,
    firstCompletion: false,
    incrementCount: false,
  };
}

export function hasStoredStart(row: {
  startGooglePlaceId: string | null;
  startName: string | null;
  startLat: number | null;
  startLng: number | null;
} | null): boolean {
  if (!row) {
    return false;
  }
  return (
    typeof row.startGooglePlaceId === "string" &&
    row.startGooglePlaceId.length > 0 &&
    typeof row.startName === "string" &&
    row.startName.length > 0 &&
    typeof row.startLat === "number" &&
    Number.isFinite(row.startLat) &&
    typeof row.startLng === "number" &&
    Number.isFinite(row.startLng)
  );
}

export function parsePlaceSearchQuery(
  value: string | null,
): { ok: true; q: string } | { ok: false; fields: ErrorField[] } {
  if (value === null) {
    return { ok: false, fields: [{ path: "q", code: "required" }] };
  }
  const q = value.trim();
  if (q.length < PLACE_SEARCH_Q_MIN) {
    return { ok: false, fields: [{ path: "q", code: "required" }] };
  }
  if (q.length > PLACE_SEARCH_Q_MAX) {
    return { ok: false, fields: [{ path: "q", code: "too_long" }] };
  }
  return { ok: true, q };
}

export function responsesClosedError(): HttpError {
  return httpError(409, {
    reason: "responses_closed",
    message: "responses are closed",
  });
}

export function upstreamPlacesError(): HttpError {
  return httpError(503, {
    message: "places upstream failed",
  });
}

export function placeSearchRateLimitedError(): HttpError {
  return httpError(429, {
    message: "too many place searches",
  });
}

export function responseValidationFailed(fields: readonly ErrorField[]): HttpError {
  const field = fields[0];
  let message = "invalid fields";
  if (fields.length === 1 && field) {
    if (field.code === "required") {
      message = `${field.path} is required`;
    } else if (field.code === "too_long") {
      message = `${field.path} is too long`;
    } else if (field.code === "bad_time") {
      message = "time is invalid";
    } else if (field.code === "outside_window") {
      message = "time is outside the window";
    } else if (field.code === "end_before_start") {
      message = "end is before start";
    } else if (field.code === "not_one") {
      message = `${field.path} is not one value`;
    } else if (field.code === "unknown") {
      message = `${field.path} is not accepted`;
    } else if (field.code === "below_min") {
      message = `${field.path} is below the minimum`;
    }
  }
  return httpError(400, { message, fields });
}
