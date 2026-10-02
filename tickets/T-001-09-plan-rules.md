---
id: T-001-09
title: "Plan edit rules"
type: backend
status: done
risk: medium
depends_on:
  - T-001-02
  - T-001-03
  - T-001-04
files:
  - "src/server/plans/edit-rules.ts"
  - "src/server/plans/edit-rules.test.ts"
  - "src/server/plans/views.ts"
  - "src/server/plans/views.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}"
requirements:
  - F-001-15
  - N-001-13
acceptance_criteria:
  - "AC-1: collecting with answered_count 0 allows title, timezone, windows, steps, and currency, budget any, and threshold any"
  - "AC-2: collecting with answered_count at least 1 allows title, budget raise, and threshold lower, and freezes the rest"
  - "AC-3: blocked allows title and budget raise, and freezes the rest; proposed allows title and freezes the rest"
  - "AC-4: budget raise requires the same currency and a strictly greater amount_minor; threshold lower requires an integer at least answered_count and at most the stored threshold; threshold any allows an integer 1 through 100"
  - "AC-5: A frozen key, an illegal budget change, a currency change while currency is frozen, or a threshold outside the current mode is field_frozen and describes no write"
  - "AC-6: The organizer view includes no starting points, step picks, or itinerary"
  - "AC-7: The participant view omits other participants, other starting points, the answered count, and the threshold"
  - "AC-8: Tests are pure: no database and no network"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Encode the freeze matrix and the organizer view redaction. No HTTP routes and no extra files.
