---
id: T-001-43
title: "Tests: exact redirect assertions and link session cleanup"
type: test
status: ready
risk: low
depends_on: [T-001-40]
files:
  - "src/app/plans/[planId]/proposal/page.test.tsx"
  - "e2e/attempt-in-progress.e2e.ts"
  - "e2e/authz.e2e.ts"
  - "e2e/confirmed-server-load.e2e.ts"
  - "e2e/core-loop.e2e.ts"
  - "e2e/organizer-plan-server-load.e2e.ts"
  - "e2e/plan-views-api-paths.e2e.ts"
  - "e2e/proposal-server-load.e2e.ts"
  - "e2e/respond-server-load.e2e.ts"
skills:
  - test
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: every redirect assertion in src/app/plans/[planId]/proposal/page.test.tsx matches the whole redirect target, so a redirect to /plans/{planId}/respond or /plans/{planId}/confirmed fails the test that expects /plans/{planId}"
  - "AC-2: after the e2e suite runs on an empty test database, the link_sessions table has no row whose id is not referenced by link_session_plans, and each listed e2e file deletes the link_sessions rows of the plans it created in its afterAll"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

This ticket is test-only cleanup from the CodeRabbit review of #96 (T-001-39). It changes no product code.

- **`src/app/plans/[planId]/proposal/page.test.tsx`:** the three redirect assertions use `toThrow("NEXT_REDIRECT /plans/pln_a…")`, which is a substring match. The `collecting` case would therefore also pass for `/plans/pln_a/respond` or `/plans/pln_a/confirmed`. Use an anchored regular expression, or an exact `Error` message, for all three.
- **Each listed `e2e/` file:** its `afterAll` deletes `link_session_plans` for the plans it created, but never the `link_sessions` rows. A `GET /api/v1/join/{token}` call creates one of those rows, or reuses the session in a valid `hp_link` cookie and adds an association for another plan. Before deleting the plan's `link_session_plans` rows, read their `link_session_id`s. Delete only the associations for the file's own plans, never another plan's. After the other deletes, delete a collected `link_sessions` row only when no `link_session_plans` row remains for it.
- No assertion is weakened, no test is skipped, and no shared helper is added. Each file keeps its own `afterAll`, as it does today.
