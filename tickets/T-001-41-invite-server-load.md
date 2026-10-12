---
id: T-001-41
title: "Invite page loads the share link and invitations on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-37]
files:
  - "src/server/invites/page-data.ts"
  - "src/server/invites/page-data.test.ts"
  - "src/app/api/v1/plans/[planId]/invite/route.ts"
  - "src/app/plans/[planId]/invite/page.tsx"
  - "src/app/plans/[planId]/invite/page.test.tsx"
  - "src/app/plans/[planId]/invite/error.tsx"
  - "src/app/plans/[planId]/invite/error.test.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/invite-panel.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans/{planId}/invite"
requirements:
  - F-001-16
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans/{planId}/invite returns the same status and body as before: 200 with the join path and sent invitations for the organizer, 403 organizer_only for a participant, an invited account or a link reader, 404 for a stranger or unknown plan, and 409 plan_locked for the organizer on a locked plan"
  - "AC-2: the /plans/{planId}/invite page, called with the organizer's cookie, renders InvitePanel with initial data that holds the join path and the sent invitations, and InvitePanel given that data shows the share link and the invitation rows and makes no GET /api/v1/plans/{planId}/invite request on its first render"
  - "AC-3: the page redirects to /plans/{planId}/confirmed when the organizer opens it on a locked plan"
  - "AC-4: for no cookie, a participant's or a stranger's cookie, or an unknown plan id, the page renders InvitePanel with no initial data, which shows the invite load error (invite.loadError) and no plan data"
  - "AC-5: when the page's load throws, the route renders src/app/plans/[planId]/invite/error.tsx, which shows invite.title, invite.loadError in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-6: sending an invitation and copying the link from the invite panel behave as before"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Convert `/plans/{planId}/invite` to ADR-0007 server loading. Copy T-001-38 (`loadConfirmedPage` and the confirmed page, view and `error.tsx`), which follows T-001-36 and T-001-37.

- **`src/server/invites/page-data.ts`:** add `loadInvitePage(planId, readCookie)`, with the same steps and order as today's `GET`: `loadPlanRow`, `planRoleForCookies`, the organizer check (`inviteCallerError`), the locked check, then `loadSentInvitations` and `inviteReadBody`. It returns one of:
  - `{ kind: "ok", view }`, where `view` is today's 200 body;
  - `{ kind: "organizer_only" }`: a participant, an invited account or a link reader;
  - `{ kind: "not_found" }`: no plan, or no role;
  - `{ kind: "locked" }`: the organizer on a locked plan.
- **`src/app/api/v1/plans/[planId]/invite/route.ts`:** `GET` calls the loader and maps each kind to the response it sends today: `ok` → `NextResponse.json(view)`, `organizer_only` → `organizerOnlyResponse`, `not_found` → `notFoundResponse`, `locked` → `errorResponse(planLockedInviteError())`. Each is wrapped in `logged(request, …)`. The bodies must not change.
- **`src/app/plans/[planId]/invite/page.tsx`:** as the confirmed page does. `locked` → `redirect` to `/plans/{planId}/confirmed`; `ok` → `initialInvite={JSON.parse(JSON.stringify(view))}`; anything else → `initialInvite={null}`. Add `page.test.tsx` beside it for the redirect, with exact-match assertions on the target.
- **`src/components/invite-panel.tsx`:** `InvitePanel` takes `initialInvite: unknown`.
  - A value that the existing `parseInviteBody` accepts starts in `loaded` without fetching. Anything else, `null` included, starts in `error`.
  - Remove `InvitePanelBody`'s first-load effect. Keep `loadInvite` (the retry button) and the send and copy paths as they are.
  - Leave `InvitationsList` in the same file unchanged. It serves `/invitations`, which converts in its own ticket.
- **`src/app/plans/[planId]/invite/error.tsx` and its test:** copy `src/app/plans/[planId]/confirmed/error.tsx` and its test, with the text of this panel's `load === "error"` branch: `invite.title`, `invite.loadError`, and `common.retry` on the button.
- No new message key, no new dependency, no Server Action, no new field in the body.
- **Unit tests:**
  - The loader runs against the test database for each kind.
  - The panel with `initialInvite` makes no fetch on first render, and with `null` shows the error state.
  - The existing send and copy tests keep passing.
  - The boundary is tested as in T-001-38.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 to AC-4 the way `e2e/confirmed-server-load.e2e.ts` does. It proves AC-5 the way `e2e/confirmed-error-boundary.e2e.ts` does, with the same stated limit. Its `afterAll` also deletes the `link_sessions` rows the test creates; see T-001-43.
