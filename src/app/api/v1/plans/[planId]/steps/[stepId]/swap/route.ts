import { NextResponse } from "next/server";
import { swapGoogleOptions } from "@/server/proposal/swap-google";
import { and, asc, eq, inArray } from "drizzle-orm";
import { now } from "@/server/clock";
import { httpError } from "@/server/http/errors";
import { asPlanState } from "@/server/join/open";
import type { CurrencyCode } from "@/server/money";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  participants,
  planOptions,
  planSteps,
  plans,
  proposalAlternatives,
  proposalCandidates,
  proposalCohort,
  proposalLegs,
  proposalSteps,
  proposals,
  responses,
  stepSignals,
} from "@/server/db/schema";
import {
  computeRouteMatrix,
  isUsableRouteMatrixElement,
  type GoogleClientOptions,
  type LatLng,
} from "@/server/google/routes";
import {
  fairnessWarning,
  isChainFair,
  maxTripMinusMedian,
} from "@/server/proposal/fairness";
import type { ChainInput } from "@/server/proposal/rank";
import {
  errorResponse,
  logged,
  readJsonObject,
  rejectCsrf,
  validationFailed,
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
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALTERNATIVE_CAP = 3;

type SwapRouteContext = {
  params: Promise<{ planId: string; stepId: string }>;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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

type Point = { id: string; location: LatLng };

type CandidatePlace = {
  googlePlaceId: string;
  placeName: string;
  amountMinor: number;
  location: LatLng;
};

type StepPlace = {
  stepId: string;
  optionId: string;
  googlePlaceId: string;
  placeName: string;
  amountMinor: number;
};

type SwapWrite = {
  placeName: string;
  amountMinor: number;
  googlePlaceId: string;
  fairnessWarning: boolean;
  touchingLegs: {
    fromStepId: string;
    toStepId: string;
    durationSeconds: number;
  }[];
  alternatives: { position: number; googlePlaceId: string }[];
};

function notProposedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_proposed",
      message: "proposal is not available",
    }),
  );
}

function notAnAlternativeResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_an_alternative",
      message: "place is not an alternative",
    }),
  );
}

function routeUnavailableResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "route_unavailable",
      message: "route is unavailable",
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

function parseGooglePlaceId(body: Record<string, unknown>): string | null {
  const value = body.google_place_id;
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function durationKey(fromId: string, toId: string): string {
  return `${fromId}\0${toId}`;
}

function comparePlaceIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function comparePlaceIdSequence(
  left: readonly string[],
  right: readonly string[],
): number {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    return comparePlaceIds(a, b);
  }
  return left.length - right.length;
}

function compareChains(left: ChainInput, right: ChainInput): number {
  const leftFair = isChainFair(left.memberTripSeconds);
  const rightFair = isChainFair(right.memberTripSeconds);
  if (leftFair !== rightFair) {
    return leftFair ? -1 : 1;
  }
  if (leftFair) {
    if (left.betweenPlaceDurationSum !== right.betweenPlaceDurationSum) {
      return left.betweenPlaceDurationSum - right.betweenPlaceDurationSum;
    }
  } else {
    const leftSpread = maxTripMinusMedian(left.memberTripSeconds);
    const rightSpread = maxTripMinusMedian(right.memberTripSeconds);
    if (leftSpread !== rightSpread) {
      return leftSpread - rightSpread;
    }
  }
  return comparePlaceIdSequence(left.placeIds, right.placeIds);
}

function chainFromPlaceIds(
  placeIds: readonly string[],
  memberIds: readonly string[],
  durations: Map<string, number>,
): ChainInput | null {
  let between = 0;
  for (let i = 0; i < placeIds.length - 1; i += 1) {
    const from = placeIds[i];
    const to = placeIds[i + 1];
    if (from === undefined || to === undefined) {
      return null;
    }
    const duration = durations.get(durationKey(from, to));
    if (duration === undefined || duration < 1) {
      return null;
    }
    between += duration;
  }
  const first = placeIds[0];
  if (first === undefined) {
    return null;
  }
  const memberTripSeconds: number[] = [];
  for (const memberId of memberIds) {
    const startLeg = durations.get(durationKey(memberId, first));
    if (startLeg === undefined || startLeg < 1) {
      return null;
    }
    memberTripSeconds.push(startLeg + between);
  }
  return {
    placeIds,
    betweenPlaceDurationSum: between,
    memberTripSeconds,
  };
}

async function fillDurations(
  origins: readonly Point[],
  destinations: readonly Point[],
  durations: Map<string, number>,
  google: GoogleClientOptions | undefined,
): Promise<boolean> {
  if (origins.length === 0 || destinations.length === 0) {
    return true;
  }
  try {
    const elements = await computeRouteMatrix(
      {
        origins: origins.map((point) => point.location),
        destinations: destinations.map((point) => point.location),
      },
      google,
    );
    for (const element of elements) {
      if (
        !isUsableRouteMatrixElement(element) ||
        element.durationSeconds === null
      ) {
        continue;
      }
      const from = origins[element.originIndex];
      const to = destinations[element.destinationIndex];
      if (from === undefined || to === undefined) {
        continue;
      }
      durations.set(durationKey(from.id, to.id), element.durationSeconds);
    }
    return true;
  } catch {
    return false;
  }
}

function candidateKey(stepId: string, placeId: string): string {
  return `${stepId}\0${placeId}`;
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
    .orderBy(
      asc(proposalAlternatives.stepId),
      asc(proposalAlternatives.position),
    );
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
  return NextResponse.json({
    state: "proposed",
    block: null,
    proposal: await loadOrganizerProposalJson(plan),
  });
}

function locationOf(
  candidates: Map<string, CandidatePlace>,
  stepId: string,
  placeId: string,
): LatLng | null {
  const found = candidates.get(candidateKey(stepId, placeId));
  if (!found) {
    return null;
  }
  return found.location;
}

async function planRoutesForSwap(input: {
  stepId: string;
  stepIndex: number;
  newPlace: CandidatePlace;
  storedSteps: StepPlace[];
  candidates: Map<string, CandidatePlace>;
  members: { participantId: string; start: LatLng }[];
  existingLegs: {
    fromStepId: string;
    toStepId: string;
    durationSeconds: number;
  }[];
  remaining: CandidatePlace[];
  google: GoogleClientOptions | undefined;
}): Promise<SwapWrite | "route_unavailable"> {
  const durations = new Map<string, number>();
  for (const leg of input.existingLegs) {
    if (leg.fromStepId !== input.stepId && leg.toStepId !== input.stepId) {
      durations.set(
        durationKey(leg.fromStepId, leg.toStepId),
        leg.durationSeconds,
      );
      durations.set(
        durationKey(
          input.storedSteps.find((step) => step.stepId === leg.fromStepId)
            ?.googlePlaceId ?? "",
          input.storedSteps.find((step) => step.stepId === leg.toStepId)
            ?.googlePlaceId ?? "",
        ),
        leg.durationSeconds,
      );
    }
  }

  const chainPlaceIds = input.storedSteps.map((step, index) =>
    index === input.stepIndex ? input.newPlace.googlePlaceId : step.googlePlaceId,
  );
  const firstPlaceId = chainPlaceIds[0];
  if (firstPlaceId === undefined) {
    return "route_unavailable";
  }

  const prev = input.stepIndex > 0 ? input.storedSteps[input.stepIndex - 1] : undefined;
  const next =
    input.stepIndex < input.storedSteps.length - 1
      ? input.storedSteps[input.stepIndex + 1]
      : undefined;

  const poolForStep: Point[] = [
    { id: input.newPlace.googlePlaceId, location: input.newPlace.location },
    ...input.remaining.map((place) => ({
      id: place.googlePlaceId,
      location: place.location,
    })),
  ];
  const starts: Point[] = input.members.map((member) => ({
    id: member.participantId,
    location: member.start,
  }));

  const firstStep = input.storedSteps[0];
  if (firstStep === undefined) {
    return "route_unavailable";
  }
  const firstDestinations: Point[] =
    input.stepIndex === 0
      ? poolForStep
      : (() => {
          const loc = locationOf(
            input.candidates,
            firstStep.stepId,
            firstStep.googlePlaceId,
          );
          if (loc === null) {
            return [];
          }
          return [{ id: firstStep.googlePlaceId, location: loc }];
        })();
  if (firstDestinations.length === 0) {
    return "route_unavailable";
  }

  const okStarts = await fillDurations(
    starts,
    firstDestinations,
    durations,
    input.google,
  );
  if (!okStarts) {
    return "route_unavailable";
  }

  if (prev !== undefined) {
    const prevLoc = locationOf(
      input.candidates,
      prev.stepId,
      prev.googlePlaceId,
    );
    if (prevLoc === null) {
      return "route_unavailable";
    }
    const okPrev = await fillDurations(
      [{ id: prev.googlePlaceId, location: prevLoc }],
      poolForStep,
      durations,
      input.google,
    );
    if (!okPrev) {
      return "route_unavailable";
    }
  }

  if (next !== undefined) {
    const nextLoc = locationOf(
      input.candidates,
      next.stepId,
      next.googlePlaceId,
    );
    if (nextLoc === null) {
      return "route_unavailable";
    }
    const okNext = await fillDurations(
      poolForStep,
      [{ id: next.googlePlaceId, location: nextLoc }],
      durations,
      input.google,
    );
    if (!okNext) {
      return "route_unavailable";
    }
  }

  const memberIds = input.members.map((member) => member.participantId);
  const chosen = chainFromPlaceIds(chainPlaceIds, memberIds, durations);
  if (chosen === null) {
    return "route_unavailable";
  }

  const touchingLegs: SwapWrite["touchingLegs"] = [];
  if (prev !== undefined) {
    const duration = durations.get(
      durationKey(prev.googlePlaceId, input.newPlace.googlePlaceId),
    );
    if (duration === undefined || duration < 1) {
      return "route_unavailable";
    }
    touchingLegs.push({
      fromStepId: prev.stepId,
      toStepId: input.stepId,
      durationSeconds: duration,
    });
  }
  if (next !== undefined) {
    const duration = durations.get(
      durationKey(input.newPlace.googlePlaceId, next.googlePlaceId),
    );
    if (duration === undefined || duration < 1) {
      return "route_unavailable";
    }
    touchingLegs.push({
      fromStepId: input.stepId,
      toStepId: next.stepId,
      durationSeconds: duration,
    });
  }

  const scored: { placeId: string; input: ChainInput }[] = [];
  for (const place of input.remaining) {
    const substituted = chainPlaceIds.slice();
    substituted[input.stepIndex] = place.googlePlaceId;
    const chain = chainFromPlaceIds(substituted, memberIds, durations);
    if (chain !== null) {
      scored.push({ placeId: place.googlePlaceId, input: chain });
    }
  }
  scored.sort((left, right) => compareChains(left.input, right.input));
  const picked = scored.slice(0, ALTERNATIVE_CAP);
  const alternatives: SwapWrite["alternatives"] = [];
  for (let position = 0; position < picked.length; position += 1) {
    const row = picked[position];
    if (row === undefined) {
      continue;
    }
    alternatives.push({ position, googlePlaceId: row.placeId });
  }

  return {
    placeName: input.newPlace.placeName,
    amountMinor: input.newPlace.amountMinor,
    googlePlaceId: input.newPlace.googlePlaceId,
    fairnessWarning: fairnessWarning(chosen.memberTripSeconds),
    touchingLegs,
    alternatives,
  };
}

async function applySwap(
  planId: string,
  proposalId: string,
  stepId: string,
  googlePlaceId: string,
  write: SwapWrite,
): Promise<"ok" | "not_proposed" | "plan_locked" | "not_an_alternative"> {
  return db().transaction(async (tx: Transaction) => {
    const planRows = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .for("update");
    const plan = planRows[0];
    if (!plan) {
      return "not_proposed" as const;
    }
    const state = storedState(asPlanState(plan.state));
    if (state === "locked") {
      return "plan_locked" as const;
    }
    if (state !== "proposed") {
      return "not_proposed" as const;
    }
    const stillAlt = await tx
      .select({ googlePlaceId: proposalAlternatives.googlePlaceId })
      .from(proposalAlternatives)
      .where(
        and(
          eq(proposalAlternatives.proposalId, proposalId),
          eq(proposalAlternatives.stepId, stepId),
          eq(proposalAlternatives.googlePlaceId, googlePlaceId),
        ),
      )
      .limit(1);
    if (!stillAlt[0]) {
      return "not_an_alternative" as const;
    }

    const instant = now();
    await tx
      .update(proposalSteps)
      .set({
        googlePlaceId: write.googlePlaceId,
        placeName: write.placeName,
        amountMinor: write.amountMinor,
      })
      .where(
        and(
          eq(proposalSteps.proposalId, proposalId),
          eq(proposalSteps.stepId, stepId),
        ),
      );
    await tx
      .update(proposals)
      .set({ fairnessWarning: write.fairnessWarning })
      .where(eq(proposals.id, proposalId));
    for (const leg of write.touchingLegs) {
      const existing = await tx
        .select({ fromStepId: proposalLegs.fromStepId })
        .from(proposalLegs)
        .where(
          and(
            eq(proposalLegs.proposalId, proposalId),
            eq(proposalLegs.fromStepId, leg.fromStepId),
            eq(proposalLegs.toStepId, leg.toStepId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(proposalLegs)
          .set({ durationSeconds: leg.durationSeconds })
          .where(
            and(
              eq(proposalLegs.proposalId, proposalId),
              eq(proposalLegs.fromStepId, leg.fromStepId),
              eq(proposalLegs.toStepId, leg.toStepId),
            ),
          );
      } else {
        await tx.insert(proposalLegs).values({
          proposalId,
          fromStepId: leg.fromStepId,
          toStepId: leg.toStepId,
          durationSeconds: leg.durationSeconds,
        });
      }
    }
    await tx
      .delete(stepSignals)
      .where(
        and(eq(stepSignals.proposalId, proposalId), eq(stepSignals.stepId, stepId)),
      );
    await tx
      .delete(proposalAlternatives)
      .where(
        and(
          eq(proposalAlternatives.proposalId, proposalId),
          eq(proposalAlternatives.stepId, stepId),
        ),
      );
    if (write.alternatives.length > 0) {
      await tx.insert(proposalAlternatives).values(
        write.alternatives.map((row) => ({
          proposalId,
          stepId,
          position: row.position,
          googlePlaceId: row.googlePlaceId,
        })),
      );
    }
    await tx
      .update(plans)
      .set({ updatedAt: instant })
      .where(eq(plans.id, planId));
    return "ok" as const;
  });
}

export async function POST(
  request: Request,
  context: SwapRouteContext,
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

  const denied = rejectNonOrganizer(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, denied);
  }

  const state: PlanState = storedState(asPlanState(plan.state));
  if (state === "locked") {
    return logged(request, planLockedResponse());
  }
  if (state !== "proposed") {
    return logged(request, notProposedResponse());
  }

  const body = await readJsonObject(request);
  if (!body) {
    return logged(
      request,
      validationFailed([{ path: "google_place_id", code: "required" }]),
    );
  }
  const googlePlaceId = parseGooglePlaceId(body);
  if (googlePlaceId === null) {
    const code =
      body.google_place_id === undefined ? "required" : "unknown";
    return logged(
      request,
      validationFailed([{ path: "google_place_id", code }]),
    );
  }

  const stepRows = await db()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
  const stepIndex = stepRows.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) {
    return logged(request, notFoundResponse());
  }

  const proposalRows = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.planId, plan.id))
    .limit(1);
  const proposal = proposalRows[0];
  if (!proposal) {
    return logged(request, notProposedResponse());
  }

  const altRows = await db()
    .select({ googlePlaceId: proposalAlternatives.googlePlaceId })
    .from(proposalAlternatives)
    .where(
      and(
        eq(proposalAlternatives.proposalId, proposal.id),
        eq(proposalAlternatives.stepId, stepId),
        eq(proposalAlternatives.googlePlaceId, googlePlaceId),
      ),
    )
    .limit(1);
  if (!altRows[0]) {
    return logged(request, notAnAlternativeResponse());
  }

  const candidateRows = await db()
    .select()
    .from(proposalCandidates)
    .where(eq(proposalCandidates.proposalId, proposal.id));
  const candidates = new Map<string, CandidatePlace>();
  for (const row of candidateRows) {
    candidates.set(candidateKey(row.stepId, row.googlePlaceId), {
      googlePlaceId: row.googlePlaceId,
      placeName: row.placeName,
      amountMinor: row.amountMinor,
      location: { latitude: row.latitude, longitude: row.longitude },
    });
  }
  const newPlace = candidates.get(candidateKey(stepId, googlePlaceId));
  if (!newPlace) {
    return logged(request, notAnAlternativeResponse());
  }

  const storedStepRows = await db()
    .select()
    .from(proposalSteps)
    .where(eq(proposalSteps.proposalId, proposal.id));
  const storedByStep = new Map(storedStepRows.map((row) => [row.stepId, row]));
  const storedSteps: StepPlace[] = [];
  for (const step of stepRows) {
    const stored = storedByStep.get(step.id);
    if (stored === undefined) {
      return logged(request, notProposedResponse());
    }
    storedSteps.push({
      stepId: stored.stepId,
      optionId: stored.optionId,
      googlePlaceId: stored.googlePlaceId,
      placeName: stored.placeName,
      amountMinor: stored.amountMinor,
    });
  }

  const remaining: CandidatePlace[] = [];
  for (const row of candidateRows) {
    if (row.stepId === stepId && row.googlePlaceId !== googlePlaceId) {
      const place = candidates.get(candidateKey(row.stepId, row.googlePlaceId));
      if (place !== undefined) {
        remaining.push(place);
      }
    }
  }

  const memberRows = await db()
    .select({
      participantId: proposalCohort.participantId,
      startLat: responses.startLat,
      startLng: responses.startLng,
    })
    .from(proposalCohort)
    .leftJoin(responses, eq(responses.participantId, proposalCohort.participantId))
    .where(eq(proposalCohort.proposalId, proposal.id));
  const members: { participantId: string; start: LatLng }[] = [];
  for (const row of memberRows) {
    if (
      typeof row.startLat !== "number" ||
      typeof row.startLng !== "number" ||
      !Number.isFinite(row.startLat) ||
      !Number.isFinite(row.startLng)
    ) {
      return logged(request, routeUnavailableResponse());
    }
    members.push({
      participantId: row.participantId,
      start: { latitude: row.startLat, longitude: row.startLng },
    });
  }

  const existingLegs = await db()
    .select()
    .from(proposalLegs)
    .where(eq(proposalLegs.proposalId, proposal.id));

  const routed = await planRoutesForSwap({
    stepId,
    stepIndex,
    newPlace,
    storedSteps,
    candidates,
    members,
    existingLegs: existingLegs.map((leg) => ({
      fromStepId: leg.fromStepId,
      toStepId: leg.toStepId,
      durationSeconds: leg.durationSeconds,
    })),
    remaining,
    google: swapGoogleOptions(),
  });
  if (routed === "route_unavailable") {
    return logged(request, routeUnavailableResponse());
  }

  const applied = await applySwap(
    plan.id,
    proposal.id,
    stepId,
    googlePlaceId,
    routed,
  );
  if (applied === "plan_locked") {
    return logged(request, planLockedResponse());
  }
  if (applied === "not_proposed") {
    return logged(request, notProposedResponse());
  }
  if (applied === "not_an_alternative") {
    return logged(request, notAnAlternativeResponse());
  }

  return logged(request, await organizerProposalDocument(plan.id));
}
