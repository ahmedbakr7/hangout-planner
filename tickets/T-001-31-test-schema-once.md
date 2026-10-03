---
id: T-001-31
title: "Apply the test database schema once, before any test file"
type: chore
status: in_progress
risk: low
depends_on: []
files:
  - "src/server/db/test-schema.ts"
  - "vitest.global-setup.ts"
  - "vitest.config.ts"
  - "vitest.e2e.config.mts"
skills:
  - build
  - backend-patterns
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: applySchemaOnce called concurrently from five connections on an empty schema creates every table of drizzle/0001_init.sql once, and none of the calls fails"
  - "AC-2: applySchemaOnce on a schema that already has the tables changes nothing and does not fail"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
---

On a fresh database the unit suite fails in about 3 of 4 runs with `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`. 22 test files each migrate the database in `beforeAll` under a Postgres advisory lock, but with different lock keys (14 use 60106, seven use their own 60123-60129), so files on different keys race to create the same enum type.

Add `applySchemaOnce(sql)` in `src/server/db/test-schema.ts`: under one advisory lock key, apply `drizzle/0001_init.sql` only when the `accounts` table is missing. Call it from a Vitest `globalSetup` (`vitest.global-setup.ts`, using `DATABASE_URL`) wired into `vitest.config.ts` and `vitest.e2e.config.mts`, so the schema exists before the first test file starts. The per-file migration blocks then find the tables and skip; removing those 22 copies is the duplication ticket's work, not this one.

Test play: the integration suite (`e2e/`) must pass for real-stack proof. It is broken since #53 moved `closeDatabase`, `setGoogleClientOptions` and `setProposalAttemptGoogleOptions` out of the route modules; repoint the two e2e files at `@/server/auth/http`, `@/server/plans/http`, `@/server/invites/inbox`, `@/server/join/db`, `@/server/response/google`, `@/server/proposal/swap-google` and `@/server/proposal/trigger`, and prove AC-1 through the real stack.
