---
id: T-001-27
title: "Proposal UI"
type: frontend
status: ready
risk: medium
depends_on:
  - T-001-12
  - T-001-24
  - T-001-25
  - T-001-26
files:
  - "src/app/plans/[planId]/proposal/page.tsx"
  - "src/components/proposal-view.tsx"
  - "src/components/proposal-view.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}/proposal"
requirements:
  - F-001-28
  - F-001-29
  - F-001-30
  - F-001-31
  - F-001-32
  - F-001-33
  - F-001-41
  - N-001-8
  - N-001-9
  - N-001-10
  - N-001-15
  - N-001-16
acceptance_criteria:
  - "While collecting this surface is not shown; while blocked the organizer sees time, budget, and venue-data sentences from the three flags, those sentences use danger, and lock is absent; when time and budget are both true both sentences are visible"
  - "A joined participant while blocked is shown the response surface; venue-data offers retry; a missing duration is blank and is not rendered as zero"
  - "A proposed itinerary shows the time with the timezone, how many cohort members can make it, and each cohort member's display name, and the attendance line calls that set everyone only when the number equals the cohort size"
  - "Each step shows the step name, the authored option label, the place name, and the per-person amount with the plan currency; legs show a travel duration; starting points and a map are absent"
  - "The fairness warning uses warning, talks about travel time, includes no amount and no currency, and does not hide lock"
  - "The organizer sees at most 3 alternatives on a step; zero alternatives keeps the place and says there is no alternative; swap updates that place and the counts on that step show as none; lock is present only while proposed"
  - "A cohort member sees their own signal and does not see counts, swap, or lock; a joined person outside the cohort sees the itinerary without signal controls; chrome may name Google Places and Google Maps routing and offers no native-app install step"
  - "A load failure uses danger and retry and omits another plan's places; a locked open shows the confirmed surface"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Build the proposal surface from design/pages/proposal.md: block copy, the fairness warning, the swap list, lock, organizer counts, and the member's own signal. No extra files.
