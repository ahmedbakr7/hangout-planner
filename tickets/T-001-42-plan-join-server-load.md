---
id: T-001-42
title: "Plan join page loads the join preview on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-35, T-001-37]
files:
  - "src/server/join/page-data.ts"
  - "src/server/join/page-data.test.ts"
  - "src/app/api/v1/plans/[planId]/opening/route.ts"
  - "src/app/plans/[planId]/join/page.tsx"
  - "src/app/plans/[planId]/join/page.test.tsx"
  - "src/app/plans/[planId]/join/error.tsx"
  - "src/app/plans/[planId]/join/error.test.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/join-panel.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}/opening"
requirements:
  - F-001-10
  - F-001-11
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId}/opening returns the same status and body as before for the organizer, a participant and an invited account (200, with next and, for next join, the preview), and for a link reader, a stranger or an unknown plan (404)"
  - "AC-2: the /plans/{planId}/join page, called with an invited account's cookie on a plan that is not locked, renders JoinPanel with initial data that holds the join preview (plan title and organizer display name) and the signed-in state, and JoinPanel given that data shows the preview and the account join action and makes no GET /api/v1/plans/{planId}/opening or /api/v1/me request on its first render"
  - "AC-3: when the opening's next is not join, the page redirects to that surface: /plans/{planId} for the organizer, /plans/{planId}/respond or /plans/{planId}/proposal for a participant (by state), and /plans/{planId}/confirmed on a locked plan"
  - "AC-4: for no cookie, a stranger's cookie or an unknown plan id, the page renders JoinPanel with no initial opening, which shows the unknown-link state (join.unknownLink) and no plan data"
  - "AC-5: when the page's load throws, the route renders src/app/plans/[planId]/join/error.tsx, which shows join.title, join.joinFailed in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-6: /join/{token} keeps today's client loading: JoinPanel given a token and no initial opening fetches GET /api/v1/join/{token} and /api/v1/me on first render as before"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Convert `/plans/{planId}/join` to ADR-0007 server loading. Copy T-001-38: `loadConfirmedPage`, the confirmed page, its view, its `error.tsx`, and its mapping from `next` to path.

`/join/{token}` is not part of this ticket. Its `GET` writes a link session and sets the `hp_link` cookie. A server component cannot set cookies, and ADR-0007 rules out Server Actions. That page needs a lead decision first. `JoinPanel` serves both pages, so the token path must keep working as it does today.

- **`src/server/join/page-data.ts`:**
  - Move `asOpeningCaller` and `loadJoinPreview` out of the opening route, unchanged.
  - Add `loadPlanJoinPage(planId, readCookie)`. It follows today's opening `GET`: `loadPlanRow`, `planRoleForCookies`, the caller check, `openingBody` with the preview when `next` is `join`.
  - It returns `{ kind: "ok", opening, signedIn }` or `{ kind: "not_found" }`.
  - `signedIn` is `(await readAccountSession(readCookie("hp_session"))).ok`. It is the same check `/api/v1/me` makes, without sliding the session. A server component cannot set the cookie that a slide renews.
- **`src/app/api/v1/plans/[planId]/opening/route.ts`:** `GET` calls the loader. `ok` → `NextResponse.json(opening)`; `not_found` → `notFoundResponse`. Each is wrapped in `logged(request, …)`. The body must not change.
- **`src/app/plans/[planId]/join/page.tsx`:** as the confirmed page does.
  - When `opening.next` is not `join`, `redirect` to the path for `next`. Use the same mapping as `hrefForOpening` in `join-panel.tsx`.
  - `ok` with `next` `join` → `initialOpening={JSON.parse(JSON.stringify(opening))}` and `initialSignedIn={signedIn}`.
  - `not_found` → `initialOpening={null}`.
  - Add `page.test.tsx` beside it for the redirects, with exact-match assertions on the target.
- **`src/components/join-panel.tsx`:** `JoinPanel` takes optional `initialOpening?: unknown` and `initialSignedIn?: boolean`.
  - When `initialOpening` is a value that the existing `parseOpening` accepts with `next` `join`, start in `loaded` with that preview and the session from `initialSignedIn`, without fetching.
  - When it is `null`, start in `unknown`. Any other value starts in `error`.
  - Run the first-load effect only when `initialOpening` is `undefined`, which is the `/join/{token}` page. Keep `loadOpening` (the retry buttons) and the join paths as they are.
- **`src/app/plans/[planId]/join/error.tsx` and its test:** copy `src/app/plans/[planId]/confirmed/error.tsx` and its test, with the text of this panel's `load === "error"` branch: `join.title`, `join.joinFailed`, and `common.retry` on the button. Today a throw on this route falls back to `src/app/plans/[planId]/error.tsx`, which shows the organizer plan's text.
- No new message key, no new dependency, no Server Action, no new field in the opening body.
- **Unit tests:**
  - The loader runs against the test database for each caller and state.
  - The panel with `initialOpening` makes no fetch on first render, and with `null` shows the unknown-link state.
  - The panel with a token and no initial opening still fetches.
  - The existing join tests keep passing.
  - The boundary is tested as in T-001-38.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 to AC-4 the way `e2e/confirmed-server-load.e2e.ts` does. It proves AC-5 the way `e2e/confirmed-error-boundary.e2e.ts` does, with the same stated limit. Its `afterAll` also deletes the `link_sessions` rows the test creates; see T-001-43.
