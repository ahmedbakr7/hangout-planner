---
id: T-001-46
title: "Create page loads the session and currency list on the server"
type: fullstack
status: ready
risk: medium
depends_on: [T-001-38, T-001-44, T-001-45]
files:
  - "src/server/plans/page-data.ts"
  - "src/server/plans/page-data.test.ts"
  - "src/app/api/v1/currencies/route.ts"
  - "src/app/plans/new/page.tsx"
  - "src/app/plans/new/page.test.tsx"
  - "src/app/plans/new/error.tsx"
  - "src/app/plans/new/error.test.tsx"
  - "src/components/create-form.tsx"
  - "src/components/create-form.test.tsx"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/currencies"
requirements:
  - F-001-7
  - F-001-9
  - F-001-12
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /api/v1/currencies returns the same status and body as before: 200 with the currency list for a signed-in account, and the missing-session response with no valid hp_session"
  - "AC-2: the /plans/new page, called with a signed-in account's cookie, renders CreateForm with initial data that holds the currency list, and CreateForm given that data shows the create form with those currencies in the currency field and makes no GET /api/v1/me or GET /api/v1/currencies request on its first render other than the one slide request"
  - "AC-3: CreateForm given initial data sends exactly one GET /api/v1/me after mount (ADR-0009), and given null sends none"
  - "AC-4: for no cookie or an invalid hp_session, the page renders CreateForm with no initial data, which shows the account gate with next /plans/new, as signed-out create does today"
  - "AC-5: CreateForm given initial data whose currency list does not parse shows the create form with the default currency list, as a failed currency load does today"
  - "AC-6: when the page's load throws, the route renders src/app/plans/new/error.tsx, which shows Create.title, errors.code.upstream in a role=\"alert\" element and a common.retry button that calls the retry function Next passes, and calls console.error(error) once"
  - "AC-7: submitting a valid create form still sends POST /api/v1/plans and opens the organizer plan, as before"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0009-session-slide-after-server-load.md
---

Convert `/plans/new` to ADR-0007 server loading. Copy T-001-45: `loadHomePage`, the home page, `initialPlans` in `HomeList`, and `src/app/error.tsx`. Use `useSessionSlide` from T-001-44.

Today the page makes two first loads. `CreateFormRoot` calls `GET /api/v1/me`, and shows the account gate when signed out. `CreateFormFields` calls `GET /api/v1/currencies`, and keeps `DEFAULT_CURRENCIES` when that fails. Both move to the server.

- **`src/server/plans/page-data.ts`:** add `loadCreatePlanPage(readCookie)`.
  - It runs the same steps as today's `GET /api/v1/currencies`: `readAccountSession(readCookie("hp_session"))`, then the same body built from `CURRENCIES`. Move the body assembly out of the route, unchanged.
  - It returns `{ kind: "ok", view }`, where `view` is today's 200 body, or `{ kind: "signed_out" }`.
  - It does not slide the session.
- **`src/app/api/v1/currencies/route.ts`:** `GET` calls the loader. `ok` → `NextResponse.json(view)`; `signed_out` → `missingSessionResponse()`. Each is wrapped in `logged(request, …)`.
- **`src/app/plans/new/page.tsx`:** `ok` → `<CreateForm initialCurrencies={JSON.parse(JSON.stringify(view))} />`; `signed_out` → `initialCurrencies={null}`. Add `page.test.tsx` beside it.
- **`src/components/create-form.tsx`:** `CreateForm` takes `initialCurrencies: unknown`.
  - `null` renders `<AccountGate next="/plans/new" />`, as signed-out does today.
  - Any other value renders the form. Its currency list is `parseCurrencies(initialCurrencies)` when that parses, and `DEFAULT_CURRENCIES` otherwise.
  - Remove both first-load effects and the `checking` state.
  - Call `useSessionSlide(initialCurrencies !== null)`.
  - Keep the submit path as it is.
- **`src/app/plans/new/error.tsx` and its test:** copy `src/app/error.tsx` from T-001-45 and its test, with `Create.title`, `errors.code.upstream` (the screen has no load-error key; T-001-40 uses the same key), and `common.retry` on the button.
- No new message key, no new dependency, no Server Action, and no new field in the body.
- **Unit tests:**
  - The loader runs against the test database, signed in and signed out.
  - The form with `initialCurrencies` makes no first-render fetch other than the slide request. With `null` it shows the gate, and with a bad value it uses the default list.
  - The existing submit and validation tests keep passing.
  - The boundary is tested as in T-001-45.
- **Real-stack proof (test play):** an `e2e/` test proves AC-2 and AC-4 the way the T-001-45 e2e does. It proves AC-6 the way the boundary e2e does, with the same stated limit. Its cleanup follows T-001-43.
