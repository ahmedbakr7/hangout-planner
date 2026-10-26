---
id: T-001-90
title: "Real-stack proof for shipped tickets: lock and confirmed, proposal and confirmed UI, and the T-001-29 suites"
type: test
status: ready
risk: low
depends_on: [T-001-26, T-001-27, T-001-28, T-001-29, T-001-43, T-001-52]
files:
  - "e2e/shipped-lock-confirmed.e2e.ts"
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
  - "AC-1: a passing real-stack test whose name carries T-001-90/AC-1 and T-001-26/AC-1 proves T-001-26 AC-1 through the app's routes and Postgres (or a browser against next start): POST lock from proposed returns 200 with the confirmed document and sets state locked"
  - "AC-2: a passing real-stack test whose name carries T-001-90/AC-2 and T-001-27/AC-3 proves T-001-27 AC-3 through the app's routes and Postgres (or a browser against next start): A proposed itinerary shows the time with the timezone, how many cohort members can make it, and each cohort member's display name, and the attendance line calls that set everyone only when the number equals the cohort size"
  - "AC-3: a passing real-stack test whose name carries T-001-90/AC-3 and T-001-28/AC-2 proves T-001-28 AC-2 through the app's routes and Postgres (or a browser against next start): The loaded outing shows state locked, the authored title, the time with the timezone, each step's place name and per-person amount with currency, the travel duration between consecutive places, and the cohort display names"
  - "AC-4: a passing real-stack test whose name carries T-001-90/AC-4 and T-001-29/AC-1 proves T-001-29 AC-1 through the app's routes and Postgres (or a browser against next start): e2e/core-loop.e2e.ts covers account, create in EGP, copy path, anonymous join, complete response, proposal, swap, signal, lock, and confirmed read on the share link"
  - "AC-5: a passing real-stack test whose name carries T-001-90/AC-5 and T-001-29/AC-2 proves T-001-29 AC-2 through the app's routes and Postgres (or a browser against next start): e2e/authz.e2e.ts covers a second account cannot read another organizer's plan, a participant cannot lock, a locked write fails, and an unknown invite email adds no inbox row"
  - "AC-6: a passing real-stack test whose name carries T-001-90/AC-6 and T-001-29/AC-3 proves T-001-29 AC-3 through the app's routes and Postgres (or a browser against next start): e2e/rtl.e2e.ts covers Arabic locale setting dir=rtl on create and on confirmed, and a missing Arabic key still showing the English string"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Roadmap item 6. `gate ci` re-proves every done ticket through the real stack (`tests.real_stack = ["integration", "e2e"]`): a passing real-stack test must carry one of the ticket's AC tags. T-001-26, T-001-27, T-001-28, T-001-29 shipped before AC tags and the real-stack suites existed, so `gate ci` lists them without real-stack proof (baselined). A done ticket's own test play cannot run (records mode); the kit's supported path (kit session, 2026-10-26) is a `type: test` ticket whose real-stack tests carry both its own tag and the shipped ticket's tag. Each AC here proves one AC of one shipped ticket; one tag per shipped ticket is enough for the gate, so the other AC of those tickets stay unit-proven.

- **Test names** carry both tags, this ticket's first, e.g. `it("T-001-90/AC-1 T-001-26/AC-1 ...")`. Assert the shipped AC's behaviour from the public surface: HTTP status, body and cookies through the route server, rows in Postgres, or the page's default export rendered with the loaded data, as the existing `e2e/` files do.
- **Harness:** copy `e2e/core-loop.e2e.ts` and `e2e/authz.e2e.ts` for accounts, plans, joins and the fake Google fetch (`setGoogleClientOptions`, `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL`); `e2e/organizer-plan-server-load.e2e.ts` for rendering a page's default export with an actor's cookies; `e2e/route-server.ts` to call route handlers over HTTP; `cleanupThenClose` from `e2e/db-cleanup.ts` in `afterAll` and the `e2e/teardown.ts` order. Every test creates its own data and can run in any order.
- **No production change.** A `type: test` ticket writes only its `files:`. If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **T-001-29's suites already exist and pass, untagged.** AC-4, AC-5 and AC-6 are proven by renaming the existing tests: `e2e/core-loop.e2e.ts`'s one test carries `T-001-90/AC-4 T-001-29/AC-1`; each of the four tests in `e2e/authz.e2e.ts` carries `T-001-90/AC-5 T-001-29/AC-2`; each of the three in `e2e/rtl.e2e.ts` carries `T-001-90/AC-6 T-001-29/AC-3`. Keep each test's words after the tags and change no assertion. `e2e/rtl.e2e.ts` renders components in jsdom with stubbed fetches, so AC-6 is a component-level proof inside the integration suite rather than routes plus Postgres; that is what T-001-29 AC-3 shipped, and the gate counts the integration suite as real-stack. Confirm each AC's list is covered by the test bodies; if a listed case is missing, add it to that file and report it.
- **depends_on:** T-001-43 and T-001-52 (both done) also wrote `e2e/core-loop.e2e.ts`, `e2e/authz.e2e.ts` and `e2e/rtl.e2e.ts`; lint requires a dependency between tickets that write the same file. Neither is an AC target here.
- AC-1 to AC-3 go in `e2e/shipped-lock-confirmed.e2e.ts`. AC-2 and AC-3 render `/plans/{planId}/proposal` and `/plans/{planId}/confirmed` from their default exports, as `e2e/proposal-server-load.e2e.ts` and `e2e/confirmed-server-load.e2e.ts` do.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-lock-confirmed.e2e.ts e2e/core-loop.e2e.ts e2e/authz.e2e.ts e2e/rtl.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
