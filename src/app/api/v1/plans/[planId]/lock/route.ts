import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { now } from "@/server/clock";
import { plans } from "@/server/db/schema";
import { httpError } from "@/server/http/errors";
import { asPlanState } from "@/server/join/open";
import { errorResponse, logged, rejectCsrf } from "../../../accounts/route";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  organizerOnlyResponse,
  planLockedResponse,
  storedState,
  type PlanRow,
} from "../../route";
import { loadConfirmedDocument } from "../confirmed/route";
import { planRoleFor } from "../opening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LockRouteContext = {
  params: Promise<{ planId: string }>;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type LockOutcome =
  | { kind: "missing" }
  | { kind: "locked" }
  | { kind: "not_proposed" }
  | { kind: "ok"; plan: PlanRow };

function notProposedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_proposed",
      message: "proposal is not available",
    }),
  );
}

function rejectNonOrganizer(
  role: Awaited<ReturnType<typeof planRoleFor>>,
): NextResponse | null {
  if (role === "organizer") {
    return null;
  }
  if (role === "participant" || role === "invited" || role === "link_reader") {
    return organizerOnlyResponse();
  }
  return notFoundResponse();
}

async function lockProposedPlan(planId: string): Promise<LockOutcome> {
  const instant = now();
  return db().transaction(async (tx: Transaction) => {
    const rows = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .for("update");
    const row = rows[0];
    if (!row) {
      return { kind: "missing" };
    }
    const state = storedState(asPlanState(row.state));
    if (state === "locked") {
      return { kind: "locked" };
    }
    if (state !== "proposed") {
      return { kind: "not_proposed" };
    }
    await tx
      .update(plans)
      .set({
        state: "locked",
        lockedAt: instant,
        updatedAt: instant,
      })
      .where(eq(plans.id, planId));
    return {
      kind: "ok",
      plan: { ...row, state: "locked", lockedAt: instant, updatedAt: instant },
    };
  });
}

export async function POST(
  request: Request,
  context: LockRouteContext,
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

  const denied = rejectNonOrganizer(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, denied);
  }

  const outcome = await lockProposedPlan(plan.id);
  if (outcome.kind === "missing") {
    return logged(request, notFoundResponse());
  }
  if (outcome.kind === "locked") {
    return logged(request, planLockedResponse());
  }
  if (outcome.kind === "not_proposed") {
    return logged(request, notProposedResponse());
  }

  return logged(
    request,
    NextResponse.json(await loadConfirmedDocument(outcome.plan)),
  );
}
