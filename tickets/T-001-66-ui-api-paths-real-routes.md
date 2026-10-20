---
id: T-001-66
title: "Tests: the account, home, invitations, create and join screens against real routes"
type: test
status: ready
risk: low
depends_on: [T-001-08, T-001-32, T-001-33, T-001-45, T-001-46, T-001-47, T-001-56, T-001-59]
files:
  - "e2e/ui-api-paths.e2e.ts"
  - "src/i18n/fallback.test.ts"
skills:
  - test
  - frontend-patterns
contracts:
  - "arch/CONTRACTS.md#GET /api/v1/me"
  - "arch/CONTRACTS.md#GET /api/v1/plans"
  - "arch/CONTRACTS.md#POST /api/v1/plans"
  - "arch/CONTRACTS.md#GET /api/v1/invitations"
  - "arch/CONTRACTS.md#GET /api/v1/join/{token}"
  - "arch/CONTRACTS.md#POST /api/v1/join/{token}"
  - "arch/CONTRACTS.md#POST /api/v1/plans/{planId}/join"
requirements: [F-001-10, F-001-14, F-001-18, F-001-37, N-001-1, N-001-4]
acceptance_criteria:
  - "AC-1: the home list, given initial data that does not parse, for a newly registered account with no plans: Retry sends GET /api/v1/plans to the real route and the list shows \"This account has no plans yet.\""
  - "AC-2: the invitations list, given initial data that does not parse, for a newly registered account with no invitations: Retry sends GET /api/v1/invitations to the real route and the list shows \"No invitations yet.\""
  - "AC-3: a signed-in account's valid create form submit sends one POST /api/v1/plans to the real route, which stores the plan in collecting with answered_count 0, and the form opens /plans/{planId} for that plan"
  - "AC-4: a create form submit after the session is gone gets the real POST /api/v1/plans 401 missing_session; the form shows \"Sign in to continue.\", keeps the entered plan title, and no plan with that title is stored"
  - "AC-5: on /join/{token}, the join panel loads the preview from the real GET /api/v1/join/{token} and GET /api/v1/me and shows the plan title; join without an account with a display name sends POST /api/v1/join/{token}, which stores a participant with that display name, and the panel opens /plans/{planId}/respond"
  - "AC-6: on /plans/{planId}/join, an invited signed-in account's \"Join with an account\" sends POST /api/v1/plans/{planId}/join to the real route, which stores a participant for that account, and the panel opens /plans/{planId}/respond"
  - "AC-7: on /join/{token} with a token no plan has, the real GET /api/v1/join/{token} answers 404 and the join panel shows \"This link does not open a plan.\""
  - "AC-8: AccountGate under Arabic messages missing Account.requiredToOrganize, when GET /api/v1/me answers 401 missing_session, shows the English \"An account is required to organize a plan.\" with lang ar and dir rtl, and its email field and sign-in button stay usable"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0003-api-v1-prefix.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0008-join-token-page-loads-on-the-client.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
---

Roadmap item 1, plus the test part of item 15. `e2e/ui-api-paths.e2e.ts` is the only real-stack test that carries T-001-32's tags, and the #62 review left it weak. It keeps its own copy of the route server with one shared cookie, so the third test runs on the second test's session (review M3). Since T-001-45 made `initialPlans` a required prop, its `HomeList` render seeds the error state and fetches nothing, and the test waits only for the "Create a plan" link, which is always there. So the home half of "home and invitations request only served /api/v1 paths" checks no request at all. It also never renders the create form or the join panel (review M2). Separately, `src/i18n/fallback.test.ts` stubs `fetch` for `/v1/me`, but AccountGate calls `/api/v1/me`. The stub throws, AccountGate's `catch` turns that into the signed-out state, and the test passes without ever reaching the 401 path. Both files are in `tests.globs`, so a `type: test` build may write them. Its build runs the integration suite, and AC-1 to AC-7 are proven there.

- **`e2e/ui-api-paths.e2e.ts`, set-up:** drop the file's own `serve`, `cookieJar` and `routeFor` import. Use `createRouteServer()` from `e2e/route-server.ts`, a new one in `beforeEach`, so every test starts with no cookies. Copy the set-up of `e2e/join-panel-retry.e2e.ts`: the hoisted `router` mock, the `call` helper, `process.env.HP_HASH_TEST = "1"`, `emails` and `planIds` arrays, its `deleteSeededRows` (plans, participants, link sessions, invitations, guest sessions, accounts), and its `afterAll` closing all five databases. Copy the `afterEach` of `e2e/plan-paths.e2e.ts:186-198`, so `teardownThenAssertServed(server.unserved, ...)` from `e2e/teardown.ts` fails any test that sent a request no route serves.
- **Each test registers its own account** with a random email (pushed to `emails`) and creates its own plans (ids pushed to `planIds`). No test reads another test's state or cookies. Seed through `server.serve` as `seedPlan` in `e2e/plan-join-server-load.e2e.ts:88-142` does, switching actors with `server.useCookies`.
- **The two AccountGate tests keep their names and `T-001-32/AC-2` tags.** The 401 test runs with the fresh server's empty jar. The 200 test registers its own account.
- **Split the `T-001-32/AC-1` home-and-invitations test into two**, each tagged with both tickets, as `src/components/invite-panel.test.tsx:552` carries two tags:
  - `T-001-32/AC-1 T-001-66/AC-1`: render `HomeList` with `initialPlans: { plans: "not a list" }`, click Retry, and wait for `en.Home.empty`.
  - `T-001-32/AC-1 T-001-66/AC-2`: the same for `InvitationsList`, with `initialInbox: { invitations: "not a list" }`, waiting for `en.invitations.empty`.
  - Copy the unparseable seed and Retry of `e2e/invitations-server-load.e2e.ts:332-349`. Each test asserts that the list's GET is in `server.requested` and that every requested line matches `/^[A-Z]+ \/api\/v1\//`, as `e2e/plan-views-api-paths.e2e.ts` does.
- **AC-3 and AC-4 (create form):**
  - Render `CreateForm` with `initialCurrencies` taken from the real `GET /api/v1/currencies` body, the way `e2e/plan-views-api-paths.e2e.ts` passes `initialPlan` from `server.serve`. Fill the form as `fillValidForm` in `src/components/create-form.test.tsx:173-203` does.
  - AC-3, tagged `T-001-32/AC-1 T-001-66/AC-3`: wait for `router.push` with `/plans/<id>`. Read that plan's `state` and `answered_count` from the database, push its id to `planIds`, and assert exactly one `POST /api/v1/plans` was sent and every request is under `/api/v1/`.
  - AC-4: before submitting, call `server.useCookies("")`. Use a title unique to the test. Assert the `role="alert"` text is `en.errors.reason.missing_session`, the "Plan title" field still holds that title, `router.push` was not called, and `SELECT count(*) FROM plans WHERE title = <title>` is 0.
- **AC-5 to AC-7 (join panel):**
  - AC-5, tagged `T-001-32/AC-1 T-001-66/AC-5`: the organizer creates a plan through `call`. Then, with empty cookies, render `JoinPanel` with `token` only (ADR-0008: this page loads on the client). Wait for the plan title, type a display name in `en.join.displayName`, and submit `en.join.joinWithoutAccount`. Assert `router.push` with `/plans/<planId>/respond`, one `participants` row with that display name and a guest session, and every request under `/api/v1/`.
  - AC-6, tagged `T-001-32/AC-1 T-001-66/AC-6`: the organizer invites a second account (copy `e2e/plan-join-server-load.e2e.ts:123-140`). As that account, pass the real `GET /api/v1/plans/{planId}/opening` body as `initialOpening`, with `initialSignedIn: true` (ADR-0007). Click `en.join.joinWithAccount`. Assert `router.push` with `/plans/<planId>/respond`, a `participants` row with that account's id, and every request under `/api/v1/`.
  - AC-7: render `JoinPanel` with a well-formed token that no plan has (`jt_` plus 43 base64url characters from `randomBytes`), and wait for `en.join.unknownLink`.
- **`src/i18n/fallback.test.ts`**, second test, now named `T-001-66/AC-8 keeps the gate usable in an RTL layout when an Arabic key is missing`:
  - The `fetch` stub answers `"/api/v1/me"` with the existing `missingSession` 401 body.
  - Any other URL is pushed to a local `unexpected` array before the stub throws. AccountGate's `catch` would hide a throw, so the test asserts that `unexpected` is empty and that the stub was called with `/api/v1/me`.
  - The rest of the test and the first test stay as they are.
- **Out of scope:**
  - The rest of item 15: the `/v1/join` log text in `src/app/api/v1/join/[token]/route.ts:128`, the `/v1` doc comments in `src/server/plans/views.ts:240,260`, and the optional route-test URLs. The first two are production files, which a `type: test` ticket may not change.
  - The invite panel's send (`POST /api/v1/plans/{planId}/invitations`) through the UI. Its unit tests already fail on a path revert (#62 review).
  - Browser specs. ADR-0010 sends new page journeys to `browser/`. These are component-level checks through the route handlers and stay in `e2e/`.
  - No product file, `e2e/route-server.ts` or `e2e/teardown.ts` change.
- **Agent:** build with `builder`. Its tools run `npx --no-install vitest`, which covers both the unit and the integration suite.
