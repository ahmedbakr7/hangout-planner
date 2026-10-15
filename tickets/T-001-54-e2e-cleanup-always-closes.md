---
id: T-001-54
title: "Tests: e2e cleanup always closes its database clients"
type: test
status: ready
risk: low
depends_on: [T-001-31, T-001-43, T-001-49]
files:
  - "e2e/db-cleanup.ts"
  - "e2e/db-cleanup.e2e.ts"
  - "e2e/account-server-load.e2e.ts"
  - "e2e/attempt-in-progress.e2e.ts"
  - "e2e/confirmed-server-load.e2e.ts"
  - "e2e/create-server-load.e2e.ts"
  - "e2e/home-server-load.e2e.ts"
  - "e2e/invitations-plan-path.e2e.ts"
  - "e2e/invitations-server-load.e2e.ts"
  - "e2e/invite-server-load.e2e.ts"
  - "e2e/list-truncation.e2e.ts"
  - "e2e/organizer-plan-server-load.e2e.ts"
  - "e2e/plan-join-server-load.e2e.ts"
  - "e2e/plan-paths.e2e.ts"
  - "e2e/plan-views-api-paths.e2e.ts"
  - "e2e/proposal-server-load.e2e.ts"
  - "e2e/respond-server-load.e2e.ts"
  - "e2e/session-slide.e2e.ts"
  - "e2e/test-schema.e2e.ts"
  - "e2e/ui-api-paths.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: when the cleanup step passed to cleanupThenClose throws, every closer passed with it still runs, and cleanupThenClose then rejects with that cleanup error"
  - "AC-2: when the cleanup step succeeds and a closer throws, the remaining closers still run and cleanupThenClose rejects with the first closer error"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Roadmap item 11's last open line (CodeRabbit on #113). This ticket is test-only. It changes no product code.

In 17 of the `e2e/` files listed after the helper, `afterAll` first deletes the rows the file seeded, then closes its own `postgres` client (`sql.end()`) and the server modules' clients (`closeDatabase` imports). `e2e/test-schema.e2e.ts` has the same shape: it drops its scratch database, then closes its admin client. If a delete or the drop throws, the closes never run. Vitest then reports the cleanup error, but open clients can hold the run open or leak connections into the next file.

- **`e2e/db-cleanup.ts`:** export `cleanupThenClose(cleanup: () => Promise<void>, ...closers: Array<() => Promise<unknown>>): Promise<void>`.
  - It runs `cleanup` first.
  - It then runs every closer whatever happened, with `Promise.allSettled` or one at a time, each in its own `try`.
  - It rejects with the cleanup error if there was one, otherwise with the first closer error, otherwise it resolves.
  - It imports nothing from `src/`.
- **`e2e/db-cleanup.e2e.ts`:** tests tagged `T-001-54/AC-1` and `T-001-54/AC-2`, using fakes that record calls. No database is needed. This is the real-stack proof the kit's `ac-coverage` rule asks of a `type: test` ticket.
- **The 18 files:** each `afterAll` becomes one `cleanupThenClose` call.
  - The existing deletes, or in `test-schema.e2e.ts` the `DROP DATABASE`, move unchanged into the cleanup function.
  - The existing `sql.end(...)` and `closeDatabase` calls become the closers, in the same set.
  - Do not change what is deleted, the order of the deletes, or any test.
- `afterAll` blocks with no deletes (for example `e2e/authz.e2e.ts`) stay as they are.
- No assertion is weakened and no test is skipped.
- `e2e/db-cleanup.ts` is a helper, not a test, like `e2e/route-server.ts`. `e2e/**` is in the kit's test globs, so a `type: test` ticket may write it.
- **Requirement:** no spec requirement covers test hygiene, and a `type: test` ticket must cite one. N-001-15 is cited as T-001-43 cited it: the e2e suites this ticket touches include the plan-isolation tests that prove it. The citation does not claim this ticket proves N-001-15.
