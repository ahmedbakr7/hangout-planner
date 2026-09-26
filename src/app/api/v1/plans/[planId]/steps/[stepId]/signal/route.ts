import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { now } from "@/server/clock";
import { httpError } from "@/server/http/errors";
import { asPlanState } from "@/server/join/open";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  planSteps,
  plans,
  proposalCohort,
  proposals,
  stepSignals,
} from "@/server/db/schema";
import {
  errorResponse,
  logged,
  readJsonObject,
  rejectCsrf,
  validationFailed,
} from "../../../../../accounts/route";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  planLockedResponse,
  storedState,
} from "../../../../route";
import { planRoleFor } from "../../../opening/route";
import { loadCallerParticipant } from "../../../response/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignalRouteContext = {
  params: Promise<{ planId: string; stepId: string }>;
};

type SignalValue = "like" | "dislike" | "unset";

function notProposedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_proposed",
      message: "proposal is not available",
    }),
  );
}

function notCohortResponse(): NextResponse {
  return errorResponse(
    httpError(403, {
      reason: "not_cohort",
      message: "not a cohort member",
    }),
  );
}

function parseSignal(body: Record<string, unknown>): SignalValue | "invalid" | "missing" {
  if (body.signal === undefined) {
    return "missing";
  }
  if (body.signal === "like" || body.signal === "dislike" || body.signal === "unset") {
    return body.signal;
  }
  return "invalid";
}

export async function PUT(
  request: Request,
  context: SignalRouteContext,
): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const { planId, stepId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const role = await planRoleFor(request, plan);
  if (role === null) {
    return logged(request, notFoundResponse());
  }
  if (role !== "participant") {
    return logged(request, notCohortResponse());
  }

  const caller = await loadCallerParticipant(request, plan.id);
  if (!caller) {
    return logged(request, notFoundResponse());
  }

  const state: PlanState = storedState(asPlanState(plan.state));
  const proposalRows = await db()
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.planId, plan.id))
    .limit(1);
  const proposal = proposalRows[0];
  if (proposal) {
    const cohortRows = await db()
      .select({ participantId: proposalCohort.participantId })
      .from(proposalCohort)
      .where(
        and(
          eq(proposalCohort.proposalId, proposal.id),
          eq(proposalCohort.participantId, caller.id),
        ),
      )
      .limit(1);
    if (!cohortRows[0]) {
      return logged(request, notCohortResponse());
    }
  }

  const body = await readJsonObject(request);
  if (!body) {
    return logged(
      request,
      validationFailed([{ path: "signal", code: "required" }]),
    );
  }
  const parsed = parseSignal(body);
  if (parsed === "missing") {
    return logged(
      request,
      validationFailed([{ path: "signal", code: "required" }]),
    );
  }
  if (parsed === "invalid") {
    return logged(
      request,
      validationFailed([{ path: "signal", code: "not_one" }]),
    );
  }

  const stepRows = await db()
    .select({ id: planSteps.id })
    .from(planSteps)
    .where(and(eq(planSteps.planId, plan.id), eq(planSteps.id, stepId)))
    .limit(1);
  if (!stepRows[0]) {
    return logged(request, notFoundResponse());
  }

  if (state === "locked") {
    return logged(request, planLockedResponse());
  }
  if (state !== "proposed" || !proposal) {
    return logged(request, notProposedResponse());
  }

  const result = await db().transaction(async (tx) => {
    const planRows = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, plan.id))
      .for("update");
    const locked = planRows[0];
    if (!locked) {
      return { status: "not_found" as const };
    }
    const nextState: PlanState = storedState(asPlanState(locked.state));
    if (nextState === "locked") {
      return { status: "plan_locked" as const };
    }
    if (nextState !== "proposed") {
      return { status: "not_proposed" as const };
    }

    const liveProposal = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.planId, plan.id))
      .limit(1);
    const live = liveProposal[0];
    if (!live) {
      return { status: "not_proposed" as const };
    }

    const cohortRows = await tx
      .select({ participantId: proposalCohort.participantId })
      .from(proposalCohort)
      .where(
        and(
          eq(proposalCohort.proposalId, live.id),
          eq(proposalCohort.participantId, caller.id),
        ),
      )
      .limit(1);
    if (!cohortRows[0]) {
      return { status: "not_cohort" as const };
    }

    if (parsed === "unset") {
      await tx
        .delete(stepSignals)
        .where(
          and(
            eq(stepSignals.proposalId, live.id),
            eq(stepSignals.stepId, stepId),
            eq(stepSignals.participantId, caller.id),
          ),
        );
    } else {
      const existing = await tx
        .select({ signal: stepSignals.signal })
        .from(stepSignals)
        .where(
          and(
            eq(stepSignals.proposalId, live.id),
            eq(stepSignals.stepId, stepId),
            eq(stepSignals.participantId, caller.id),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(stepSignals)
          .set({ signal: parsed })
          .where(
            and(
              eq(stepSignals.proposalId, live.id),
              eq(stepSignals.stepId, stepId),
              eq(stepSignals.participantId, caller.id),
            ),
          );
      } else {
        await tx.insert(stepSignals).values({
          proposalId: live.id,
          stepId,
          participantId: caller.id,
          signal: parsed,
        });
      }
    }

    await tx
      .update(plans)
      .set({ updatedAt: now() })
      .where(eq(plans.id, plan.id));
    return { status: "ok" as const, signal: parsed };
  });

  if (result.status === "not_found") {
    return logged(request, notFoundResponse());
  }
  if (result.status === "plan_locked") {
    return logged(request, planLockedResponse());
  }
  if (result.status === "not_proposed") {
    return logged(request, notProposedResponse());
  }
  if (result.status === "not_cohort") {
    return logged(request, notCohortResponse());
  }
  return logged(request, NextResponse.json({ signal: result.signal }));
}
