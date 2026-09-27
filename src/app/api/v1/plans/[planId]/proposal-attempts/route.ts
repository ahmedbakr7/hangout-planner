import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { asPlanState } from "@/server/join/open";
import type { CurrencyCode } from "@/server/money";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  participants,
  planOptions,
  planSteps,
  proposalAlternatives,
  proposalCandidates,
  proposalCohort,
  proposalLegs,
  proposalRuns,
  proposalSteps,
  proposals,
  stepSignals,
} from "@/server/db/schema";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import {
  logged,
  readCookie,
  rejectCsrf,
} from "@/server/auth/http";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  organizerOnlyResponse,
  planLockedResponse,
  storedCurrency,
  storedState,
  type PlanRow,
} from "@/server/plans/http";
import {
  attemptInProgressResponse,
  notBlockedResponse,
  proposalAttemptHourCapResponse,
  runTriggeredAttempt,
} from "@/server/proposal/trigger";
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AttemptsRouteContext = {
  params: Promise<{ planId: string }>;
};

type PlaceMoney = {
  name: string;
  amount_minor: number;
  currency: CurrencyCode;
};

type AlternativeJson = {
  google_place_id: string;
  name: string;
  amount_minor: number;
  currency: CurrencyCode;
};

type OrganizerStepJson = {
  step_id: string;
  name: string;
  option_label: string;
  place: PlaceMoney;
  like_count: number;
  dislike_count: number;
  alternatives: AlternativeJson[];
};

type ProposalJson = {
  time: { local_date: string; local_time: string; timezone: string };
  attending_count: number;
  cohort_size: number;
  cohort: { display_name: string; distinguisher: string; attending: boolean }[];
  fairness_warning: boolean;
  steps: OrganizerStepJson[];
  legs: { from_step_id: string; to_step_id: string; duration_seconds: number }[];
};

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

async function latestBlock(planId: string): Promise<{
  time: boolean;
  budget: boolean;
  venue_data: boolean;
}> {
  const rows = await db()
    .select({
      time: proposalRuns.blockTime,
      budget: proposalRuns.blockBudget,
      venueData: proposalRuns.blockVenueData,
    })
    .from(proposalRuns)
    .where(eq(proposalRuns.planId, planId))
    .orderBy(desc(proposalRuns.startedAt), desc(proposalRuns.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { time: false, budget: false, venue_data: false };
  }
  return { time: row.time, budget: row.budget, venue_data: row.venueData };
}

async function loadOrganizerProposalJson(
  plan: PlanRow,
): Promise<ProposalJson | null> {
  const proposalRows = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.planId, plan.id))
    .limit(1);
  const proposal = proposalRows[0];
  if (!proposal) {
    return null;
  }

  const currency = storedCurrency(plan.currency);
  const stepRows = await db()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
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
  const optionIds = storedSteps.map((row) => row.optionId);
  const optionRows =
    optionIds.length === 0
      ? []
      : await db()
          .select()
          .from(planOptions)
          .where(inArray(planOptions.id, optionIds));
  const optionById = new Map(optionRows.map((row) => [row.id, row.label]));

  const candidateRows = await db()
    .select()
    .from(proposalCandidates)
    .where(eq(proposalCandidates.proposalId, proposal.id));
  const candidateKey = (stepId: string, placeId: string): string =>
    `${stepId}\0${placeId}`;
  const candidateByKey = new Map(
    candidateRows.map((row) => [
      candidateKey(row.stepId, row.googlePlaceId),
      row,
    ]),
  );

  const alternativeRows = await db()
    .select()
    .from(proposalAlternatives)
    .where(eq(proposalAlternatives.proposalId, proposal.id))
    .orderBy(asc(proposalAlternatives.stepId), asc(proposalAlternatives.position));
  const alternativesByStep = new Map<string, AlternativeJson[]>();
  for (const row of alternativeRows) {
    const candidate = candidateByKey.get(
      candidateKey(row.stepId, row.googlePlaceId),
    );
    const list = alternativesByStep.get(row.stepId) ?? [];
    list.push({
      google_place_id: row.googlePlaceId,
      name: candidate?.placeName ?? row.googlePlaceId,
      amount_minor: candidate?.amountMinor ?? 0,
      currency,
    });
    alternativesByStep.set(row.stepId, list);
  }

  const signalRows = await db()
    .select()
    .from(stepSignals)
    .where(eq(stepSignals.proposalId, proposal.id));
  const likeByStep = new Map<string, number>();
  const dislikeByStep = new Map<string, number>();
  for (const row of signalRows) {
    if (row.signal === "like") {
      likeByStep.set(row.stepId, (likeByStep.get(row.stepId) ?? 0) + 1);
    } else if (row.signal === "dislike") {
      dislikeByStep.set(row.stepId, (dislikeByStep.get(row.stepId) ?? 0) + 1);
    }
  }

  const cohortRows = await db()
    .select({
      participantId: proposalCohort.participantId,
      attending: proposalCohort.attending,
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
      createdAt: participants.createdAt,
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
  const legs: ProposalJson["legs"] = [];
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

  const steps: OrganizerStepJson[] = [];
  for (const step of stepRows) {
    const stored = storedByStep.get(step.id);
    if (stored === undefined) {
      continue;
    }
    steps.push({
      step_id: step.id,
      name: step.name,
      option_label: optionById.get(stored.optionId) ?? "",
      place: {
        name: stored.placeName,
        amount_minor: stored.amountMinor,
        currency,
      },
      like_count: likeByStep.get(step.id) ?? 0,
      dislike_count: dislikeByStep.get(step.id) ?? 0,
      alternatives: alternativesByStep.get(step.id) ?? [],
    });
  }

  let attendingCount = 0;
  for (const row of cohortRows) {
    if (row.attending) {
      attendingCount += 1;
    }
  }

  return {
    time: {
      local_date: proposal.localDate,
      local_time: proposal.localTime,
      timezone: plan.timezone,
    },
    attending_count: attendingCount,
    cohort_size: cohortRows.length,
    cohort: cohortRows.map((row) => ({
      display_name: row.displayName,
      distinguisher: row.distinguisher,
      attending: row.attending,
    })),
    fairness_warning: proposal.fairnessWarning,
    steps,
    legs,
  };
}

async function organizerProposalDocument(
  planId: string,
): Promise<NextResponse> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return notFoundResponse();
  }
  const state: PlanState = storedState(asPlanState(plan.state));
  if (state === "collecting") {
    return NextResponse.json({
      state: "collecting",
      block: null,
      proposal: null,
    });
  }
  if (state === "blocked") {
    return NextResponse.json({
      state: "blocked",
      block: await latestBlock(plan.id),
      proposal: null,
    });
  }
  return NextResponse.json({
    state: "proposed",
    block: null,
    proposal: await loadOrganizerProposalJson(plan),
  });
}

export async function POST(
  request: Request,
  context: AttemptsRouteContext,
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

  const state = storedState(asPlanState(plan.state));
  if (state === "locked") {
    return logged(request, planLockedResponse());
  }
  if (state !== "blocked") {
    return logged(request, notBlockedResponse());
  }

  const languageCode = localeFromCookie(
    readCookie(request, LOCALE_COOKIE) ?? undefined,
  );
  const triggered = await runTriggeredAttempt(plan.id, languageCode);
  if (triggered.status === "hour_full") {
    return logged(request, proposalAttemptHourCapResponse());
  }
  if (triggered.status === "attempt_in_progress") {
    return logged(request, attemptInProgressResponse());
  }

  return logged(request, await organizerProposalDocument(plan.id));
}
