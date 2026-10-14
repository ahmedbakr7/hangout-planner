---
id: T-001-49
title: "Tests: home and invitations lists stop at 100 rows and say so"
type: test
status: ready
risk: low
depends_on: [T-001-45, T-001-46, T-001-47]
files:
  - "src/server/plans/page-data.test.ts"
  - "src/server/invites/page-data.test.ts"
skills:
  - test
contracts: "arch/CONTRACTS.md#GET /api/v1/plans"
requirements:
  - F-001-37
  - F-001-18
acceptance_criteria:
  - "AC-1: for an account that organizes 101 plans, loadHomePage returns ok with exactly 100 plans, truncated true, in updated_at descending order with the newest first; for exactly 100 plans it returns 100 plans with truncated false"
  - "AC-2: for an account with 101 invitations to distinct plans, loadInvitationsPage returns ok with exactly 100 rows, truncated true, in created_at descending order with the newest first; for exactly 100 it returns 100 rows with truncated false"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

This ticket is test-only. It changes no product code. The reviews of #105 (T-001-45) and #107 (T-001-47) both noted that no test reaches the 100-row limit and the `truncated` flag that CONTRACTS sets for `GET /api/v1/plans` and `GET /api/v1/invitations`. The loaders now own that rule.

- Add the boundary cases to the existing loader test files, with the database helpers those files already use. Seed rows with distinct `updated_at` or `created_at` values so the order is deterministic, and assert the first and last ids.
- Seed in bulk with one insert per table, not 101 round trips.
- Delete what each test seeds in that file's existing cleanup.
- No assertion is weakened, no test is skipped, and no shared helper is added.
