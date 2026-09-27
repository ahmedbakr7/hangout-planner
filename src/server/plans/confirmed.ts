import { and, asc, eq, inArray } from "drizzle-orm";
import {
  participants,
  planSteps,
  proposalCohort,
  proposalLegs,
  proposalSteps,
  proposals,
} from "@/server/db/schema";
import type { CurrencyCode } from "@/server/money";
import { db, storedCurrency, type PlanRow } from "@/server/plans/http";

export type ConfirmedJson = {
  plan_id: string;
  title: string;
  state: "locked";
  time: { local_date: string; local_time: string; timezone: string };
  steps: {
    step_id: string;
    place_name: string;
    amount_minor: number;
    currency: CurrencyCode;
  }[];
  legs: {
    from_step_id: string;
    to_step_id: string;
    duration_seconds: number;
  }[];
  cohort: { display_name: string; distinguisher: string }[];
};

export async function loadConfirmedDocument(
  plan: PlanRow,
): Promise<ConfirmedJson> {
  const currency = storedCurrency(plan.currency);
  const proposalRows = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.planId, plan.id))
    .limit(1);
  const proposal = proposalRows[0];

  const stepRows = await db()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));

  if (!proposal) {
    return {
      plan_id: plan.id,
      title: plan.title,
      state: "locked",
      time: { local_date: "", local_time: "", timezone: plan.timezone },
      steps: [],
      legs: [],
      cohort: [],
    };
  }

  const stepIds = stepRows.map((step) => step.id);
  const storedSteps =
    stepIds.length === 0
      ? []
      : await db()
          .select()
          .from(proposalSteps)
          .where(
            and(
              eq(proposalSteps.proposalId, proposal.id),
              inArray(proposalSteps.stepId, stepIds),
            ),
          );
  const storedByStep = new Map(storedSteps.map((row) => [row.stepId, row]));

  const cohortRows = await db()
    .select({
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
    })
    .from(proposalCohort)
    .innerJoin(participants, eq(participants.id, proposalCohort.participantId))
    .where(eq(proposalCohort.proposalId, proposal.id))
    .orderBy(asc(participants.createdAt), asc(participants.id));

  const legRows = await db()
    .select()
    .from(proposalLegs)
    .where(eq(proposalLegs.proposalId, proposal.id));
  const legByFrom = new Map(legRows.map((row) => [row.fromStepId, row]));
  const legs: ConfirmedJson["legs"] = [];
  for (let i = 0; i < stepRows.length - 1; i += 1) {
    const from = stepRows[i];
    const to = stepRows[i + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    const leg = legByFrom.get(from.id);
    if (leg !== undefined && leg.toStepId === to.id && leg.durationSeconds >= 1) {
      legs.push({
        from_step_id: from.id,
        to_step_id: to.id,
        duration_seconds: leg.durationSeconds,
      });
    }
  }

  const steps: ConfirmedJson["steps"] = [];
  for (const step of stepRows) {
    const stored = storedByStep.get(step.id);
    if (stored === undefined) {
      continue;
    }
    steps.push({
      step_id: step.id,
      place_name: stored.placeName,
      amount_minor: stored.amountMinor,
      currency,
    });
  }

  return {
    plan_id: plan.id,
    title: plan.title,
    state: "locked",
    time: {
      local_date: proposal.localDate,
      local_time: proposal.localTime,
      timezone: plan.timezone,
    },
    steps,
    legs,
    cohort: cohortRows.map((row) => ({
      display_name: row.displayName,
      distinguisher: row.distinguisher,
    })),
  };
}
