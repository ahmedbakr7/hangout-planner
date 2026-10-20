---
id: T-001-73
title: "Browser-test app and stub ports from HP_E2E_APP_PORT and HP_E2E_GOOGLE_STUB_PORT"
type: chore
status: ready
risk: low
depends_on: [T-001-62, T-001-65, T-001-72]
files:
  - "playwright.config.ts"
  - "src/browser-config.test.ts"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: with HP_E2E_APP_PORT set to a port P other than 3124 and HP_E2E_GOOGLE_STUB_PORT unset, use.baseURL and the app webServer url are http://127.0.0.1:P, and the app command is npx --no-install next build && npx --no-install next start -p P; the stub entry and the app env are exactly as T-001-62/AC-3 checks them"
  - "AC-2: with HP_E2E_GOOGLE_STUB_PORT set to a port Q other than 3125, the stub webServer entry has port Q and still no env, and the app env's HP_E2E_GOOGLE_BASE_URL is http://127.0.0.1:Q; the app env keys are still exactly the five T-001-62/AC-3 names"
  - "AC-3: loading playwright.config.ts throws an Error naming the variable when HP_E2E_APP_PORT or HP_E2E_GOOGLE_STUB_PORT is set to a value that is not a decimal integer from 1 to 65535 (abc, 0, 65536, 3124x, 03124)"
  - "AC-4: loading playwright.config.ts throws an Error naming both variables when they give the app and the stub the same port"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0012-browser-test-ports-from-env.md
---

Two gate runs on one machine, for example two worktrees, both start `next start` on 3124 and the stub on 3125. With `reuseExistingServer: false` the second run fails on the busy port. ADR-0012 lets a run choose both ports from the environment. CI sets neither variable, so it runs on 3124 and 3125 exactly as now. This ticket is the config half. T-001-72 has already taught the stub script to read `HP_E2E_GOOGLE_STUB_PORT`. Copy T-001-65 for the shape: a `type: chore` config change proved by Vitest tests that load the config and never read its text.

- **`playwright.config.ts`:**
  - A local `portFrom(name, fallback)` reads `HP_E2E_APP_PORT` (fallback `3124`) and `HP_E2E_GOOGLE_STUB_PORT` (fallback `3125`) once, at load. It uses the same rule as `src/server/google/origin.ts` and T-001-72's `scriptPort()`. Unset or empty gives the fallback. Otherwise the value must match `^[1-9][0-9]{0,4}$` and be at most 65535. Anything else throws, naming the variable. If both values resolve to the same port, the function throws, naming both.
  - Build `use.baseURL`, the app entry's `url` and `-p`, the stub entry's `port`, and `HP_E2E_GOOGLE_BASE_URL` from these two numbers. Nothing else changes.
  - Do not put the new variables in either entry's `env`. The stub entry keeps no `env` (T-001-62/AC-3). It gets `HP_E2E_GOOGLE_STUB_PORT` through Playwright's default inheritance of `process.env`, which is how `DATABASE_URL` reaches the app today. The app entry keeps exactly its five keys.
- **`src/browser-config.test.ts`:**
  - **Load the config fresh for each case.** The existing tests import the config statically, so they read the shell's environment. In a run that sets the variables, `T-001-62/AC-3` would fail. Change only how the config is loaded in the `T-001-62/AC-3` and `T-001-65/AC-1` tests. `vi.stubEnv` both variables to `""`, then `vi.resetModules()` and `await import("../playwright.config")`, with `vi.unstubAllEnvs()` in `afterEach`. Copy `src/server/db/client.test.ts` ("reads DATABASE_URL"), which loads `drizzle.config.ts` this way. **Every assertion in those two tests stays byte-for-byte the same.** This pins their precondition and does not weaken them. The review names the change. With both variables `""`, these two tests are what prove the defaults (3124, 3125) are unchanged; no `T-001-73` AC claims that, because a test of unchanged behaviour passes on `main` and `ac-red` would fail it.
  - **New tests**, tagged `T-001-73/AC-1` to `AC-4`, load the config the same way:
    - AC-1 and AC-2 use ports such as 4124 and 4125.
    - AC-3 runs each listed bad value through each variable, and expects `await import(...)` to reject with the variable's name.
    - AC-4 sets both variables to one port, such as 4126.
- **Test play:** `e2e/browser-config.e2e.ts` (an `integration_globs` file, which T-001-62's and T-001-65's test plays wrote) imports the config dynamically with no env control. Its `T-001-62/AC-3` and `T-001-65/AC-1` tests need the same `""` stubbing plus `vi.resetModules()`, with assertions unchanged. The test play adds a `T-001-73/AC-1`/`AC-2` test through Playwright's own loader. One way: run `npx --no-install playwright test --list` with both variables set to free ports and check that it exits 0, as `e2e/playwright-list.e2e.ts` does. A real-stack proof that two runs coexist needs agents to run the browser suite twice at once. That is too heavy for a gate, so no AC claims it.
- **What still collides:** both runs build into `.next`, so two runs in the *same* checkout still conflict (ADR-0010: the browser run shares `.next` with build and smoke). This ticket enables separate worktrees only. The kit's smoke port 3123 is set with `SDLC_APP_PORT` (kit v4.0.0), not here.
- **Out of scope:** `sdlc.toml` (its `[commands]` comment names 3124/3125; a lead PR may reword it), `.github/workflows/sdlc.yml` (CI sets neither variable), `browser/**` (T-001-72).
- **Requirements:** none. This is test tooling with no product feature.

**Agent:** build with `builder`.
