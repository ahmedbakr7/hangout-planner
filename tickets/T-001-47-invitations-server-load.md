---
id: T-001-47
title: "Invitations page loads the inbox on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-41, T-001-44]
files:
  - "src/server/invites/page-data.ts"
  - "src/server/invites/page-data.test.ts"
  - "src/app/api/v1/invitations/route.ts"
  - "src/app/invitations/page.tsx"
  - "src/app/invitations/page.test.tsx"
  - "src/app/invitations/error.tsx"
  - "src/app/invitations/error.test.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/invite-panel.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/invitations"
requirements:
  - F-001-18
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/invitations returns the same status and body as before: 200 with the signed-in account's invitation rows and truncated, and the missing-session response with no valid hp_session"
  - "AC-2: the /invitations page, called with a signed-in account's cookie, renders InvitationsList with initial data that holds that account's invitations, and InvitationsList given that data shows each row's plan title and organizer display name and makes no GET /api/v1/invitations request on its first render"
  - "AC-3: InvitationsList given initial data sends exactly one GET /api/v1/me after mount (ADR-0009); given null, its useSessionSlide call sends no request, and the only GET /api/v1/me is the one the account gate makes for itself on mount, as today"
  - "AC-4: for no cookie or an invalid hp_session, the page renders InvitationsList with no initial data, which shows the account gate with next /invitations, as signed-out does today"
  - "AC-5: InvitationsList given initial data that does not parse shows the inbox error state (invitations.loadError) with the invitations.retry button"
  - "AC-6: when the page's load throws, the route renders src/app/invitations/error.tsx, which shows invitations.title, invitations.loadError in a role=\"alert\" element and an invitations.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-7: opening a row and the invite panel's own behaviour are unchanged"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0009-session-slide-after-server-load.md
---

Convert `/invitations` to ADR-0007 server loading. Copy T-001-41: `loadInvitePage` in the same `page-data.ts`, the invite page, `initialInvite`, and `invite/error.tsx`. Use `useSessionSlide` from T-001-44.

Today `InvitationsListRoot` calls `GET /api/v1/me`, and shows the account gate when signed out. `InvitationsListBody` then calls `GET /api/v1/invitations`. Both move to the server.

- **`src/server/invites/page-data.ts`:** add `loadInvitationsPage(readCookie)`.
  - It runs the same steps as today's `GET /api/v1/invitations`: `readAccountSession(readCookie("hp_session"))`, then the same query, limit and `truncated` rule. Move the query out of the route, unchanged.
  - It returns `{ kind: "ok", view }` or `{ kind: "signed_out" }`.
  - It does not slide the session.
- **`src/app/api/v1/invitations/route.ts`:** `GET` calls the loader. `ok` → `NextResponse.json(view)`; `signed_out` → `missingSessionResponse()`. Each is wrapped in `logged(request, …)`.
- **`src/app/invitations/page.tsx`:** `ok` → `<InvitationsList initialInbox={JSON.parse(JSON.stringify(view))} />`; `signed_out` → `initialInbox={null}`. Add `page.test.tsx` beside it.
- **`src/components/invite-panel.tsx`:** `InvitationsList` takes `initialInbox: unknown`.
  - `null` renders `<AccountGate next="/invitations" />`.
  - A value that the existing `parseInbox` accepts starts `loaded`. Any other value starts in `error`.
  - Remove both first-load effects and the `checking` state. Keep `loadInbox`, which the retry button uses.
  - Call `useSessionSlide(initialInbox !== null)`.
  - `InvitePanel` in the same file keeps its T-001-41 behaviour.
- **`src/app/invitations/error.tsx` and its test:** copy `src/app/plans/[planId]/invite/error.tsx` and its test, with `invitations.title`, `invitations.loadError`, and `invitations.retry` on the button.
- No new message key, no new dependency, no Server Action, and no new field in the body.
- **Unit tests:**
  - The loader runs against the test database, signed in (with zero invitations and with invitations) and signed out.
  - The list with `initialInbox` makes no inbox fetch on first render. With `null` it shows the gate, and with a bad value it shows the error state.
  - The existing invite panel tests keep passing.
  - The boundary is tested as in T-001-41.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 and AC-4 the way `e2e/invite-server-load.e2e.ts` does. It proves AC-6 the way `e2e/invite-error-boundary.e2e.ts` does, with the same stated limit. Its cleanup follows T-001-43.
