import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { now } from "@/server/clock";
import { createDb } from "@/server/db/client";
import {
  participants,
  planOptions,
  planSteps,
  planWindows,
  plans,
  proposalAlternatives,
  proposalCandidates,
  proposalCohort,
  proposalLegs,
  proposalRuns,
  proposalSteps,
  proposals,
  responsePicks,
  responseWindows,
  responses,
  stepSignals,
} from "@/server/db/schema";
import {
  regionCodeForTimezone,
  searchVenuePlaces,
  type GoogleClientOptions,
  type LatLng,
  type VenuePlace,
} from "@/server/google/places";
import {
  computeRouteMatrix,
  isUsableRouteMatrixElement,
} from "@/server/google/routes";
import { AMOUNT_MINOR_MAX, isAmountMinor } from "@/server/money";
import { asPlanState } from "@/server/join/open";
import { isChainFair, maxTripMinusMedian } from "./fairness";
import { rankChains, type ChainInput } from "./rank";
import {
  chooseTime,
  coversInstant,
  formatLocalMinutes,
  parseLocalMinutes,
  type MemberAvailability,
  type TimeWindow,
} from "./time";

export const ATTEMPT_LOCK_MS = 20_000;
export const NEAR_RADIUS_METERS = 15_000;
export const FAR_RADIUS_METERS = 40_000;
export const POOL_CAP = 5;
export const ALTERNATIVE_CAP = 3;

type Database = ReturnType<typeof createDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type BlockFlags = {
  time: boolean;
  budget: boolean;
  venue_data: boolean;
};

export type ProposalAttemptResult =
  | { status: "proposed" }
  | { status: "blocked"; block: BlockFlags }
  | { status: "attempt_in_progress" };

export type ProposalAttemptDeps = {
  google?: GoogleClientOptions;
  languageCode?: string;
};

type CohortMember = {
  participantId: string;
  displayName: string;
  distinguisher: string;
  createdAt: Date;
  start: LatLng | null;
  availability: MemberAvailability[];
  pickOptionIds: ReadonlySet<string>;
};

type PlanOptionRow = {
  id: string;
  stepId: string;
  position: number;
  label: string;
};

type PlanStepRow = {
  id: string;
  position: number;
  name: string;
  options: PlanOptionRow[];
};

type Snapshot = {
  planId: string;
  timezone: string;
  currency: string;
  budgetAmountMinor: number;
  windows: (TimeWindow & { id: string })[];
  steps: PlanStepRow[];
  cohort: CohortMember[];
};

type StepPool = {
  stepId: string;
  optionId: string;
  optionLabel: string;
  places: VenuePlace[];
};

type ChosenChain = {
  places: VenuePlace[];
  betweenDurations: number[];
  memberTripSeconds: number[];
  fairnessWarning: boolean;
};

let database: Database | undefined;

function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  await database.$client.end({ timeout: 5 });
  database = undefined;
}

export function isProposalGoogleEnabled(): boolean {
  return process.env.HP_PROPOSAL_ENABLED !== "0";
}

function newOpaqueId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

function blockFlags(
  time: boolean,
  budget: boolean,
  venueData: boolean,
): BlockFlags {
  return { time, budget, venue_data: venueData };
}

function distSq(a: LatLng, b: LatLng): number {
  const dLat = a.latitude - b.latitude;
  const dLng = a.longitude - b.longitude;
  return dLat * dLat + dLng * dLng;
}

function centroidOf(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) {
    return null;
  }
  let latitude = 0;
  let longitude = 0;
  for (const point of points) {
    latitude += point.latitude;
    longitude += point.longitude;
  }
  return {
    latitude: latitude / points.length,
    longitude: longitude / points.length,
  };
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

function sortPool(places: VenuePlace[], centroid: LatLng): VenuePlace[] {
  return places.slice().sort((left, right) => {
    const byDist = distSq(left.location, centroid) - distSq(right.location, centroid);
    if (byDist !== 0) {
      return byDist;
    }
    return comparePlaceIds(left.id, right.id);
  });
}

function isEligibleAmount(amountMinor: number, budgetAmountMinor: number): boolean {
  return (
    isAmountMinor(amountMinor) &&
    amountMinor <= budgetAmountMinor &&
    amountMinor <= AMOUNT_MINOR_MAX
  );
}

function durationKey(fromId: string, toId: string): string {
  return `${fromId}\0${toId}`;
}

function lockAgeMs(lockAt: Date | string | null, instant: Date): number {
  if (lockAt === null) {
    return Number.POSITIVE_INFINITY;
  }
  const ms = lockAt instanceof Date ? lockAt.getTime() : Date.parse(String(lockAt));
  if (!Number.isFinite(ms)) {
    return Number.POSITIVE_INFINITY;
  }
  return instant.getTime() - ms;
}

function availabilityFromRow(row: {
  kind: string;
  earliestLocal: string | null;
  latestLocal: string | null;
}): MemberAvailability {
  if (row.kind === "free") {
    const earliest = parseLocalMinutes(row.earliestLocal ?? "");
    const latest = parseLocalMinutes(row.latestLocal ?? "");
    if (earliest !== null && latest !== null) {
      return { kind: "free", earliestMinutes: earliest, latestMinutes: latest };
    }
  }
  return { kind: "busy" };
}

function memberAttending(
  windows: readonly TimeWindow[],
  availability: readonly MemberAvailability[],
  choice: { localDate: string; minutes: number },
): boolean {
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    if (
      window === undefined ||
      window.localDate !== choice.localDate ||
      choice.minutes < window.startMinutes ||
      choice.minutes >= window.endMinutes
    ) {
      continue;
    }
    const member = availability[index];
    return member !== undefined && coversInstant(member, choice.minutes);
  }
  return false;
}

async function loadSnapshot(
  tx: Transaction,
  plan: typeof plans.$inferSelect,
): Promise<Snapshot> {
  const windowRows = await tx
    .select()
    .from(planWindows)
    .where(eq(planWindows.planId, plan.id))
    .orderBy(asc(planWindows.position));
  const stepRows = await tx
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
  const stepIds = stepRows.map((step) => step.id);
  const optionRows =
    stepIds.length === 0
      ? []
      : await tx
          .select()
          .from(planOptions)
          .where(inArray(planOptions.stepId, stepIds))
          .orderBy(asc(planOptions.stepId), asc(planOptions.position));
  const optionsByStep = new Map<string, PlanOptionRow[]>();
  for (const option of optionRows) {
    const list = optionsByStep.get(option.stepId) ?? [];
    list.push({
      id: option.id,
      stepId: option.stepId,
      position: option.position,
      label: option.label,
    });
    optionsByStep.set(option.stepId, list);
  }

  const memberRows = await tx
    .select({
      participantId: participants.id,
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
      createdAt: participants.createdAt,
      startLat: responses.startLat,
      startLng: responses.startLng,
    })
    .from(participants)
    .innerJoin(responses, eq(responses.participantId, participants.id))
    .where(and(eq(participants.planId, plan.id), eq(responses.complete, true)))
    .orderBy(asc(participants.createdAt), asc(participants.id));

  const memberIds = memberRows.map((row) => row.participantId);
  const windowById = new Map(windowRows.map((row, index) => [row.id, index]));
  const availByMember = new Map<string, MemberAvailability[]>();
  const picksByMember = new Map<string, Set<string>>();
  for (const member of memberRows) {
    availByMember.set(
      member.participantId,
      windowRows.map(() => ({ kind: "busy" as const })),
    );
    picksByMember.set(member.participantId, new Set());
  }
  if (memberIds.length > 0) {
    const windowAnswers = await tx
      .select()
      .from(responseWindows)
      .where(inArray(responseWindows.participantId, memberIds));
    for (const row of windowAnswers) {
      const index = windowById.get(row.windowId);
      const list = availByMember.get(row.participantId);
      if (index === undefined || list === undefined) {
        continue;
      }
      list[index] = availabilityFromRow(row);
    }
    const pickRows = await tx
      .select()
      .from(responsePicks)
      .where(inArray(responsePicks.participantId, memberIds));
    for (const pick of pickRows) {
      picksByMember.get(pick.participantId)?.add(pick.optionId);
    }
  }

  const windows: Snapshot["windows"] = [];
  for (const row of windowRows) {
    const startMinutes = parseLocalMinutes(row.startLocal);
    const endMinutes = parseLocalMinutes(row.endLocal);
    if (startMinutes === null || endMinutes === null) {
      continue;
    }
    windows.push({
      id: row.id,
      localDate: row.localDate,
      startMinutes,
      endMinutes,
    });
  }

  const cohort: CohortMember[] = [];
  for (const row of memberRows) {
    const start =
      typeof row.startLat === "number" &&
      typeof row.startLng === "number" &&
      Number.isFinite(row.startLat) &&
      Number.isFinite(row.startLng)
        ? { latitude: row.startLat, longitude: row.startLng }
        : null;
    cohort.push({
      participantId: row.participantId,
      displayName: row.displayName,
      distinguisher: row.distinguisher,
      createdAt: row.createdAt,
      start,
      availability: availByMember.get(row.participantId) ?? [],
      pickOptionIds: picksByMember.get(row.participantId) ?? new Set(),
    });
  }

  return {
    planId: plan.id,
    timezone: plan.timezone,
    currency: plan.currency,
    budgetAmountMinor: plan.budgetAmountMinor,
    windows,
    steps: stepRows.map((step) => ({
      id: step.id,
      position: step.position,
      name: step.name,
      options: optionsByStep.get(step.id) ?? [],
    })),
    cohort,
  };
}

async function acquireRun(
  planId: string,
): Promise<
  | { status: "attempt_in_progress" }
  | { status: "missing" }
  | { status: "locked" }
  | { status: "acquired"; snapshot: Snapshot; startedAt: Date }
> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .for("update");
    const plan = rows[0];
    if (!plan) {
      return { status: "missing" as const };
    }
    const instant = now();
    if (asPlanState(plan.state) === "locked") {
      return { status: "locked" as const };
    }
    if (
      plan.attemptLock &&
      lockAgeMs(plan.attemptLockAt, instant) < ATTEMPT_LOCK_MS
    ) {
      return { status: "attempt_in_progress" as const };
    }
    await tx
      .update(plans)
      .set({
        attemptLock: true,
        attemptLockAt: instant,
        updatedAt: instant,
      })
      .where(eq(plans.id, planId));
    const snapshot = await loadSnapshot(tx, plan);
    return { status: "acquired" as const, snapshot, startedAt: instant };
  });
}

async function deleteProposalTx(tx: Transaction, planId: string): Promise<void> {
  const existing = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.planId, planId));
  const ids = existing.map((row) => row.id);
  if (ids.length === 0) {
    return;
  }
  await tx.delete(stepSignals).where(inArray(stepSignals.proposalId, ids));
  await tx
    .delete(proposalAlternatives)
    .where(inArray(proposalAlternatives.proposalId, ids));
  await tx
    .delete(proposalCandidates)
    .where(inArray(proposalCandidates.proposalId, ids));
  await tx.delete(proposalLegs).where(inArray(proposalLegs.proposalId, ids));
  await tx.delete(proposalSteps).where(inArray(proposalSteps.proposalId, ids));
  await tx.delete(proposalCohort).where(inArray(proposalCohort.proposalId, ids));
  await tx.delete(proposals).where(inArray(proposals.id, ids));
}

async function finishRun(input: {
  planId: string;
  startedAt: Date;
  outcome: "proposed" | "blocked";
  block: BlockFlags;
  proposal?: {
    localDate: string;
    localTime: string;
    fairnessWarning: boolean;
    cohort: { participantId: string; attending: boolean }[];
    steps: {
      stepId: string;
      optionId: string;
      place: VenuePlace;
    }[];
    legs: { fromStepId: string; toStepId: string; durationSeconds: number }[];
    pools: StepPool[];
    alternatives: {
      stepId: string;
      position: number;
      googlePlaceId: string;
    }[];
  };
}): Promise<void> {
  const instant = now();
  await db().transaction(async (tx) => {
    await deleteProposalTx(tx, input.planId);
    if (input.outcome === "proposed" && input.proposal) {
      const proposalId = newOpaqueId("prp_");
      await tx.insert(proposals).values({
        id: proposalId,
        planId: input.planId,
        localDate: input.proposal.localDate,
        localTime: input.proposal.localTime,
        fairnessWarning: input.proposal.fairnessWarning,
        createdAt: instant,
      });
      if (input.proposal.cohort.length > 0) {
        await tx.insert(proposalCohort).values(
          input.proposal.cohort.map((member) => ({
            proposalId,
            participantId: member.participantId,
            attending: member.attending,
          })),
        );
      }
      if (input.proposal.steps.length > 0) {
        await tx.insert(proposalSteps).values(
          input.proposal.steps.map((step) => ({
            proposalId,
            stepId: step.stepId,
            optionId: step.optionId,
            googlePlaceId: step.place.id,
            placeName: step.place.displayName,
            amountMinor: step.place.amountMinor,
          })),
        );
      }
      if (input.proposal.legs.length > 0) {
        await tx.insert(proposalLegs).values(
          input.proposal.legs.map((leg) => ({
            proposalId,
            fromStepId: leg.fromStepId,
            toStepId: leg.toStepId,
            durationSeconds: leg.durationSeconds,
          })),
        );
      }
      const candidateRows: {
        proposalId: string;
        stepId: string;
        googlePlaceId: string;
        placeName: string;
        amountMinor: number;
        latitude: number;
        longitude: number;
      }[] = [];
      for (const pool of input.proposal.pools) {
        for (const place of pool.places) {
          candidateRows.push({
            proposalId,
            stepId: pool.stepId,
            googlePlaceId: place.id,
            placeName: place.displayName,
            amountMinor: place.amountMinor,
            latitude: place.location.latitude,
            longitude: place.location.longitude,
          });
        }
      }
      if (candidateRows.length > 0) {
        await tx.insert(proposalCandidates).values(candidateRows);
      }
      if (input.proposal.alternatives.length > 0) {
        await tx.insert(proposalAlternatives).values(
          input.proposal.alternatives.map((row) => ({
            proposalId,
            stepId: row.stepId,
            position: row.position,
            googlePlaceId: row.googlePlaceId,
          })),
        );
      }
    }
    await tx.insert(proposalRuns).values({
      id: newOpaqueId("prn_"),
      planId: input.planId,
      startedAt: input.startedAt,
      outcome: input.outcome,
      blockTime: input.block.time,
      blockBudget: input.block.budget,
      blockVenueData: input.block.venue_data,
    });
    await tx
      .update(plans)
      .set({
        state: input.outcome === "proposed" ? "proposed" : "blocked",
        attemptLock: false,
        attemptLockAt: null,
        updatedAt: instant,
      })
      .where(eq(plans.id, input.planId));
  });
}

async function releaseLock(planId: string): Promise<void> {
  try {
    await db()
      .update(plans)
      .set({
        attemptLock: false,
        attemptLockAt: null,
        updatedAt: now(),
      })
      .where(eq(plans.id, planId));
  } catch {
    // Best-effort: a later takeover may already own the lock.
  }
}

function rankStepLabels(
  options: readonly PlanOptionRow[],
  cohort: readonly CohortMember[],
): PlanOptionRow[] {
  const counts = new Map<string, number>();
  for (const option of options) {
    counts.set(option.id, 0);
  }
  for (const member of cohort) {
    for (const option of options) {
      if (member.pickOptionIds.has(option.id)) {
        counts.set(option.id, (counts.get(option.id) ?? 0) + 1);
      }
    }
  }
  return options.slice().sort((left, right) => {
    const byCount = (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
    if (byCount !== 0) {
      return byCount;
    }
    return left.position - right.position;
  });
}

async function searchLabelPool(
  input: {
    label: string;
    languageCode: string;
    planCurrency: string;
    centroid: LatLng;
    regionCode?: string;
    budgetAmountMinor: number;
  },
  google: GoogleClientOptions | undefined,
): Promise<VenuePlace[]> {
  const radii = [NEAR_RADIUS_METERS, FAR_RADIUS_METERS];
  for (const radiusMeters of radii) {
    const found = await searchVenuePlaces(
      {
        textQuery: input.label,
        languageCode: input.languageCode,
        planCurrency: input.planCurrency,
        locationBias: {
          latitude: input.centroid.latitude,
          longitude: input.centroid.longitude,
          radiusMeters,
        },
        pageSize: 20,
        ...(input.regionCode !== undefined
          ? { regionCode: input.regionCode }
          : {}),
      },
      google,
    );
    const eligible = found.filter((place) =>
      isEligibleAmount(place.amountMinor, input.budgetAmountMinor),
    );
    if (eligible.length > 0) {
      return sortPool(eligible, input.centroid).slice(0, POOL_CAP);
    }
  }
  return [];
}

async function searchStepPools(
  snapshot: Snapshot,
  centroid: LatLng,
  languageCode: string,
  google: GoogleClientOptions | undefined,
): Promise<StepPool[] | "venue_data"> {
  const regionCode = regionCodeForTimezone(snapshot.timezone);
  const pools: StepPool[] = [];
  try {
    for (const step of snapshot.steps) {
      const ranked = rankStepLabels(step.options, snapshot.cohort);
      let pool: StepPool | null = null;
      for (const option of ranked) {
        const places = await searchLabelPool(
          {
            label: option.label,
            languageCode,
            planCurrency: snapshot.currency,
            centroid,
            regionCode,
            budgetAmountMinor: snapshot.budgetAmountMinor,
          },
          google,
        );
        if (places.length > 0) {
          pool = {
            stepId: step.id,
            optionId: option.id,
            optionLabel: option.label,
            places,
          };
          break;
        }
      }
      if (pool === null) {
        pools.push({
          stepId: step.id,
          optionId: step.options[0]?.id ?? "",
          optionLabel: step.options[0]?.label ?? "",
          places: [],
        });
      } else {
        pools.push(pool);
      }
    }
    return pools;
  } catch {
    return "venue_data";
  }
}

type Point = { id: string; location: LatLng };

async function fillDurations(
  origins: readonly Point[],
  destinations: readonly Point[],
  durations: Map<string, number>,
  google: GoogleClientOptions | undefined,
): Promise<void> {
  if (origins.length === 0 || destinations.length === 0) {
    return;
  }
  const elements = await computeRouteMatrix(
    {
      origins: origins.map((point) => point.location),
      destinations: destinations.map((point) => point.location),
    },
    google,
  );
  for (const element of elements) {
    if (!isUsableRouteMatrixElement(element) || element.durationSeconds === null) {
      continue;
    }
    const from = origins[element.originIndex];
    const to = destinations[element.destinationIndex];
    if (from === undefined || to === undefined) {
      continue;
    }
    durations.set(durationKey(from.id, to.id), element.durationSeconds);
  }
}

function combinations<T>(lists: readonly (readonly T[])[]): T[][] {
  let acc: T[][] = [[]];
  for (const list of lists) {
    const next: T[][] = [];
    for (const prefix of acc) {
      for (const item of list) {
        next.push([...prefix, item]);
      }
    }
    acc = next;
  }
  return acc;
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

function chainFromPlaces(
  places: readonly VenuePlace[],
  cohort: readonly CohortMember[],
  durations: Map<string, number>,
): ChainInput | null {
  const placeIds = places.map((place) => place.id);
  let between = 0;
  const betweenDurations: number[] = [];
  for (let i = 0; i < places.length - 1; i += 1) {
    const from = places[i];
    const to = places[i + 1];
    if (from === undefined || to === undefined) {
      return null;
    }
    const duration = durations.get(durationKey(from.id, to.id));
    if (duration === undefined || duration < 1) {
      return null;
    }
    between += duration;
    betweenDurations.push(duration);
  }
  const first = places[0];
  if (first === undefined) {
    return null;
  }
  const memberTripSeconds: number[] = [];
  for (const member of cohort) {
    if (member.start === null) {
      return null;
    }
    const startLeg = durations.get(
      durationKey(member.participantId, first.id),
    );
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

function greedyChain(
  pools: readonly StepPool[],
  centroid: LatLng,
  durations: Map<string, number>,
): VenuePlace[] | null {
  const firstPool = pools[0];
  if (firstPool === undefined || firstPool.places.length === 0) {
    return null;
  }
  const first = sortPool(firstPool.places, centroid)[0];
  if (first === undefined) {
    return null;
  }
  const chosen: VenuePlace[] = [first];
  for (let i = 1; i < pools.length; i += 1) {
    const pool = pools[i];
    const previous = chosen[i - 1];
    if (pool === undefined || previous === undefined) {
      return null;
    }
    let best: VenuePlace | null = null;
    let bestDuration = 0;
    for (const place of pool.places) {
      const duration = durations.get(durationKey(previous.id, place.id));
      if (duration === undefined || duration < 1) {
        continue;
      }
      if (
        best === null ||
        duration < bestDuration ||
        (duration === bestDuration && comparePlaceIds(place.id, best.id) < 0)
      ) {
        best = place;
        bestDuration = duration;
      }
    }
    if (best === null) {
      return null;
    }
    chosen.push(best);
  }
  return chosen;
}

async function buildDurationMap(
  snapshot: Snapshot,
  pools: readonly StepPool[],
  google: GoogleClientOptions | undefined,
): Promise<Map<string, number> | "venue_data"> {
  const durations = new Map<string, number>();
  const starts: Point[] = [];
  for (const member of snapshot.cohort) {
    if (member.start === null) {
      continue;
    }
    starts.push({ id: member.participantId, location: member.start });
  }
  const poolPoints = (pool: StepPool): Point[] =>
    pool.places.map((place) => ({ id: place.id, location: place.location }));
  try {
    const first = pools[0];
    if (first !== undefined) {
      await fillDurations(starts, poolPoints(first), durations, google);
    }
    for (let i = 0; i < pools.length - 1; i += 1) {
      const from = pools[i];
      const to = pools[i + 1];
      if (from === undefined || to === undefined) {
        continue;
      }
      await fillDurations(poolPoints(from), poolPoints(to), durations, google);
    }
    return durations;
  } catch {
    return "venue_data";
  }
}

function pickChain(
  snapshot: Snapshot,
  pools: readonly StepPool[],
  centroid: LatLng,
  durations: Map<string, number>,
): ChosenChain | null {
  let chosenPlaces: VenuePlace[] | null = null;
  if (pools.length <= 4) {
    const combos = combinations(pools.map((pool) => pool.places));
    const scored: { places: VenuePlace[]; input: ChainInput }[] = [];
    for (const places of combos) {
      const input = chainFromPlaces(places, snapshot.cohort, durations);
      if (input !== null) {
        scored.push({ places, input });
      }
    }
    if (scored.length === 0) {
      return null;
    }
    const ranked = rankChains(scored.map((row) => row.input));
    if (ranked === null) {
      return null;
    }
    const match = scored.find((row) => {
      if (row.input.placeIds.length !== ranked.placeIds.length) {
        return false;
      }
      return row.input.placeIds.every((id, index) => id === ranked.placeIds[index]);
    });
    chosenPlaces = match?.places ?? null;
  } else {
    chosenPlaces = greedyChain(pools, centroid, durations);
  }
  if (chosenPlaces === null) {
    return null;
  }
  const input = chainFromPlaces(chosenPlaces, snapshot.cohort, durations);
  if (input === null) {
    return null;
  }
  const ranked = rankChains([input]);
  if (ranked === null) {
    return null;
  }
  const betweenDurations: number[] = [];
  for (let i = 0; i < chosenPlaces.length - 1; i += 1) {
    const from = chosenPlaces[i];
    const to = chosenPlaces[i + 1];
    if (from === undefined || to === undefined) {
      return null;
    }
    const duration = durations.get(durationKey(from.id, to.id));
    if (duration === undefined || duration < 1) {
      return null;
    }
    betweenDurations.push(duration);
  }
  return {
    places: chosenPlaces,
    betweenDurations,
    memberTripSeconds: [...ranked.memberTripSeconds],
    fairnessWarning: ranked.fairnessWarning,
  };
}

function alternativeRows(
  snapshot: Snapshot,
  pools: readonly StepPool[],
  chosen: ChosenChain,
  durations: Map<string, number>,
): { stepId: string; position: number; googlePlaceId: string }[] {
  const rows: { stepId: string; position: number; googlePlaceId: string }[] = [];
  for (let stepIndex = 0; stepIndex < pools.length; stepIndex += 1) {
    const pool = pools[stepIndex];
    const current = chosen.places[stepIndex];
    if (pool === undefined || current === undefined) {
      continue;
    }
    const scored: { placeId: string; input: ChainInput }[] = [];
    for (const place of pool.places) {
      if (place.id === current.id) {
        continue;
      }
      const substituted = chosen.places.slice();
      substituted[stepIndex] = place;
      const input = chainFromPlaces(substituted, snapshot.cohort, durations);
      if (input !== null) {
        scored.push({ placeId: place.id, input });
      }
    }
    scored.sort((left, right) => compareChains(left.input, right.input));
    const picked = scored.slice(0, ALTERNATIVE_CAP);
    for (let position = 0; position < picked.length; position += 1) {
      const row = picked[position];
      if (row === undefined) {
        continue;
      }
      rows.push({
        stepId: pool.stepId,
        position,
        googlePlaceId: row.placeId,
      });
    }
  }
  return rows;
}

/**
 * Writes `proposed` for a full chain, or `blocked` otherwise.
 * Callers inject Google through `deps.google` (fake `fetch` in tests).
 */
export async function runProposalAttempt(
  planId: string,
  deps: ProposalAttemptDeps = {},
): Promise<ProposalAttemptResult> {
  const acquired = await acquireRun(planId);
  if (acquired.status === "attempt_in_progress") {
    return { status: "attempt_in_progress" };
  }
  if (acquired.status === "missing") {
    return {
      status: "blocked",
      block: blockFlags(true, false, false),
    };
  }
  if (acquired.status === "locked") {
    return { status: "attempt_in_progress" };
  }

  const { snapshot, startedAt } = acquired;
  const languageCode =
    deps.languageCode === "ar" || deps.languageCode === "en"
      ? deps.languageCode
      : "en";

  const finishBlocked = async (block: BlockFlags): Promise<ProposalAttemptResult> => {
    await finishRun({
      planId,
      startedAt,
      outcome: "blocked",
      block,
    });
    return { status: "blocked", block };
  };

  try {
    if (snapshot.cohort.length === 0) {
      return await finishBlocked(blockFlags(true, false, false));
    }

    const timeChoice = chooseTime(
      snapshot.windows,
      snapshot.cohort.map((member) => member.availability),
    );
    const timeBlocked = timeChoice.timeBlocked;

    if (!isProposalGoogleEnabled()) {
      return await finishBlocked(blockFlags(timeBlocked, false, true));
    }

    const startPoints: LatLng[] = [];
    for (const member of snapshot.cohort) {
      if (member.start !== null) {
        startPoints.push(member.start);
      }
    }
    const centroid = centroidOf(startPoints);
    if (centroid === null) {
      return await finishBlocked(blockFlags(timeBlocked, false, true));
    }

    const poolsOrError = await searchStepPools(
      snapshot,
      centroid,
      languageCode,
      deps.google,
    );
    if (poolsOrError === "venue_data") {
      return await finishBlocked(blockFlags(timeBlocked, false, true));
    }
    const pools = poolsOrError;
    const missingPool = pools.some((pool) => pool.places.length === 0);
    if (missingPool) {
      return await finishBlocked(blockFlags(timeBlocked, true, false));
    }
    if (timeBlocked) {
      return await finishBlocked(blockFlags(true, false, false));
    }

    const durationsOrError = await buildDurationMap(
      snapshot,
      pools,
      deps.google,
    );
    if (durationsOrError === "venue_data") {
      return await finishBlocked(blockFlags(false, false, true));
    }
    const chosen = pickChain(snapshot, pools, centroid, durationsOrError);
    if (chosen === null) {
      return await finishBlocked(blockFlags(false, false, true));
    }
    if (chosen.places.length !== snapshot.steps.length) {
      return await finishBlocked(blockFlags(false, false, true));
    }
    for (const duration of chosen.betweenDurations) {
      if (duration < 1) {
        return await finishBlocked(blockFlags(false, false, true));
      }
    }

    const legs: {
      fromStepId: string;
      toStepId: string;
      durationSeconds: number;
    }[] = [];
    for (let i = 0; i < snapshot.steps.length - 1; i += 1) {
      const from = snapshot.steps[i];
      const to = snapshot.steps[i + 1];
      const duration = chosen.betweenDurations[i];
      if (from === undefined || to === undefined || duration === undefined) {
        return await finishBlocked(blockFlags(false, false, true));
      }
      legs.push({
        fromStepId: from.id,
        toStepId: to.id,
        durationSeconds: duration,
      });
    }

    const storedSteps: {
      stepId: string;
      optionId: string;
      place: VenuePlace;
    }[] = [];
    for (let i = 0; i < snapshot.steps.length; i += 1) {
      const step = snapshot.steps[i];
      const pool = pools[i];
      const place = chosen.places[i];
      if (step === undefined || pool === undefined || place === undefined) {
        return await finishBlocked(blockFlags(false, false, true));
      }
      storedSteps.push({
        stepId: step.id,
        optionId: pool.optionId,
        place,
      });
    }

    await finishRun({
      planId,
      startedAt,
      outcome: "proposed",
      block: blockFlags(false, false, false),
      proposal: {
        localDate: timeChoice.localDate,
        localTime: formatLocalMinutes(timeChoice.minutes),
        fairnessWarning: chosen.fairnessWarning,
        cohort: snapshot.cohort.map((member) => ({
          participantId: member.participantId,
          attending: memberAttending(
            snapshot.windows,
            member.availability,
            timeChoice,
          ),
        })),
        steps: storedSteps,
        legs,
        pools,
        alternatives: alternativeRows(
          snapshot,
          pools,
          chosen,
          durationsOrError,
        ),
      },
    });
    return { status: "proposed" };
  } catch {
    try {
      return await finishBlocked(blockFlags(false, false, true));
    } catch {
      await releaseLock(planId);
      return { status: "blocked", block: blockFlags(false, false, true) };
    }
  }
}
