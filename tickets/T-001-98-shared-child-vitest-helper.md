---
id: T-001-98
title: "Tests: one shared child-Vitest helper for the shipped-coverage e2e files"
type: test
status: ready
risk: low
depends_on: [T-001-91, T-001-92, T-001-94]
files:
  - "e2e/child-vitest.ts"
  - "e2e/child-vitest.e2e.ts"
  - "e2e/shipped-coverage-foundations.e2e.ts"
  - "e2e/shipped-coverage-shell-gate-plans.e2e.ts"
  - "e2e/shipped-coverage-join-invites.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: childEnv({ databaseUrl: null, guard: false }) returns an environment with no DATABASE_URL, HP_HASH_TEST or NODE_OPTIONS key while the parent process sets all three, childEnv({ databaseUrl: U, guard: false }) returns one whose DATABASE_URL is U, and neither call changes process.env"
  - "AC-2: in a child node process started with childEnv({ databaseUrl: null, guard: true }), fetch of https://places.googleapis.com/v1/places:searchText rejects with an error whose text contains 'blocked outgoing fetch', and an https.get of the same URL fails with 'blocked outgoing socket' on stderr"
  - "AC-3: runChild([\"src/app/api/v1/me/route.test.ts\"], env) returns null or a report with success false and no passed test, both for env { databaseUrl: null, guard: true } and for env { databaseUrl: the parent's DATABASE_URL, guard: true }"
  - "AC-4: runChild([\"src/server/money.test.ts\"], { databaseUrl: null, guard: true }) returns a report whose testResults name exactly src/server/money.test.ts, with at least one test, no failed test and every test passed; expectAllPassed accepts that report for that file list and throws for the file list [\"src/server/ids.test.ts\"]"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
  - decisions/ADR-0018-test-ticket-lists-shared-e2e-helper-under-files.md
---

Roadmap item 6's open line. This ticket is test-only. It changes no product code. Under ADR-0018 the shared helper is listed under `files:`, not `test_files`.

Three e2e files each carry their own copy of the helpers that run unit test files in a child Vitest (measured on `main` `9c12e66`):

- `e2e/shipped-coverage-foundations.e2e.ts` (T-001-91): `GUARD`, `guardedEnv(keepDatabaseUrl)`, `JsonReport`, `runIsolated(files, keepDatabaseUrl)` (timeout 110 s) and `expectPure(files)`, used by `expectGuardBites()`.
- `e2e/shipped-coverage-shell-gate-plans.e2e.ts` (T-001-92): `GUARD` (copied from foundations), `ChildEnv`, `childEnv({ databaseUrl, guard })`, `JsonReport`, `runChild(files, env)` (timeout 280 s), `expectAllPassed` and `expectNonePassed`.
- `e2e/shipped-coverage-join-invites.e2e.ts` (T-001-94): `JsonReport`, `childEnv(url)` (no guard), `runChild(files, url)` (timeout 280 s), `expectAllPassed` and `expectNonePassed`, copied from shell-gate-plans.

Changes:

- **`e2e/child-vitest.ts`** (new; a helper, not a test, like `e2e/db-cleanup.ts` and `e2e/teardown.ts`): export `GUARD`, `type ChildEnv = { databaseUrl: string | null; guard: boolean }`, `childEnv`, `type JsonReport`, `runChild(files, env, timeout = 280_000)`, `expectAllPassed` and `expectNonePassed`, with the behaviour of the shell-gate-plans copies. `runChild` keeps the `vitest.config.ts` and JSON-report arguments and the "no report" branch unchanged. It imports nothing from `src/`.
- **`e2e/child-vitest.e2e.ts`** (new): one test per AC, each tagged `T-001-98/AC-n`. No product code is touched. AC-3 needs Postgres, as the existing guard checks do.
- **The three files:** delete the local copies listed above and import from `./child-vitest`.
  - `foundations`: `guardedEnv(keep)` becomes `childEnv({ databaseUrl: keep ? databaseUrl : null, guard: true })`, `runIsolated` becomes `runChild` with a 110 000 ms timeout, and `expectPure(files)` becomes `expectAllPassed(runChild(files, …, 110_000), files)`. `expectGuardBites()` stays in the file and calls the shared helpers.
  - `join-invites`: `childEnv(url)` becomes `childEnv({ databaseUrl: url, guard: false })`.
  - Each file's `urlFor` and `root` stay where they are.
- Keep every existing test, its title and its tag unchanged. Weaken no assertion and skip no test.
- **Not in scope:** `urlFor`, the route-server harness, and any helper shared by a `src/` test and an `e2e/` test (roadmap item 24).
- **Requirement:** N-001-15 is cited as T-001-54 cited it; the citation does not claim this ticket proves N-001-15.

**Agent:** build with `builder`, as T-001-54 and T-001-59 were. A `type: test` build runs the real-stack suites itself. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/child-vitest.e2e.ts e2e/shipped-coverage-foundations.e2e.ts e2e/shipped-coverage-shell-gate-plans.e2e.ts e2e/shipped-coverage-join-invites.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
