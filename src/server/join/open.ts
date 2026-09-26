import { httpError, type ErrorField, type HttpError } from "../http/errors";
import { generateDistinguisher, isDistinguisher } from "../ids";
import type { CurrencyCode } from "../money";
import type { PlanState } from "../plans/edit-rules";

export const PARTICIPANT_CAP = 100;
export const DISPLAY_NAME_MAX = 40;

export const OPENING_NEXTS = [
  "organizer",
  "respond",
  "proposal",
  "confirmed",
  "join",
] as const;

export type OpeningNext = (typeof OPENING_NEXTS)[number];

export type JoinCaller = "organizer" | "participant" | "invited" | "link_reader";

export type ParticipantNext = "respond" | "proposal" | "confirmed";

export type JoinPreviewWindow = {
  local_date: string;
  start_local: string;
  end_local: string;
};

export type JoinPreview = {
  title: string;
  organizer_display_name: string;
  timezone: string;
  windows: JoinPreviewWindow[];
  budget: { amount_minor: number; currency: CurrencyCode };
  step_names: string[];
};

export type OpeningBody = {
  plan_id: string;
  next: OpeningNext;
  preview: JoinPreview | null;
};

export type JoinPreviewInput = {
  title: string;
  organizer_display_name: string;
  timezone: string;
  windows: readonly {
    local_date: string;
    start_local: string;
    end_local: string;
  }[];
  budget: { amount_minor: number; currency: CurrencyCode };
  step_names: readonly string[];
};

export type ParsedJoin =
  | { ok: true; kind: "account" }
  | { ok: true; kind: "anonymous"; displayName: string }
  | { ok: false; fields: ErrorField[] };

export type JoinConflictReason =
  | "organizer_cannot_join"
  | "plan_locked"
  | "plan_full";

export type JoinDecision =
  | { action: "conflict"; reason: JoinConflictReason }
  | { action: "existing" }
  | { action: "create" };

export type JoinParticipantView = {
  id: string;
  display_name: string;
  distinguisher: string;
};

const PLAN_STATES: ReadonlySet<string> = new Set([
  "collecting",
  "blocked",
  "proposed",
  "locked",
]);

export function asPlanState(value: string): PlanState {
  if (PLAN_STATES.has(value)) {
    return value as PlanState;
  }
  return "collecting";
}

/** Opening `next` table. Invited-not-participant and link reader share the join/confirmed rows. */
export function openingNext(caller: JoinCaller, state: PlanState): OpeningNext {
  if (caller === "organizer") {
    return state === "locked" ? "confirmed" : "organizer";
  }
  if (caller === "participant") {
    if (state === "locked") {
      return "confirmed";
    }
    if (state === "proposed") {
      return "proposal";
    }
    return "respond";
  }
  return state === "locked" ? "confirmed" : "join";
}

export function participantNext(state: PlanState): ParticipantNext {
  const next = openingNext("participant", state);
  if (next === "respond" || next === "proposal" || next === "confirmed") {
    return next;
  }
  return "respond";
}

export function joinPreview(input: JoinPreviewInput): JoinPreview {
  return {
    title: input.title,
    organizer_display_name: input.organizer_display_name,
    timezone: input.timezone,
    windows: input.windows.map((window) => ({
      local_date: window.local_date,
      start_local: window.start_local,
      end_local: window.end_local,
    })),
    budget: {
      amount_minor: input.budget.amount_minor,
      currency: input.budget.currency,
    },
    step_names: [...input.step_names],
  };
}

export function openingBody(
  planId: string,
  caller: JoinCaller,
  state: PlanState,
  preview: JoinPreview | null,
): OpeningBody {
  const next = openingNext(caller, state);
  return {
    plan_id: planId,
    next,
    preview: next === "join" ? preview : null,
  };
}

export function parseDisplayName(
  value: unknown,
): { ok: true; displayName: string } | { ok: false; field: ErrorField } {
  if (typeof value !== "string") {
    return { ok: false, field: { path: "display_name", code: "required" } };
  }
  const displayName = value.trim();
  if (displayName.length === 0) {
    return { ok: false, field: { path: "display_name", code: "required" } };
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return { ok: false, field: { path: "display_name", code: "too_long" } };
  }
  return { ok: true, displayName };
}

export function parseJoinBody(body: Record<string, unknown>): ParsedJoin {
  if (typeof body.kind !== "string" || body.kind.length === 0) {
    return { ok: false, fields: [{ path: "kind", code: "required" }] };
  }
  if (body.kind !== "account" && body.kind !== "anonymous") {
    return { ok: false, fields: [{ path: "kind", code: "not_one" }] };
  }
  if (body.kind === "account") {
    return { ok: true, kind: "account" };
  }
  const name = parseDisplayName(body.display_name);
  if (!name.ok) {
    return { ok: false, fields: [name.field] };
  }
  return { ok: true, kind: "anonymous", displayName: name.displayName };
}

export function joinDecision(input: {
  isOrganizer: boolean;
  locked: boolean;
  alreadyParticipant: boolean;
  participantCount: number;
}): JoinDecision {
  if (input.isOrganizer) {
    return { action: "conflict", reason: "organizer_cannot_join" };
  }
  if (input.locked) {
    return { action: "conflict", reason: "plan_locked" };
  }
  if (input.alreadyParticipant) {
    return { action: "existing" };
  }
  if (input.participantCount >= PARTICIPANT_CAP) {
    return { action: "conflict", reason: "plan_full" };
  }
  return { action: "create" };
}

export function joinConflictError(reason: JoinConflictReason): HttpError {
  if (reason === "organizer_cannot_join") {
    return httpError(409, {
      reason: "organizer_cannot_join",
      message: "organizer cannot join as a participant",
    });
  }
  if (reason === "plan_locked") {
    return httpError(409, {
      reason: "plan_locked",
      message: "plan is locked",
    });
  }
  return httpError(409, {
    reason: "plan_full",
    message: "plan is full",
  });
}

export function takenDistinguishers(
  participantDistinguishers: readonly string[],
  pendingInvitationDistinguishers: readonly string[],
): Set<string> {
  return new Set([
    ...participantDistinguishers,
    ...pendingInvitationDistinguishers,
  ]);
}

export function allocateDistinguisher(
  taken: ReadonlySet<string>,
  generate: () => string = generateDistinguisher,
): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const value = generate();
    if (!isDistinguisher(value) || taken.has(value)) {
      continue;
    }
    return value;
  }
  throw new Error("unable to allocate distinguisher");
}

export function joinParticipantView(row: {
  id: string;
  displayName: string;
  distinguisher: string;
}): JoinParticipantView {
  return {
    id: row.id,
    display_name: row.displayName,
    distinguisher: row.distinguisher,
  };
}
