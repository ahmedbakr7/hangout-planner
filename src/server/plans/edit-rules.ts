import { httpError, type HttpError } from "../http/errors";
import { parseMoney, type Money } from "../money";

export const PLAN_STATES = [
  "collecting",
  "blocked",
  "proposed",
  "locked",
] as const;

export type PlanState = (typeof PLAN_STATES)[number];

export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 100;

export type BudgetEditMode = "any" | "raise" | "frozen";
export type ThresholdEditMode = "any" | "lower" | "frozen";

export type Editable = {
  title: boolean;
  timezone: boolean;
  windows: boolean;
  budget: BudgetEditMode;
  currency: boolean;
  threshold: ThresholdEditMode;
  steps: boolean;
};

export type StoredPlan = {
  state: PlanState;
  answeredCount: number;
  budget: Money;
  threshold: number;
};

export type PlanPatch = {
  title?: unknown;
  timezone?: unknown;
  windows?: unknown;
  budget?: unknown;
  steps?: unknown;
  threshold?: unknown;
};

export type PlanPatchResult =
  | { ok: true }
  | { ok: false; error: HttpError };

const STRUCTURE_KEYS = ["title", "timezone", "windows"] as const;

function frozenEditable(): Editable {
  return {
    title: false,
    timezone: false,
    windows: false,
    budget: "frozen",
    currency: false,
    threshold: "frozen",
    steps: false,
  };
}

/** Freeze matrix from plan state and answered_count (CONTRACTS GET/PATCH plan). */
export function editableFor(
  state: PlanState,
  answeredCount: number,
): Editable {
  if (state === "collecting" && answeredCount === 0) {
    return {
      title: true,
      timezone: true,
      windows: true,
      budget: "any",
      currency: true,
      threshold: "any",
      steps: true,
    };
  }
  if (state === "collecting") {
    return {
      title: true,
      timezone: false,
      windows: false,
      budget: "raise",
      currency: false,
      threshold: "lower",
      steps: false,
    };
  }
  if (state === "blocked") {
    return {
      title: true,
      timezone: false,
      windows: false,
      budget: "raise",
      currency: false,
      threshold: "frozen",
      steps: false,
    };
  }
  if (state === "proposed") {
    return {
      title: true,
      timezone: false,
      windows: false,
      budget: "frozen",
      currency: false,
      threshold: "frozen",
      steps: false,
    };
  }
  return frozenEditable();
}

function patchHas(patch: PlanPatch, key: keyof PlanPatch): boolean {
  return patch[key] !== undefined;
}

function isThresholdInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isLegalRaise(stored: Money, proposed: Money): boolean {
  return (
    proposed.currency === stored.currency &&
    proposed.amountMinor > stored.amountMinor
  );
}

function isLegalLower(
  storedThreshold: number,
  answeredCount: number,
  proposed: number,
): boolean {
  return proposed >= answeredCount && proposed <= storedThreshold;
}

function isThresholdAny(value: number): boolean {
  return value >= THRESHOLD_MIN && value <= THRESHOLD_MAX;
}

/**
 * Validate a PATCH body against the freeze matrix. Failure is 409 field_frozen
 * and does not describe a write.
 */
export function validatePlanPatch(
  stored: StoredPlan,
  patch: PlanPatch,
): PlanPatchResult {
  const editable = editableFor(stored.state, stored.answeredCount);
  const fields: { path: string; code: "frozen" }[] = [];

  for (const key of STRUCTURE_KEYS) {
    if (patchHas(patch, key) && editable[key] === false) {
      fields.push({ path: key, code: "frozen" });
    }
  }

  if (patchHas(patch, "budget")) {
    if (editable.budget === "frozen") {
      fields.push({ path: "budget", code: "frozen" });
    } else {
      const proposed = parseMoney(patch.budget);
      if (proposed === null) {
        if (editable.budget === "raise") {
          fields.push({ path: "budget", code: "frozen" });
        }
      } else {
        if (
          editable.budget === "raise" &&
          !isLegalRaise(stored.budget, proposed)
        ) {
          fields.push({ path: "budget", code: "frozen" });
        }
        if (proposed.currency !== stored.budget.currency && !editable.currency) {
          fields.push({ path: "currency", code: "frozen" });
        }
      }
    }
  }

  if (patchHas(patch, "threshold")) {
    if (editable.threshold === "frozen") {
      fields.push({ path: "threshold", code: "frozen" });
    } else if (!isThresholdInteger(patch.threshold)) {
      fields.push({ path: "threshold", code: "frozen" });
    } else if (
      editable.threshold === "any" &&
      !isThresholdAny(patch.threshold)
    ) {
      fields.push({ path: "threshold", code: "frozen" });
    } else if (
      editable.threshold === "lower" &&
      !isLegalLower(stored.threshold, stored.answeredCount, patch.threshold)
    ) {
      fields.push({ path: "threshold", code: "frozen" });
    }
  }

  if (patchHas(patch, "steps") && editable.steps === false) {
    fields.push({ path: "steps", code: "frozen" });
  }

  if (fields.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    error: httpError(409, {
      reason: "field_frozen",
      message: "plan patch rejected as field_frozen",
      fields,
    }),
  };
}
