---
id: T-001-93
title: "AC coverage for shipped tickets: home and create, organizer plan"
type: test
status: ready
risk: low
depends_on: [T-001-11, T-001-12, T-001-30, T-001-34, T-001-36, T-001-45, T-001-46, T-001-53, T-001-70, T-001-77, T-001-92]
files:
  - "e2e/shipped-coverage-home-organizer-theme.e2e.ts"
  - "src/components/create-form.test.tsx"
  - "src/components/home-list.test.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2, F-001-4, F-001-12, F-001-13, F-001-14, F-001-15, F-001-24, F-001-27, F-001-37, N-001-1, N-001-4, N-001-5, N-001-13, N-001-14, N-001-15]
acceptance_criteria:
  - "AC-1: each of T-001-11 AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8 has a passing test whose name carries T-001-93/AC-1 and that AC's tag (for example T-001-93/AC-1 T-001-11/AC-1), and that test asserts every clause of the AC as T-001-11 states it"
  - "AC-2: each of T-001-12 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 has a passing test whose name carries T-001-93/AC-2 and that AC's tag (for example T-001-93/AC-2 T-001-12/AC-2), and that test asserts every clause of the AC as T-001-12 states it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
---
Roadmap item 6, second half. `gate ci` proves every AC of every done ticket (`ac-coverage`): each needs a passing test whose name carries its tag. T-001-11, T-001-12 shipped before AC tags, so these AC are baselined as `missing`. T-001-87 gave each of them one real-stack-proven AC; this ticket covers the rest. A done ticket's own plays cannot run again, so a `type: test` ticket does it (ADR-0017).

- **Test names** carry both tags, this ticket's first: `it("T-001-93/AC-1 T-001-11/AC-1 ...")`. A test may carry more than one shipped tag when it asserts every clause of each.
- **Retag first.** Most of these AC already have a unit or route test, written by the shipped ticket's build and listed under `files:`, that asserts the behaviour but carries no tag. Where an existing test asserts **every clause** of the AC as the shipped ticket states it, add the two tags to the start of its name and change nothing else in that test. Where no test asserts every clause, add a new test: in the same file when it fits that file's harness, or in `e2e/shipped-coverage-home-organizer-theme.e2e.ts` for anything that needs the route server and Postgres. Never weaken or reword an existing assertion.
- **Real-stack proof.** At least one test with a `T-001-93/AC-n` tag runs in a real-stack suite (`e2e/` or `browser/`): the gate refuses a `type: test` build without one. `e2e/shipped-coverage-home-organizer-theme.e2e.ts` is that file; copy the harness of `e2e/shipped-plans-shell.e2e.ts` (from T-001-87).
- **Other test files.** If the test that best proves an AC lives in a test file not listed under `files:`, retag it there; the scope check flags it as out of area and the review names it. Tests only: a `type: test` ticket changes nothing outside the test globs.
- **No production change.** If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Not in this ticket.** T-001-11 AC-9 and T-001-12 AC-9 (the chrome AC: ESLint and review enforce it, the lead decision of 2026-10-15 behind T-001-53), and every remaining T-001-30 AC (AC-1, AC-2, AC-4 to AC-7: theme install, CSS variable mapping, fonts and focus styling, and what T-001-30's own diff added; source text, configuration or a past diff) stay in the `ac-coverage` baseline. No test can prove them as written; roadmap item 7 holds them for a lead spec change. Do not tag a test with them.
- **Report.** End with a table: shipped AC, test file, test name, retagged or new.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run the unit suite and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-coverage-home-organizer-theme.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
