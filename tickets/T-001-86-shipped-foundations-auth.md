---
id: T-001-86
title: "Real-stack proof for shipped tickets: bootstrap, schema, money, errors, auth, Google clients"
type: test
status: ready
risk: low
depends_on: [T-001-01, T-001-02, T-001-03, T-001-04, T-001-05, T-001-06, T-001-13]
files:
  - "e2e/shipped-foundations-auth.e2e.ts"
skills:
  - test
  - backend-patterns
  - frontend-patterns
contracts: []
requirements: [F-001-5, F-001-6, F-001-7, F-001-9, N-001-2, N-001-3, N-001-15]
acceptance_criteria:
  - "AC-1: a passing real-stack test whose name carries T-001-86/AC-1 and T-001-01/AC-6 proves T-001-01 AC-6 through the app's routes and Postgres (or a browser against next start): The Drizzle client reads DATABASE_URL"
  - "AC-2: a passing real-stack test whose name carries T-001-86/AC-2 and T-001-02/AC-1 proves T-001-02 AC-1 through the app's routes and Postgres (or a browser against next start): drizzle/0001_init.sql creates every table and column named in arch/CONTRACTS.md Tables, including the partial unique on participants (plan_id, account_id), the unique (plan_id, account_id) on invitations, and exactly one of account_id and guest_session_id on participants"
  - "AC-3: a passing real-stack test whose name carries T-001-86/AC-3 and T-001-03/AC-1 proves T-001-03 AC-1 through the app's routes and Postgres (or a browser against next start): Money amounts are integers in minor units, and amount_minor is rejected outside 1 through 100000000000"
  - "AC-4: a passing real-stack test whose name carries T-001-86/AC-4 and T-001-04/AC-1 proves T-001-04 AC-1 through the app's routes and Postgres (or a browser against next start): The helper builds the error envelope with code, message, and fields, and fields is always an array"
  - "AC-5: a passing real-stack test whose name carries T-001-86/AC-5 and T-001-05/AC-3 proves T-001-05 AC-3 through the app's routes and Postgres (or a browser against next start): hp_session, hp_guest, and hp_link are httpOnly, SameSite=Lax, Path=/, with a 30-day sliding expiry, and Secure when HP_COOKIE_SECURE=1"
  - "AC-6: a passing real-stack test whose name carries T-001-86/AC-6 and T-001-06/AC-1 proves T-001-06 AC-1 through the app's routes and Postgres (or a browser against next start): POST /v1/accounts returns 201 with the account object and sets hp_session; 409 email_taken and 400 invalid fields create no account and set no cookie"
  - "AC-7: a passing real-stack test whose name carries T-001-86/AC-7 and T-001-13/AC-1 proves T-001-13 AC-1 through the app's routes and Postgres (or a browser against next start): Places calls send X-Goog-Api-Key and the contracted field masks, never a wildcard; start search and start details omit priceRange; the venue mask includes places.priceRange"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Roadmap item 6. `gate ci` re-proves every done ticket through the real stack (`tests.real_stack = ["integration", "e2e"]`): a passing real-stack test must carry one of the ticket's AC tags. T-001-01, T-001-02, T-001-03, T-001-04, T-001-05, T-001-06, T-001-13 shipped before AC tags and the real-stack suites existed, so `gate ci` lists them without real-stack proof (baselined). A done ticket's own test play cannot run (records mode); the kit's supported path (kit session, 2026-10-26) is a `type: test` ticket whose real-stack tests carry both its own tag and the shipped ticket's tag. Each AC here proves one AC of one shipped ticket; one tag per shipped ticket is enough for the gate, so the other AC of those tickets stay unit-proven.

- **Test names** carry both tags, this ticket's first, e.g. `it("T-001-86/AC-1 T-001-01/AC-6 ...")`. Assert the shipped AC's behaviour from the public surface: HTTP status, body and cookies through the route server, rows in Postgres, or the page's default export rendered with the loaded data, as the existing `e2e/` files do.
- **Harness:** copy `e2e/core-loop.e2e.ts` and `e2e/authz.e2e.ts` for accounts, plans, joins and the fake Google fetch (`setGoogleClientOptions`, `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL`); `e2e/organizer-plan-server-load.e2e.ts` for rendering a page's default export with an actor's cookies; `e2e/route-server.ts` to call route handlers over HTTP; `cleanupThenClose` from `e2e/db-cleanup.ts` in `afterAll` and the `e2e/teardown.ts` order. Every test creates its own data and can run in any order.
- **No production change.** A `type: test` ticket writes only its `files:`. If a test fails because production disagrees with the shipped AC, stop and report the AC, the command, expected against actual, and the file:line you believe is wrong; that becomes a new ticket. Do not weaken the assertion to match.
- **Notes per AC:**
  - AC-1: with the route server started from `DATABASE_URL`, a write through a route lands in that database (read it back with `postgres(DATABASE_URL)`).
  - AC-2: insert straight into Postgres: a participant with both `account_id` and `guest_session_id`, one with neither, a second participant for the same `(plan_id, account_id)`, and a second invitation for the same `(plan_id, account_id)` each fail with the named constraint; check `information_schema.columns` for every table and column in `arch/CONTRACTS.md` § Tables.
  - AC-3: `POST /api/v1/plans` with `amount_minor` 0 and 100000000001 answers 400 naming the field; 1 and 100000000000 are accepted.
  - AC-4: a 4xx response body (for example 401 `missing_session` from `GET /api/v1/me`) has `code`, `message` and `fields` as an array.
  - AC-5: read `Set-Cookie` for `hp_session` (`POST /api/v1/accounts`), `hp_guest` (anonymous join) and `hp_link` (`GET /api/v1/join/{token}`): `HttpOnly`, `SameSite=Lax`, `Path=/`, a 30-day `Max-Age` or `Expires`, and `Secure` only with `HP_COOKIE_SECURE=1`.
  - AC-7: drive a place search through `GET .../places?q=` with a recording fake fetch and assert the request headers and field mask.

**Agent:** build with `builder`; a `type: test` build runs the real-stack suites itself and has no separate test play. Run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/shipped-foundations-auth.e2e.ts` against the local Postgres in `DATABASE_URL` before the gate.
