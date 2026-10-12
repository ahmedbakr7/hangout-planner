---
id: T-001-45
title: "Home loads the organizer's plan list on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-38, T-001-44]
files:
  - "src/server/plans/page-data.ts"
  - "src/server/plans/page-data.test.ts"
  - "src/app/api/v1/plans/route.ts"
  - "src/app/page.tsx"
  - "src/app/page.test.tsx"
  - "src/app/error.tsx"
  - "src/app/error.test.tsx"
  - "src/components/home-list.tsx"
  - "src/components/home-list.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/plans"
requirements:
  - F-001-37
  - N-001-14
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/plans returns the same status and body as before: 200 with the signed-in account's organized plans and truncated, and the missing-session response with no valid hp_session; POST keeps its behaviour"
  - "AC-2: the / page, called with a signed-in account's cookie, renders HomeList with initial data that holds that account's plans, and HomeList given that data shows the plan rows and makes no GET /api/v1/plans request on its first render"
  - "AC-3: HomeList given initial data sends exactly one GET /api/v1/me after mount (ADR-0009), and given null sends none"
  - "AC-4: for no cookie or an invalid hp_session, the page renders HomeList with no initial data, which shows the signed-out home (Home.signedOutFriends and the create link) and no plan rows"
  - "AC-5: HomeList given initial data that does not parse shows the home error state (Home.loadError) with the Home.retry button"
  - "AC-6: when the page's load throws, the route renders src/app/error.tsx, which shows Home.title, Home.loadError in a role=\"alert\" element and a Home.retry button that calls the retry function Next passes, and calls console.error(error) once"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0009-session-slide-after-server-load.md
---

Convert `/` to ADR-0007 server loading. Copy T-001-41: `loadInvitePage`, the invite page, `initialInvite` in `InvitePanel`, and `invite/error.tsx`. Use `useSessionSlide` from T-001-44.

- **`src/server/plans/page-data.ts`:** add `loadHomePage(readCookie)`.
  - It runs the same steps as today's `GET /api/v1/plans`: `readAccountSession(readCookie("hp_session"))`, then the same query, limit and `truncated` rule. Move the query out of the route, unchanged.
  - It returns `{ kind: "ok", view }`, where `view` is today's 200 body, or `{ kind: "signed_out" }`.
  - It does not slide the session.
- **`src/app/api/v1/plans/route.ts`:** `GET` calls the loader. `ok` → `NextResponse.json(view)`; `signed_out` → `missingSessionResponse()`. Each is wrapped in `logged(request, …)`. `POST` keeps its behaviour.
- **`src/app/page.tsx`:** build the reader from `await cookies()` and call the loader. `ok` → `<HomeList initialPlans={JSON.parse(JSON.stringify(view))} />`; `signed_out` → `initialPlans={null}`. Add `page.test.tsx` beside it.
- **`src/components/home-list.tsx`:** `HomeList` takes `initialPlans: unknown`.
  - `null` starts signed out.
  - A value that the existing `parsePlans` accepts starts signed in and `loaded`.
  - Any other value starts signed in with the `error` load state.
  - Remove the first-load effect. Keep `loadPlans`, which the retry button uses.
  - Call `useSessionSlide(initialPlans !== null)`.
- **`src/app/error.tsx` and its test:** copy `src/app/plans/[planId]/invite/error.tsx` and its test, with the text of this screen's `load === "error"` branch: `Home.title`, `Home.loadError`, and `Home.retry` on the button. This is the root segment's boundary. It also catches a throw from any route below it that has no `error.tsx` of its own. That is accepted, because those routes have no loader that throws.
- No new message key, no new dependency, no Server Action, and no new field in the body.
- **Unit tests:**
  - The loader runs against the test database, signed in (with zero plans and with plans) and signed out.
  - The component with `initialPlans` makes no plan fetch on first render. With `null` it shows the signed-out view, and with a bad value it shows the error state.
  - The boundary is tested as in T-001-41.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 and AC-4 the way `e2e/invite-server-load.e2e.ts` does. It proves AC-6 the way `e2e/invite-error-boundary.e2e.ts` does, with the same stated limit. Its cleanup follows T-001-43.
