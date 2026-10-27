---
id: T-001-94
title: "AC coverage for shipped tickets: join by token, opening, invitations, inbox, join and invite UI"
type: test
status: ready
risk: low
depends_on: [T-001-14, T-001-15, T-001-16, T-001-17, T-001-18, T-001-19, T-001-35, T-001-41, T-001-42, T-001-44, T-001-47, T-001-50, T-001-51, T-001-53, T-001-55, T-001-56, T-001-71, T-001-93]
files:
  - "e2e/coverage-join-invites.e2e.ts"
  - "src/app/api/v1/join/[token]/route.test.ts"
  - "src/server/join/open.test.ts"
  - "src/app/api/v1/plans/[planId]/join/route.test.ts"
  - "src/app/api/v1/plans/[planId]/opening/route.test.ts"
  - "src/app/api/v1/plans/[planId]/invitations/route.test.ts"
  - "src/app/api/v1/plans/[planId]/invite/route.test.ts"
  - "src/server/invites/send.test.ts"
  - "src/app/api/v1/invitations/route.test.ts"
  - "src/components/join-panel.test.tsx"
  - "src/components/invite-panel.test.tsx"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-4, F-001-9, F-001-10, F-001-11, F-001-16, F-001-17, F-001-18, F-001-19, F-001-36, F-001-39, N-001-15, N-001-17, N-001-18, N-001-19, N-001-20]
acceptance_criteria:
  - "AC-1: each of T-001-14 AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8 has a passing test whose name carries T-001-94/AC-1 and that AC's tag (for example T-001-94/AC-1 T-001-14/AC-1), and that test asserts every clause of the AC as T-001-14 states it"
  - "AC-2: each of T-001-15 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 has a passing test whose name carries T-001-94/AC-2 and that AC's tag (for example T-001-94/AC-2 T-001-15/AC-2), and that test asserts every clause of the AC as T-001-15 states it"
  - "AC-3: each of T-001-16 AC-1, AC-2, AC-4, AC-5, AC-6, AC-7 has a passing test whose name carries T-001-94/AC-3 and that AC's tag (for example T-001-94/AC-3 T-001-16/AC-1), and that test asserts every clause of the AC as T-001-16 states it"
  - "AC-4: each of T-001-17 AC-2, AC-3, AC-4, AC-5, AC-6 has a passing test whose name carries T-001-94/AC-4 and that AC's tag (for example T-001-94/AC-4 T-001-17/AC-2), and that test asserts every clause of the AC as T-001-17 states it"
  - "AC-5: each of T-001-18 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 has a passing test whose name carries T-001-94/AC-5 and that AC's tag (for example T-001-94/AC-5 T-001-18/AC-2), and that test asserts every clause of the AC as T-001-18 states it"
  - "AC-6: each of T-001-19 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9 has a passing test whose name carries T-001-94/AC-6 and that AC's tag (for example T-001-94/AC-6 T-001-19/AC-1), and that test asserts every clause of the AC as T-001-19 states it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0017-test-ticket-builds-write-real-stack-tests.md
---
Roadmap item 6, second half. `gate ci` proves every AC of every done ticket (`ac-coverage`): each needs a passing test whose name carries its tag. T-001-14, T-001-15, T-001-16, T-001-17, T-001-18, T-001-19 shipped before AC tags, so these AC are baselined as `missing`. T-001-88 gave each of them one real-stack-proven AC; this ticket covers the rest. A done ticket's own plays cannot run again, so a `type: test` ticket does it (ADR-0017).

- **Test names** carry both tags, this ticket's first: `it("T-001-94/AC-1 T-001-14/AC-1 ...")`. A test may carry more than one shipped tag when it asserts every clause of each.
- **Retag first.** Most of these AC already have a unit or route test, written by the shipped ticket's build and listed under `files:`, that asserts the behaviour but carries no tag. Where an existing test asserts **every clause** of the AC as the shipped ticket states it, add the two tags to the start of its name and change nothing else in that test. Where no test asserts every clause, add a new test: in the same file when it fits that file's harness, or in `e2e/coverage-join-invites.e2e.ts` for anything that needs the route server and Postgres. Never weaken or reword an existing assertion.
- **Real-stack proof.** At least one test with a `T-001-94/AC-n` tag runs in a real-stack suite (`e2e/` or `browser/`): the gate refuses a `type: test` build without one. `e2e/coverage-join-invites.e2e.ts` is that file; copy the harness of `e2e/shipped-join-invites.e2e.ts` (from T-001-88).
- **Other test files.** If the test that best proves an AC lives in a test file not listed under `files:`, retag it there; the scope check flags it as out of area and the review names it. Tests only: a `type: test` ticket changes nothing outside the test globs.
- **No production change.** If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Report.** End with a table: shipped AC, test file, test name, retagged or new.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run the unit suite and `npx --no-install vitest run --config vitest.e2e.config.mts e2e/coverage-join-invites.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
