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
  - CI runs `npx --no-install playwright install --with-deps chromium` after `npm ci`, caching the browser folder keyed by the pinned version.
  - A version bump is a lead PR that changes the pin and the cache key together.
- **Where tests live.** Tests go in `browser/*.spec.ts`, with `playwright.config.ts` at the repo root. They are separate from `e2e/` (Vitest, in-process), which stays as it is.
- **What they run against.**
  - Playwright's `webServer` builds and starts the production server: `next build`, then `next start -p 3124`, at `http://127.0.0.1:3124`. Port 3124 is used because the kit's smoke check uses 3123.
  - Tests drive it through the browser and the public `/api/v1` routes only. They do not import from `src/`. The one exception is the schema helper named below.
- **Database.**
  - The same `DATABASE_URL` as the other suites: CI's Postgres service, or the local Postgres on 5433.
  - A Playwright `globalSetup` applies the schema with `applySchemaOnce` from `src/server/db/test-schema.ts`.
  - Each spec creates its own accounts and plans through the public API, and deletes them in `afterAll` in the style of `e2e/db-cleanup.ts`. There is no shared seed file.
- **Google.**
  - The Places and Routes clients read one optional variable, `HP_E2E_GOOGLE_BASE_URL`. When it is set, they send the same requests to that origin instead of `https://places.googleapis.com` and `https://routes.googleapis.com`. Paths, headers and bodies stay unchanged.
  - `globalSetup` starts a local stub server on a free port that answers those paths with fixed fixtures, and passes its URL to `webServer` through the environment.
  - Production and preview environments never set the variable. A unit test proves the default URLs when it is unset.
- **Secrets.** None. The test environment sets:
  - `GOOGLE_MAPS_API_KEY` and `GOOGLE_API_KEY` to a dummy value;
  - `HP_COOKIE_SECURE=0`, because the test server is plain `http://127.0.0.1`;
  - `HP_HASH_TEST=1`.
- **Gate wiring.**
  - `commands.e2e` in `sdlc.toml` runs `npx --no-install playwright test --reporter=junit`, writing the JUnit file to `{junit}` through `PLAYWRIGHT_JUNIT_OUTPUT_NAME`.
  - The `real_stack = ["integration"]` override stays until the browser suite is green on `main` and `gate` runs it as a required check. A later lead PR then sets `real_stack = ["integration", "e2e"]` and deletes the override comment.
- **Agent access.** A later lead PR (`sdlc.toml` and `ops/`) lets `fe-builder`, `tester` and `reviewer` run `npx --no-install playwright test` and read its screenshots and traces. They may not run `playwright install`.

## Consequences

- Browser tests catch routing, cookie, rendering and redirect faults the in-process suite cannot, and give agents a way to see a page.
- CI gets slower: one extra `next build`, a Chromium install (cached), and the browser run.
- `HP_E2E_GOOGLE_BASE_URL` is a test hook in product code. It changes only the origin of requests that the server already makes, it is read only from the environment, and it is never set outside tests.
- Two test trees exist, `e2e/` (in-process) and `browser/` (over HTTP). New page-level journeys go to `browser/`. Handler-level checks stay in `e2e/`.
- Tickets, in order:
  1. The Google base-URL hook, with a unit test for the default.
  2. Playwright config, the stub, `globalSetup`, one journey spec (create an account, create a plan, open its invite page), and the CI step.
  3. The lead PR for `commands.e2e` and agent access.
  4. After the suite is green and required, the lead PR that removes the `real_stack` override.
