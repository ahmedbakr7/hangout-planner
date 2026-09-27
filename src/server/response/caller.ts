import { and, eq } from "drizzle-orm";
import { readAccountSession, readCookie } from "@/server/auth/http";
import { hashCookieToken } from "@/server/auth/session";
import { now } from "@/server/clock";
import { guestSessions, participants } from "@/server/db/schema";
import { db } from "@/server/plans/http";

type ParticipantRow = {
  id: string;
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

export async function loadCallerParticipant(
  request: Request,
  planId: string,
): Promise<ParticipantRow | null> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (session.ok) {
    const rows = await db()
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.planId, planId),
          eq(participants.accountId, session.account.id),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return rows[0];
    }
  }
  const hash = tokenHash(readCookie(request, "hp_guest"));
  if (!hash) {
    return null;
  }
  const rows = await db()
    .select({ id: participants.id, expiresAt: guestSessions.expiresAt })
    .from(participants)
    .innerJoin(
      guestSessions,
      eq(guestSessions.id, participants.guestSessionId),
    )
    .where(
      and(eq(participants.planId, planId), eq(guestSessions.tokenHash, hash)),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !isFuture(row.expiresAt)) {
    return null;
  }
  return { id: row.id };
}
