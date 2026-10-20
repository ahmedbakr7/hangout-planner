---
id: T-001-76
title: "Lint rule: no import from next/font/google under src/"
type: chore
status: draft
risk: low
split_from: T-001-74
depends_on: [T-001-74]
files:
  - "eslint.config.mjs"
  - "src/lint-rules.test.ts"
skills:
  - build
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2]
acceptance_criteria:
  - "AC-1: ESLint reports a no-restricted-imports error whose message names next/font/local for an import from next/font/google in any .ts or .tsx file under src/, test files included"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
  - decisions/ADR-0006-patterns-rulebook.md
---

This ticket holds T-001-74's AC-1, split off because `ac-red` reverts only `src/**` (the nextjs profile's `source_globs`), never `eslint.config.mjs`. A test of the lint rule therefore passes on the base once `src/app/layout.tsx` changes, so T-001-74 could not prove it. With only config changed here, `ac-red` has no production file to revert; the lead checks the rule's red state by hand (run the AC-1 tests on `main`'s `eslint.config.mjs`).

- **`eslint.config.mjs`:** add a `no-restricted-imports` path rule for `next/font/google` to every file under `src/`, test files included. The message is "Load fonts with next/font/local from src/app/fonts (T-001-74): next/font/google fetches at build time." Use a new config entry with `files: ["src/**/*.{ts,tsx}"]`, and do not put it in `ignores: TEST_FILES`. **Merge it with the boundary rules:** ESLint keeps only the last `no-restricted-imports` setting for a file, so the new path has to be in each existing boundary entry (`src/server`, `src/lib`, `src/components`) too, or it replaces their patterns. Copy how `serverBoundary` is passed today, and add `paths: [nextFontGoogle]` beside `patterns`.
- **`src/lint-rules.test.ts`:** tests tagged `T-001-76/AC-1` call the file's `ruleIds()` with `import { IBM_Plex_Sans } from "next/font/google";` as `src/app/layout.tsx`, `src/components/x.tsx`, `src/server/x.ts`, `src/lib/x.ts` and `src/app/x.test.tsx`. Each expects a `no-restricted-imports` error whose message names `next/font/local`. In the same `describe`, check that the boundary rules still fire: one `@/components` import as `src/server/x.ts`, one `@/server` import as `src/lib/x.ts`.
- **Out of scope:** `src/app/layout.tsx` and the font files (T-001-74).
