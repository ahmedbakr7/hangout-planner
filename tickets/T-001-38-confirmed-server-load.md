---
id: T-001-38
title: "Confirmed page loads the outing on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-37]
files:
  - "src/server/plans/page-data.ts"
  - "src/server/plans/page-data.test.ts"
  - "src/app/api/v1/plans/[planId]/confirmed/route.ts"
  - "src/app/plans/[planId]/confirmed/page.tsx"
  - "src/app/plans/[planId]/confirmed/error.tsx"
  - "src/app/plans/[planId]/confirmed/error.test.tsx"
  - "src/components/confirmed-view.tsx"
  - "src/components/confirmed-view.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}/confirmed"
requirements:
  - F-001-35
  - F-001-36
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId}/confirmed returns the same status and body as before: 200 with the confirmed document for any caller with a role on a locked plan, 404 for a stranger or unknown plan, and 409 not_locked for a caller with a role on a plan that is not locked"
  - "AC-2: the /plans/{planId}/confirmed page, called with a participant's cookie on a locked plan, renders ConfirmedView with initial data that holds the plan's title, and ConfirmedView given that data shows the title and makes no GET /api/v1/plans/{planId}/confirmed or /opening request on its first render"
  - "AC-3: on a plan that is not locked, the page redirects to the surface /opening names for the caller: /plans/{planId} for the organizer, /plans/{planId}/respond or /plans/{planId}/proposal for a participant (by state), and /plans/{planId}/join for any other caller with a role"
  - "AC-4: for no cookie, a stranger's cookie or an unknown plan id, the page renders ConfirmedView with no initial data, which shows the confirmed load error (confirmed.loadError) and no plan data"
  - "AC-5: when the page's load throws, the route renders src/app/plans/[planId]/confirmed/error.tsx, which shows confirmed.title, confirmed.loadError in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Convert `/plans/{planId}/confirmed` to ADR-0007 server loading. Copy T-001-36 (`loadOrganizerPlanPage`, `src/app/plans/[planId]/page.tsx`, `initialPlan` in `src/components/organizer-plan.tsx`) and T-001-37 (`src/app/plans/[planId]/error.tsx`). Without its own `error.tsx`, this route falls back to the `/plans/{planId}` boundary and shows the plan's error text, which is wrong here.

- **`src/server/plans/page-data.ts`:** add `loadConfirmedPage(planId, readCookie)`. Use the same steps as today's confirmed `GET`: `loadPlanRow`, `planRoleForCookies`, the locked check, `loadConfirmedDocument`. It returns one of:
  - `{ kind: "ok", doc }`;
  - `{ kind: "not_found" }`: no plan, or no role;
  - `{ kind: "not_locked", next }`: `next` is `openingNext(role, state)` from `src/server/join/open.ts` when the role is `organizer`, `participant` or `invited`, and `"join"` for any other role. This is what `/opening` and the component's 404 branch decide today.
- **`src/app/api/v1/plans/[planId]/confirmed/route.ts`:** `GET` calls the loader and maps each kind to the response it sends today (`NextResponse.json(doc)`, `notFoundResponse`, the route's `notLockedResponse`), each wrapped in `logged(request, …)`.
- **`src/app/plans/[planId]/confirmed/page.tsx`:** as the organizer page does. `not_locked`: `redirect` to the path for `next` (`organizer` → `/plans/{planId}`, `respond` → `/plans/{planId}/respond`, `proposal` → `/plans/{planId}/proposal`, `join` → `/plans/{planId}/join`). `ok`: `initialDoc={JSON.parse(JSON.stringify(doc))}`. `not_found`: `initialDoc={null}`.
- **`src/components/confirmed-view.tsx`:** take `initialDoc: unknown`.
  - An object that `parseConfirmed` accepts starts in `loaded` without fetching; anything else starts in `error`.
  - Remove the first-load effect. Keep `loadConfirmed` (the retry button) and `redirectNotLocked` as they are.
- **`src/app/plans/[planId]/confirmed/error.tsx` and its test:** copy `src/app/plans/[planId]/error.tsx` and `error.test.tsx`, with the text of this component's `load === "error"` branch: `confirmed.title`, `confirmed.loadError`, and `common.retry` on the button.
- No new message key, no new dependency, no Server Action, no new field in the document.
- **Unit tests:** the loader against the test database for each kind, including each `next`; the component with `initialDoc` makes no fetch on first render, and with `null` shows the error state; the boundary as in T-001-37.
- **Real-stack proof (test play):** an `e2e/` test that proves AC-2 to AC-4 the way `e2e/organizer-plan-server-load.e2e.ts` does, and AC-5 the way `e2e/organizer-plan-error-boundary.e2e.ts` does, with the same stated limit.
