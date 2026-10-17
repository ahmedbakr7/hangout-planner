---
id: T-001-57
title: "Place-search limit counted in Postgres"
type: backend
status: ready
risk: medium
depends_on: [T-001-20, T-001-31, T-001-54]
files:
  - "drizzle/0001_init.sql"
  - "src/server/db/schema.ts"
  - "src/server/db/schema.test.ts"
  - "src/server/response/place-search.ts"
  - "src/server/response/place-search.test.ts"
  - "src/app/api/v1/plans/[planId]/place-searches/route.ts"
  - "src/app/api/v1/plans/[planId]/place-searches/route.test.ts"
  - "e2e/plan-views-api-paths.e2e.ts"
  - "e2e/attempt-in-progress.e2e.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Tables"
requirements:
  - F-001-23
acceptance_criteria:
  - "AC-1: a participant's place search returns 429 when 30 place_searches rows for that participant are newer than one hour, even in a server instance that has served none of them"
  - "AC-2: each allowed place search inserts one place_searches row for the caller, stamped with the clock's now; a search refused with 429 inserts none"
  - "AC-3: place_searches rows older than one hour do not count toward the limit, and a place search deletes the caller's rows older than one hour"
  - "AC-4: when a participant has 29 rows newer than one hour and two place searches run concurrently, exactly one is allowed and the other returns 429"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0005-rate-limit-state-in-postgres.md
  - decisions/ADR-0006-patterns-rulebook.md
---

Roadmap item 9. ADR-0005 (accepted) decided that the place-search limit, 30 calls per participant per rolling hour, is counted in Postgres. `src/server/response/place-search.ts` still counts in an in-process `Map`. On serverless each instance has its own `Map` and loses it on cold start, so the limit is not enforced.

ADR-0005 binds; follow its Decision section exactly:

- **Table.** Add `place_searches` (`id` text primary key, `participant_id` text not null, foreign key to `participants.id`, `searched_at` timestamp with time zone not null) to `drizzle/0001_init.sql`, in the same style as `proposal_runs`: the `CREATE TABLE` without inline constraints, and the foreign key as a separate `ALTER TABLE "place_searches" ADD CONSTRAINT "place_searches_participant_id_participants_id_fk" ...` line beside the other foreign keys. Add the matching table to `src/server/db/schema.ts`, and add its columns to the table list in `src/server/db/schema.test.ts`. **Lead decision of 2026-10-17:** no deployed database exists yet, so the table goes into `0001_init.sql` and there is no second migration file. Do not add `drizzle/0002_*` or a migration runner. This is the one exception to ADR-0005's "adds the migration" consequence and backend-patterns' "Forward only": with no deployed database, `0001_init.sql` still creates the whole database (ADR-0001, plan-001). The roadmap (item 9) requires a migration ADR before the first schema change once a database holds real data.
- **Count.** Make `allowPlaceSearch` async and run it in one `db().transaction`. In order: take `pg_advisory_xact_lock(hashtext(participant_id))`; delete that participant's rows with `searched_at` at or before now minus one hour; count the remaining rows; if the count is 30 or more, return false; otherwise insert one row with `id` `` `pse_${randomBytes(16).toString("hex")}` `` (the format of the private `newOpaqueId` in `src/server/proposal/attempt.ts`; do not import or copy that helper) and `searched_at` now, and return true. Use `now()` from `@/server/clock`, `PLACE_SEARCH_LIMIT` and `PLACE_SEARCH_WINDOW_MS`. Copy the transaction and insert style from `src/server/proposal/attempt.ts`.
- **Remove** the `Map` and `resetPlaceSearchLog`. Tests delete `place_searches` rows before the `participants` rows they reference. In `src/app/api/v1/plans/[planId]/place-searches/route.test.ts` that is all three `DELETE FROM participants` statements: the plan cleanup (`WHERE plan_id`), the account cleanup (`WHERE account_id`) and the guest cleanup in `afterEach` (`WHERE guest_session_id`). The new `place-search.test.ts` cleans up its own rows the same way.
- The route awaits `allowPlaceSearch`. It changes nothing else: same order of checks (authz, closed states, query validation, then the limit), same 429 body.
- **Tests** in `src/server/response/place-search.test.ts` (new) and the route test, against the test database, tagged `T-001-57/AC-n`. AC-1 seeds 30 rows directly and calls the route. AC-4 seeds 29 rows and runs two calls with `Promise.all`.
- `place_searches.participant_id` references `participants`, so any suite that calls the route must delete its `place_searches` rows before its `participants` rows. Two e2e suites reach the real route by clicking the response form's "Search" button: `e2e/plan-views-api-paths.e2e.ts` and `e2e/attempt-in-progress.e2e.ts`. In each, add a `place_searches` delete (for that suite's participants) just before its `DELETE FROM participants` statement, and change nothing else in those files. `src/components/response-form.test.tsx` mocks `fetch` and writes no rows, so it needs no change. Find statements by their text, not by line number.
- No change to CONTRACTS, the ADRs, or other routes.

Tests and gates need a fresh database. `applySchemaOnce` skips a database that already has `accounts`, so an older local test database will not get the new table.

**Agent:** build with `builder`.
