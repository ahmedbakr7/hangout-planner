---
id: T-001-89
title: "Real-stack proof for shipped tickets: response HTTP and UI, scoring, proposal attempt, triggers, swap and signal"
type: test
status: ready
risk: low
depends_on: [T-001-20, T-001-21, T-001-22, T-001-23, T-001-24, T-001-25]
files:
  - "e2e/shipped-response-proposal.e2e.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-3, F-001-4, F-001-5, F-001-6, F-001-7, F-001-8, F-001-9, F-001-20, F-001-21, F-001-22, F-001-23, F-001-25, F-001-26, F-001-28, F-001-29, F-001-30, F-001-31, F-001-32, F-001-33, F-001-38, F-001-40, N-001-2, N-001-6, N-001-7, N-001-8, N-001-9, N-001-10, N-001-15]
acceptance_criteria:
  - "AC-1: a passing real-stack test whose name carries T-001-89/AC-1 and T-001-20/AC-1 proves T-001-20 AC-1 through the app's routes and Postgres (or a browser against next start): An incomplete valid save by an incomplete caller returns 200 complete false and leaves answered_count unchanged; the first complete save returns 200 complete true, first_completion true, and increments answered_count by one in the same transaction as the write"
  - "AC-2: a passing real-stack test whose name carries T-001-89/AC-2 and T-001-21/AC-1 proves T-001-21 AC-1 through the app's routes and Postgres (or a browser against next start): The surface shows the plan budget with currency, every day window, every step name, and every option label as authored, and the starting-point control is labeled approximate"
  - "AC-3: a passing real-stack test whose name carries T-001-89/AC-3 and T-001-22/AC-2 proves T-001-22 AC-2 through the app's routes and Postgres (or a browser against next start): Coverage 0 is time-blocked and stores no clock time"
  - "AC-4: a passing real-stack test whose name carries T-001-89/AC-4 and T-001-23/AC-4 proves T-001-23 AC-4 through the app's routes and Postgres (or a browser against next start): An empty cohort stores no proposal and finishes blocked with time true, budget false, venue_data false, and no Google calls"
  - "AC-5: a passing real-stack test whose name carries T-001-89/AC-5 and T-001-24/AC-3 proves T-001-24 AC-3 through the app's routes and Postgres (or a browser against next start): POST /v1/plans/{planId}/proposal-attempts runs an attempt while blocked and returns the organizer proposal document; any other state returns 409 not_blocked or 409 plan_locked"
  - "AC-6: a passing real-stack test whose name carries T-001-89/AC-6 and T-001-25/AC-6 proves T-001-25 AC-6 through the app's routes and Postgres (or a browser against next start): Signal accepts like, dislike, or unset for a cohort participant while proposed; unset deletes the row; the time, places, and cohort do not change; the response has no counts"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Roadmap item 6. `gate ci` re-proves every done ticket through the real stack (`tests.real_stack = ["integration", "e2e"]`): a passing real-stack test must carry one of the ticket's AC tags. T-001-20, T-001-21, T-001-22, T-001-23, T-001-24, T-001-25 shipped before AC tags and the real-stack suites existed, so `gate ci` lists them without real-stack proof (baselined). A done ticket's own test play cannot run (records mode); the kit's supported path (kit session, 2026-10-26) is a `type: test` ticket whose real-stack tests carry both its own tag and the shipped ticket's tag. Each AC here proves one AC of one shipped ticket; one tag per shipped ticket is enough for the gate, so the other AC of those tickets stay unit-proven.

- **Test names** carry both tags, this ticket's first, e.g. `it("T-001-89/AC-1 T-001-20/AC-1 ...")`. Assert the shipped AC's behaviour from the public surface: HTTP status, body and cookies through the route server, rows in Postgres, or the page's default export rendered with the loaded data, as the existing `e2e/` files do.
- **Harness:** copy `e2e/core-loop.e2e.ts` and `e2e/authz.e2e.ts` for accounts, plans, joins and the fake Google fetch (`setGoogleClientOptions`, `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL`); `e2e/organizer-plan-server-load.e2e.ts` for rendering a page's default export with an actor's cookies; `e2e/route-server.ts` to call route handlers over HTTP; `cleanupThenClose` from `e2e/db-cleanup.ts` in `afterAll` and the `e2e/teardown.ts` order. Every test creates its own data and can run in any order.
- **No production change.** A `type: test` ticket writes only its `files:`. If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Notes per AC:**
  - AC-3: two participants whose windows do not overlap complete their responses so that `answered_count` reaches the threshold; the attempt ends `blocked` with `block_time` true and the stored proposal run has no clock time.
  - AC-4: reach an attempt whose cohort is empty through the routes only (for example a time-blocked plan whose windows leave no shared instant, then `POST .../proposal-attempts`); it stores no proposal, finishes blocked with time true, budget false and venue_data false, and the recording fake fetch saw no Google call. If no route sequence yields an empty cohort, stop and report: the AC moves to a different T-001-23 AC by amendment.
  - AC-2 renders `/plans/{planId}/respond` from its default export, as `e2e/respond-server-load.e2e.ts` does.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-response-proposal.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
