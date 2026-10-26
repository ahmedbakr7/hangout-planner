---
id: T-001-88
title: "Real-stack proof for shipped tickets: join by token, opening, invitations, inbox, join and invite UI"
type: test
status: ready
risk: low
depends_on: [T-001-14, T-001-15, T-001-16, T-001-17, T-001-18, T-001-19]
files:
  - "e2e/shipped-join-invites.e2e.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-4, F-001-9, F-001-10, F-001-11, F-001-16, F-001-17, F-001-18, F-001-19, F-001-36, F-001-39, N-001-15, N-001-17, N-001-18, N-001-19, N-001-20]
acceptance_criteria:
  - "AC-1: a passing real-stack test whose name carries T-001-88/AC-1 and T-001-14/AC-4 proves T-001-14 AC-4 through the app's routes and Postgres (or a browser against next start): Anonymous join requires a display name of 1–40 characters after trim, asks for no password, and 201 sets or extends hp_guest; the same guest and plan return the existing participant; a new guest session creates a new participant even when the display name matches"
  - "AC-2: a passing real-stack test whose name carries T-001-88/AC-2 and T-001-15/AC-1 proves T-001-15 AC-1 through the app's routes and Postgres (or a browser against next start): GET opening returns next organizer, respond, proposal, confirmed, or join according to the caller and state table, and preview is the join preview only when next is join"
  - "AC-3: a passing real-stack test whose name carries T-001-88/AC-3 and T-001-16/AC-3 proves T-001-16 AC-3 through the app's routes and Postgres (or a browser against next start): Unknown email returns 404 account_not_found and adds no row; an invalid email returns 400 and adds no row; the organizer email returns 409 cannot_invite_self and adds no row"
  - "AC-4: a passing real-stack test whose name carries T-001-88/AC-4 and T-001-17/AC-1 proves T-001-17 AC-1 through the app's routes and Postgres (or a browser against next start): GET /v1/invitations returns this account's invitations, created_at descending, at most 100, one row per plan with plan_id, title, and organizer_display_name"
  - "AC-5: a passing real-stack test whose name carries T-001-88/AC-5 and T-001-18/AC-1 proves T-001-18 AC-1 through the app's routes and Postgres (or a browser against next start): The preview shows the authored title, organizer display name, timezone, day windows, per-person budget with currency, and step names"
  - "AC-6: a passing real-stack test whose name carries T-001-88/AC-6 and T-001-19/AC-7 proves T-001-19 AC-7 through the app's routes and Postgres (or a browser against next start): The invitations page shows one row per plan with the authored title and the organizer display name, and opening a row follows that plan's opening next"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Roadmap item 6. `gate ci` re-proves every done ticket through the real stack (`tests.real_stack = ["integration", "e2e"]`): a passing real-stack test must carry one of the ticket's AC tags. T-001-14, T-001-15, T-001-16, T-001-17, T-001-18, T-001-19 shipped before AC tags and the real-stack suites existed, so `gate ci` lists them without real-stack proof (baselined). A done ticket's own test play cannot run (records mode); the kit's supported path (kit session, 2026-10-26) is a `type: test` ticket whose real-stack tests carry both its own tag and the shipped ticket's tag. Each AC here proves one AC of one shipped ticket; one tag per shipped ticket is enough for the gate, so the other AC of those tickets stay unit-proven.

- **Test names** carry both tags, this ticket's first, e.g. `it("T-001-88/AC-1 T-001-14/AC-4 ...")`. Assert the shipped AC's behaviour from the public surface: HTTP status, body and cookies through the route server, rows in Postgres, or the page's default export rendered with the loaded data, as the existing `e2e/` files do.
- **Harness:** copy `e2e/core-loop.e2e.ts` and `e2e/authz.e2e.ts` for accounts, plans, joins and the fake Google fetch (`setGoogleClientOptions`, `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL`); `e2e/organizer-plan-server-load.e2e.ts` for rendering a page's default export with an actor's cookies; `e2e/route-server.ts` to call route handlers over HTTP; `cleanupThenClose` from `e2e/db-cleanup.ts` in `afterAll` and the `e2e/teardown.ts` order. Every test creates its own data and can run in any order.
- **No production change.** A `type: test` ticket writes only its `files:`. If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Notes:** AC-5 and AC-6 render the page's default export (`/plans/{planId}/join` and `/invitations`) with the loaded data, as `e2e/plan-join-server-load.e2e.ts` and `e2e/invitations-server-load.e2e.ts` do; AC-6's "opening a row" asserts the row's link is that plan's opening path from `GET /api/v1/plans/{planId}/opening`.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-join-invites.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
