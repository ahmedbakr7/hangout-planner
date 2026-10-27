---
id: T-001-96
title: "AC coverage for shipped tickets: lock and confirmed, proposal and confirmed UI"
type: test
status: ready
risk: low
depends_on: [T-001-26, T-001-27, T-001-28, T-001-29, T-001-38, T-001-39, T-001-43, T-001-50, T-001-52, T-001-53, T-001-55, T-001-71, T-001-78, T-001-90, T-001-95]
files:
  - "e2e/shipped-coverage-lock-confirmed.e2e.ts"
  - "src/app/api/v1/plans/[planId]/confirmed/route.test.ts"
  - "src/app/api/v1/plans/[planId]/lock/route.test.ts"
  - "src/components/proposal-view.test.tsx"
  - "src/components/confirmed-view.test.tsx"
  - "e2e/core-loop.e2e.ts"
  - "e2e/authz.e2e.ts"
  - "e2e/rtl.e2e.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-9, F-001-28, F-001-29, F-001-30, F-001-31, F-001-32, F-001-33, F-001-34, F-001-35, F-001-36, F-001-41, N-001-8, N-001-9, N-001-10, N-001-11, N-001-12, N-001-15, N-001-16]
acceptance_criteria:
  - "AC-1: each of T-001-26 AC-2, AC-3, AC-4, AC-5, AC-6 has a passing test whose name carries T-001-96/AC-1 and that AC's tag (for example T-001-96/AC-1 T-001-26/AC-2), and that test asserts every clause of the AC as T-001-26 states it"
  - "AC-2: each of T-001-27 AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8 has a passing test whose name carries T-001-96/AC-2 and that AC's tag (for example T-001-96/AC-2 T-001-27/AC-1), and that test asserts every clause of the AC as T-001-27 states it"
  - "AC-3: each of T-001-28 AC-1, AC-3, AC-4, AC-5, AC-6, AC-7 has a passing test whose name carries T-001-96/AC-3 and that AC's tag (for example T-001-96/AC-3 T-001-28/AC-1), and that test asserts every clause of the AC as T-001-28 states it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
---
Roadmap item 6, second half. `gate ci` proves every AC of every done ticket (`ac-coverage`): each needs a passing test whose name carries its tag. T-001-26, T-001-27, T-001-28, T-001-29 shipped before AC tags, so these AC are baselined as `missing`. T-001-90 gave each of them one real-stack-proven AC; this ticket covers the rest, except the AC under "Not in this ticket". A done ticket's own plays cannot run again, so a `type: test` ticket does it (ADR-0017).

- **Test names** carry both tags, this ticket's first: `it("T-001-96/AC-1 T-001-26/AC-2 ...")`. A test may carry more than one shipped tag when it asserts every clause of each.
- **Retag first.** Most of these AC already have a unit or route test, written by the shipped ticket's build and listed under `files:`, that asserts the behaviour but carries no tag. Where an existing test asserts **every clause** of the AC as the shipped ticket states it, add the two tags to the start of its name and change nothing else in that test. Where no test asserts every clause, add a new test: in the same file when it fits that file's harness, or in `e2e/shipped-coverage-lock-confirmed.e2e.ts` for anything that needs the route server and Postgres. Never weaken or reword an existing assertion.
- **Real-stack proof.** At least one test with a `T-001-96/AC-n` tag runs in a real-stack suite (`e2e/` or `browser/`): the gate refuses a `type: test` build without one. `e2e/shipped-coverage-lock-confirmed.e2e.ts` is that file; copy the harness of `e2e/shipped-lock-confirmed.e2e.ts` (from T-001-90).
- **Other test files.** If the test that best proves an AC lives in a test file not listed under `files:`, retag it there; the scope check flags it as out of area and the review names it. Tests only: a `type: test` ticket changes nothing outside the test globs.
- **No production change.** If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Not in this ticket.** T-001-27 AC-9 and T-001-28 AC-8 (the chrome AC: ESLint and review enforce it, the lead decision of 2026-10-15 behind T-001-53), and T-001-29 AC-4 and AC-5 (what T-001-29's own diff did: no production edit, one added devDependency) stay in the `ac-coverage` baseline. No test can prove them as written; roadmap item 7 holds them for a lead spec change. Do not tag a test with them.
- **Report.** End with a table: shipped AC, test file, test name, retagged or new.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run the unit suite and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-coverage-lock-confirmed.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
