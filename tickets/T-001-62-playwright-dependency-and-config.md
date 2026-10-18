---
id: T-001-62
title: "Playwright dependency, config, global setup and a smoke spec"
type: chore
status: ready
risk: medium
depends_on: [T-001-35, T-001-52, T-001-61]
files:
  - "package.json"
  - "package-lock.json"
  - "playwright.config.ts"
  - "vitest.config.ts"
  - "tsconfig.json"
  - "eslint.config.mjs"
  - "browser/global-setup.ts"
  - "browser/smoke.spec.ts"
  - "src/browser-config.test.ts"
  - "e2e/browser-global-setup.e2e.ts"
  - ".gitignore"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: package.json lists @playwright/test at exactly 1.56.1 in devDependencies, and package-lock.json resolves node_modules/@playwright/test to 1.56.1"
  - "AC-2: the Vitest config's test.exclude is Vitest's default exclude list plus browser/**, and tsconfig.json's include adds browser/**/*.ts and playwright.config.ts"
  - "AC-3: playwright.config.ts has testDir browser, globalSetup browser/global-setup.ts, use.baseURL http://127.0.0.1:3124, one chromium project and no other, and a webServer list of exactly two entries in order: command node browser/google-stub.mjs with port 3125 and timeout 10000, then command npx --no-install next build && npx --no-install next start -p 3124 with url http://127.0.0.1:3124 and timeout 300000, both with reuseExistingServer false; only the app entry has env, and its keys are exactly GOOGLE_MAPS_API_KEY and GOOGLE_API_KEY (a dummy value), HP_E2E_GOOGLE_BASE_URL=http://127.0.0.1:3125, HP_COOKIE_SECURE=0 and HP_HASH_TEST=1"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

Step 3b of ADR-0011. It adds the Playwright dependency and every file ADR-0010 places beside the browser suite, plus one smoke spec so that step 4 has a suite to wire. It changes no product code and no behaviour of `npm test` or `npm run lint`. Copy T-001-52 for the shape: a `type: chore` ticket whose config and dependency changes are proved by Vitest tests that load the config, never by reading a file's text.

The lead approved `@playwright/test` 1.56.1 in ADR-0010 (2026-10-17). No other package.

- **`package.json` / `package-lock.json`:** `npm install --save-dev --save-exact @playwright/test@1.56.1`. Do not upgrade or add anything else. Never run `playwright install`; the browser is preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`).
- **`playwright.config.ts`** (repo root, `defineConfig` from `@playwright/test`): exactly what ADR-0010 § "What they run against" and § "Test environment" say, with the values AC-3 lists.
  - The stub entry waits on `port`, not `url`: the stub answers `GET /` with 404, which Playwright does not count as ready.
  - `DATABASE_URL` reaches the app through Playwright's default merge of `process.env` into `webServer.env`. The config does not name it, and the AC-3 test asserts the five keys only.
  - The app entry's 300 s timeout covers `next build`; Playwright's 60 s default does not. The dummy key value is a fixed string such as `"browser-test-dummy"`. The JUnit reporter reads its output path from `PLAYWRIGHT_JUNIT_OUTPUT_NAME`, which the config does not set (step 4's `commands.e2e` does). The config reads no other environment variable and sets nothing in `process.env`.
- **`vitest.config.ts`:** `test.exclude` is `[...configDefaults.exclude, "browser/**"]`. Nothing else changes.
- **`tsconfig.json`:** add `browser/**/*.ts` and `playwright.config.ts` to `include`.
- **`eslint.config.mjs`:** add `browser/**/*.ts` to `TEST_FILES`. `npm run lint` must still exit 0 (T-001-52/AC-1 lints the whole tree).
- **`browser/global-setup.ts`:** copy `vitest.global-setup.ts`: open `postgres(DATABASE_URL, { max: 1 })`, call `applySchemaOnce`, end the connection. If `DATABASE_URL` is unset it throws `DATABASE_URL is required` (a browser run without a database cannot pass). It imports only `postgres` and `src/server/db/test-schema.ts` (the exception ADR-0010 names).
- **`browser/smoke.spec.ts`:** one test, titled as AC-4 states. It opens `/` with no cookies (English, the fallback locale), and expects the level-1 heading named `Home` (`messages/en.json` `Home.title`). It creates no data, so it needs no cleanup.
- **`src/browser-config.test.ts`** (`// @vitest-environment node`), tagged `T-001-62/AC-1` to `AC-4`:
  - AC-1: reads `package.json` and `package-lock.json` as JSON (data, not source text) and checks the pin and the lockfile entry. It does not compare with another branch. That no other dependency changed is shown by the lockfile diff, which the review checks.
  - AC-2: imports `vitest.config.ts` and checks `test.exclude`; reads `tsconfig.json` as JSON and checks `include`.
  - AC-3: imports `playwright.config.ts` and checks each field AC-3 names.
  - AC-4: runs `npx --no-install playwright test --list --reporter=json` with `child_process`. It parses the JSON and checks the one test's file, title and project. `--list` starts neither `webServer` nor `globalSetup` and opens no browser. If it does start one here, stop and report rather than raising timeouts.
  - **Agent rule (lead reading of ADR-0010 § Agent access):** `playwright test --list` is the one Playwright invocation agents run before step 4, and only through this test. It loads the config and specs, opens no browser and starts no server. Running the suite itself (`playwright test` without `--list`) waits for step 4's agent access.
- **`e2e/browser-global-setup.e2e.ts`**, tagged `T-001-62/AC-5`: creates a throwaway database on the test Postgres, runs the default export of `browser/global-setup.ts` with `DATABASE_URL` stubbed to it, checks that a known table exists, runs it again, then drops the database. Copy the inline `CREATE DATABASE` / `DROP DATABASE ... WITH (FORCE)` code and URL rewrite in `e2e/test-schema.e2e.ts`, and close connections with `cleanupThenClose` from `e2e/db-cleanup.ts`. This is an `integration_globs` file in a `type: chore` ticket, as T-001-52 had `e2e/rtl.e2e.ts`; the review names it.
- **Running the spec itself.** No gate runs `browser/smoke.spec.ts` until step 4 sets `commands.e2e`, and agents may not run Playwright until then (ADR-0010 § Agent access). On the build head, the lead's session runs `npx --no-install playwright test` with the local Postgres. It posts a PR comment with the command, the exit status, the commit, and the reporter's final pass line (`1 passed`). The comment must name the PR's final head; a later commit needs a new run. The lead checks it before merging, and a failing or stale run blocks the merge. The reviewer agent cannot read PR comments, so no AC claims this run; gate proof of the smoke spec starts at step 4, as ADR-0011 accepts.
- **`.gitignore`:** add `test-results/` and `playwright-report/`, which a run writes.
- **Out of scope:** the CI step, browser cache, `commands.e2e` and agent access (step 4, a lead PR), and any journey spec (step 4a).
- **Requirements:** none. This is test tooling with no product feature.

**Agent:** build with `builder`.

## Amendments

- split AC-4 -> T-001-63: the build play cannot write browser/** (integration_globs), which AC-4 lists
- split AC-5 -> T-001-63: browser/global-setup.ts and its e2e test are integration_globs files, the test play's
