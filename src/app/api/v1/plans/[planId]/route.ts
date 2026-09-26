import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { authorize, type PlanRole } from "@/server/auth/authorize";
import { hashCookieToken } from "@/server/auth/session";
import { now } from "@/server/clock";
import {
  guestSessions,
  invitations,
  linkSessionPlans,
  linkSessions,
  participants,
  plans,
  proposalAlternatives,
  proposalCandidates,
  proposalCohort,
  proposalLegs,
  proposalRuns,
  proposalSteps,
  proposals,
  stepSignals,
} from "@/server/db/schema";
import { httpError } from "@/server/http/errors";
import type { GoogleClientOptions } from "@/server/google/places";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import { validatePlanPatch } from "@/server/plans/edit-rules";
import {
  runProposalAttempt,
  type ProposalAttemptResult,
} from "@/server/proposal/attempt";
import {
  errorResponse,
  logged,
  readAccountSession,
  readCookie,
  readJsonObject,
  rejectCsrf,
} from "../../accounts/route";
import {
  assembleOrganizerPlan,
  db,
  fieldFrozenResponse,
  loadOrganizerPlan,
  loadPlanRow,
  notFoundResponse,
  organizerOnlyResponse,
  parsePlanBody,
  planLockedResponse,
  planPatchFromBody,
  planValidationFailed,
  replaceSteps,
  replaceWindows,
  storedCurrency,
  storedState,
  type ParsedPatch,
  type PlanRow,
} from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PROPOSAL_ATTEMPT_HOUR_CAP = 20;
export const PROPOSAL_ATTEMPT_HOUR_MS = 60 * 60 * 1000;

type PlanRouteContext = {
  params: Promise<{ planId: string }>;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let proposalAttemptGoogle: GoogleClientOptions | undefined;

export function setProposalAttemptGoogleOptions(
  options: GoogleClientOptions | undefined,
): void {
  proposalAttemptGoogle = options;
}

export type TriggeredAttemptResult =
  | ProposalAttemptResult
  | { status: "hour_full" };

function newOpaqueId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

export function attemptInProgressResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "attempt_in_progress",
      message: "a proposal attempt is already in progress",
    }),
  );
}

export function proposalAttemptHourCapResponse(): NextResponse {
  return errorResponse(
    httpError(429, {
      message: "too many proposal attempts",
    }),
  );
}

export function notBlockedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_blocked",
      message: "plan is not blocked",
    }),
  );
}

export async function recentProposalRunCount(planId: string): Promise<number> {
  const cutoff = new Date(now().getTime() - PROPOSAL_ATTEMPT_HOUR_MS);
  const rows = await db()
    .select({ value: count() })
    .from(proposalRuns)
    .where(
      and(eq(proposalRuns.planId, planId), gt(proposalRuns.startedAt, cutoff)),
    );
  return Number(rows[0]?.value ?? 0);
}

async function deleteProposalsTx(
  tx: Transaction,
  planId: string,
): Promise<void> {
  const existing = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.planId, planId));
  const ids = existing.map((row) => row.id);
  if (ids.length === 0) {
    return;
  }
  await tx.delete(stepSignals).where(inArray(stepSignals.proposalId, ids));
  await tx
    .delete(proposalAlternatives)
    .where(inArray(proposalAlternatives.proposalId, ids));
  await tx
    .delete(proposalCandidates)
    .where(inArray(proposalCandidates.proposalId, ids));
  await tx.delete(proposalLegs).where(inArray(proposalLegs.proposalId, ids));
  await tx.delete(proposalSteps).where(inArray(proposalSteps.proposalId, ids));
  await tx.delete(proposalCohort).where(inArray(proposalCohort.proposalId, ids));
  await tx.delete(proposals).where(inArray(proposals.id, ids));
}

export async function applyHourFullVenueData(planId: string): Promise<void> {
  const instant = now();
  await db().transaction(async (tx) => {
    const rows = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, planId))
      .for("update");
    if (!rows[0]) {
      return;
    }
    await deleteProposalsTx(tx, planId);
    await tx.insert(proposalRuns).values({
      id: newOpaqueId("prn_"),
      planId,
      startedAt: instant,
      outcome: "blocked",
      blockTime: false,
      blockBudget: false,
      blockVenueData: true,
    });
    await tx
      .update(plans)
      .set({
        state: "blocked",
        attemptLock: false,
        attemptLockAt: null,
        updatedAt: instant,
      })
      .where(eq(plans.id, planId));
  });
}

export async function runTriggeredAttempt(
  planId: string,
  languageCode?: string,
): Promise<TriggeredAttemptResult> {
  if ((await recentProposalRunCount(planId)) >= PROPOSAL_ATTEMPT_HOUR_CAP) {
    return { status: "hour_full" };
  }
  return runProposalAttempt(planId, {
    google: proposalAttemptGoogle,
    languageCode,
  });
}

function attemptLanguage(request: Request): "ar" | "en" {
  return localeFromCookie(readCookie(request, LOCALE_COOKIE) ?? undefined);
}

function tokenHash(token: string | null): string | null {
  if (!token) {
    return null;
  }
  try {
    return hashCookieToken(token);
  } catch {
    return null;
  }
}

function isFuture(value: Date | string): boolean {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) && time > now().getTime();
}

async function accountParticipates(
  planId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(eq(participants.planId, planId), eq(participants.accountId, accountId)),
    )
    .limit(1);
  return rows.length > 0;
}

async function accountInvited(
  planId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(eq(invitations.planId, planId), eq(invitations.accountId, accountId)),
    )
    .limit(1);
  return rows.length > 0;
}

async function guestOwnsParticipant(
  request: Request,
  planId: string,
): Promise<boolean> {
  const hash = tokenHash(readCookie(request, "hp_guest"));
  if (!hash) {
    return false;
  }
  const rows = await db()
    .select({ expiresAt: guestSessions.expiresAt })
    .from(guestSessions)
    .innerJoin(
      participants,
      eq(participants.guestSessionId, guestSessions.id),
    )
    .where(
      and(eq(guestSessions.tokenHash, hash), eq(participants.planId, planId)),
    )
    .limit(1);
  const row = rows[0];
  return Boolean(row && isFuture(row.expiresAt));
}

async function linkIncludesPlan(
  request: Request,
  planId: string,
): Promise<boolean> {
  const hash = tokenHash(readCookie(request, "hp_link"));
  if (!hash) {
    return false;
  }
  const rows = await db()
    .select({ expiresAt: linkSessions.expiresAt })
    .from(linkSessions)
    .innerJoin(
      linkSessionPlans,
      eq(linkSessionPlans.linkSessionId, linkSessions.id),
    )
    .where(
      and(eq(linkSessions.tokenHash, hash), eq(linkSessionPlans.planId, planId)),
    )
    .limit(1);
  const row = rows[0];
  return Boolean(row && isFuture(row.expiresAt));
}

async function planRoleFor(
  request: Request,
  plan: PlanRow,
): Promise<PlanRole | null> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  const sessionAccountId = session.ok ? session.account.id : null;
  const accountHasParticipant =
    sessionAccountId !== null
      ? await accountParticipates(plan.id, sessionAccountId)
      : false;
  const accountHasInvitation =
    sessionAccountId !== null
      ? await accountInvited(plan.id, sessionAccountId)
      : false;
  return authorize({
    sessionAccountId,
    organizerAccountId: plan.organizerAccountId,
    accountHasParticipant,
    guestOwnsParticipant: await guestOwnsParticipant(request, plan.id),
    accountHasInvitation,
    linkIncludesPlan: await linkIncludesPlan(request, plan.id),
    requestJoinToken: null,
    planJoinToken: plan.joinToken,
  });
}

function rejectNonOrganizer(role: PlanRole | null): NextResponse | null {
  if (role === "organizer") {
    return null;
  }
  if (role === "participant" || role === "invited" || role === "link_reader") {
    return organizerOnlyResponse();
  }
  return notFoundResponse();
}

function hasPlanWrite(patch: ParsedPatch): boolean {
  return (
    patch.title !== undefined ||
    patch.timezone !== undefined ||
    patch.windows !== undefined ||
    patch.budget !== undefined ||
    patch.steps !== undefined ||
    patch.threshold !== undefined
  );
}

async function applyPlanPatch(
  planId: string,
  patch: ParsedPatch,
): Promise<void> {
  await db().transaction(async (tx) => {
    const fields: {
      title?: string;
      timezone?: string;
      budgetAmountMinor?: number;
      currency?: string;
      threshold?: number;
      updatedAt: Date;
    } = { updatedAt: now() };
    if (patch.title !== undefined) {
      fields.title = patch.title;
    }
    if (patch.timezone !== undefined) {
      fields.timezone = patch.timezone;
    }
    if (patch.budget !== undefined) {
      fields.budgetAmountMinor = patch.budget.amountMinor;
      fields.currency = patch.budget.currency;
    }
    if (patch.threshold !== undefined) {
      fields.threshold = patch.threshold;
    }
    await tx.update(plans).set(fields).where(eq(plans.id, planId));
    if (patch.windows !== undefined) {
      await replaceWindows(tx, planId, patch.windows);
    }
    if (patch.steps !== undefined) {
      await replaceSteps(tx, planId, patch.steps);
    }
  });
}

export async function GET(
  request: Request,
  context: PlanRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const denied = rejectNonOrganizer(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, denied);
  }
  if (storedState(plan.state) === "locked") {
    return logged(request, planLockedResponse());
  }

  const view = await assembleOrganizerPlan(plan);
  return logged(request, NextResponse.json(view));
}

export async function PATCH(
  request: Request,
  context: PlanRouteContext,
): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const denied = rejectNonOrganizer(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, denied);
  }
  if (storedState(plan.state) === "locked") {
    return logged(request, planLockedResponse());
  }

  const body = (await readJsonObject(request)) ?? {};
  const freeze = validatePlanPatch(
    {
      state: storedState(plan.state),
      answeredCount: plan.answeredCount,
      budget: {
        amountMinor: plan.budgetAmountMinor,
        currency: storedCurrency(plan.currency),
      },
      threshold: plan.threshold,
    },
    planPatchFromBody(body),
  );
  if (!freeze.ok) {
    return logged(request, fieldFrozenResponse(freeze.error));
  }

  const parsed = parsePlanBody(body, "patch");
  if (!parsed.ok) {
    return logged(request, planValidationFailed(parsed.fields));
  }

  if (hasPlanWrite(parsed.value)) {
    await applyPlanPatch(plan.id, parsed.value);
  }

  const priorState = storedState(plan.state);
  const shouldAttempt =
    hasPlanWrite(parsed.value) &&
    ((priorState === "collecting" &&
      parsed.value.threshold !== undefined &&
      parsed.value.threshold === plan.answeredCount) ||
      (priorState === "blocked" && parsed.value.budget !== undefined));
  if (shouldAttempt) {
    const triggered = await runTriggeredAttempt(
      plan.id,
      attemptLanguage(request),
    );
    if (triggered.status === "hour_full") {
      await applyHourFullVenueData(plan.id);
    } else if (triggered.status === "attempt_in_progress") {
      return logged(request, attemptInProgressResponse());
    }
  }

  const view = await loadOrganizerPlan(plan.id);
  if (!view) {
    return logged(request, notFoundResponse());
  }
  return logged(request, NextResponse.json(view));
}
