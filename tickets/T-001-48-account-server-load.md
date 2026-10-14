---
id: T-001-48
title: "Account page loads the signed-in account on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-44, T-001-46, T-001-47]
files:
  - "src/server/auth/page-data.ts"
  - "src/server/auth/page-data.test.ts"
  - "src/app/api/v1/me/route.ts"
  - "src/app/account/page.tsx"
  - "src/app/account/page.test.tsx"
  - "src/app/account/error.tsx"
  - "src/app/account/error.test.tsx"
  - "src/components/account-gate.tsx"
  - "src/components/account-gate.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/me"
requirements:
  - F-001-9
  - N-001-3
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/me returns the same status, body and Set-Cookie as before: 200 with the account's id, email and display_name and a renewed hp_session cookie whose session row's expires_at moved later, and 401 missing_session with no valid hp_session, including a guest-only browser"
  - "AC-2: the /account page, called with a signed-in account's cookie, renders AccountGate with initial data that holds that account, and AccountGate given that data shows the signed-in view with the account's display name and makes no first-load GET /api/v1/me request other than the one slide request"
  - "AC-3: AccountGate given initial account data sends exactly one GET /api/v1/me after mount (ADR-0009); given null initial data it sends no request at all"
  - "AC-4: for no cookie or an invalid hp_session, the page renders AccountGate with null initial data, which shows the sign-in form, and keeps the next path handling it has today (allow-listed next, and the join-without-account link for a join next)"
  - "AC-5: AccountGate rendered with no initialAccount prop, as CreateForm and InvitationsList render it, keeps today's first-load GET /api/v1/me behaviour unchanged"
  - "AC-6: when the page's load throws, the route renders src/app/account/error.tsx, which shows Account.title, errors.code.upstream in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-7: sign-in and register from the account page behave as before, including the redirect to the allow-listed next path"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0009-session-slide-after-server-load.md
---

Convert `/account` to ADR-0007 server loading. This is the last page. Copy T-001-46: `loadCreatePlanPage`, the create page, `initialCurrencies` in `CreateForm`, and `plans/new/error.tsx`. Use `useSessionSlide` from T-001-44.

`AccountGate` renders on three surfaces: the `/account` page, and signed-out `CreateForm` and `InvitationsList`. Only the `/account` page converts. The embedded uses keep their first-load `/api/v1/me`, which T-001-46 and T-001-47 AC-3 rely on. The new prop is therefore optional, and the old path runs when it is absent. This also means the page sends no second `/me`: with initial data it sends only the slide request, and with `null` it sends nothing.

- **`src/server/auth/page-data.ts`:** add `loadAccountPage(readCookie)`.
  - It calls `readAccountSession(readCookie("hp_session"))`.
  - It returns `{ kind: "ok", view, session }` or `{ kind: "signed_out" }`.
    - `view` is today's 200 body, `{ account: { id, email, display_name } }`.
    - `session` is the `AccountSession` that `GET` needs to slide.
  - It does not slide the session.
- **`src/app/api/v1/me/route.ts`:** `GET` calls the loader.
  - `ok` → `slideSession(session.sessionId)`, then `accountResponse(session.account, session.token, 200, options)`, as today.
  - `signed_out` → `missingSessionResponse()`.
  - Each is wrapped in `logged(request, …)`. The status, body and cookie do not change.
- **`src/app/account/page.tsx`:**
  - Keep today's `searchParams` handling of `next`.
  - Build the reader from `await cookies()`.
  - `ok` → `<AccountGate next={next} initialAccount={JSON.parse(JSON.stringify(view))} />`. Pass only `view`, never `session`, because the token must not reach the client.
  - `signed_out` → `initialAccount={null}`.
  - Add `page.test.tsx` beside it.
- **`src/components/account-gate.tsx`:** add `initialAccount?: unknown` to `AccountGateProps`.
  - `undefined` keeps today's first-load effect and `checking` state, unchanged.
  - `null` starts in `signed_out` with no fetch.
  - A value that the existing `readDisplayName` reads starts in `signed_in` with that name.
  - Any other value starts in `signed_out`, which is what a `/me` body without a name does today.
  - Run the first-load effect only when `initialAccount === undefined`.
  - Call `useSessionSlide(signedInFromInitial)` unconditionally. `signedInFromInitial` is true only when `initialAccount` gave a name.
  - Keep sign-in, register and the `next` handling as they are.
- **`src/app/account/error.tsx` and its test:** copy `src/app/plans/new/error.tsx` and its test, with `Account.title`, `errors.code.upstream`, and `common.retry` on the button.
- No new message key, no new dependency, no Server Action, and no new field in the body.
- **Unit tests:** every AC needs a passing unit test tagged `T-001-48/AC-n` in the build.
  - The loader runs against the test database, signed in and signed out. This includes AC-1's `expires_at` check, following `src/components/use-session-slide.test.tsx`.
  - The gate is tested with initial data, with `null`, and with no prop.
  - The existing gate tests keep passing.
  - The boundary is tested as in T-001-46.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 and AC-4 the way the T-001-46 e2e does. It proves AC-6 the way the boundary e2e does, with the same stated limit. Its cleanup follows T-001-43.
