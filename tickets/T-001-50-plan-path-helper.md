---
id: T-001-50
title: "One helper maps a plan's next surface to its path"
type: frontend
status: ready
risk: low
depends_on: [T-001-38, T-001-42, T-001-44]
files:
  - "src/lib/plan-paths.ts"
  - "src/lib/plan-paths.test.ts"
  - "src/app/plans/[planId]/confirmed/page.tsx"
  - "src/app/plans/[planId]/join/page.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/confirmed-view.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: planPath(planId, next) returns /plans/{planId} for organizer, /plans/{planId}/respond, /plans/{planId}/proposal and /plans/{planId}/confirmed for respond, proposal and confirmed, and null for join"
  - "AC-2: the confirmed page, the plan join page, JoinPanel and ConfirmedView build every next-to-path redirect or link through planPath, and none of the five local mapping functions (pathForNext in the two pages, hrefForOpening in JoinPanel and ConfirmedView, hrefForParticipant in JoinPanel) remains"
  - "AC-3: every existing redirect and navigation test for those four files passes unchanged"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

The reviews of #101 and #103 found five copies of the same mapping from a plan's `next` value to its screen path:

- `pathForNext` in `src/app/plans/[planId]/confirmed/page.tsx` and in `src/app/plans/[planId]/join/page.tsx`;
- `hrefForOpening` in `src/components/join-panel.tsx` and in `src/components/confirmed-view.tsx`;
- `hrefForParticipant` in `src/components/join-panel.tsx`.

This ticket replaces them with one pure function. Behaviour does not change.

- **`src/lib/plan-paths.ts`:**
  - It exports `planPath(planId: string, next: "organizer" | "respond" | "proposal" | "confirmed" | "join"): string | null`, with the mapping in AC-1.
  - It has no `"use client"` directive and no server-only import, so both pages and client components can import it.
  - It does not import from `src/server/`. Declare the union here and keep the callers' own types.
- **Pages:** call `planPath` where they call `pathForNext` today. They already redirect only when `next` is not `join`, so the result is never `null` there.
- **Components:**
  - `hrefForOpening` callers use `planPath` directly, since the `null` for `join` is the behaviour they have today.
  - `hrefForParticipant` callers pass a participant `next`, which is never `join`, so they use the string result.
- **`src/lib/plan-paths.test.ts`:** one test per AC-1 case, tagged `T-001-50/AC-1`. Every AC needs a passing tagged unit test in the build. For AC-2, a test may read the four files' source, as `src/components/home-list.test.tsx` does, and assert that no local mapping function remains.
- No new message key and no new dependency.
