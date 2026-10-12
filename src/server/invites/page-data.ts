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
