---
id: T-001-36
title: "Organizer plan page loads the plan on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-34]
files:
  - "src/server/plans/page-data.ts"
  - "src/server/plans/page-data.test.ts"
  - "src/server/plans/role.ts"
  - "src/app/api/v1/plans/[planId]/route.ts"
  - "src/app/plans/[planId]/page.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}"
requirements:
  - F-001-24
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId} returns the same status and body as before for the organizer (200 with the organizer view), a participant (403, organizer only), a stranger or unknown plan (404) and a locked plan (409 plan_locked)"
  - "AC-2: the /plans/{planId} page, called with the organizer's session cookie, renders OrganizerPlan with initial data that holds the plan's title and threshold, and OrganizerPlan given that data shows the title and threshold and makes no GET /api/v1/plans/{planId} request on its first render"
  - "AC-3: the /plans/{planId} page redirects to /plans/{planId}/confirmed when the plan is locked, and renders OrganizerPlan with no initial data, which shows the error state and no plan data, for a participant's cookie, no cookie, or an unknown plan id"
  - "AC-4: after a PATCH from the organizer plan, the component still loads the plan with GET /api/v1/plans/{planId} as it does today, including the refetch on 409 attempt_in_progress"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Follow ADR-0007 for the organizer plan page. This is the first page converted, and the code it adds becomes the example later page tickets copy. Keep it plain.

- **`src/server/plans/role.ts`:** add `planRoleForCookies(readCookie, plan)`. It does what `planRoleFor(request, plan)` does, but reads the cookies through `readCookie: (name: string) => string | null`. `planRoleFor` keeps its signature and calls it. Every route that imports it stays unchanged.
- **`src/server/plans/page-data.ts`:** add `loadOrganizerPlanPage(planId, readCookie)`. It returns one of:
  - `{ kind: "ok", view }`, where `view` is `assembleOrganizerPlan(plan)`;
  - `{ kind: "not_found" }`;
  - `{ kind: "organizer_only" }`;
  - `{ kind: "locked" }`.

  Use the same steps as today's `GET`: `loadPlanRow`, role, the organizer-only rule, the locked check.
- **`src/app/api/v1/plans/[planId]/route.ts`:** `GET` calls the loader and maps each kind to the response it sends today (`notFoundResponse`, `organizerOnlyResponse`, `planLockedResponse`, or `NextResponse.json(view)`). Delete the route file's copies of the role helpers (`planRoleFor` and the functions only it uses) and import from `role.ts`. `PATCH` keeps its behaviour.
- **`src/app/plans/[planId]/page.tsx`:** build the reader from `await cookies()` (`next/headers`) and call the loader.
  - `locked`: `redirect` to `/plans/{planId}/confirmed`.
  - `ok`: render `OrganizerPlan` with `initialPlan={JSON.parse(JSON.stringify(view))}`.
  - Anything else: render `OrganizerPlan` with `initialPlan={null}`.
- **`src/components/organizer-plan.tsx`:** take `initialPlan`.
  - When it is an object, run the existing `parsePlan` on it, apply it, and start in `loaded` without fetching. A value that does not parse, or whose id is not `planId`, starts in `error`.
  - When it is `null`, start in `error`.
  - Remove the first-load effect. Keep `loadPlan` and every write path as they are.
- No new dependency, no Server Action, no new field in the view.
- **Unit tests:**
  - The loader runs against the test database, for each kind.
  - The component renders with `initialPlan` and makes no fetch on first render. With `null`, it shows the error state.
  - The existing PATCH and refetch tests keep passing.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 and AC-3 in process, with no HTTP rendering. The harness cannot render pages over HTTP until roadmap item 5 (Playwright).
  - Set the plan up through the real route handlers and database with `e2e/route-server.ts`: an organizer creates it, a participant joins, and one plan is locked.
  - Call the page's default export directly, with `next/headers` mocked so `cookies()` returns that actor's cookies from the route-server jar, and with `redirect` from `next/navigation` mocked.
  - Assert on the element it returns (an `OrganizerPlan` and its `initialPlan`) or on the redirect.
