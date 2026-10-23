---
id: T-001-80
title: "Lock Next.js 16.4.3 for the 16.4.0 security advisories"
type: chore
status: ready
risk: medium
test: none
depends_on: [T-001-35, T-001-52, T-001-62]
files:
  - "package-lock.json"
  - "src/next-version.test.ts"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: package-lock.json resolves node_modules/next to a 16.4.x version at or above 16.4.3, every node_modules/@next/* entry it lists that next depends on (@next/env and the @next/swc-* binaries) resolves to that same version, and the installed next package reports it"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

`npm audit --omit=dev` on main (`cea2687`) reports three Next.js advisories for 16.0.0 to 16.4.0: GHSA-2464-fhr4-w9xw (critical, remote code execution in the Image Optimization API with SVG files), GHSA-673q-mjm6-r5xr (critical, remote code execution in `use cache` functions returning typed arrays) and GHSA-p3m5-59mp-jv5r (high, denial of service in the App Router with Server Actions). 16.4.3 is the current 16.4 patch. The lead approved the bump on 2026-10-23.

The lead installs before the build runs (agents cannot run `npm install`), as for T-001-62 (`7aa0398`): `npm install next@16.4.3`, then `package.json`'s `next` is set back to `^16.4.0` and `npm install` is run once more, so only `package-lock.json` changes. `npm ci` installs exactly what the lockfile says, so CI and every worktree get 16.4.3. `package.json` keeps the T-001-35 range: T-001-35/AC-1 is accepted and its test checks `^16.4.0` exactly, and a range of `^16.4.0` resolves to 16.4.3 or later wherever no lockfile is present. The lead's commit names the command and the `npm audit` result.

- **`src/next-version.test.ts`:** add one `describe` block, tagged `T-001-80/AC-1`. Read `package-lock.json` as JSON (data, not source text), as T-001-62/AC-1 does. AC-1 checks the `node_modules/next` entry, the `@next/env` entry, each `@next/swc-*` entry the lockfile lists, and `node_modules/next/package.json`. The `^16.4.0` range stays covered by the T-001-35/AC-1 test. That no package outside `next` and `@next/*` changed version is shown by the lockfile diff, which the review checks (as for T-001-62/AC-1). Do not change the T-001-35 tests.
- **Red check.** `ac-red` reverts only `src/**`, so it cannot fail these tests on the base (the change is in `package-lock.json`). The lead runs the T-001-80 tests against main's lockfile by hand before merging and posts the failing output on the PR, as for T-001-76.
- **Security check.** The lead runs `npm audit --omit=dev` on the build head and posts the result on the PR: no `next` advisory may remain. The reviewer agent cannot run it (network).
- `test: none`: no new behaviour. The gate's unit, integration and browser suites, `next build` and the smoke probes against `next start` prove the app still works on 16.4.3.
- **Out of scope:** `eslint-config-next` stays at 16.4.0; drizzle-orm is T-001-81. Do not adopt any Next feature.
