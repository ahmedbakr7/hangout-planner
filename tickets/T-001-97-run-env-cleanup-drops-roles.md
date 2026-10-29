---
id: T-001-97
title: "Tests: run-env cleanup drops its roles even when a database drop throws"
type: test
status: ready
risk: low
depends_on: [T-001-84]
files:
  - "src/run-env.test.ts"
  - "e2e/run-env.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: in src/run-env.test.ts, when dropping one tracked run database throws, the per-test cleanup still drops every tracked role that owns no remaining database, empties both tracked sets, and then rejects with that database error"
  - "AC-2: in e2e/run-env.e2e.ts, when dropping one tracked run database throws, the per-test cleanup still drops every tracked role that owns no remaining database, empties both tracked sets, and then rejects with that database error"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0014-per-run-database-and-ports.md
  - decisions/ADR-0015-run-env-script-in-scripts.md
---

Roadmap item 24's open line (review of #186). This ticket is test-only. It changes no product code and no script.

Today both files drop the tracked `hp_run_` databases first, then the tracked `e84_` roles, in one sequence. If one database drop throws, the role loop never runs, so an `e84_` login role stays in the local Postgres after the run.

- **`src/run-env.test.ts`:** move the `afterEach` body into a named `dropCreated` function, as `e2e/run-env.e2e.ts` already has it, and pass that to `afterEach`. Drop the roles in a `finally` after the database loop. Empty both sets whatever happened. Rethrow the first database error; if only a role drop failed, rethrow the first role error. Do not import from `e2e/`; the repo has no helper shared by a `src/` test and an `e2e/` test (roadmap item 24).
- **`e2e/run-env.e2e.ts`:** make `dropCreated` one `cleanupThenClose` call from `e2e/db-cleanup.ts`: the database drops are the cleanup, and the role drops are the closer. `cleanupThenClose` already runs its closers when the cleanup throws and rejects with the cleanup error (T-001-54). Empty both sets whatever happened.
- **Tests:** in each file, one test tagged with that file's AC. It creates a real role with the file's existing role helper, tracks a database name whose `DROP DATABASE` fails against the real Postgres (a name holding a double quote, which the quoted identifier in the drop cannot hold), calls `dropCreated` directly, and asserts:
  - it rejects with the Postgres error;
  - `pg_roles` has no row for the role;
  - both sets are empty.

  The test must fail on main, where the role is left behind. It must not leave the role behind when it fails: drop it itself in a `finally`.
- Keep every existing test and its tag unchanged. Weaken no assertion and skip no test.
- **Requirement:** no spec requirement covers test hygiene, and a `type: test` ticket must cite one. N-001-15 is cited as T-001-54 cited it. The citation does not claim that this ticket proves N-001-15.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself. It runs `npx --no-install vitest run src/run-env.test.ts` and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/run-env.e2e.ts` against the local Postgres in `DATABASE_URL`.
