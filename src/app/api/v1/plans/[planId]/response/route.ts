import { NextResponse } from "next/server";
import { loadCallerParticipant } from "@/server/response/caller";
import { responseGoogleOptions } from "@/server/response/google";
import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import { now } from "@/server/clock";
import {
  planOptions,
  planSteps,
  planWindows,
  plans,
  responsePicks,
  responseWindows,
  responses,
} from "@/server/db/schema";
import {
  getStartPlaceDetails,
  type StartPlace,
} from "@/server/google/places";
import { asPlanState } from "@/server/join/open";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  draftIsComplete,
  hasStoredStart,
  incompleteFields,
  parseResponseBody,
  responseValidationFailed,
  responsesClosedError,
  saveCountDecision,
  upstreamPlacesError,
  validateWindowsAndPicks,
  type PickDraft,
  type PlanStepRule,
  type PlanWindowRule,
  type WindowDraft,
} from "@/server/response/save";
import {
  errorResponse,
  logged,
  readCookie,
  readJsonObject,
  rejectCsrf,
} from "@/server/auth/http";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  planLockedResponse,
  storedCurrency,
  type PlanRow,
} from "@/server/plans/http";
import {
  applyHourFullVenueData,
  attemptInProgressResponse,
  runTriggeredAttempt,
} from "@/server/proposal/trigger";
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResponseRouteContext = {
  params: Promise<{ planId: string }>;
};

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type ParticipantRow = {
  id: string;
};

type PlanShape = {
  windows: PlanWindowRule[];
  windowViews: {
    id: string;
    local_date: string;
    start_local: string;
    end_local: string;
  }[];
  steps: PlanStepRule[];
  stepViews: {
    id: string;
    name: string;
    options: { id: string; label: string }[];
  }[];
};

type StoredResponse = {
  startGooglePlaceId: string | null;
  startName: string | null;
  startLat: number | null;
  startLng: number | null;
  complete: boolean;
  firstCompletedAt: Date | null;
};

type WriteRejected = Error & { writeReject: NextResponse };

function rejectWrite(response: NextResponse): WriteRejected {
  return Object.assign(new Error("response write rejected"), {
    writeReject: response,
  });
}

function isWriteRejected(err: unknown): err is WriteRejected {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const reject = (err as { writeReject?: unknown }).writeReject;
  return typeof reject === "object" && reject !== null;
}

async function loadPlanShape(planId: string): Promise<PlanShape> {
  const windowRows = await db()
    .select()
    .from(planWindows)
    .where(eq(planWindows.planId, planId))
    .orderBy(asc(planWindows.position));
  const stepRows = await db()
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, planId))
    .orderBy(asc(planSteps.position));
  const stepIds = stepRows.map((step) => step.id);
  const optionRows =
    stepIds.length === 0
      ? []
      : await db()
          .select()
          .from(planOptions)
          .where(inArray(planOptions.stepId, stepIds))
          .orderBy(asc(planOptions.stepId), asc(planOptions.position));
  const optionsByStep = new Map<string, { id: string; label: string }[]>();
  for (const option of optionRows) {
    const list = optionsByStep.get(option.stepId) ?? [];
    list.push({ id: option.id, label: option.label });
    optionsByStep.set(option.stepId, list);
  }
  return {
    windows: windowRows.map((window) => ({
      id: window.id,
      startLocal: window.startLocal,
      endLocal: window.endLocal,
    })),
    windowViews: windowRows.map((window) => ({
      id: window.id,
      local_date: window.localDate,
      start_local: window.startLocal,
      end_local: window.endLocal,
    })),
    steps: stepRows.map((step) => ({
      id: step.id,
      optionIds: (optionsByStep.get(step.id) ?? []).map((option) => option.id),
    })),
    stepViews: stepRows.map((step) => ({
      id: step.id,
      name: step.name,
      options: optionsByStep.get(step.id) ?? [],
    })),
  };
}

async function loadPlanShapeTx(
  tx: Transaction,
  planId: string,
): Promise<PlanShape> {
  const windowRows = await tx
    .select()
    .from(planWindows)
    .where(eq(planWindows.planId, planId))
    .orderBy(asc(planWindows.position));
  const stepRows = await tx
    .select()
    .from(planSteps)
    .where(eq(planSteps.planId, planId))
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
  const optionsByStep = new Map<string, { id: string; label: string }[]>();
  for (const option of optionRows) {
    const list = optionsByStep.get(option.stepId) ?? [];
    list.push({ id: option.id, label: option.label });
    optionsByStep.set(option.stepId, list);
  }
  return {
    windows: windowRows.map((window) => ({
      id: window.id,
      startLocal: window.startLocal,
      endLocal: window.endLocal,
    })),
    windowViews: windowRows.map((window) => ({
      id: window.id,
      local_date: window.localDate,
      start_local: window.startLocal,
      end_local: window.endLocal,
    })),
    steps: stepRows.map((step) => ({
      id: step.id,
      optionIds: (optionsByStep.get(step.id) ?? []).map((option) => option.id),
    })),
    stepViews: stepRows.map((step) => ({
      id: step.id,
      name: step.name,
      options: optionsByStep.get(step.id) ?? [],
    })),
  };
}

function closedResponse(state: PlanState): NextResponse | null {
  if (state === "proposed") {
    return errorResponse(responsesClosedError());
  }
  if (state === "locked") {
    return planLockedResponse();
  }
  return null;
}

async function rejectNonParticipant(
  request: Request,
  plan: PlanRow,
): Promise<{ participant: ParticipantRow } | { denied: NextResponse }> {
  const role = await planRoleFor(request, plan);
  const participant = await loadCallerParticipant(request, plan.id);
  if (role !== "participant" || !participant) {
    return { denied: notFoundResponse() };
  }
  return { participant };
}

function responseWindowView(row: {
  windowId: string;
  kind: string;
  earliestLocal: string | null;
  latestLocal: string | null;
}):
  | { window_id: string; kind: "busy" }
  | {
      window_id: string;
      kind: "free";
      earliest_local: string;
      latest_local: string;
    } {
  if (
    row.kind === "free" &&
    typeof row.earliestLocal === "string" &&
    typeof row.latestLocal === "string"
  ) {
    return {
      window_id: row.windowId,
      kind: "free",
      earliest_local: row.earliestLocal,
      latest_local: row.latestLocal,
    };
  }
  return { window_id: row.windowId, kind: "busy" };
}

async function resolveStartPlace(placeId: string): Promise<StartPlace | null> {
  try {
    return await getStartPlaceDetails(placeId, responseGoogleOptions());
  } catch {
    return null;
  }
}

async function replaceDraft(
  tx: Transaction,
  participantId: string,
  windows: readonly WindowDraft[],
  picks: readonly PickDraft[],
): Promise<void> {
  await tx
    .delete(responseWindows)
    .where(eq(responseWindows.participantId, participantId));
  await tx
    .delete(responsePicks)
    .where(eq(responsePicks.participantId, participantId));
  if (windows.length > 0) {
    await tx.insert(responseWindows).values(
      windows.map((window) => ({
        participantId,
        windowId: window.windowId,
        kind: window.kind,
        earliestLocal: window.earliestLocal ?? null,
        latestLocal: window.latestLocal ?? null,
      })),
    );
  }
  if (picks.length > 0) {
    await tx.insert(responsePicks).values(
      picks.map((pick) => ({
        participantId,
        stepId: pick.stepId,
        optionId: pick.optionId,
      })),
    );
  }
}

async function writeResponse(input: {
  planId: string;
  participantId: string;
  bodyWindows: unknown;
  bodyPicks: unknown;
  startPlace: StartPlace | null;
  startPlaceIdPresent: boolean;
}): Promise<{
  complete: boolean;
  firstCompletion: boolean;
  planState: PlanState;
  answeredCount: number;
  threshold: number;
}> {
  return db().transaction(async (tx) => {
    const planRows = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, input.planId))
      .for("update");
    const plan = planRows[0];
    if (!plan) {
      throw new Error("plan missing during response save");
    }
    const closed = closedResponse(asPlanState(plan.state));
    if (closed) {
      throw rejectWrite(closed);
    }
    const existingRows = await tx
      .select()
      .from(responses)
      .where(eq(responses.participantId, input.participantId))
      .for("update");
    const existing: StoredResponse | undefined = existingRows[0];
    const callerComplete = existing?.complete === true;
    const shape = await loadPlanShapeTx(tx, input.planId);
    const validated = validateWindowsAndPicks(
      shape.windows,
      shape.steps,
      input.bodyWindows,
      input.bodyPicks,
    );
    if (!validated.ok) {
      throw rejectWrite(
        errorResponse(responseValidationFailed(validated.fields)),
      );
    }
    const startStored = input.startPlaceIdPresent
      ? input.startPlace !== null
      : hasStoredStart(existing ?? null);
    const complete = draftIsComplete(
      shape.windows,
      shape.steps,
      validated.windows,
      validated.picks,
      startStored,
    );
    const decision = saveCountDecision(callerComplete, complete);
    if (!decision.ok) {
      throw rejectWrite(
        errorResponse(
          responseValidationFailed(
            incompleteFields(
              shape.windows,
              shape.steps,
              validated.windows,
              validated.picks,
              startStored,
            ),
          ),
        ),
      );
    }

    const startGooglePlaceId = input.startPlace
      ? input.startPlace.id
      : (existing?.startGooglePlaceId ?? null);
    const startName = input.startPlace
      ? input.startPlace.displayName
      : (existing?.startName ?? null);
    const startLat = input.startPlace
      ? input.startPlace.location.latitude
      : (existing?.startLat ?? null);
    const startLng = input.startPlace
      ? input.startPlace.location.longitude
      : (existing?.startLng ?? null);
    const instant = now();
    const firstCompletedAt = decision.complete
      ? (existing?.firstCompletedAt ?? instant)
      : (existing?.firstCompletedAt ?? null);

    if (!existing) {
      await tx.insert(responses).values({
        participantId: input.participantId,
        startGooglePlaceId,
        startName,
        startLat,
        startLng,
        complete: decision.complete,
        firstCompletedAt,
      });
    } else {
      await tx
        .update(responses)
        .set({
          startGooglePlaceId,
          startName,
          startLat,
          startLng,
          complete: decision.complete,
          firstCompletedAt,
        })
        .where(eq(responses.participantId, input.participantId));
    }
    await replaceDraft(
      tx,
      input.participantId,
      validated.windows,
      validated.picks,
    );
    const answeredCount = decision.incrementCount
      ? plan.answeredCount + 1
      : plan.answeredCount;
    if (decision.incrementCount) {
      await tx
        .update(plans)
        .set({
          answeredCount,
          updatedAt: instant,
        })
        .where(eq(plans.id, input.planId));
    }
    return {
      complete: decision.complete,
      firstCompletion: decision.firstCompletion,
      planState: asPlanState(plan.state),
      answeredCount,
      threshold: plan.threshold,
    };
  });
}

export async function GET(
  request: Request,
  context: ResponseRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }
  const access = await rejectNonParticipant(request, plan);
  if ("denied" in access) {
    return logged(request, access.denied);
  }
  const closed = closedResponse(asPlanState(plan.state));
  if (closed) {
    return logged(request, closed);
  }

  const shape = await loadPlanShape(plan.id);
  const storedRows = await db()
    .select()
    .from(responses)
    .where(eq(responses.participantId, access.participant.id))
    .limit(1);
  const stored = storedRows[0];
  const windowOrder = new Map(
    shape.windowViews.map((window, index) => [window.id, index]),
  );
  const stepOrder = new Map(
    shape.stepViews.map((step, index) => [step.id, index]),
  );
  const windowRows = stored
    ? await db()
        .select()
        .from(responseWindows)
        .where(eq(responseWindows.participantId, access.participant.id))
    : [];
  const pickRows = stored
    ? await db()
        .select()
        .from(responsePicks)
        .where(eq(responsePicks.participantId, access.participant.id))
    : [];
  windowRows.sort(
    (left, right) =>
      (windowOrder.get(left.windowId) ?? 0) -
      (windowOrder.get(right.windowId) ?? 0),
  );
  pickRows.sort(
    (left, right) =>
      (stepOrder.get(left.stepId) ?? 0) - (stepOrder.get(right.stepId) ?? 0),
  );

  const start =
    stored && typeof stored.startName === "string" && stored.startName.length > 0
      ? { name: stored.startName }
      : null;

  return logged(
    request,
    NextResponse.json({
      title: plan.title,
      plan_state: asPlanState(plan.state),
      budget: {
        amount_minor: plan.budgetAmountMinor,
        currency: storedCurrency(plan.currency),
      },
      timezone: plan.timezone,
      windows: shape.windowViews,
      steps: shape.stepViews,
      response: {
        complete: stored?.complete === true,
        windows: windowRows.map(responseWindowView),
        start,
        picks: pickRows.map((pick) => ({
          step_id: pick.stepId,
          option_id: pick.optionId,
        })),
      },
    }),
  );
}

export async function PUT(
  request: Request,
  context: ResponseRouteContext,
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
  const access = await rejectNonParticipant(request, plan);
  if ("denied" in access) {
    return logged(request, access.denied);
  }
  const closed = closedResponse(asPlanState(plan.state));
  if (closed) {
    return logged(request, closed);
  }

  const body = (await readJsonObject(request)) ?? {};
  const parsed = parseResponseBody(body);
  if (parsed.fields.length > 0) {
    return logged(
      request,
      errorResponse(responseValidationFailed(parsed.fields)),
    );
  }

  const shape = await loadPlanShape(plan.id);
  const validated = validateWindowsAndPicks(
    shape.windows,
    shape.steps,
    parsed.windows,
    parsed.picks,
  );
  if (!validated.ok) {
    return logged(
      request,
      errorResponse(responseValidationFailed(validated.fields)),
    );
  }

  const existingRows = await db()
    .select()
    .from(responses)
    .where(eq(responses.participantId, access.participant.id))
    .limit(1);
  const existing = existingRows[0];
  const callerComplete = existing?.complete === true;
  const startWouldBeStored =
    parsed.startPlaceId !== undefined || hasStoredStart(existing ?? null);
  const wouldComplete = draftIsComplete(
    shape.windows,
    shape.steps,
    validated.windows,
    validated.picks,
    startWouldBeStored,
  );
  if (callerComplete && !wouldComplete) {
    return logged(
      request,
      errorResponse(
        responseValidationFailed(
          incompleteFields(
            shape.windows,
            shape.steps,
            validated.windows,
            validated.picks,
            startWouldBeStored,
          ),
        ),
      ),
    );
  }

  let startPlace: StartPlace | null = null;
  if (parsed.startPlaceId !== undefined) {
    startPlace = await resolveStartPlace(parsed.startPlaceId);
    if (startPlace === null) {
      return logged(request, errorResponse(upstreamPlacesError()));
    }
  }

  try {
    const written = await writeResponse({
      planId: plan.id,
      participantId: access.participant.id,
      bodyWindows: parsed.windows,
      bodyPicks: parsed.picks,
      startPlace,
      startPlaceIdPresent: parsed.startPlaceId !== undefined,
    });
    let planState = written.planState;
    const shouldAttempt =
      written.firstCompletion &&
      written.planState === "collecting" &&
      written.answeredCount === written.threshold;
    if (shouldAttempt) {
      const languageCode = localeFromCookie(
        readCookie(request, LOCALE_COOKIE) ?? undefined,
      );
      const triggered = await runTriggeredAttempt(plan.id, languageCode);
      if (triggered.status === "hour_full") {
        await applyHourFullVenueData(plan.id);
        planState = "blocked";
      } else if (triggered.status === "attempt_in_progress") {
        return logged(request, attemptInProgressResponse());
      } else {
        const latest = await loadPlanRow(plan.id);
        planState = latest ? asPlanState(latest.state) : planState;
      }
    }
    return logged(
      request,
      NextResponse.json({
        complete: written.complete,
        first_completion: written.firstCompletion,
        plan_state: planState,
      }),
    );
  } catch (err) {
    if (isWriteRejected(err)) {
      return logged(request, err.writeReject);
    }
    throw err;
  }
}
