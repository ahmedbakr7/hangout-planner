---
id: T-001-53
title: "Drop the nine source-text chrome tests that ESLint now enforces"
type: chore
status: ready
risk: low
depends_on: [T-001-08, T-001-11, T-001-12, T-001-18, T-001-19, T-001-21, T-001-27, T-001-28, T-001-34, T-001-35, T-001-36, T-001-38, T-001-39, T-001-40, T-001-41, T-001-42, T-001-44, T-001-45, T-001-46, T-001-47, T-001-48, T-001-50, T-001-51, T-001-52]
files:
  - "src/lint-rules.test.ts"
  - "src/components/account-gate.test.tsx"
  - "src/components/confirmed-view.test.tsx"
  - "src/components/create-form.test.tsx"
  - "src/components/home-list.test.tsx"
  - "src/components/invite-panel.test.tsx"
  - "src/components/join-panel.test.tsx"
  - "src/components/organizer-plan.test.tsx"
  - "src/components/proposal-view.test.tsx"
  - "src/components/response-form.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: ESLint's configuration for each of src/components/account-gate.tsx, confirmed-view.tsx, create-form.tsx, home-list.tsx, invite-panel.tsx, join-panel.tsx, organizer-plan.tsx, proposal-view.tsx and response-form.tsx sets no-restricted-syntax to error with the raw-hex Literal, the raw-hex TemplateElement and the JSX style attribute selectors"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0002-shadcn-ui.md
  - decisions/ADR-0006-patterns-rulebook.md
---

Roadmap item 3, first slice, and the lead decision T-001-52 deferred. Each of the nine component test files above has a `describe("<Component> chrome")` block with one test, "composes shadcn primitives with DESIGN.md semantic classes and no raw hex". It reads component source with `readFileSync` and checks for hex literals, `style={{`, shadcn imports and class names. Since T-001-52 (#117), ESLint fails `npm run lint` on a raw hex colour or a JSX `style` attribute in any non-test file under `src`, which is the part ADR-0002 binds. The rest of each test is a string match on source, the pattern the `test-quality` check flags. None of these tests carries an AC tag.

- **Remove** the whole `describe("... chrome")` block in each of the nine files, and any import, constant or helper (for example `TICKET_FILES`, `readFileSync`, `join`) that only that block used. Leave every other test in those files unchanged, including the other source-text tests (roadmap item 3 continues).
- **Add to `src/lint-rules.test.ts`** one test tagged `T-001-53/AC-1`. For each of the nine component paths, call `eslint.calculateConfigForFile(path)` and assert `no-restricted-syntax` is an error whose options include the three selectors from `eslint.config.mjs`. It reads ESLint's resolved config, never a file's source text.
- **Baseline:** removing the nine tests lowers the `test-quality` counts for those files. Run `sdlc baseline --prune` and commit `sdlc-baseline.json` with the build; the gate fails until the baseline matches, and it may only shrink.
- No product file changes. No `eslint-disable`.

**Agent:** build with `fe-builder` (roadmap item 17, its first pilot run). This ticket touches no page, so the pilot checks that the launcher works under the runner (dev server up and stopped, `AGENTS.md` untouched, no stale port), not what the Next.js tools add.
