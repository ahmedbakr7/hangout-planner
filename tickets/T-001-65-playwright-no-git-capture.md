---
id: T-001-65
title: "Stop Playwright fetching git history in CI"
type: chore
status: ready
risk: low
depends_on: [T-001-62]
files:
  - "playwright.config.ts"
  - "src/browser-config.test.ts"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: playwright.config.ts sets captureGitInfo to exactly { commit: false, diff: false }, and every field T-001-62/AC-3 checks keeps its value"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
---

Playwright 1.56's git-info plugin is on by default when `CI` is set. On GitHub Actions it reads the pull request's base SHA and runs `git fetch origin <sha> --depth=1` in the checkout (`node_modules/playwright/lib/plugins/gitCommitInfoPlugin.js`). That makes the CI clone shallow: `origin/main` loses its history, so the gate reads no delivered tickets and `gate pr` on a PR with a merge commit counts every ticket since the graft (#148: "moves 31 tickets"). Diagnosed on #151 with a git wrapper that logged the call. Every gate run since #146, where the browser suite and `e2e/playwright-list.e2e.ts` first ran in CI, does this.

The fix is one config field. Nothing else in the config changes. ADR-0010 does not set this field, so the change keeps to it.

- **`playwright.config.ts`:** add `captureGitInfo: { commit: false, diff: false }` at the top level of `defineConfig`. No other change.
- **`src/browser-config.test.ts`:** one new test tagged `T-001-65/AC-1` that imports the config and checks `captureGitInfo` equals `{ commit: false, diff: false }`. The `T-001-62/AC-3` test stays as it is and must still pass. Copy that test's shape: load the config, never read its text.
- **Out of scope:** the workflow, `sdlc.toml`, the trace and ac-coverage baselines, and any kit check for shallow clones (a kit change).
- **Proof on CI:** after merge, a PR whose history has a merge commit (#148) passes `gate pr` with one ticket. The reviewer cannot see CI, so no AC claims this; the lead checks it on #148.
- **Requirements:** none. This is test tooling with no product feature.

**Agent:** build with `builder`.
