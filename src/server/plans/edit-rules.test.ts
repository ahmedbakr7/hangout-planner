import { describe, expect, it } from "vitest";
import {
  PLAN_STATES,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  editableFor,
  validatePlanPatch,
  type Editable,
  type PlanPatch,
  type PlanPatchResult,
  type PlanState,
  type StoredPlan,
} from "./edit-rules";

const OPEN_COLLECTING: Editable = {
  title: true,
  timezone: true,
  windows: true,
  budget: "any",
  currency: true,
  threshold: "any",
  steps: true,
};

const ANSWERED_COLLECTING: Editable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "raise",
  currency: false,
  threshold: "lower",
  steps: false,
};

const BLOCKED: Editable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "raise",
  currency: false,
  threshold: "frozen",
  steps: false,
};

const PROPOSED: Editable = {
  title: true,
  timezone: false,
  windows: false,
  budget: "frozen",
  currency: false,
  threshold: "frozen",
  steps: false,
};

function stored(overrides: Partial<StoredPlan> = {}): StoredPlan {
  return {
    state: "collecting",
    answeredCount: 0,
    budget: { amountMinor: 50_000, currency: "EGP" },
    threshold: 3,
    ...overrides,
  };
}

function expectOk(result: PlanPatchResult): void {
  expect(result).toEqual({ ok: true });
  expect("write" in result).toBe(false);
}

function expectFrozen(
  result: PlanPatchResult,
  paths: readonly string[],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.error.status).toBe(409);
  expect(result.error.body.error.code).toBe("conflict");
  expect(result.error.body.error.reason).toBe("field_frozen");
  expect(result.error.body.error.message).toBe(
    "plan patch rejected as field_frozen",
  );
  expect(result.error.body.error.fields).toEqual(
    paths.map((path) => ({ path, code: "frozen" })),
  );
  expect("write" in result).toBe(false);
  expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
}

describe("PLAN_STATES", () => {
  it("is collecting, blocked, proposed, and locked", () => {
    expect(PLAN_STATES).toEqual([
      "collecting",
      "blocked",
      "proposed",
      "locked",
    ]);
  });
});

describe("editableFor", () => {
  it("collecting with answered_count 0 allows title, timezone, windows, steps, and currency, budget any, and threshold any", () => {
    expect(editableFor("collecting", 0)).toEqual(OPEN_COLLECTING);
  });

  it("collecting with answered_count at least 1 allows title, budget raise, and threshold lower, and freezes the rest", () => {
    expect(editableFor("collecting", 1)).toEqual(ANSWERED_COLLECTING);
    expect(editableFor("collecting", 4)).toEqual(ANSWERED_COLLECTING);
  });

  it("blocked allows title and budget raise, and freezes the rest; proposed allows title and freezes the rest", () => {
    expect(editableFor("blocked", 0)).toEqual(BLOCKED);
    expect(editableFor("blocked", 2)).toEqual(BLOCKED);
    expect(editableFor("proposed", 0)).toEqual(PROPOSED);
    expect(editableFor("proposed", 5)).toEqual(PROPOSED);
  });
});

describe("validatePlanPatch", () => {
  it("collecting with answered_count 0 allows title, timezone, windows, steps, currency, budget any, and threshold any", () => {
    const plan = stored();
    expect(editableFor(plan.state, plan.answeredCount).budget).toBe("any");
    expect(editableFor(plan.state, plan.answeredCount).threshold).toBe("any");
    expectOk(
      validatePlanPatch(plan, {
        title: "Thursday in Maadi",
        timezone: "Africa/Cairo",
        windows: [
          {
            local_date: "2026-10-02",
            start_local: "18:00",
            end_local: "23:00",
          },
        ],
        steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
        budget: { amount_minor: 25_000, currency: "USD" },
        threshold: 1,
      }),
    );
    expectOk(
      validatePlanPatch(plan, {
        budget: { amount_minor: 1, currency: "AED" },
        threshold: 100,
      }),
    );
  });

  it("collecting with answered_count at least 1 allows title, budget raise, and threshold lower, and freezes the rest", () => {
    const plan = stored({ answeredCount: 1, threshold: 4 });
    expectOk(
      validatePlanPatch(plan, {
        title: "Updated title",
        budget: { amount_minor: 50_001, currency: "EGP" },
        threshold: 1,
      }),
    );
    expectFrozen(
      validatePlanPatch(plan, {
        timezone: "Africa/Cairo",
        windows: [],
        steps: [],
      }),
      ["timezone", "windows", "steps"],
    );
    expectFrozen(
      validatePlanPatch(plan, {
        budget: { amount_minor: 60_000, currency: "USD" },
      }),
      ["budget", "currency"],
    );
  });

  it("blocked allows title and budget raise, and freezes the rest; proposed allows title and freezes the rest", () => {
    const blocked = stored({ state: "blocked", answeredCount: 2 });
    expectOk(
      validatePlanPatch(blocked, {
        title: "Blocked title",
        budget: { amount_minor: 80_000, currency: "EGP" },
      }),
    );
    expectFrozen(
      validatePlanPatch(blocked, {
        timezone: "Africa/Cairo",
        windows: [],
        steps: [],
        threshold: 2,
      }),
      ["timezone", "windows", "threshold", "steps"],
    );

    const proposed = stored({ state: "proposed", answeredCount: 3 });
    expectOk(validatePlanPatch(proposed, { title: "Proposed title" }));
    expectFrozen(
      validatePlanPatch(proposed, {
        timezone: "Africa/Cairo",
        windows: [],
        budget: { amount_minor: 90_000, currency: "EGP" },
        steps: [],
        threshold: 1,
      }),
      ["timezone", "windows", "budget", "threshold", "steps"],
    );
  });

  it("budget raise requires the same currency and a strictly greater amount_minor; threshold lower requires an integer at least answered_count and at most the stored threshold; threshold any allows an integer 1 through 100", () => {
    const raise = stored({ state: "blocked", answeredCount: 2, threshold: 5 });
    expectOk(
      validatePlanPatch(raise, {
        budget: { amount_minor: 50_001, currency: "EGP" },
      }),
    );
    expectFrozen(
      validatePlanPatch(raise, {
        budget: { amount_minor: 50_000, currency: "EGP" },
      }),
      ["budget"],
    );
    expectFrozen(
      validatePlanPatch(raise, {
        budget: { amount_minor: 49_999, currency: "EGP" },
      }),
      ["budget"],
    );
    expectFrozen(
      validatePlanPatch(raise, {
        budget: { amount_minor: 80_000, currency: "SAR" },
      }),
      ["budget", "currency"],
    );
    expectFrozen(
      validatePlanPatch(raise, { budget: { amount_minor: 0, currency: "EGP" } }),
      ["budget"],
    );

    const lower = stored({ answeredCount: 2, threshold: 5 });
    expectOk(validatePlanPatch(lower, { threshold: 2 }));
    expectOk(validatePlanPatch(lower, { threshold: 5 }));
    expectOk(validatePlanPatch(lower, { threshold: 3 }));
    expectFrozen(validatePlanPatch(lower, { threshold: 1 }), ["threshold"]);
    expectFrozen(validatePlanPatch(lower, { threshold: 6 }), ["threshold"]);
    expectFrozen(validatePlanPatch(lower, { threshold: 2.5 }), ["threshold"]);

    const any = stored();
    expect(THRESHOLD_MIN).toBe(1);
    expect(THRESHOLD_MAX).toBe(100);
    expectOk(validatePlanPatch(any, { threshold: 1 }));
    expectOk(validatePlanPatch(any, { threshold: 100 }));
    expectOk(validatePlanPatch(any, { threshold: 50 }));
    expectFrozen(validatePlanPatch(any, { threshold: 0 }), ["threshold"]);
    expectFrozen(validatePlanPatch(any, { threshold: 101 }), ["threshold"]);
  });

  it("a frozen key, an illegal budget change, a currency change while currency is frozen, or a threshold outside the current mode is field_frozen and describes no write", () => {
    const collecting = stored({ answeredCount: 1, threshold: 3 });
    expectFrozen(
      validatePlanPatch(collecting, { timezone: "Africa/Cairo" }),
      ["timezone"],
    );
    expectFrozen(
      validatePlanPatch(collecting, {
        budget: { amount_minor: 40_000, currency: "EGP" },
      }),
      ["budget"],
    );
    expectFrozen(
      validatePlanPatch(collecting, {
        budget: { amount_minor: 70_000, currency: "USD" },
      }),
      ["budget", "currency"],
    );
    expectFrozen(
      validatePlanPatch(collecting, { threshold: 4 }),
      ["threshold"],
    );
    expectFrozen(
      validatePlanPatch(collecting, { threshold: 0 }),
      ["threshold"],
    );

    const proposed = stored({ state: "proposed" });
    const frozenTitle = validatePlanPatch(proposed, { title: "ok" });
    expectOk(frozenTitle);

    const omitted = validatePlanPatch(proposed, {});
    expectOk(omitted);

    const states: PlanState[] = ["collecting", "blocked", "proposed", "locked"];
    for (const state of states) {
      expectFrozen(
        validatePlanPatch(stored({ state, answeredCount: 1 }), {
          windows: [{ local_date: "2026-10-02" }],
        } satisfies PlanPatch),
        ["windows"],
      );
    }
  });
});
