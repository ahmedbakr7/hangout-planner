import { asc, eq, inArray } from "drizzle-orm";
import {
  planOptions,
  planSteps,
  planWindows,
  responsePicks,
  responseWindows,
  responses,
} from "@/server/db/schema";
import { asPlanState } from "@/server/join/open";
import type { PlanState } from "@/server/plans/edit-rules";
import { db, loadPlanRow, storedCurrency } from "@/server/plans/http";
import { planRoleForCookies, type CookieReader } from "@/server/plans/role";
import { loadCallerParticipantForCookies } from "@/server/response/caller";
import type {
  PlanStepRule,
  PlanWindowRule,
} from "@/server/response/save";

export type PlanShape = {
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

export type ResponseWindowView =
  | { window_id: string; kind: "busy" }
  | {
      window_id: string;
      kind: "free";
      earliest_local: string;
      latest_local: string;
    };

export type ResponseView = {
  title: string;
  plan_state: PlanState;
  budget: { amount_minor: number; currency: string };
  timezone: string;
  windows: PlanShape["windowViews"];
  steps: PlanShape["stepViews"];
  response: {
    complete: boolean;
    windows: ResponseWindowView[];
    start: { name: string } | null;
    picks: { step_id: string; option_id: string }[];
  };
};

export type ResponsePage =
  | { kind: "ok"; view: ResponseView }
  | { kind: "proposed" }
  | { kind: "locked" }
  | { kind: "not_found" };

export async function loadPlanShape(planId: string): Promise<PlanShape> {
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

function responseWindowView(row: {
  windowId: string;
  kind: string;
  earliestLocal: string | null;
  latestLocal: string | null;
}): ResponseWindowView {
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

export async function loadResponsePage(
  planId: string,
  readCookie: CookieReader,
): Promise<ResponsePage> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return { kind: "not_found" };
  }
  const role = await planRoleForCookies(readCookie, plan);
  const participant = await loadCallerParticipantForCookies(readCookie, plan.id);
  if (role !== "participant" || !participant) {
    return { kind: "not_found" };
  }
  const state = asPlanState(plan.state);
  if (state === "proposed") {
    return { kind: "proposed" };
  }
  if (state === "locked") {
    return { kind: "locked" };
  }

  const shape = await loadPlanShape(plan.id);
  const storedRows = await db()
    .select()
    .from(responses)
    .where(eq(responses.participantId, participant.id))
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
        .where(eq(responseWindows.participantId, participant.id))
    : [];
  const pickRows = stored
    ? await db()
        .select()
        .from(responsePicks)
        .where(eq(responsePicks.participantId, participant.id))
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

  return {
    kind: "ok",
    view: {
      title: plan.title,
      plan_state: state,
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
    },
  };
}
