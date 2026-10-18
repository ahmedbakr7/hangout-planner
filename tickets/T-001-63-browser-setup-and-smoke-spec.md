---
id: T-001-63
title: "Browser global setup and the smoke spec"
type: test
status: ready
risk: low
split_from: T-001-62
depends_on: [T-001-62]
files:
  - "browser/global-setup.ts"
  - "browser/smoke.spec.ts"
  - "e2e/browser-global-setup.e2e.ts"
  - "e2e/playwright-list.e2e.ts"
skills:
  - test
contracts: []
requirements: [F-001-1]
acceptance_criteria:
  - "AC-1: npx --no-install playwright test --list, run from the repository root, exits 0 and lists exactly one test, in the chromium project: browser/smoke.spec.ts \"T-001-63/AC-1 signed-out home page shows the Home heading\""
  - "AC-2: browser/global-setup.ts applies the schema to DATABASE_URL with applySchemaOnce and does nothing else; on a fresh database it creates the schema, and a second run changes nothing"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

This ticket holds T-001-62's AC-4 and AC-5, split off because they need `browser/**` and `e2e/**` files, which the build play cannot write. As a `type: test` ticket, its build writes these test files and proves both ACs with the integration suite. F-001-1 (English chrome on every surface) is the feature the smoke spec's heading check touches; the citation does not claim this ticket proves it.

The lead marked it ready with one change from the split text: AC-1 quotes the smoke test's title with this ticket's own tag (`T-001-63/AC-1`) instead of `T-001-62/AC-4`, so the tag names an AC that exists.

- **`browser/smoke.spec.ts`:** one test titled exactly `T-001-63/AC-1 signed-out home page shows the Home heading`. It opens `/` and expects a level-1 heading named `Home` to be visible. It imports only from `@playwright/test`.
- **`browser/global-setup.ts`:** the default export applies the schema to `DATABASE_URL` with `applySchemaOnce` from `src/server/db/test-schema.ts` (the one `src/` import ADR-0010 allows) and does nothing else. It rejects with `DATABASE_URL is required` when the variable is unset.
- **`e2e/playwright-list.e2e.ts`**, tagged `T-001-63/AC-1`: runs `npx --no-install playwright test --list` from the repository root with `node:child_process` and checks the exit status and that the output lists exactly that one test under the `chromium` project. `--list` starts no server and opens no browser.
- **`e2e/browser-global-setup.e2e.ts`**, tagged `T-001-63/AC-2`: creates a throwaway database on the test Postgres, runs the default export with `DATABASE_URL` stubbed to it, checks that a known table exists, runs it again, then drops the database. Copy the inline `CREATE DATABASE` / `DROP DATABASE ... WITH (FORCE)` code and URL rewrite in `e2e/test-schema.e2e.ts`, and close connections with `cleanupThenClose` from `e2e/db-cleanup.ts`. One more untagged test checks the `DATABASE_URL is required` rejection.
- **Agent rule (from T-001-62, until the step 4 lead PR):** agents may run `playwright test --list` only inside a test. No agent runs the smoke spec in a browser. The lead runs `npx --no-install playwright test` by hand on the reviewed commit and posts the command, exit status, commit and `1 passed` on the PR.
