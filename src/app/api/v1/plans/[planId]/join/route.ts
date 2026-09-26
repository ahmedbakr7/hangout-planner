import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { invitations, participants, plans } from "@/server/db/schema";
import { generateId, isDistinguisher } from "@/server/ids";
import {
  allocateDistinguisher,
  asPlanState,
  joinConflictError,
  joinDecision,
  joinParticipantView,
  participantNext,
  takenDistinguishers,
  type JoinConflictReason,
  type JoinParticipantView,
  type ParticipantNext,
} from "@/server/join/open";
import {
  errorResponse,
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
  readJsonObject,
  rejectCsrf,
  validationFailed,
} from "../../../accounts/route";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  type PlanRow,
} from "../../route";
import { planRoleFor } from "../opening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JoinRouteContext = {
  params: Promise<{ planId: string }>;
};

type ParticipantRow = {
  id: string;
  displayName: string;
  distinguisher: string;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type JoinConflict = { joinConflict: JoinConflictReason };

function joinResponse(
  participant: JoinParticipantView,
  next: ParticipantNext,
  status: 200 | 201,
): NextResponse {
  return NextResponse.json({ participant, next }, { status });
}

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

function isJoinConflict(err: unknown): err is JoinConflict {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const reason = (err as { joinConflict?: unknown }).joinConflict;
  return (
    reason === "organizer_cannot_join" ||
    reason === "plan_locked" ||
    reason === "plan_full"
  );
}

function parseAccountJoin(
  body: Record<string, unknown>,
): { ok: true } | { ok: false; fields: { path: string; code: "required" | "not_one" }[] } {
  if (typeof body.kind !== "string" || body.kind.length === 0) {
    return { ok: false, fields: [{ path: "kind", code: "required" }] };
  }
  if (body.kind !== "account") {
    return { ok: false, fields: [{ path: "kind", code: "not_one" }] };
  }
  return { ok: true };
}

async function findAccountParticipant(
  planId: string,
  accountId: string,
): Promise<ParticipantRow | null> {
  const rows = await db()
    .select({
      id: participants.id,
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
    })
    .from(participants)
    .where(
      and(eq(participants.planId, planId), eq(participants.accountId, accountId)),
    )
    .limit(1);
  return rows[0] ?? null;
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

async function participantCount(planId: string): Promise<number> {
  const rows = await db()
    .select({ value: count() })
    .from(participants)
    .where(eq(participants.planId, planId));
  return Number(rows[0]?.value ?? 0);
}

async function lockPlan(tx: Transaction, planId: string): Promise<PlanRow | null> {
  const rows = await tx
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .for("update");
  return rows[0] ?? null;
}

async function takenOnPlan(tx: Transaction, planId: string): Promise<{
  taken: Set<string>;
  participantDistinguishers: Set<string>;
  invitationDistinguisher: Map<string, string>;
}> {
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
  const participantDistinguishers = new Set(
    participantRows.map((row) => row.distinguisher),
  );
  return {
    taken: takenDistinguishers(
      participantRows.map((row) => row.distinguisher),
      pending,
    ),
    participantDistinguishers,
    invitationDistinguisher: new Map(
      invitationRows.map((row) => [row.accountId, row.distinguisher]),
    ),
  };
}

async function insertAccountJoin(input: {
  planId: string;
  accountId: string;
  displayName: string;
}): Promise<{ participant: ParticipantRow; created: boolean }> {
  return db().transaction(async (tx) => {
    const plan = await lockPlan(tx, input.planId);
    if (!plan) {
      throw new Error("plan missing during join");
    }

    const existing = (
      await tx
        .select({
          id: participants.id,
          displayName: participants.displayName,
          distinguisher: participants.distinguisher,
        })
        .from(participants)
        .where(
          and(
            eq(participants.planId, input.planId),
            eq(participants.accountId, input.accountId),
          ),
        )
        .limit(1)
    )[0];
    if (existing) {
      return { participant: existing, created: false };
    }

    const countRows = await tx
      .select({ value: count() })
      .from(participants)
      .where(eq(participants.planId, input.planId));
    const decision = joinDecision({
      isOrganizer: input.accountId === plan.organizerAccountId,
      locked: asPlanState(plan.state) === "locked",
      alreadyParticipant: false,
      participantCount: Number(countRows[0]?.value ?? 0),
    });
    if (decision.action === "conflict") {
      throw Object.assign(new Error(decision.reason), {
        joinConflict: decision.reason,
      });
    }

    const { taken, participantDistinguishers, invitationDistinguisher } =
      await takenOnPlan(tx, input.planId);
    const invitedDistinguisher = invitationDistinguisher.get(input.accountId);
    const distinguisher =
      invitedDistinguisher &&
      isDistinguisher(invitedDistinguisher) &&
      !participantDistinguishers.has(invitedDistinguisher)
        ? invitedDistinguisher
        : allocateDistinguisher(taken);
    const row: ParticipantRow = {
      id: generateId("prt_"),
      displayName: input.displayName,
      distinguisher,
    };
    try {
      await tx.insert(participants).values({
        id: row.id,
        planId: input.planId,
        accountId: input.accountId,
        guestSessionId: null,
        displayName: input.displayName,
        distinguisher,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await tx
          .select({
            id: participants.id,
            displayName: participants.displayName,
            distinguisher: participants.distinguisher,
          })
          .from(participants)
          .where(
            and(
              eq(participants.planId, input.planId),
              eq(participants.accountId, input.accountId),
            ),
          )
          .limit(1);
        if (raced[0]) {
          return { participant: raced[0], created: false };
        }
      }
      throw err;
    }
    return { participant: row, created: true };
  });
}

export async function POST(
  request: Request,
  context: JoinRouteContext,
): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const role = await planRoleFor(request, plan);
  const accountId = session.account.id;
  const isOrganizer = accountId === plan.organizerAccountId;
  const existing = await findAccountParticipant(plan.id, accountId);
  const invited = await accountInvited(plan.id, accountId);
  if (
    (role !== "organizer" && role !== "participant" && role !== "invited") ||
    (!isOrganizer && existing === null && !invited)
  ) {
    return logged(request, notFoundResponse());
  }

  const raw = await readJsonObject(request);
  if (!raw) {
    return logged(
      request,
      validationFailed([{ path: "kind", code: "required" }]),
    );
  }
  const parsed = parseAccountJoin(raw);
  if (!parsed.ok) {
    return logged(request, validationFailed(parsed.fields));
  }

  const state = asPlanState(plan.state);
  const decision = joinDecision({
    isOrganizer,
    locked: state === "locked",
    alreadyParticipant: existing !== null,
    participantCount: existing ? 0 : await participantCount(plan.id),
  });
  if (decision.action === "conflict") {
    return logged(request, errorResponse(joinConflictError(decision.reason)));
  }
  if (decision.action === "existing" && existing) {
    return logged(
      request,
      joinResponse(joinParticipantView(existing), participantNext(state), 200),
    );
  }

  try {
    const inserted = await insertAccountJoin({
      planId: plan.id,
      accountId,
      displayName: session.account.display_name,
    });
    return logged(
      request,
      joinResponse(
        joinParticipantView(inserted.participant),
        participantNext(state),
        inserted.created ? 201 : 200,
      ),
    );
  } catch (err) {
    if (isJoinConflict(err)) {
      return logged(request, errorResponse(joinConflictError(err.joinConflict)));
    }
    throw err;
  }
}
