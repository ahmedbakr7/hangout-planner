---
id: T-001-24
title: "Attempt triggers"
type: backend
status: done
risk: high
depends_on:
  - T-001-10
  - T-001-20
  - T-001-23
files:
  - "src/app/api/v1/plans/[planId]/proposal-attempts/route.ts"
  - "src/app/api/v1/plans/[planId]/proposal-attempts/route.test.ts"
  - "src/app/api/v1/plans/[planId]/route.ts"
  - "src/app/api/v1/plans/[planId]/route.test.ts"
  - "src/app/api/v1/plans/[planId]/response/route.ts"
  - "src/app/api/v1/plans/[planId]/response/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Proposal attempt"
requirements:
  - F-001-9
  - F-001-25
  - F-001-26
  - F-001-38
  - F-001-40
  - N-001-15
acceptance_criteria:
  - "AC-1: PUT response runs an attempt only after a first completion commits and that completion makes answered_count equal the threshold, then returns the resulting plan_state; a save while blocked does not run an attempt"
  - "AC-2: PATCH runs an attempt when it lowers the threshold onto answered_count while collecting, or raises the budget while blocked, and the returned plan includes the new state"
  - "AC-3: POST /v1/plans/{planId}/proposal-attempts runs an attempt while blocked and returns the organizer proposal document; any other state returns 409 not_blocked or 409 plan_locked"
  - "AC-4: The run locks the plan row; a lock younger than 20 seconds returns 409 attempt_in_progress after the triggering write has committed; a lock older than 20 seconds may be taken over"
  - "AC-5: The attempts route returns 429 after 20 runs per plan per rolling hour and does not change the plan; a completion or budget raise that finds the hour full does not call Google, finishes as venue_data, and still returns 200 for the write that already committed"
  - "AC-6: HP_PROPOSAL_ENABLED=0 records venue_data and does not call Google"
  - "AC-7: A stranger gets 404 with the envelope only; a non-organizer who can know the plan gets 403 organizer_only on the attempts route; missing X-HP-Request: 1 returns 403 csrf and writes nothing"
  - "AC-8: Handler tests use Postgres and the fake Google clients, and they keep plan validation, response counting, and the no-write-on-invalid rules"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Add the three attempt triggers on the response write, the plan patch, and POST proposal-attempts, including retry and the hour cap. Do not change response counting. No extra files.
