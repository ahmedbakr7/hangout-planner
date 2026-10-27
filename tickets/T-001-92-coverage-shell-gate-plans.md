---
id: T-001-92
title: "AC coverage for shipped tickets: shell, account gate, plan rules and plans HTTP"
type: test
status: ready
risk: low
depends_on: [T-001-07, T-001-08, T-001-09, T-001-10, T-001-24, T-001-35, T-001-48, T-001-52, T-001-53, T-001-66, T-001-70, T-001-91]
files:
  - "e2e/shipped-coverage-shell-gate-plans.e2e.ts"
  - "src/i18n/fallback.test.ts"
  - "browser/shell-styles.spec.ts"
  - "src/components/account-gate.test.tsx"
  - "src/components/language-control.test.tsx"
  - "src/server/plans/edit-rules.test.ts"
  - "src/server/plans/views.test.ts"
  - "src/app/api/v1/currencies/route.test.ts"
  - "src/app/api/v1/plans/[planId]/route.test.ts"
  - "src/app/api/v1/plans/route.test.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2, F-001-3, F-001-4, F-001-5, F-001-6, F-001-7, F-001-9, F-001-12, F-001-13, F-001-14, F-001-15, F-001-24, F-001-27, F-001-37, N-001-1, N-001-2, N-001-3, N-001-4, N-001-5, N-001-13, N-001-14, N-001-15]
acceptance_criteria:
  - "AC-1: each of T-001-07 AC-4, AC-5, AC-6 has a passing test whose name carries T-001-92/AC-1 and that AC's tag (for example T-001-92/AC-1 T-001-07/AC-4), and that test asserts every clause of the AC as T-001-07 states it"
  - "AC-2: each of T-001-08 AC-1, AC-2, AC-3, AC-5, AC-6 has a passing test whose name carries T-001-92/AC-2 and that AC's tag (for example T-001-92/AC-2 T-001-08/AC-1), and that test asserts every clause of the AC as T-001-08 states it"
  - "AC-3: each of T-001-09 AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8 has a passing test whose name carries T-001-92/AC-3 and that AC's tag (for example T-001-92/AC-3 T-001-09/AC-1), and that test asserts every clause of the AC as T-001-09 states it"
  - "AC-4: each of T-001-10 AC-1, AC-3, AC-4, AC-5, AC-7, AC-8 has a passing test whose name carries T-001-92/AC-4 and that AC's tag (for example T-001-92/AC-4 T-001-10/AC-1), and that test asserts every clause of the AC as T-001-10 states it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0003-api-v1-prefix.md
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
---
Roadmap item 6, second half. `gate ci` proves every AC of every done ticket (`ac-coverage`): each needs a passing test whose name carries its tag. T-001-07, T-001-08, T-001-09, T-001-10 shipped before AC tags, so these AC are baselined as `missing`. T-001-87 gave each of them one real-stack-proven AC; this ticket covers the rest. A done ticket's own plays cannot run again, so a `type: test` ticket does it (ADR-0017).

- **Test names** carry both tags, this ticket's first: `it("T-001-92/AC-1 T-001-07/AC-1 ...")`. A test may carry more than one shipped tag when it asserts every clause of each.
- **Retag first.** Most of these AC already have a unit or route test, written by the shipped ticket's build and listed under `files:`, that asserts the behaviour but carries no tag. Where an existing test asserts **every clause** of the AC as the shipped ticket states it, add the two tags to the start of its name and change nothing else in that test. Where no test asserts every clause, add a new test: in the same file when it fits that file's harness, or in `e2e/shipped-coverage-shell-gate-plans.e2e.ts` for anything that needs the route server and Postgres. Never weaken or reword an existing assertion.
- **Real-stack proof.** At least one test with a `T-001-92/AC-n` tag runs in a real-stack suite (`e2e/` or `browser/`): the gate refuses a `type: test` build without one. `e2e/shipped-coverage-shell-gate-plans.e2e.ts` is that file; copy the harness of `e2e/shipped-plans-shell.e2e.ts` (from T-001-87).
- **Other test files.** If the test that best proves an AC lives in a test file not listed under `files:`, retag it there; the scope check flags it as out of area and the review names it. Tests only: a `type: test` ticket changes nothing outside the test globs.
- **No production change.** If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Not in this ticket.** T-001-07 AC-1 and AC-2 (where hex and spacing live in CSS and which token names CSS uses: source text, which review enforces; `src/app/shell-tokens.test.ts` asserts them on source text, so it is not listed and is not retagged), T-001-08 AC-7 (the chrome AC: shadcn primitives, no raw hex, and "follows" three skills; ESLint and review enforce it, the lead decision of 2026-10-15 behind T-001-53), and T-001-10 AC-6 ("this ticket does not call runProposalAttempt": T-001-24 later made PATCH run attempts) stay in the `ac-coverage` baseline. No test can prove them as written; roadmap item 7 holds them for a lead spec change. Do not tag a test with them.
- **Paths.** T-001-10's AC text predates ADR-0003 and names `/v1/...`; the route is `/api/v1/...` (ADR-0003, roadmap item 12). A test of the `/api/v1` path proves that clause. Name ADR-0003 in the test's comment.
- **Report.** End with a table: shipped AC, test file, test name, retagged or new.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run the unit suite and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-coverage-shell-gate-plans.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
