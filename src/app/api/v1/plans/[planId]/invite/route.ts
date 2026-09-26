import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { accounts, invitations, participants, responses } from "@/server/db/schema";
import { isDistinguisher } from "@/server/ids";
import {
  inviteCallerError,
  inviteReadBody,
  planLockedInviteError,
  sentInvitation,
  type SentInvitation,
} from "@/server/invites/send";
import { errorResponse, logged } from "../../../accounts/route";
import { db, loadPlanRow, notFoundResponse, storedState } from "../../route";
import { planRoleFor } from "../opening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InviteRouteContext = {
  params: Promise<{ planId: string }>;
};

function rowDistinguisher(
  participantDistinguisher: string | null,
  invitationDistinguisher: string,
): string {
  if (
    participantDistinguisher !== null &&
    isDistinguisher(participantDistinguisher)
  ) {
    return participantDistinguisher;
  }
  return invitationDistinguisher;
}

export async function loadSentInvitations(
  planId: string,
  accountId?: string,
): Promise<SentInvitation[]> {
  const rows = await db()
    .select({
      displayName: accounts.displayName,
      invitationDistinguisher: invitations.distinguisher,
      participantDistinguisher: participants.distinguisher,
      complete: responses.complete,
    })
    .from(invitations)
    .innerJoin(accounts, eq(accounts.id, invitations.accountId))
    .leftJoin(
      participants,
      and(
        eq(participants.planId, invitations.planId),
        eq(participants.accountId, invitations.accountId),
      ),
    )
    .leftJoin(responses, eq(responses.participantId, participants.id))
    .where(
      accountId
        ? and(eq(invitations.planId, planId), eq(invitations.accountId, accountId))
        : eq(invitations.planId, planId),
    )
    .orderBy(asc(invitations.createdAt), asc(invitations.id));
  return rows.map((row) =>
    sentInvitation({
      displayName: row.displayName,
      distinguisher: rowDistinguisher(
        row.participantDistinguisher,
        row.invitationDistinguisher,
      ),
      hasParticipant: row.participantDistinguisher !== null,
      responseComplete: row.complete === true,
    }),
  );
}

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
