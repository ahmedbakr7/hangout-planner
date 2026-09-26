---
id: T-001-25
title: "Swap and signal"
type: backend
status: in_review
risk: medium
depends_on:
  - T-001-23
files:
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/swap/route.ts"
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/swap/route.test.ts"
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/signal/route.ts"
  - "src/app/api/v1/plans/[planId]/steps/[stepId]/signal/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#POST /v1/plans/{planId}/steps/{stepId}/swap"
requirements:
  - F-001-9
  - F-001-28
  - F-001-29
  - F-001-30
  - F-001-31
  - F-001-32
  - F-001-33
  - N-001-8
  - N-001-9
  - N-001-10
  - N-001-15
acceptance_criteria:
  - "Swap of one stored alternative replaces that step's place, refreshes the legs that touch that step, refreshes fairness_warning, deletes that step's signals, and replaces that step's alternatives from the remaining stored pool"
  - "The time and the other steps' places stay, and their alternative lists stay; swap does not call Places"
  - "A google_place_id that is not one of that step's alternatives returns 409 not_an_alternative and leaves the proposal unchanged"
  - "When a touched leg cannot be routed, the response is 409 route_unavailable and the previous place, legs, signals, and alternatives stay"
  - "After a successful swap, like_count and dislike_count are 0 and a cohort member's my_signal on that step is unset"
  - "Signal accepts like, dislike, or unset for a cohort participant while proposed; unset deletes the row; the time, places, and cohort do not change; the response has no counts"
  - "The organizer and a non-cohort participant get 403 not_cohort; a stranger gets 404 with the envelope only; missing X-HP-Request: 1 returns 403 csrf and writes nothing; a non-proposed or locked plan does not change"
  - "Handler tests use Postgres and the fake Routes client, and they do not call routes.googleapis.com"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement swap of one stored alternative and the cohort signal. A failed route leaves the previous place. No extra files.
