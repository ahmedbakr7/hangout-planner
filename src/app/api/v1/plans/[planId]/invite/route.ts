import { NextResponse } from "next/server";
import { errorResponse, logged } from "@/server/auth/http";
import {
  inviteCallerError,
  inviteReadBody,
  planLockedInviteError,
} from "@/server/invites/send";
import { loadSentInvitations } from "@/server/invites/sent";
import { loadPlanRow, notFoundResponse, storedState } from "@/server/plans/http";
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InviteRouteContext = {
  params: Promise<{ planId: string }>;
};

export async function GET(
  request: Request,
  context: InviteRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const denied = inviteCallerError(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, errorResponse(denied));
  }
  if (storedState(plan.state) === "locked") {
    return logged(request, errorResponse(planLockedInviteError()));
  }

  const invitationsList = await loadSentInvitations(plan.id);
  return logged(
    request,
    NextResponse.json(inviteReadBody(plan.joinToken, invitationsList)),
  );
}
