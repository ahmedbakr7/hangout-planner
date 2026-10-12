import { desc, eq } from "drizzle-orm";
import { readAccountSession } from "@/server/auth/http";
import { accounts, invitations, plans } from "@/server/db/schema";
import { INBOX_LIMIT, db } from "@/server/invites/inbox";
import {
  inviteCallerError,
  inviteReadBody,
  type InviteReadBody,
} from "@/server/invites/send";
import { loadSentInvitations } from "@/server/invites/sent";
import { loadPlanRow, storedState } from "@/server/plans/http";
import { planRoleForCookies, type CookieReader } from "@/server/plans/role";

export type InvitePage =
  | { kind: "ok"; view: InviteReadBody }
  | { kind: "organizer_only" }
  | { kind: "not_found" }
  | { kind: "locked" };

export async function loadInvitePage(
  planId: string,
  readCookie: CookieReader,
): Promise<InvitePage> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return { kind: "not_found" };
  }

  const denied = inviteCallerError(await planRoleForCookies(readCookie, plan));
  if (denied) {
    return denied.status === 404
      ? { kind: "not_found" }
      : { kind: "organizer_only" };
  }
  if (storedState(plan.state) === "locked") {
    return { kind: "locked" };
  }

  const invitationsList = await loadSentInvitations(plan.id);
  return { kind: "ok", view: inviteReadBody(plan.joinToken, invitationsList) };
}

export type InboxView = {
  invitations: {
    plan_id: string;
    title: string;
    organizer_display_name: string;
  }[];
  truncated: boolean;
};

export type InvitationsPage =
  | { kind: "ok"; view: InboxView }
  | { kind: "signed_out" };

export async function loadInvitationsPage(
  readCookie: CookieReader,
): Promise<InvitationsPage> {
  const session = await readAccountSession(readCookie("hp_session"));
  if (!session.ok) {
    return { kind: "signed_out" };
  }

  const rows = await db()
    .select({
      planId: plans.id,
      title: plans.title,
      organizerDisplayName: accounts.displayName,
    })
    .from(invitations)
    .innerJoin(plans, eq(plans.id, invitations.planId))
    .innerJoin(accounts, eq(accounts.id, plans.organizerAccountId))
    .where(eq(invitations.accountId, session.account.id))
    .orderBy(desc(invitations.createdAt), desc(invitations.id))
    .limit(INBOX_LIMIT + 1);

  const truncated = rows.length > INBOX_LIMIT;
  const page = truncated ? rows.slice(0, INBOX_LIMIT) : rows;
  return {
    kind: "ok",
    view: {
      invitations: page.map((row) => ({
        plan_id: row.planId,
        title: row.title,
        organizer_display_name: row.organizerDisplayName,
      })),
      truncated,
    },
  };
}
