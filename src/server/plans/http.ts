import { NextResponse } from "next/server";
import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import { createDb } from "@/server/db/client";
import {
  planOptions,
  planSteps,
  planWindows,
  plans,
  participants,
  responsePicks,
  responseWindows,
  responses,
} from "@/server/db/schema";
import {
  httpError,
  type ErrorField,
  type HttpError,
} from "@/server/http/errors";
import { generateId } from "@/server/ids";
import {
  AMOUNT_MINOR_MAX,
  AMOUNT_MINOR_MIN,
  isCurrencyCode,
  type CurrencyCode,
  type Money,
} from "@/server/money";
import {
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  type PlanPatch,
  type PlanState,
} from "@/server/plans/edit-rules";
import {
  organizerPlanView,
  type OrganizerPlanView,
  type ParticipantStatus,
} from "@/server/plans/views";
import { errorResponse } from "@/server/auth/http";

export const HOME_LIST_LIMIT = 100;
const TITLE_MAX = 80;
const STEP_NAME_MAX = 60;
const OPTION_LABEL_MAX = 40;
const WINDOWS_MIN = 1;
const WINDOWS_MAX = 7;
const STEPS_MIN = 1;
const STEPS_MAX = 6;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 4;

export const REQUIRED_CREATE_FIELDS: ErrorField[] = [
  { path: "title", code: "required" },
  { path: "timezone", code: "required" },
  { path: "windows", code: "required" },
  { path: "budget", code: "required" },
  { path: "steps", code: "required" },
  { path: "threshold", code: "required" },
];

type Database = ReturnType<typeof createDb>;
export type PlanRow = typeof plans.$inferSelect;

export type ParsedWindow = {
  localDate: string;
  startLocal: string;
  endLocal: string;
};

export type ParsedStep = {
  name: string;
  options: string[];
};

export type ParsedCreate = {
  title: string;
  timezone: string;
  windows: ParsedWindow[];
  budget: Money;
  steps: ParsedStep[];
  threshold: number;
};

export type ParsedPatch = {
  title?: string;
  timezone?: string;
  windows?: ParsedWindow[];
  budget?: Money;
  steps?: ParsedStep[];
  threshold?: number;
};

export type ParsePlanResult =
  | { ok: true; value: ParsedPatch }
  | { ok: false; fields: ErrorField[] };

let database: Database | undefined;
let timeZones: ReadonlySet<string> | undefined;

export function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  await database.$client.end({ timeout: 5 });
  database = undefined;
}

function ianaTimeZones(): ReadonlySet<string> {
  if (!timeZones) {
    timeZones = new Set(Intl.supportedValuesOf("timeZone"));
  }
  return timeZones;
}

function isIanaTimeZone(value: string): boolean {
  return ianaTimeZones().has(value);
}

function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseLocalMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function planValidationMessage(fields: readonly ErrorField[]): string {
  if (fields.length !== 1) {
    return "invalid fields";
  }
  const field = fields[0];
  if (!field) {
    return "invalid fields";
  }
  const segments = field.path.replace(/\[\d+\]/g, "").split(".");
  const name = segments[segments.length - 1] || field.path;
  switch (field.code) {
    case "required":
      return `${name} is required`;
    case "too_long":
      return `${name} is too long`;
    case "not_positive":
      return `${name} is not positive`;
    case "below_min":
      return `${name} is below the minimum`;
    case "above_max":
      return `${name} is above the maximum`;
    case "end_before_start":
      return "end is before start";
    case "bad_timezone":
      return "timezone is not an IANA name";
    case "bad_currency":
      return "currency is not listed";
    case "bad_time":
      return "time is invalid";
    case "unknown":
      return `${name} is not accepted`;
    default:
      return "invalid fields";
  }
}

export function planValidationFailed(
  fields: readonly ErrorField[],
): NextResponse {
  return errorResponse(
    httpError(400, {
      message: planValidationMessage(fields),
      fields,
    }),
  );
}

export function notFoundResponse(): NextResponse {
  return errorResponse(httpError(404, { message: "plan not found" }));
}

export function organizerOnlyResponse(): NextResponse {
  return errorResponse(
    httpError(403, {
      reason: "organizer_only",
      message: "organizer only",
    }),
  );
}

export function planLockedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "plan_locked",
      message: "plan is locked",
    }),
  );
}

export function fieldFrozenResponse(error: HttpError): NextResponse {
  return errorResponse(error);
}

export function planPatchFromBody(body: Record<string, unknown>): PlanPatch {
  const patch: PlanPatch = {};
  if (body.title !== undefined) {
    patch.title = body.title;
  }
  if (body.timezone !== undefined) {
    patch.timezone = body.timezone;
  }
  if (body.windows !== undefined) {
    patch.windows = body.windows;
  }
  if (body.budget !== undefined) {
    patch.budget = body.budget;
  }
  if (body.steps !== undefined) {
    patch.steps = body.steps;
  }
  if (body.threshold !== undefined) {
    patch.threshold = body.threshold;
  }
  return patch;
}

function parseTitle(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): string | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "title", code: "required" });
    }
    return undefined;
  }
  if (typeof value !== "string") {
    fields.push({ path: "title", code: "required" });
    return undefined;
  }
  const title = value.trim();
  if (title.length === 0) {
    fields.push({ path: "title", code: "required" });
    return undefined;
  }
  if (title.length > TITLE_MAX) {
    fields.push({ path: "title", code: "too_long" });
    return undefined;
  }
  return title;
}

function parseTimezone(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): string | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "timezone", code: "required" });
    }
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    fields.push({
      path: "timezone",
      code: value === "" ? "required" : "bad_timezone",
    });
    return undefined;
  }
  if (!isIanaTimeZone(value)) {
    fields.push({ path: "timezone", code: "bad_timezone" });
    return undefined;
  }
  return value;
}

function parseWindow(
  value: unknown,
  path: string,
  fields: ErrorField[],
): ParsedWindow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fields.push({ path, code: "required" });
    return null;
  }
  const record = value as Record<string, unknown>;
  let localDate: string | undefined;
  if (typeof record.local_date !== "string") {
    fields.push({ path: `${path}.local_date`, code: "required" });
  } else if (record.local_date.trim().length === 0) {
    fields.push({ path: `${path}.local_date`, code: "required" });
  } else if (!isLocalDate(record.local_date)) {
    fields.push({ path: `${path}.local_date`, code: "unknown" });
  } else {
    localDate = record.local_date;
  }

  let startLocal: string | undefined;
  let startMinutes: number | null = null;
  if (typeof record.start_local !== "string" || record.start_local.length === 0) {
    fields.push({ path: `${path}.start_local`, code: "required" });
  } else {
    startMinutes = parseLocalMinutes(record.start_local);
    if (startMinutes === null) {
      fields.push({ path: `${path}.start_local`, code: "bad_time" });
    } else {
      startLocal = record.start_local;
    }
  }

  let endLocal: string | undefined;
  let endMinutes: number | null = null;
  if (typeof record.end_local !== "string" || record.end_local.length === 0) {
    fields.push({ path: `${path}.end_local`, code: "required" });
  } else {
    endMinutes = parseLocalMinutes(record.end_local);
    if (endMinutes === null) {
      fields.push({ path: `${path}.end_local`, code: "bad_time" });
    } else {
      endLocal = record.end_local;
    }
  }

  if (
    startMinutes !== null &&
    endMinutes !== null &&
    endMinutes <= startMinutes
  ) {
    fields.push({ path: `${path}.end_local`, code: "end_before_start" });
  }

  if (!localDate || !startLocal || !endLocal || endMinutes === null || startMinutes === null) {
    return null;
  }
  if (endMinutes <= startMinutes) {
    return null;
  }
  return { localDate, startLocal, endLocal };
}

function parseWindows(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): ParsedWindow[] | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "windows", code: "required" });
    }
    return undefined;
  }
  if (!Array.isArray(value)) {
    fields.push({ path: "windows", code: "required" });
    return undefined;
  }
  if (value.length < WINDOWS_MIN) {
    fields.push({ path: "windows", code: "below_min" });
  } else if (value.length > WINDOWS_MAX) {
    fields.push({ path: "windows", code: "above_max" });
  }
  const windows: ParsedWindow[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseWindow(item, `windows[${index}]`, fields);
    if (parsed) {
      windows.push(parsed);
    }
  }
  return windows;
}

function parseBudget(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): Money | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "budget", code: "required" });
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fields.push({ path: "budget", code: "required" });
    return undefined;
  }
  const record = value as { amount_minor?: unknown; currency?: unknown };
  if (record.amount_minor === undefined) {
    fields.push({ path: "budget.amount_minor", code: "required" });
  } else if (
    typeof record.amount_minor !== "number" ||
    !Number.isInteger(record.amount_minor) ||
    record.amount_minor < AMOUNT_MINOR_MIN
  ) {
    fields.push({ path: "budget.amount_minor", code: "not_positive" });
  } else if (record.amount_minor > AMOUNT_MINOR_MAX) {
    fields.push({ path: "budget.amount_minor", code: "above_max" });
  }
  if (record.currency === undefined) {
    fields.push({ path: "budget.currency", code: "required" });
  } else if (!isCurrencyCode(record.currency)) {
    fields.push({ path: "budget.currency", code: "bad_currency" });
  }
  if (
    typeof record.amount_minor === "number" &&
    Number.isInteger(record.amount_minor) &&
    record.amount_minor >= AMOUNT_MINOR_MIN &&
    record.amount_minor <= AMOUNT_MINOR_MAX &&
    isCurrencyCode(record.currency)
  ) {
    return { amountMinor: record.amount_minor, currency: record.currency };
  }
  return undefined;
}

function parseOption(
  value: unknown,
  path: string,
  fields: ErrorField[],
): string | null {
  if (typeof value !== "string") {
    fields.push({ path, code: "required" });
    return null;
  }
  const label = value.trim();
  if (label.length === 0) {
    fields.push({ path, code: "required" });
    return null;
  }
  if (label.length > OPTION_LABEL_MAX) {
    fields.push({ path, code: "too_long" });
    return null;
  }
  return label;
}

function parseStep(
  value: unknown,
  path: string,
  fields: ErrorField[],
): ParsedStep | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fields.push({ path, code: "required" });
    return null;
  }
  const record = value as Record<string, unknown>;
  let name: string | undefined;
  if (typeof record.name !== "string") {
    fields.push({ path: `${path}.name`, code: "required" });
  } else {
    const trimmed = record.name.trim();
    if (trimmed.length === 0) {
      fields.push({ path: `${path}.name`, code: "required" });
    } else if (trimmed.length > STEP_NAME_MAX) {
      fields.push({ path: `${path}.name`, code: "too_long" });
    } else {
      name = trimmed;
    }
  }

  let options: string[] | undefined;
  if (record.options === undefined || !Array.isArray(record.options)) {
    fields.push({ path: `${path}.options`, code: "required" });
  } else {
    if (record.options.length < OPTIONS_MIN) {
      fields.push({ path: `${path}.options`, code: "below_min" });
    } else if (record.options.length > OPTIONS_MAX) {
      fields.push({ path: `${path}.options`, code: "above_max" });
    }
    const parsedOptions: string[] = [];
    for (const [index, option] of record.options.entries()) {
      const label = parseOption(option, `${path}.options[${index}]`, fields);
      if (label) {
        parsedOptions.push(label);
      }
    }
    options = parsedOptions;
  }

  if (!name || !options || options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) {
    return null;
  }
  return { name, options };
}

function parseSteps(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): ParsedStep[] | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "steps", code: "required" });
    }
    return undefined;
  }
  if (!Array.isArray(value)) {
    fields.push({ path: "steps", code: "required" });
    return undefined;
  }
  if (value.length < STEPS_MIN) {
    fields.push({ path: "steps", code: "below_min" });
  } else if (value.length > STEPS_MAX) {
    fields.push({ path: "steps", code: "above_max" });
  }
  const steps: ParsedStep[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseStep(item, `steps[${index}]`, fields);
    if (parsed) {
      steps.push(parsed);
    }
  }
  return steps;
}

function parseThreshold(
  value: unknown,
  fields: ErrorField[],
  required: boolean,
): number | undefined {
  if (value === undefined) {
    if (required) {
      fields.push({ path: "threshold", code: "required" });
    }
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fields.push({ path: "threshold", code: "unknown" });
    return undefined;
  }
  if (value < THRESHOLD_MIN) {
    fields.push({ path: "threshold", code: "below_min" });
    return undefined;
  }
  if (value > THRESHOLD_MAX) {
    fields.push({ path: "threshold", code: "above_max" });
    return undefined;
  }
  return value;
}

export function parsePlanBody(
  body: Record<string, unknown>,
  mode: "create" | "patch",
): ParsePlanResult {
  const required = mode === "create";
  const fields: ErrorField[] = [];
  const title = parseTitle(body.title, fields, required);
  const timezone = parseTimezone(body.timezone, fields, required);
  const windows = parseWindows(body.windows, fields, required);
  const budget = parseBudget(body.budget, fields, required);
  const steps = parseSteps(body.steps, fields, required);
  const threshold = parseThreshold(body.threshold, fields, required);
  if (fields.length > 0) {
    return { ok: false, fields };
  }
  const value: ParsedPatch = {};
  if (title !== undefined) {
    value.title = title;
  }
  if (timezone !== undefined) {
    value.timezone = timezone;
  }
  if (windows !== undefined) {
    value.windows = windows;
  }
  if (budget !== undefined) {
    value.budget = budget;
  }
  if (steps !== undefined) {
    value.steps = steps;
  }
  if (threshold !== undefined) {
    value.threshold = threshold;
  }
  return { ok: true, value };
}

export function storedCurrency(value: string): CurrencyCode {
  if (isCurrencyCode(value)) {
    return value;
  }
  return "EGP";
}

export function storedState(value: string): PlanState {
  if (
    value === "collecting" ||
    value === "blocked" ||
    value === "proposed" ||
    value === "locked"
  ) {
    return value;
  }
  return "collecting";
}

export async function loadPlanRow(planId: string): Promise<PlanRow | null> {
  const rows = await db()
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadOrganizerPlan(
  planId: string,
): Promise<OrganizerPlanView | null> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return null;
  }
  return assembleOrganizerPlan(plan);
}

export async function assembleOrganizerPlan(
  plan: PlanRow,
): Promise<OrganizerPlanView> {
  const windowRows = await db()
    .select()
    .from(planWindows)
    .where(eq(planWindows.planId, plan.id))
    .orderBy(asc(planWindows.position));
  const stepRows = await db()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
  const stepIds = stepRows.map((step) => step.id);
  const optionRows =
    stepIds.length === 0
      ? []
      : await db()
          .select()
          .from(planOptions)
          .where(inArray(planOptions.stepId, stepIds))
          .orderBy(asc(planOptions.stepId), asc(planOptions.position));
  const optionsByStep = new Map<string, { id: string; label: string }[]>();
  for (const option of optionRows) {
    const list = optionsByStep.get(option.stepId) ?? [];
    list.push({ id: option.id, label: option.label });
    optionsByStep.set(option.stepId, list);
  }
  const participantRows = await db()
    .select()
    .from(participants)
    .where(eq(participants.planId, plan.id));
  const participantIds = participantRows.map((participant) => participant.id);
  const responseRows =
    participantIds.length === 0
      ? []
      : await db()
          .select({
            participantId: responses.participantId,
            complete: responses.complete,
          })
          .from(responses)
          .where(inArray(responses.participantId, participantIds));
  const completeByParticipant = new Map(
    responseRows.map((row) => [row.participantId, row.complete]),
  );

  return organizerPlanView({
    id: plan.id,
    title: plan.title,
    state: storedState(plan.state),
    timezone: plan.timezone,
    windows: windowRows.map((window) => ({
      id: window.id,
      local_date: window.localDate,
      start_local: window.startLocal,
      end_local: window.endLocal,
    })),
    budget: {
      amount_minor: plan.budgetAmountMinor,
      currency: storedCurrency(plan.currency),
    },
    steps: stepRows.map((step) => ({
      id: step.id,
      name: step.name,
      options: optionsByStep.get(step.id) ?? [],
    })),
    threshold: plan.threshold,
    answered_count: plan.answeredCount,
    participants: participantRows.map((participant) => {
      const status: ParticipantStatus =
        completeByParticipant.get(participant.id) === true
          ? "answered"
          : "in_progress";
      return {
        id: participant.id,
        display_name: participant.displayName,
        distinguisher: participant.distinguisher,
        status,
        created_at: participant.createdAt,
      };
    }),
  });
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function insertWindows(
  tx: Transaction,
  planId: string,
  windows: readonly ParsedWindow[],
): Promise<void> {
  if (windows.length === 0) {
    return;
  }
  await tx.insert(planWindows).values(
    windows.map((window, position) => ({
      id: generateId("win_"),
      planId,
      position,
      localDate: window.localDate,
      startLocal: window.startLocal,
      endLocal: window.endLocal,
    })),
  );
}

export async function insertSteps(
  tx: Transaction,
  planId: string,
  steps: readonly ParsedStep[],
): Promise<void> {
  for (const [position, step] of steps.entries()) {
    const stepId = generateId("stp_");
    await tx.insert(planSteps).values({
      id: stepId,
      planId,
      position,
      name: step.name,
    });
    await tx.insert(planOptions).values(
      step.options.map((label, optionPosition) => ({
        id: generateId("opt_"),
        stepId,
        position: optionPosition,
        label,
      })),
    );
  }
}

export async function replaceWindows(
  tx: Transaction,
  planId: string,
  windows: readonly ParsedWindow[],
): Promise<void> {
  const existing = await tx
    .select({ id: planWindows.id })
    .from(planWindows)
    .where(eq(planWindows.planId, planId));
  const ids = existing.map((row) => row.id);
  if (ids.length > 0) {
    await tx
      .delete(responseWindows)
      .where(inArray(responseWindows.windowId, ids));
    await tx.delete(planWindows).where(eq(planWindows.planId, planId));
  }
  await insertWindows(tx, planId, windows);
}

export async function replaceSteps(
  tx: Transaction,
  planId: string,
  steps: readonly ParsedStep[],
): Promise<void> {
  const existing = await tx
    .select({ id: planSteps.id })
    .from(planSteps)
    .where(eq(planSteps.planId, planId));
  const ids = existing.map((row) => row.id);
  if (ids.length > 0) {
    await tx.delete(responsePicks).where(inArray(responsePicks.stepId, ids));
    await tx.delete(planOptions).where(inArray(planOptions.stepId, ids));
    await tx.delete(planSteps).where(eq(planSteps.planId, planId));
  }
  await insertSteps(tx, planId, steps);
}
