import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { now } from "@/server/clock";
import { accounts, invitations, participants, plans } from "@/server/db/schema";
import { generateId } from "@/server/ids";
import {
  accountNotFoundError,
  cannotInviteSelfError,
  invitationDistinguisher,
  inviteCallerError,
  parseInviteEmail,
  planLockedInviteError,
  sendInviteDecision,
} from "@/server/invites/send";
import { takenDistinguishers } from "@/server/join/open";
import {
  errorResponse,
  logged,
  readJsonObject,
  rejectCsrf,
  validationFailed,
} from "../../../accounts/route";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  storedState,
  type PlanRow,
} from "../../route";
import { planRoleFor } from "../opening/route";
import { loadSentInvitations } from "../invite/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvitationsRouteContext = {
  params: Promise<{ planId: string }>;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type InviteConflict = { inviteConflict: "plan_locked" };

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === "23505") {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function isInviteConflict(err: unknown): err is InviteConflict {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  return (err as { inviteConflict?: unknown }).inviteConflict === "plan_locked";
}

async function lockPlan(tx: Transaction, planId: string): Promise<PlanRow | null> {
  const rows = await tx
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .for("update");
  return rows[0] ?? null;
}

async function takenOnPlan(
  tx: Transaction,
  planId: string,
): Promise<Set<string>> {
  const participantRows = await tx
    .select({
      distinguisher: participants.distinguisher,
      accountId: participants.accountId,
    })
    .from(participants)
    .where(eq(participants.planId, planId));
  const invitationRows = await tx
    .select({
      distinguisher: invitations.distinguisher,
      accountId: invitations.accountId,
    })
    .from(invitations)
    .where(eq(invitations.planId, planId));
  const joinedAccounts = new Set(
    participantRows
      .map((row) => row.accountId)
      .filter((id): id is string => typeof id === "string"),
  );
  const pending = invitationRows
    .filter((row) => !joinedAccounts.has(row.accountId))
    .map((row) => row.distinguisher);
  return takenDistinguishers(
    participantRows.map((row) => row.distinguisher),
    pending,
  );
}

async function findAccountByEmail(email: string): Promise<{
  id: string;
  displayName: string;
} | null> {
  const rows = await db()
    .select({ id: accounts.id, displayName: accounts.displayName })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureInvitation(input: {
  planId: string;
  accountId: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const plan = await lockPlan(tx, input.planId);
    if (!plan) {
      throw new Error("plan missing during invite");
    }
    if (storedState(plan.state) === "locked") {
      throw Object.assign(new Error("plan_locked"), {
        inviteConflict: "plan_locked" as const,
      });
    }

    const existing = (
      await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.planId, input.planId),
            eq(invitations.accountId, input.accountId),
          ),
        )
        .limit(1)
    )[0];
    if (existing) {
      return;
    }

    const participant = (
      await tx
        .select({ distinguisher: participants.distinguisher })
        .from(participants)
        .where(
          and(
            eq(participants.planId, input.planId),
            eq(participants.accountId, input.accountId),
          ),
        )
        .limit(1)
    )[0];
    const taken = await takenOnPlan(tx, input.planId);
    const distinguisher = invitationDistinguisher({
      participantDistinguisher: participant?.distinguisher ?? null,
      taken,
    });
    try {
      await tx.insert(invitations).values({
        id: generateId("inv_"),
        planId: input.planId,
        accountId: input.accountId,
        distinguisher,
        createdAt: now(),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return;
      }
      throw err;
    }
  });
}

export async function POST(
  request: Request,
  context: InvitationsRouteContext,
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

  const denied = inviteCallerError(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, errorResponse(denied));
  }

  const body = (await readJsonObject(request)) ?? {};
  const parsed = parseInviteEmail(body.email);
  const matchedAccount = parsed.ok
    ? await findAccountByEmail(parsed.email)
    : null;
  const decision = sendInviteDecision({
    locked: storedState(plan.state) === "locked",
    email: body.email,
    organizerAccountId: plan.organizerAccountId,
    matchedAccount,
  });

  if (decision.action === "locked") {
    return logged(request, errorResponse(planLockedInviteError()));
  }
  if (decision.action === "invalid") {
    return logged(request, validationFailed(decision.fields));
  }
  if (decision.action === "unknown") {
    return logged(request, errorResponse(accountNotFoundError()));
  }
  if (decision.action === "self") {
    return logged(request, errorResponse(cannotInviteSelfError()));
  }

  try {
    await ensureInvitation({
      planId: plan.id,
      accountId: matchedAccount!.id,
    });
  } catch (err) {
    if (isInviteConflict(err)) {
      return logged(request, errorResponse(planLockedInviteError()));
    }
    throw err;
  }

  const [row] = await loadSentInvitations(plan.id, matchedAccount!.id);
  if (!row) {
    return logged(request, notFoundResponse());
  }
  return logged(request, NextResponse.json(row));
}
