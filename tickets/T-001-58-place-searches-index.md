---
id: T-001-58
title: "Index place_searches by participant and time"
type: backend
status: ready
risk: low
depends_on: [T-001-57]
files:
  - "drizzle/0001_init.sql"
  - "src/server/db/schema.ts"
  - "src/server/db/schema.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Tables"
requirements:
  - F-001-23
acceptance_criteria:
  - "AC-1: the database created from drizzle/0001_init.sql has a btree index place_searches_participant_id_searched_at_idx on place_searches (participant_id, searched_at)"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0005-rate-limit-state-in-postgres.md
---

Follow-up from CodeRabbit on #130. `allowPlaceSearch` (T-001-57) deletes and counts one participant's `place_searches` rows on every search, while holding that participant's advisory lock. Neither query has an index. Each search prunes only the caller's rows, so rows of participants who stop searching stay, and the table grows with the number of participants.

- **`drizzle/0001_init.sql`:** add `CREATE INDEX "place_searches_participant_id_searched_at_idx" ON "place_searches" USING btree ("participant_id","searched_at");` beside the existing `CREATE UNIQUE INDEX "participants_plan_id_account_id_uidx"` line, in the same form. The table stays in `0001_init.sql` with no second migration file (lead decision of 2026-10-17, roadmap item 9).
- **`src/server/db/schema.ts`:** declare the same index on `placeSearches` with drizzle's `index(...)`, in the style of the `uniqueIndex("participants_plan_id_account_id_uidx")` declaration on `participants`.
- **`src/server/db/schema.test.ts`:** a test tagged `T-001-58/AC-1` that reads `pg_indexes` for the index name and asserts its definition names `place_searches`, btree, and the two columns in that order. Copy the existing `participants_plan_id_account_id_uidx` test.
- No change to `place-search.ts`, CONTRACTS or any ADR.

This ticket touches `drizzle/**`, a `lanes.strict_paths` entry, so it runs in the strict lane and its PR needs a lead approval.

Tests and gates need a fresh database: `applySchemaOnce` skips a database that already has `accounts`.

**Agent:** build with `builder`.
