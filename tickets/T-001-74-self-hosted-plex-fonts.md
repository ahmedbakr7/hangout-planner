---
id: T-001-74
title: "Load IBM Plex Sans and IBM Plex Sans Arabic from files in the repo with next/font/local"
type: frontend
status: ready
risk: low
depends_on: [T-001-07, T-001-52, T-001-53, T-001-62]
files:
  - "src/app/layout.tsx"
  - "src/app/fonts/IBMPlexSans-Regular.woff2"
  - "src/app/fonts/IBMPlexSans-SemiBold.woff2"
  - "src/app/fonts/IBMPlexSansArabic-Regular.woff2"
  - "src/app/fonts/IBMPlexSansArabic-SemiBold.woff2"
  - "src/app/fonts/OFL.txt"
  - "eslint.config.mjs"
  - "src/lint-rules.test.ts"
  - "e2e/font-imports.e2e.ts"
skills:
  - build
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2]
acceptance_criteria:
  - "AC-1: ESLint reports a no-restricted-imports error whose message names next/font/local for an import from next/font/google in any .ts or .tsx file under src/, test files included"
  - "AC-2: npm run lint passes on the repository, and src/app/layout.tsx imports no module from next/font/google"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
  - decisions/ADR-0006-patterns-rulebook.md
---

`next build` fails now and then in CI while `next/font/google` fetches IBM Plex Sans: Turbopack stops with "next/font/google queries have exactly one entry" on a font URL from Google's CSS (#160, #162). A re-run passes. The fix is to stop fetching fonts at build time. The faces, weights and CSS variables stay the same (ADR-0001: "Faces: IBM Plex Sans Arabic and IBM Plex Sans"; `design/DESIGN.md`: "Wire the faces through Next.js font loading"), so no ADR changes.

- **Font files.** The lead commits the five files under `src/app/fonts/` on `build/T-001-74` before the build runs (`sdlc commit T-001-74 --agent lead --play build`), because an agent cannot write binary files. They come unchanged from IBM's own npm packages, `@ibm/plex-sans@1.1.0` and `@ibm/plex-sans-arabic@1.1.0`, under `fonts/complete/woff2/`; `OFL.txt` is the packages' `LICENSE.txt` (SIL Open Font License 1.1, the same text in both). The build does not change, rename or add font files.
- **`src/app/layout.tsx`:**
  - Replace the two `next/font/google` loaders with `localFont` from `next/font/local`. Keep the variable names `ibmPlexSans` and `ibmPlexSansArabic`, the CSS variables `--font-latin` and `--font-arabic`, and `display: "swap"`.
  - Each loader's `src` lists its two files, `{ path: "./fonts/<file>.woff2", weight: "400", style: "normal" }` and the same for `600`. Keep the `className` on `<html>` exactly as it is. Nothing else in the file changes.
  - The complete files cover every script the Google subsets did (`latin`, plus `arabic` for the Arabic face), so no `unicode-range` is needed.
- **`eslint.config.mjs`:** add a `no-restricted-imports` path rule for `next/font/google` to every file under `src/`, test files included. The message is "Load fonts with next/font/local from src/app/fonts (T-001-74): next/font/google fetches at build time." Use a new config entry with `files: ["src/**/*.{ts,tsx}"]`, and do not put it in `ignores: TEST_FILES`. **Merge it with the boundary rules:** ESLint keeps only the last `no-restricted-imports` setting for a file, so the new path has to be in each existing boundary entry (`src/server`, `src/lib`, `src/components`) too, or it replaces their patterns. Copy how `serverBoundary` is passed today, and add `paths: [nextFontGoogle]` beside `patterns`.
- **`src/lint-rules.test.ts`:**
  - Tests tagged `T-001-74/AC-1` call the file's `ruleIds()` with `import { IBM_Plex_Sans } from "next/font/google";` as `src/app/layout.tsx`, `src/components/x.tsx`, `src/server/x.ts`, `src/lib/x.ts` and `src/app/x.test.tsx`. Each expects a `no-restricted-imports` error whose message names `next/font/local`. In the same `describe`, check that the boundary rules still fire: one `@/components` import as `src/server/x.ts`, one `@/server` import as `src/lib/x.ts`.
  - The `T-001-74/AC-2` test lints the real `src/app/layout.tsx` with a second `ESLint` instance whose `overrideConfig` adds the `next/font/google` path rule, and expects no errors. It must not depend on the repo config having the rule, so it fails whenever the layout imports `next/font/google`. The existing `T-001-52/AC-1` test keeps proving the whole tree lints clean.
- **Proof:** both AC fail on `main`: AC-1 has no rule there, and AC-2 finds the layout's `next/font/google` import. Run `npm run lint`, the type check and the unit suite. The browser proof that pages load the faces from the app's own origin is T-001-75 (`type: test`), because only the test play may write `browser/**`.
- **Test play:** add `e2e/font-imports.e2e.ts` (listed in `files:` for the test play only; the build may not write `e2e/`), tagged `T-001-74/AC-2`. It lints every `.ts` and `.tsx` file under the real `src/` tree through the ESLint API with the same override as the unit test, and expects no `next/font/google` import anywhere.
- **Out of scope:** the Tailwind and CSS variables in `src/app/globals.css` (unchanged), and `skills/frontend-patterns` (a lead PR adds the fonts row once this merges).

**Agent:** build with `builder`. It may not run `next build`; the gate does.
