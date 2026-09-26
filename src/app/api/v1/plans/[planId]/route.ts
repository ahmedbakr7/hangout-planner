import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
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
} from "@/server/db/schema";
import { validatePlanPatch } from "@/server/plans/edit-rules";
import {
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

type PlanRouteContext = {
  params: Promise<{ planId: string }>;
};

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

  const view = await loadOrganizerPlan(plan.id);
  if (!view) {
    return logged(request, notFoundResponse());
  }
  return logged(request, NextResponse.json(view));
}
