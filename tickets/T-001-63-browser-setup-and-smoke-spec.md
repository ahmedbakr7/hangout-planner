---
id: T-001-63
title: "Browser global setup and the smoke spec"
type: test
status: draft
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
requirements: []
acceptance_criteria:
  - "AC-1: npx --no-install playwright test --list, run from the repository root, exits 0 and lists exactly one test, in the chromium project: browser/smoke.spec.ts \"T-001-62/AC-4 signed-out home page shows the Home heading\""
  - "AC-2: browser/global-setup.ts applies the schema to DATABASE_URL with applySchemaOnce and does nothing else; on a fresh database it creates the schema, and a second run changes nothing"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

This ticket holds T-001-62's AC-4 and AC-5, split off because they need `browser/**` and `e2e/**` files, which the build play cannot write. The lead finishes the ticket before it is ready.
