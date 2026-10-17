---
id: ADR-0010
title: Browser tests with Playwright against the built app
status: accepted
---

# ADR-0010: Browser tests with Playwright against the built app

- Status: accepted
- Date: 2026-10-17
- Source: lead (roadmap item 5; lead approval of the Playwright dependency on 2026-10-17)
- Supersedes: none
- Amends: none

## Context

The `e2e/` suite runs route handlers and loaders in-process under jsdom, with real Postgres and no HTTP. It cannot catch routing, middleware, cookie or rendering faults. It already missed `/v1` vs `/api/v1` (ADR-0003). `sdlc.toml` sets `real_stack = ["integration"]` as a temporary override, because the kit's Next.js profile expects `e2e` to be Playwright over HTTP. No agent or CI job can open a page in a browser. So no gate sees what a screen actually renders.

The cloud agent containers already ship Chromium at `/opt/pw-browsers` (revision 1194, Chromium 141.0.7390.37). That is the browser Playwright 1.56.1 expects.

The server calls Google Places and Routes with fixed URLs (`src/server/google/places.ts`, `src/server/google/routes.ts`). A browser test against a started server cannot inject the fakes the in-process suites use (`setGoogleClientOptions`). Without a change it would call the real Google APIs, which need a key and cost money, and whose answers change.

## Decision

- **Dependency.** Add `@playwright/test` at exactly `1.56.1` (no range) as a dev dependency, with the lockfile updated by `npm install`. Use Chromium only, with no other browser projects.
- **Browsers.**
  - Agents and cloud sessions use the preinstalled browsers (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and never run `playwright install`.
  - CI runs `npx --no-install playwright install --with-deps chromium` after `npm ci`, caching `~/.cache/ms-playwright` keyed by the pinned version.
  - A version bump is a lead PR that changes the pin and the cache key together.
- **Where tests live.**
  - Specs go in `browser/*.spec.ts`. Support files (`browser/global-setup.ts`, `browser/google-stub.mjs`) sit beside them. `playwright.config.ts` is at the repo root.
  - They are separate from `e2e/` (Vitest, in-process), which stays as it is.
  - Every test title carries its `T-001-xx/AC-n` tag, as Vitest titles do.
- **Keeping the two runners apart.**
  - `vitest.config.ts` sets `test.exclude` to Vitest's defaults plus `browser/**`, so `npm test` never collects a spec.
  - `tsconfig.json` adds `browser/**/*.ts` and `playwright.config.ts` to `include`, so `tsc` type-checks them.
  - `eslint.config.mjs` adds `browser/**/*.ts` to `TEST_FILES`, so the test-file rules apply to specs. ESLint already lints `playwright.config.ts` as a root config file.
- **What they run against.**
  - `webServer` is a list of two servers, started in order:
    1. the Google stub, `node browser/google-stub.mjs`, at `http://127.0.0.1:3125`;
    2. the app: `next build`, then `next start -p 3124`, at `http://127.0.0.1:3124`.
  - Port 3124 is used because the kit's smoke check uses 3123. `reuseExistingServer` is `false` for both, so a stale local server is never tested.
  - The browser run uses the same `.next` folder as the build and smoke steps. It never runs at the same time as them: in CI and in the gate it runs after smoke.
  - Specs drive the app through the browser and the public `/api/v1` routes only. They do not import from `src/`. The one exception is the schema helper named below.
- **Database.**
  - The same `DATABASE_URL` as the other suites: CI's Postgres service, or the local Postgres on 5433.
  - `browser/global-setup.ts` applies the schema with `applySchemaOnce` from `src/server/db/test-schema.ts`. It does nothing else.
  - Each spec creates its own accounts and plans through the public API, and deletes them in `afterAll` in the style of `e2e/db-cleanup.ts`. There is no shared seed file.
- **Google.**
  - One helper, `src/server/google/origin.ts`, reads the optional variable `HP_E2E_GOOGLE_BASE_URL`. `places.ts` and `routes.ts` call it at request time to choose the origin. The exported URL constants stay as the defaults.
  - When the variable is unset or empty, requests go to `https://places.googleapis.com` and `https://routes.googleapis.com`, as now.
  - When it is set, it must be exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`: no trailing slash, path, query, credentials or other host. Any other value throws on the first Google call. It is never silently ignored or rewritten.
  - Only the origin changes. Paths, headers, field masks and bodies stay the same. Neither the variable nor the resulting URL is logged, as `skills/backend-patterns` already requires for Google request URLs.
  - The stub answers these three paths with fixed fixtures, and 404 for anything else:
    - `POST /v1/places:searchText` (`places.ts`, Text Search);
    - `GET /v1/places/{id}` (`places.ts`, Place Details);
    - `POST /distanceMatrix/v2:computeRouteMatrix` (`routes.ts`).
  - Production and preview environments never set the variable. Unit tests prove the default origins when it is unset, and the rejection of each bad form.
  - The in-process fakes are unchanged. The `setGoogleClientOptions` setters in `src/server/response/google.ts`, `src/server/response/place-search.ts` and `src/server/proposal/swap-google.ts`, and `setProposalAttemptGoogleOptions` in `src/server/proposal/trigger.ts`, keep injecting `fetch` for Vitest. An injected `fetch` still receives the URL the helper chose.
  - Why an environment variable and not a `GoogleClientOptions` field: a started production server has no in-process caller that could pass options. The environment is the only input it has.
  - `arch/CONTRACTS.md` § External Google is not changed. The contract with Google (hosts, paths, headers, field masks) is the same; the hook only exists under test. This ADR is the record.
- **Test environment.** No secrets. These variables are set only in the app entry's `webServer.env` in `playwright.config.ts`, never in the CI job, the shell, or `.env` files:
  - `GOOGLE_MAPS_API_KEY` and `GOOGLE_API_KEY` set to a dummy value;
  - `HP_E2E_GOOGLE_BASE_URL=http://127.0.0.1:3125`;
  - `HP_COOKIE_SECURE=0`, because the test server is plain `http://127.0.0.1`;
  - `HP_HASH_TEST=1`. It must not reach the Vitest process: `src/server/auth/password.test.ts` throws if it is set there.
- **Gate wiring.**
  - `commands.e2e` in `sdlc.toml` runs `npx --no-install playwright test --reporter=junit`, writing the JUnit file to `{junit}` through `PLAYWRIGHT_JUNIT_OUTPUT_NAME`.
  - `browser/**` joins the test globs and `integration_globs` in `sdlc.toml`, keeping the existing defaults, so the test play may write specs and `ac-coverage` counts them.
  - The `real_stack = ["integration"]` override stays until the browser suite is green on `main` and `gate` runs it as a required check. A later lead PR then sets `real_stack = ["integration", "e2e"]` and deletes the override comment.
- **Agent access.** A later lead PR (`sdlc.toml` and `ops/`) lets `fe-builder`, `tester` and `reviewer` run `npx --no-install playwright test` and read its screenshots and traces. They may not run `playwright install`.

## Consequences

- Browser tests catch routing, cookie, rendering and redirect faults the in-process suite cannot, and give agents a way to see a page.
- CI gets slower: one extra `next build`, a Chromium install (cached), and the browser run.
- `HP_E2E_GOOGLE_BASE_URL` is a test hook in product code. It only changes the origin of requests the server already makes, accepts only a loopback origin, is read only from the environment, and is never set outside tests.
- Two test trees exist, `e2e/` (in-process) and `browser/` (over HTTP). New page-level journeys go to `browser/`. Handler-level checks stay in `e2e/`.
- `sdlc.toml` and `.github/workflows/sdlc.yml` are outside `lead_allowed`, so their changes are lead PRs, not ticket work.
- Work, in order:
  1. Ticket: the Google origin helper and its use in `places.ts` and `routes.ts`, with unit tests for the defaults and each rejected form.
  2. Lead PR: `browser/**` in the test globs and `integration_globs`.
  3. Ticket: the dependency, `playwright.config.ts`, the `vitest.config.ts`, `tsconfig.json` and `eslint.config.mjs` changes, the stub, `browser/global-setup.ts`, and one journey spec (create an account, create a plan, open its invite page).
  4. Lead PR: the CI step and browser cache in `.github/workflows/sdlc.yml`, `commands.e2e`, and agent access.
  5. After the suite is green and required, the lead PR that removes the `real_stack` override.
