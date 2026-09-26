import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { authorize, type PlanRole } from "@/server/auth/authorize";
import { hashCookieToken } from "@/server/auth/session";
import { now } from "@/server/clock";
import {
  accounts,
  guestSessions,
  invitations,
  linkSessionPlans,
  linkSessions,
  participants,
  planSteps,
  planWindows,
} from "@/server/db/schema";
import {
  asPlanState,
  joinPreview,
  openingBody,
  type JoinCaller,
  type JoinPreview,
} from "@/server/join/open";
import { logged, readAccountSession, readCookie } from "../../../accounts/route";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  storedCurrency,
  type PlanRow,
} from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpeningRouteContext = {
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

export async function planRoleFor(
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

function asOpeningCaller(
  role: PlanRole | null,
): JoinCaller | null {
  if (role === "organizer" || role === "participant" || role === "invited") {
    return role;
  }
  return null;
}

async function loadJoinPreview(plan: PlanRow): Promise<JoinPreview> {
  const organizerRows = await db()
    .select({ displayName: accounts.displayName })
    .from(accounts)
    .where(eq(accounts.id, plan.organizerAccountId))
    .limit(1);
  const windowRows = await db()
    .select({
      localDate: planWindows.localDate,
      startLocal: planWindows.startLocal,
      endLocal: planWindows.endLocal,
    })
    .from(planWindows)
    .where(eq(planWindows.planId, plan.id))
    .orderBy(asc(planWindows.position));
  const stepRows = await db()
    .select({ name: planSteps.name })
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
  return joinPreview({
    title: plan.title,
    organizer_display_name: organizerRows[0]?.displayName ?? "",
    timezone: plan.timezone,
    windows: windowRows.map((window) => ({
      local_date: window.localDate,
      start_local: window.startLocal,
      end_local: window.endLocal,
    })),
    budget: {
      amount_minor: plan.budgetAmountMinor,
      currency: storedCurrency(plan.currency),
    },
    step_names: stepRows.map((step) => step.name),
  });
}

export async function GET(
  request: Request,
  context: OpeningRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const caller = asOpeningCaller(await planRoleFor(request, plan));
  if (!caller) {
    return logged(request, notFoundResponse());
  }

  const state = asPlanState(plan.state);
  const next = openingBody(plan.id, caller, state, null).next;
  const preview = next === "join" ? await loadJoinPreview(plan) : null;
  return logged(
    request,
    NextResponse.json(openingBody(plan.id, caller, state, preview)),
  );
}
