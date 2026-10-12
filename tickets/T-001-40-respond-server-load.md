---
id: T-001-40
title: "Respond page loads the participant's response on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-39]
files:
  - "src/server/response/page-data.ts"
  - "src/server/response/page-data.test.ts"
  - "src/app/api/v1/plans/[planId]/response/route.ts"
  - "src/app/plans/[planId]/respond/page.tsx"
  - "src/app/plans/[planId]/respond/error.tsx"
  - "src/app/plans/[planId]/respond/error.test.tsx"
  - "src/components/response-form.tsx"
  - "src/components/response-form.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}/response"
requirements:
  - F-001-22
  - F-001-39
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId}/response returns the same status and body as before for a participant while collecting or blocked (200 with the response document, with and without a saved response), a participant while proposed (409 responses_closed) or locked (409 plan_locked), and the organizer, a stranger or an unknown plan (404); PUT keeps its behaviour"
  - "AC-2: the /plans/{planId}/respond page, called with a participant's cookie while collecting, renders ResponseForm with initial data that holds the plan's title and the participant's saved answers, and ResponseForm given that data shows them and makes no GET /api/v1/plans/{planId}/response request on its first render; the same holds for a guest participant's cookie"
  - "AC-3: the page redirects to /plans/{planId}/proposal while proposed and to /plans/{planId}/confirmed while locked"
  - "AC-4: for no cookie, the organizer's or a stranger's cookie, or an unknown plan id, the page renders ResponseForm with no initial data, which shows the error state with the not-found text (errors.code.not_found) it shows for a 404 today, and no plan data"
  - "AC-5: when the page's load throws, the route renders src/app/plans/[planId]/respond/error.tsx, which shows respond.title, errors.code.upstream in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Convert `/plans/{planId}/respond` to ADR-0007 server loading. Copy T-001-36 (`loadOrganizerPlanPage`, `src/app/plans/[planId]/page.tsx`, `initialPlan` in `src/components/organizer-plan.tsx`) and T-001-37 (`src/app/plans/[planId]/error.tsx`). It uses `loadCallerParticipantForCookies` from T-001-39.

- **`src/server/response/page-data.ts`:** move `loadPlanShape` and the GET body assembly (the stored response, its windows and picks, their ordering, the `start` value) out of the response route, unchanged. The route's `PUT` imports `loadPlanShape` from here. `loadPlanShapeTx` (used only inside `PUT`'s transaction) stays in the route, unchanged; the `PlanShape` type moves with `loadPlanShape` and the route imports it. Add `loadResponsePage(planId, readCookie)`, with the same steps and order as today's `GET`: `loadPlanRow`, the participant check (`planRoleForCookies` and `loadCallerParticipantForCookies`), then the closed check on `asPlanState(plan.state)`. It returns one of:
  - `{ kind: "ok", view }`, where `view` is today's 200 body;
  - `{ kind: "proposed" }`;
  - `{ kind: "locked" }`;
  - `{ kind: "not_found" }`: no plan, or not a participant.
- **`src/app/api/v1/plans/[planId]/response/route.ts`:** `GET` calls the loader and maps each kind to the response it sends today: `ok` → `NextResponse.json(view)`, `proposed` → `errorResponse(responsesClosedError())`, `locked` → `planLockedResponse`, `not_found` → `notFoundResponse`. Each is wrapped in `logged(request, …)`. `PUT` keeps its behaviour.
- **`src/app/plans/[planId]/respond/page.tsx`:** as the organizer page does. `proposed` → `redirect` to `/plans/{planId}/proposal`; `locked` → `/plans/{planId}/confirmed`; `ok` → `initialResponse={JSON.parse(JSON.stringify(view))}`; `not_found` → `initialResponse={null}`.
- **`src/components/response-form.tsx`:** take `initialResponse: unknown`.
  - Run it through the existing `parseResponseDocument`. A parsed document whose plan state is `collecting` or `blocked` starts in `loaded` with the same state the first-load effect sets today; anything else starts in `error`.
  - `null` starts in `error` with `openError` set to `{ code: "not_found", fields: [] }`, so it shows the same text as a 404 does today. Any other value that does not parse starts in `error` with `{ fields: [] }`.
  - Remove the first-load effect. Keep `loadResponse` (the retry button) and every write path as they are.
- **`src/app/plans/[planId]/respond/error.tsx` and its test:** copy `src/app/plans/[planId]/error.tsx` and `error.test.tsx`, with the text this component's `load === "error"` branch shows when it has no parsed error: `respond.title`, `errors.code.upstream`, and `common.retry` on the button.
- No new message key, no new dependency, no Server Action, no new field in the body.
- **Unit tests:** the loader against the test database for each kind, with and without a saved response, and for a guest participant; the component with `initialResponse` makes no fetch on first render, and with `null` shows the not-found error state; the existing save tests keep passing; the boundary as in T-001-37.
- **Real-stack proof (test play):** an `e2e/` test that proves AC-2 to AC-4 the way `e2e/organizer-plan-server-load.e2e.ts` does, and AC-5 the way `e2e/organizer-plan-error-boundary.e2e.ts` does, with the same stated limit.
