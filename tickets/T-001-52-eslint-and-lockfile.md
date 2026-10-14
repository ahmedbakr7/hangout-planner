---
id: T-001-52
title: "ESLint with import boundaries, and a committed lockfile"
type: chore
status: ready
risk: medium
depends_on: [T-001-35, T-001-41, T-001-42, T-001-44, T-001-45, T-001-47, T-001-48, T-001-50, T-001-51]
files:
  - "package.json"
  - "package-lock.json"
  - "eslint.config.mjs"
  - "src/lint-rules.test.ts"
  - ".github/workflows/sdlc.yml"
  - "src/components/account-gate.tsx"
  - "src/components/home-list.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/language-control.tsx"
  - "src/server/auth/http.ts"
  - "src/app/api/v1/plans/[planId]/route.test.ts"
  - "src/i18n/fallback.test.ts"
  - "e2e/rtl.e2e.ts"
skills:
  - build
  - frontend-patterns
  - backend-patterns
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: npm run lint runs the TypeScript check and then ESLint over the repository with the eslint-config-next core-web-vitals and typescript rule sets and no warnings allowed, and it exits 0 on this ticket's head"
  - "AC-2: ESLint reports an error for an import of react, react-dom, next/navigation, @/components or @/app from a non-test file under src/server, for an import of @/server, @/components or @/app from a file under src/lib, and for an import of @/server from a non-test file under src/components"
  - "AC-3: ESLint reports an error for a raw hex colour in a string or template literal and for a JSX style attribute in a non-test .ts or .tsx file under src"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
  - decisions/ADR-0006-patterns-rulebook.md
---

Roadmap item 11. Hangout has no linter: its `lint` script runs `tsc` only, so the kit's lint gate checks types and nothing else. The folder rules in `skills/frontend-patterns/SKILL.md` (`src/server` has no React imports; `src/lib` does not import `src/server`) and ADR-0002's "hex only in the theme CSS, no inline styles" are enforced today only by review and by source-text tests in nine component test files. `npm install` also writes a `package-lock.json` that is never committed, so CI resolves dependency versions fresh on every run.

The lead approved these two devDependencies on 2026-10-14, after a dry run in a scratch worktree:

- `eslint` `^9.39.4`. ESLint 10 exists, but the plugins `eslint-config-next` 16.4.0 depends on (`eslint-plugin-react`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`) support ESLint up to 9.
- `eslint-config-next` `16.4.0`, exact, matching `next`. It brings `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `typescript-eslint`, `globals` and the node and typescript import resolvers.

No other package. No ESLint plugin beyond these; the custom rules use ESLint's built-in `no-restricted-imports` and `no-restricted-syntax`.

- **`package.json`:** add the two devDependencies. `lint` becomes the current `tsc -p tsconfig.typecheck.json --noEmit` followed by `eslint . --max-warnings 0`. `typecheck` is unchanged.
- **`package-lock.json`:** commit the lockfile that `npm install` writes with these dependencies. Do not upgrade any other package.
- **`.github/workflows/sdlc.yml`:** install with `npm ci --no-audit --no-fund` and drop the comment that says no lockfile is committed. (Lead note after merge: the kit makes `.github/workflows/**` lead-only, so no ticket PR can change it. The lead made this change in the follow-up lead PR after #117.)
- **`eslint.config.mjs`** (flat config, `defineConfig` from `eslint/config`):
  - Spread `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.
  - Ignore `.next/`, `node_modules/`, `.sdlc/`, `.sdlc-run/`, `skills/` and `next-env.d.ts`.
  - Boundaries with `no-restricted-imports` `patterns`, each with a message naming the rule:
    - `src/server/**`, test files excluded: `react`, `react-dom`, `react/*`, `next/navigation`, `@/components`, `@/components/*`, `@/app`, `@/app/*`.
    - `src/lib/**`: `@/server`, `@/server/*`, `@/components`, `@/components/*`, `@/app`, `@/app/*`.
    - `src/components/**`, test files excluded: `@/server`, `@/server/*`.
    - Each alias is listed bare and with `/*`, because a `/*` pattern does not match the bare alias.
    - Test files are excluded because the database-backed tests under `src/server` and `src/components` render or call across these folders on purpose.
  - Chrome with `no-restricted-syntax` on `src/**/*.{ts,tsx}`, test files excluded: a `Literal` or `TemplateElement` matching `#[0-9a-fA-F]{3,8}\b`, and a `JSXAttribute` named `style`. Messages cite ADR-0002.
- **Fix what the rule sets report today.** The dry run found 13 problems in 9 files, all listed in `files:`. Behaviour does not change:
  - `@typescript-eslint/no-unused-vars`: `PLAN_STATES` (`home-list.tsx`), `OPENING_NEXTS` (`invite-panel.tsx`, `join-panel.tsx`) and `LOCALES` (`language-control.tsx`) are used only as types; `REQUIRED_SIGN_IN_FIELDS` (`src/server/auth/http.ts`) is unused; `generateJoinToken` is an unused import in `src/app/api/v1/plans/[planId]/route.test.ts`.
  - `react/no-children-prop`: `e2e/rtl.e2e.ts` (3) and `src/i18n/fallback.test.ts` (1) pass `children` as a prop to `React.createElement`; pass them as arguments.
  - `@next/next/no-html-link-for-pages`: the `<a href="/">` inside `Button asChild` in `account-gate.tsx` and `invite-panel.tsx` becomes `next/link`'s `Link`.
  - `react-hooks/exhaustive-deps` in `account-gate.tsx`: the first-load effect reads `initialAccount` and must stay mount-only (it seeds once, ADR-0007). Keep that behaviour.
  - An `eslint-disable` comment is allowed only on a single line, for a single rule, with a `-- reason`. Name each one in the PR.
- **`src/lint-rules.test.ts`:** unit tests through the `ESLint` class API, tagged `T-001-52/AC-n`:
  - AC-2 and AC-3: `lintText` with a `filePath` inside each folder, asserting the expected rule fires for a bare alias and a subpath, and that a test file path or the theme CSS's folder does not trigger it where the ticket excludes it.
  - AC-1: `lintFiles` on the repository reports zero errors and zero warnings (raise that test's timeout).
  - These tests lint snippets and the real tree. They never read a product file's source text.
- **Out of scope:**
  - The nine source-text "no raw hex, no inline style" guard tests stay unchanged. Removing them is a lead decision once this rule has run in CI.
  - The `try`/`finally` cleanup in `e2e/` `afterAll` blocks stays in roadmap item 11.
  - `sdlc.toml`'s comment that Hangout has no linter is updated by the lead after merge.
