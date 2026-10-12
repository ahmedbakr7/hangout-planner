---
id: T-001-39
title: "Proposal page loads the proposal on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-37]
files:
  - "src/server/proposal/page-data.ts"
  - "src/server/proposal/page-data.test.ts"
  - "src/server/response/caller.ts"
  - "src/app/api/v1/plans/[planId]/proposal/route.ts"
  - "src/app/plans/[planId]/proposal/page.tsx"
  - "src/app/plans/[planId]/proposal/error.tsx"
  - "src/app/plans/[planId]/proposal/error.test.tsx"
  - "src/components/proposal-view.tsx"
  - "src/components/proposal-view.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}/proposal"
requirements:
  - F-001-33
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId}/proposal returns the same status and body as before for the organizer (200 with state collecting, blocked or proposed), a cohort member and a non-cohort participant while proposed (200), a participant while collecting or blocked (409 not_proposed), the organizer or a participant on a locked plan (409 plan_locked), and a stranger, an invited or link caller, or an unknown plan (404)"
  - "AC-2: the /plans/{planId}/proposal page, called with a cohort member's cookie on a proposed plan, renders ProposalView with initial data that holds the proposal, and ProposalView given that data shows the proposal and makes no GET /api/v1/plans/{planId}/proposal request on its first render; for the organizer on a blocked plan, the initial data holds the blocked state and its block, and ProposalView shows the blocked state with no first-render GET"
  - "AC-3: the page redirects to /plans/{planId}/confirmed when the plan is locked (organizer or participant), to /plans/{planId} for the organizer while collecting, and to /plans/{planId}/respond for a participant while collecting or blocked"
  - "AC-4: for no cookie, a stranger's cookie or an unknown plan id, the page renders ProposalView with no initial data, which shows the proposal load error (proposal.loadError) and no plan data"
  - "AC-5: when the page's load throws, the route renders src/app/plans/[planId]/proposal/error.tsx, which shows proposal.title, proposal.loadError in a role=\"alert\" element and a proposal.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-6: swap, signal, lock and retry-attempt from the proposal view still refetch with GET /api/v1/plans/{planId}/proposal as they do today"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Convert `/plans/{planId}/proposal` to ADR-0007 server loading. Copy T-001-36 (`loadOrganizerPlanPage`, `src/app/plans/[planId]/page.tsx`, `initialPlan` in `src/components/organizer-plan.tsx`) and T-001-37 (`src/app/plans/[planId]/error.tsx`).

- **`src/server/response/caller.ts`:** add `loadCallerParticipantForCookies(readCookie, planId)`, taking a `CookieReader` from `src/server/plans/role.ts`. `loadCallerParticipant(request, planId)` keeps its signature and calls it, as `planRoleFor` calls `planRoleForCookies`. Every route that imports it stays unchanged.
- **`src/server/proposal/page-data.ts`:** move `latestBlock`, `loadProposalJson` and the helpers only they use out of the proposal route, unchanged. Add `loadProposalPage(planId, readCookie)`, with the same steps and order as today's `GET`. It returns one of:
  - `{ kind: "ok", view }`, where `view` is today's 200 body (`{ state, block, proposal }`) for `blocked` or `proposed`;
  - `{ kind: "collecting" }`: the organizer while `collecting`;
  - `{ kind: "not_proposed" }`: a participant while `collecting` or `blocked`;
  - `{ kind: "locked" }`: the organizer or a participant on a locked plan;
  - `{ kind: "not_found" }`: everything the route answers 404 today.
- **`src/app/api/v1/plans/[planId]/proposal/route.ts`:** `GET` calls the loader and maps each kind to the response it sends today: `ok` → `NextResponse.json(view)`, `collecting` → `{ state: "collecting", block: null, proposal: null }`, `not_proposed` → the route's `notProposedResponse`, `locked` → `planLockedResponse`, `not_found` → `notFoundResponse`. Each is wrapped in `logged(request, …)`. Every other handler in the file keeps its behaviour.
- **`src/app/plans/[planId]/proposal/page.tsx`:** as the organizer page does. `locked` → `redirect` to `/plans/{planId}/confirmed`; `collecting` → `/plans/{planId}`; `not_proposed` → `/plans/{planId}/respond`; `ok` → `initialProposal={JSON.parse(JSON.stringify(view))}`; `not_found` → `initialProposal={null}`.
- **`src/components/proposal-view.tsx`:** take `initialProposal: unknown`.
  - Run it through the existing `parseFetchBody(200, …)`. A `blocked` or `proposed` outcome starts in `loaded` without fetching; anything else starts in `error`.
  - Remove the first-load effect. Keep `loadProposal`, `applyOutcome` and every write path as they are.
- **`src/app/plans/[planId]/proposal/error.tsx` and its test:** copy `src/app/plans/[planId]/error.tsx` and `error.test.tsx`, with the text of this component's `load === "error"` branch: `proposal.title`, `proposal.loadError`, `proposal.retry`.
- No new message key, no new dependency, no Server Action, no new field in the body.
- **Unit tests:** the loader against the test database for each kind, and cohort and non-cohort participants; the component with `initialProposal` makes no fetch on first render, and with `null` shows the error state; the existing write and refetch tests keep passing; the boundary as in T-001-37.
- **Real-stack proof (test play):** an `e2e/` test that proves AC-2 to AC-4 the way `e2e/organizer-plan-server-load.e2e.ts` does, and AC-5 the way `e2e/organizer-plan-error-boundary.e2e.ts` does, with the same stated limit. Reach `proposed` the way `e2e/core-loop.e2e.ts` does, and `blocked` the way `src/app/api/v1/plans/[planId]/proposal/route.test.ts` sets it up.
