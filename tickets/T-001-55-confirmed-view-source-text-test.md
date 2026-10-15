---
id: T-001-55
title: "Replace the confirmed-view source-text test with behaviour tests"
type: chore
status: ready
risk: low
depends_on: [T-001-14, T-001-19, T-001-28, T-001-38, T-001-41, T-001-47, T-001-50, T-001-51, T-001-53]
files:
  - "src/components/confirmed-view.test.tsx"
  - "src/components/invite-panel.test.tsx"
  - "src/app/plans/[planId]/confirmed/page.test.tsx"
  - "src/server/join/open.test.ts"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: the /plans/{planId}/confirmed page renders ConfirmedView for that planId"
  - "AC-2: InvitePanel sends a locked plan to /plans/{planId}/confirmed, both when an invitation request answers plan_locked and when an invitations row's opening next is confirmed"
  - "AC-3: the opening for a locked plan gives next confirmed to the organizer and to a participant"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Roadmap item 3, second slice. `src/components/confirmed-view.test.tsx` has one test, "T-001-50/AC-3 the share link and an invitations row for a locked plan land on this surface". It reads three source files with `readFileSync` and checks for strings: `ConfirmedView` and `planId` in the confirmed page, `` `/plans/${planId}/confirmed` `` in `src/components/invite-panel.tsx`, and `state === "locked" ? "confirmed"` in `src/server/join/open.ts`. The `test-quality` check counts it as 3 hits, baselined.

Each of those claims already has, or can have, a behaviour test in the file that owns it:

- **AC-1** in `src/app/plans/[planId]/confirmed/page.test.tsx`, which already mocks `ConfirmedView`: render the page for a plan and assert the mocked `ConfirmedView` received that `planId`.
- **AC-2** in `src/components/invite-panel.test.tsx`: the existing `plan_locked` redirect test and the "opening follows join and confirmed next from opening" test already pin both paths; tag them, or add one test per path.
- **AC-3** in `src/server/join/open.test.ts`: the table of `next` by state already covers `locked`; tag the test that asserts it, or add one.

Tag each with `T-001-55/AC-n`. A test that already pins a case may keep its name and gain the tag.

- **Remove** the source-text test from `src/components/confirmed-view.test.tsx`, and the `readFileSync` and `join` imports if nothing else in that file uses them. Leave every other test in that file unchanged.
- **Baseline:** run `sdlc baseline --prune` and commit `sdlc-baseline.json` with the build. The `confirmed-view` `test-quality` entry (3) goes away; nothing else may change.
- No product file changes. No new test reads source text.

**Agent:** build with `builder`, test-only.
