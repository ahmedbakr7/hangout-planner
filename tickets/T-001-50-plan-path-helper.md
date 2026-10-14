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
  - "AC-1: planPath(planId, next) returns /plans/{planId} for organizer, and /plans/{planId}/respond, /plans/{planId}/proposal, /plans/{planId}/confirmed and /plans/{planId}/join for respond, proposal, confirmed and join"
  - "AC-2: each caller keeps the targets it has today: the confirmed page redirects a not_locked result to planPath for its next, join included (/plans/{planId}/join for a link-only caller); the plan join page redirects only when next is not join; JoinPanel navigates for every opening next except join and, after a join, to the participant next; ConfirmedView links to /plans/{planId}/join for next join and gives no link for next confirmed"
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

They map the same five values to the same five paths. They differ only in which `next` each caller treats as "stay on this screen": `JoinPanel` never navigates for `join`, `ConfirmedView` gives no link for `confirmed`, and the plan join page does not redirect for `join`. The confirmed page has no such case: it redirects every `not_locked` result, `join` included.

This ticket replaces the mapping with one pure function and leaves each caller's own stay-here check where it is. Behaviour does not change.

- **`src/lib/plan-paths.ts`:**
  - It exports `planPath(planId: string, next: "organizer" | "respond" | "proposal" | "confirmed" | "join"): string`, with the mapping in AC-1. It never returns `null`.
  - It has no `"use client"` directive and no server-only import, so both pages and client components can import it.
  - It does not import from `src/server/`. Declare the union here and keep the callers' own types.
- **Pages:** call `planPath` where they call `pathForNext` today. The plan join page keeps its `next !== "join"` guard. The confirmed page keeps redirecting every `not_locked` result, so a link-only caller still lands on `/plans/{planId}/join`.
- **Components:**
  - `JoinPanel` keeps its `parsed.next !== "join"` guard before calling `planPath`, so its redirects are unchanged. Remove the now-dead `null` branch after the call only if no path reaches it.
  - `ConfirmedView`'s `hrefFromOpeningBody` returns `null` for `confirmed` itself, then calls `planPath` for the other four.
  - `hrefForParticipant` callers pass a participant `next`, which is never `join`, so they call `planPath` directly.
  - Remove the five local functions (`pathForNext` in both pages, `hrefForOpening` in `JoinPanel` and `ConfirmedView`, `hrefForParticipant`). Review checks this in the diff; no test reads source text.
- **Unit tests:**
  - `src/lib/plan-paths.test.ts`: one test per AC-1 case, tagged `T-001-50/AC-1`.
  - AC-2, tagged `T-001-50/AC-2`, by behaviour: the confirmed page's `not_locked` `join` redirect target (exact match, as in `src/app/plans/[planId]/join/page.test.tsx`), `ConfirmedView`'s link for `join` and none for `confirmed`, and `JoinPanel` staying on screen for an opening `next` of `join` and navigating to `/plans/{planId}/confirmed` after a join whose participant `next` is `confirmed`. Add these beside the existing tests of each file; existing tests that already pin a case may carry the tag.
  - Every AC needs a passing tagged unit test in the build.
- No new message key and no new dependency.
