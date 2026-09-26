---
id: T-001-12
title: "Organizer plan"
type: frontend
status: in_review
risk: low
depends_on:
  - T-001-11
files:
  - "src/app/plans/[planId]/page.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}"
requirements:
  - F-001-15
  - F-001-24
  - F-001-27
  - N-001-5
  - N-001-13
  - N-001-15
acceptance_criteria:
  - "The page shows answered count, in-progress count, threshold, and each participant display name with status in progress or answered"
  - "The distinguisher is shown only when another row in that list has the same display name, and the list has no starting points and no step picks"
  - "While collecting there is no itinerary, and the waiting copy uses text-muted"
  - "While blocked or proposed the same counts remain and there is a way to the proposal surface; the itinerary is not duplicated on this page"
  - "Edit controls follow editable for the current state, budget shows the currency, and a rejected edit leaves the stored value and says the field can no longer be changed"
  - "An invite action is present while collecting, blocked, or proposed"
  - "A locked open shows the confirmed surface instead of this page"
  - "A load failure uses danger and retry and omits any other plan's title, people, and places"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Build the organizer plan surface from design/pages/plan.md. Locked open is not this page. No extra files.
