import { and, eq } from "drizzle-orm";
import { readAccountSession, readCookie } from "@/server/auth/http";
import { authorize, type PlanRole } from "@/server/auth/authorize";
import { hashCookieToken } from "@/server/auth/session";
import { now } from "@/server/clock";
import {
  guestSessions,
  invitations,
  linkSessionPlans,
  linkSessions,
  participants,
} from "@/server/db/schema";
import { db, type PlanRow } from "@/server/plans/http";

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
