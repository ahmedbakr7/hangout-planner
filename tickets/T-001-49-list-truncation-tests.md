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
  - "e2e/list-truncation.e2e.ts"
skills:
  - test
contracts: "arch/CONTRACTS.md#GET /api/v1/plans"
requirements:
  - F-001-37
  - F-001-18
acceptance_criteria:
  - "AC-1: for an account that organizes 101 plans, loadHomePage returns ok with exactly 100 plans, truncated true, ordered by updated_at descending, then id descending; for exactly 100 plans it returns 100 plans with truncated false"
  - "AC-2: for an account with 101 invitations to distinct plans, loadInvitationsPage returns ok with exactly 100 rows, truncated true, ordered by created_at descending, then id descending; for exactly 100 it returns 100 rows with truncated false"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

This ticket is test-only. It changes no product code. The reviews of #105 (T-001-45) and #107 (T-001-47) both noted that no test reaches the 100-row limit and the `truncated` flag that CONTRACTS sets for `GET /api/v1/plans` and `GET /api/v1/invitations`. The loaders now own that rule.

- Add the boundary cases to the existing loader test files, with the database helpers those files already use. The loaders order by `desc(plans.updatedAt), desc(plans.id)` and `desc(invitations.createdAt), desc(invitations.id)`. Seed rows with distinct `updated_at` or `created_at` values so the order is deterministic, and assert the first and last ids. In each 101-row case, give two rows inside the first 100 the same timestamp and assert they come back in descending id order, so the tie-break is tested too.
- Seed in bulk with one insert per table, not 101 round trips.
- Delete what each test seeds in that file's existing cleanup.
- **Real-stack proof, in this build:** a `type: test` ticket's build must prove each AC with a passing integration test (the `ac-coverage` gate). Add `e2e/list-truncation.e2e.ts`, tagged `T-001-49/AC-1` and `T-001-49/AC-2`. It seeds the same 101-row and 100-row cases in the test database, signs in as the seeded account, and calls `GET /api/v1/plans` and `GET /api/v1/invitations` through the running app: 100 rows and `truncated` true for 101, 100 rows and `truncated` false for 100, first and last ids in the loaders' order. Copy the setup and `afterAll` cleanup of `e2e/home-server-load.e2e.ts` and `e2e/invitations-server-load.e2e.ts`. The unit tests above stay.
- No assertion is weakened, no test is skipped, and no shared helper is added.
