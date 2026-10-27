---
id: T-001-95
title: "AC coverage for shipped tickets: response, scoring, attempt, triggers, swap and signal"
type: test
status: ready
risk: low
depends_on: [T-001-10, T-001-20, T-001-21, T-001-22, T-001-23, T-001-24, T-001-25, T-001-34, T-001-35, T-001-40, T-001-52, T-001-53, T-001-57, T-001-68, T-001-79, T-001-92, T-001-94]
files:
  - "e2e/shipped-coverage-response-proposal.e2e.ts"
  - "src/app/api/v1/plans/[planId]/place-searches/route.test.ts"
  - "src/app/api/v1/plans/[planId]/response/route.test.ts"
  - "src/server/response/save.test.ts"
  - "src/components/response-form.test.tsx"
  - "src/server/proposal/fairness.test.ts"
  - "src/server/proposal/rank.test.ts"
  - "src/server/proposal/time.test.ts"
  - "src/app/api/v1/plans/[planId]/proposal/route.test.ts"
  - "src/server/proposal/attempt.test.ts"
  - "src/app/api/v1/plans/[planId]/proposal-attempts/route.test.ts"
  - "src/app/api/v1/plans/[planId]/route.test.ts"
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/signal/route.test.ts"
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/swap/route.test.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-3, F-001-4, F-001-5, F-001-6, F-001-7, F-001-8, F-001-9, F-001-20, F-001-21, F-001-22, F-001-23, F-001-25, F-001-26, F-001-28, F-001-29, F-001-30, F-001-31, F-001-32, F-001-33, F-001-38, F-001-40, N-001-2, N-001-6, N-001-7, N-001-8, N-001-9, N-001-10, N-001-15]
acceptance_criteria:
  - "AC-1: each of T-001-20 AC-2, AC-3, AC-4, AC-5, AC-6, AC-8 has a passing test whose name carries T-001-95/AC-1 and that AC's tag (for example T-001-95/AC-1 T-001-20/AC-2), and that test asserts every clause of the AC as T-001-20 states it"
  - "AC-2: each of T-001-21 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 has a passing test whose name carries T-001-95/AC-2 and that AC's tag (for example T-001-95/AC-2 T-001-21/AC-2), and that test asserts every clause of the AC as T-001-21 states it"
  - "AC-3: each of T-001-22 AC-1, AC-3, AC-4, AC-5, AC-6 has a passing test whose name carries T-001-95/AC-3 and that AC's tag (for example T-001-95/AC-3 T-001-22/AC-1), and that test asserts every clause of the AC as T-001-22 states it"
  - "AC-4: each of T-001-23 AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8 has a passing test whose name carries T-001-95/AC-4 and that AC's tag (for example T-001-95/AC-4 T-001-23/AC-1), and that test asserts every clause of the AC as T-001-23 states it"
  - "AC-5: each of T-001-24 AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8 has a passing test whose name carries T-001-95/AC-5 and that AC's tag (for example T-001-95/AC-5 T-001-24/AC-1), and that test asserts every clause of the AC as T-001-24 states it"
  - "AC-6: each of T-001-25 AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8 has a passing test whose name carries T-001-95/AC-6 and that AC's tag (for example T-001-95/AC-6 T-001-25/AC-1), and that test asserts every clause of the AC as T-001-25 states it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0003-api-v1-prefix.md
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
---
Roadmap item 6, second half. `gate ci` proves every AC of every done ticket (`ac-coverage`): each needs a passing test whose name carries its tag. T-001-20, T-001-21, T-001-22, T-001-23, T-001-24, T-001-25 shipped before AC tags, so these AC are baselined as `missing`. T-001-89 gave each of them one real-stack-proven AC; this ticket covers the rest. A done ticket's own plays cannot run again, so a `type: test` ticket does it (ADR-0017).

- **Test names** carry both tags, this ticket's first: `it("T-001-95/AC-1 T-001-20/AC-2 ...")`. A test may carry more than one shipped tag when it asserts every clause of each.
- **Retag first.** Most of these AC already have a unit or route test, written by the shipped ticket's build and listed under `files:`, that asserts the behaviour but carries no tag. Where an existing test asserts **every clause** of the AC as the shipped ticket states it, add the two tags to the start of its name and change nothing else in that test. Where no test asserts every clause, add a new test: in the same file when it fits that file's harness, or in `e2e/shipped-coverage-response-proposal.e2e.ts` for anything that needs the route server and Postgres. Never weaken or reword an existing assertion.
- **Real-stack proof.** At least one test with a `T-001-95/AC-n` tag runs in a real-stack suite (`e2e/` or `browser/`): the gate refuses a `type: test` build without one. `e2e/shipped-coverage-response-proposal.e2e.ts` is that file; copy the harness of `e2e/shipped-response-proposal.e2e.ts` (from T-001-89).
- **Other test files.** If the test that best proves an AC lives in a test file not listed under `files:`, retag it there; the scope check flags it as out of area and the review names it. Tests only: a `type: test` ticket changes nothing outside the test globs.
- **No production change.** If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Not in this ticket.** T-001-20 AC-7 ("this ticket does not call runProposalAttempt, so a completing save leaves plan_state unchanged": T-001-24 AC-1 later made a completing save run an attempt) and T-001-21 AC-8 (the chrome AC: ESLint enforces its no-raw-hex clause, review its shadcn and `bg-primary` clauses, and nothing can test "follows" three skills; the lead decision of 2026-10-15 behind T-001-53) stay in the `ac-coverage` baseline. No test can prove them as written; roadmap item 7 holds them for a lead spec change. Do not tag a test with them.
- **Paths.** T-001-24's AC text predates ADR-0003 and names `/v1/...`; the route is `/api/v1/...` (ADR-0003, roadmap item 12). A test of the `/api/v1` path proves that clause. Name ADR-0003 in the test's comment.
- **Report.** End with a table: shipped AC, test file, test name, retagged or new.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run the unit suite and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-coverage-response-proposal.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
