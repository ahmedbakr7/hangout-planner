---
id: T-001-64
title: "Browser journey: create an account, create a plan, open its invite page"
type: test
status: draft
risk: low
depends_on: [T-001-63]
files:
  - "browser/create-and-invite.spec.ts"
skills:
  - test
contracts: []
requirements: [F-001-9, F-001-12, F-001-14, F-001-16]
acceptance_criteria:
  - "AC-1: signed out, choosing Create a plan on the home page opens the account page; creating an account there with a new email, a password and a display name opens the create form, whose level-1 heading is Create a plan"
  - "AC-2: submitting the create form with a title, the filled timezone, one day window, a positive budget in EGP, one step with a step name and two option labels, and a threshold of 1 opens /plans/{id} for the new plan, whose level-1 heading is the entered title"
  - "AC-3: choosing Invite on that plan opens /plans/{id}/invite, whose level-1 heading is Invite and whose Shareable link section shows a URL as text that starts with the app's origin followed by /join/"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

Step 4a of ADR-0011: the first journey spec, proved by the gate in Chromium through `commands.e2e`. It stays `status: draft` until its ACs can be proved. The lead PR that sets `commands.e2e` (with the CI step and agent access) and adds `e2e` to `tests.real_stack` marks it ready. Before that, no gate runs a browser spec.

- **`browser/create-and-invite.spec.ts`:** one `test.describe` in serial mode (`test.describe.configure({ mode: "serial" })`) sharing one page, with one test per AC, each titled with its `T-001-64/AC-n` tag.
  - It drives the app only through the browser, by role and accessible name, using the English strings in `messages/en.json` (`Home.create`, `Account.*`, `Create.*`, `plans.invite`, `invite.*`). It imports nothing from `src/`; its only other imports are the cleanup ones below.
  - The account's email is unique per run (for example, a timestamp and random suffix at `example.test`), so reruns never collide.
  - The journey touches no Google path, so the stub only has to be running, which `playwright.config.ts` already does.
  - **Cleanup:** `afterAll` deletes every row the run created (the plan and its child rows, then the account and its sessions, in foreign-key order), found through the run's unique email. ADR-0010 asks for this "in the style of `e2e/db-cleanup.ts`", and the public API has no delete route. So it opens its own `postgres` client on `DATABASE_URL`, takes the child-table delete order from the foreign keys in `src/server/db/schema.ts` (read, not imported; `deleteSeededRows` in `e2e/plan-join-server-load.e2e.ts` shows the style), and closes the client through `cleanupThenClose` from `e2e/db-cleanup.ts`. Those two are its only imports outside `@playwright/test`; nothing comes from `src/`.
- **Proof:** the gate's `e2e` suite (Playwright JUnit) proves each AC. The tester and reviewer may run `npx --no-install playwright test` once step 4 grants it; they never run `playwright install`.
