import { and, asc, eq } from "drizzle-orm";
import { accounts, invitations, participants, responses } from "@/server/db/schema";
import { isDistinguisher } from "@/server/ids";
import { sentInvitation, type SentInvitation } from "@/server/invites/send";
import { db } from "@/server/plans/http";

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
