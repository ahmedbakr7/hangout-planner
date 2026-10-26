---
id: T-001-87
title: "Real-stack proof for shipped tickets: shell, account gate, plan rules and plans HTTP, home, create, organizer plan, theme"
type: test
status: ready
risk: low
depends_on: [T-001-07, T-001-08, T-001-09, T-001-10, T-001-11, T-001-12, T-001-30]
files:
  - "e2e/shipped-plans-shell.e2e.ts"
  - "browser/shipped-plans-shell.spec.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2, F-001-3, F-001-4, F-001-5, F-001-6, F-001-7, F-001-9, F-001-12, F-001-13, F-001-14, F-001-15, F-001-24, F-001-27, F-001-37, N-001-1, N-001-2, N-001-3, N-001-4, N-001-5, N-001-13, N-001-14, N-001-15]
acceptance_criteria:
  - "AC-1: a passing real-stack test whose name carries T-001-87/AC-1 and T-001-07/AC-3 proves T-001-07 AC-3 through the app's routes and Postgres (or a browser against next start): dir and lang on html follow the hp_locale cookie: ar is rtl and en is ltr"
  - "AC-2: a passing real-stack test whose name carries T-001-87/AC-2 and T-001-08/AC-4 proves T-001-08 AC-4 through the app's routes and Postgres (or a browser against next start): next accepts only /, /plans/new, /invitations, or /join/ plus a join token; any other value is ignored and success returns home"
  - "AC-3: a passing real-stack test whose name carries T-001-87/AC-3 and T-001-09/AC-5 proves T-001-09 AC-5 through the app's routes and Postgres (or a browser against next start): A frozen key, an illegal budget change, a currency change while currency is frozen, or a threshold outside the current mode is field_frozen and describes no write"
  - "AC-4: a passing real-stack test whose name carries T-001-87/AC-4 and T-001-10/AC-2 proves T-001-10 AC-2 through the app's routes and Postgres (or a browser against next start): POST /v1/plans creates a collecting plan with answered_count 0 and a new join token, the caller is the organizer and not a participant, and 201 returns the organizer plan plus join_path; 400 names each invalid field and writes no row"
  - "AC-5: a passing real-stack test whose name carries T-001-87/AC-5 and T-001-11/AC-6 proves T-001-11 AC-6 through the app's routes and Postgres (or a browser against next start): A valid submit opens the new organizer plan in collecting with answered count 0"
  - "AC-6: a passing real-stack test whose name carries T-001-87/AC-6 and T-001-12/AC-1 proves T-001-12 AC-1 through the app's routes and Postgres (or a browser against next start): The page shows answered count, in-progress count, threshold, and each participant display name with status in progress or answered"
  - "AC-7: a passing real-stack test whose name carries T-001-87/AC-7 and T-001-30/AC-3 proves T-001-30 AC-3 through the app's routes and Postgres (or a browser against next start): Tailwind registers those variables so semantic utilities resolve, using v3 theme.extend or v4 @theme; ADR-0002 leaves the major open. Ship the config files that major needs from this ticket's file list and do not add an unused second config"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
---

Roadmap item 6. `gate ci` re-proves every done ticket through the real stack (`tests.real_stack = ["integration", "e2e"]`): a passing real-stack test must carry one of the ticket's AC tags. T-001-07, T-001-08, T-001-09, T-001-10, T-001-11, T-001-12, T-001-30 shipped before AC tags and the real-stack suites existed, so `gate ci` lists them without real-stack proof (baselined). A done ticket's own test play cannot run (records mode); the kit's supported path (kit session, 2026-10-26) is a `type: test` ticket whose real-stack tests carry both its own tag and the shipped ticket's tag. Each AC here proves one AC of one shipped ticket; one tag per shipped ticket is enough for the gate, so the other AC of those tickets stay unit-proven.

- **Test names** carry both tags, this ticket's first, e.g. `it("T-001-87/AC-1 T-001-07/AC-3 ...")`. Assert the shipped AC's behaviour from the public surface: HTTP status, body and cookies through the route server, rows in Postgres, or the page's default export rendered with the loaded data, as the existing `e2e/` files do.
- **Harness:** copy `e2e/core-loop.e2e.ts` and `e2e/authz.e2e.ts` for accounts, plans, joins and the fake Google fetch (`setGoogleClientOptions`, `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL`); `e2e/organizer-plan-server-load.e2e.ts` for rendering a page's default export with an actor's cookies; `e2e/route-server.ts` to call route handlers over HTTP; `cleanupThenClose` from `e2e/db-cleanup.ts` in `afterAll` and the `e2e/teardown.ts` order. Every test creates its own data and can run in any order.
- **No production change.** A `type: test` ticket writes only its `files:`. If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Where each AC goes:** AC-1, AC-3, AC-4 and AC-6 in `e2e/shipped-plans-shell.e2e.ts`. AC-1 calls the default export of `src/app/layout.tsx` (an async server component that reads `cookies()`) with a stubbed cookie store for `hp_locale` `ar`, `en` and unset, and reads the `<html>` element's `dir` and `lang` props. AC-2, AC-5 and AC-7 need a real browser: AC-2 opens `/account?next=...` signed out with an allowed and a disallowed `next`, registers, and asserts where the page lands (`/plans/new`, a `/join/<token>` path, or `/` for an ignored value). Put AC-2, AC-5 and AC-7 in `browser/shipped-plans-shell.spec.ts`, copying `browser/create-and-invite.spec.ts` (T-001-64) and `browser/shell-styles.spec.ts` (T-001-70), imports only from `@playwright/test`.
  - AC-7: in Chromium, an element with `bg-primary` (the Create a plan action) has a computed `background-color` equal to the computed value of `--primary` on `:root`, and `text-destructive` resolves to `--destructive`.

**Agent:** build with `fe-builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-plans-shell.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
