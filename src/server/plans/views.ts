import type { CurrencyCode } from "../money";
import {
  editableFor,
  type Editable,
  type PlanState,
} from "./edit-rules";

export type MoneyView = {
  amount_minor: number;
  currency: CurrencyCode;
};

export type PlanWindowView = {
  id: string;
  local_date: string;
  start_local: string;
  end_local: string;
};

export type PlanOptionView = {
  id: string;
  label: string;
};

export type PlanStepView = {
  id: string;
  name: string;
  options: PlanOptionView[];
};

export type ParticipantStatus = "answered" | "in_progress";

export type OrganizerParticipantView = {
  id: string;
  display_name: string;
  distinguisher: string;
  status: ParticipantStatus;
};

export type OrganizerPlanView = {
  id: string;
  title: string;
  state: PlanState;
  timezone: string;
  windows: PlanWindowView[];
  budget: MoneyView;
  steps: PlanStepView[];
  threshold: number;
  answered_count: number;
  in_progress_count: number;
  participants: OrganizerParticipantView[];
  editable: Editable;
};

export type OrganizerPlanInput = {
  id: string;
  title: string;
  state: PlanState;
  timezone: string;
  windows: readonly {
    id: string;
    local_date: string;
    start_local: string;
    end_local: string;
  }[];
  budget: MoneyView;
  steps: readonly {
    id: string;
    name: string;
    options: readonly { id: string; label: string }[];
  }[];
  threshold: number;
  answered_count: number;
  participants: readonly {
    id: string;
    display_name: string;
    distinguisher: string;
    status: ParticipantStatus;
    created_at?: Date | string;
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

export type ResponsePickView = {
  step_id: string;
  option_id: string;
};

export type ParticipantStartView = {
  name: string;
};

export type ParticipantResponseView = {
  plan_state: PlanState;
  budget: MoneyView;
  timezone: string;
  windows: PlanWindowView[];
  steps: PlanStepView[];
  response: {
    complete: boolean;
    windows: ResponseWindowView[];
    start: ParticipantStartView | null;
    picks: ResponsePickView[];
  };
};

export type ParticipantResponseInput = {
  state: PlanState;
  timezone: string;
  budget: MoneyView;
  windows: readonly OrganizerPlanInput["windows"][number][];
  steps: readonly OrganizerPlanInput["steps"][number][];
  response: {
    complete: boolean;
    windows: readonly {
      window_id: string;
      kind: "busy" | "free";
      earliest_local?: string;
      latest_local?: string;
    }[];
    start: { name: string } | null;
    picks: readonly { step_id: string; option_id: string }[];
  };
};

function copyMoney(budget: MoneyView): MoneyView {
  return {
    amount_minor: budget.amount_minor,
    currency: budget.currency,
  };
}

function copyWindows(
  windows: readonly OrganizerPlanInput["windows"][number][],
): PlanWindowView[] {
  return windows.map((window) => ({
    id: window.id,
    local_date: window.local_date,
    start_local: window.start_local,
    end_local: window.end_local,
  }));
}

function copySteps(
  steps: readonly OrganizerPlanInput["steps"][number][],
): PlanStepView[] {
  return steps.map((step) => ({
    id: step.id,
    name: step.name,
    options: step.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
  }));
}

function createdAtMs(value: Date | string | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return 0;
}

function compareParticipants(
  left: OrganizerPlanInput["participants"][number],
  right: OrganizerPlanInput["participants"][number],
): number {
  const byTime = createdAtMs(left.created_at) - createdAtMs(right.created_at);
  if (byTime !== 0) {
    return byTime;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function copyParticipants(
  participants: readonly OrganizerPlanInput["participants"][number][],
): OrganizerParticipantView[] {
  return [...participants].sort(compareParticipants).map((participant) => ({
    id: participant.id,
    display_name: participant.display_name,
    distinguisher: participant.distinguisher,
    status: participant.status,
  }));
}

function copyStart(
  start: { name: string } | null,
): ParticipantStartView | null {
  if (start === null) {
    return null;
  }
  return { name: start.name };
}

function copyResponseWindows(
  windows: ParticipantResponseInput["response"]["windows"],
): ResponseWindowView[] {
  return windows.map((window) => {
    if (window.kind === "busy") {
      return { window_id: window.window_id, kind: "busy" };
    }
    return {
      window_id: window.window_id,
      kind: "free",
      earliest_local: window.earliest_local ?? "",
      latest_local: window.latest_local ?? "",
    };
  });
}

function copyPicks(
  picks: ParticipantResponseInput["response"]["picks"],
): ResponsePickView[] {
  return picks.map((pick) => ({
    step_id: pick.step_id,
    option_id: pick.option_id,
  }));
}

/** Organizer GET /v1/plans/{planId}: no starting points, step picks, or itinerary. */
export function organizerPlanView(plan: OrganizerPlanInput): OrganizerPlanView {
  const participants = copyParticipants(plan.participants);
  return {
    id: plan.id,
    title: plan.title,
    state: plan.state,
    timezone: plan.timezone,
    windows: copyWindows(plan.windows),
    budget: copyMoney(plan.budget),
    steps: copySteps(plan.steps),
    threshold: plan.threshold,
    answered_count: plan.answered_count,
    in_progress_count: participants.length - plan.answered_count,
    participants,
    editable: editableFor(plan.state, plan.answered_count),
  };
}

/**
 * Participant GET /v1/plans/{planId}/response: omits other participants,
 * other starting points, answered_count, and threshold.
 */
export function participantResponseView(
  plan: ParticipantResponseInput,
): ParticipantResponseView {
  return {
    plan_state: plan.state,
    budget: copyMoney(plan.budget),
    timezone: plan.timezone,
    windows: copyWindows(plan.windows),
    steps: copySteps(plan.steps),
    response: {
      complete: plan.response.complete,
      windows: copyResponseWindows(plan.response.windows),
      start: copyStart(plan.response.start),
      picks: copyPicks(plan.response.picks),
    },
  };
}
