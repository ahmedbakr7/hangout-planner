---
id: T-001-12
title: "Organizer plan"
type: frontend
status: done
legacy: v0
risk: low
depends_on:
  - T-001-11
  - T-001-30
files:
  - "src/app/plans/[planId]/page.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}"
requirements:
  - F-001-15
  - F-001-24
  - F-001-27
  - N-001-5
  - N-001-13
  - N-001-15
acceptance_criteria:
  - "AC-1: The page shows answered count, in-progress count, threshold, and each participant display name with status in progress or answered"
  - "AC-2: The distinguisher is shown only when another row in that list has the same display name, and the list has no starting points and no step picks"
  - "AC-3: While collecting there is no itinerary, and the waiting copy uses text-muted-foreground"
  - "AC-4: While blocked or proposed the same counts remain and there is a way to the proposal surface; the itinerary is not duplicated on this page"
  - "AC-5: Edit controls follow editable for the current state, budget shows the currency, and a rejected edit leaves the stored value and says the field can no longer be changed"
  - "AC-6: An invite action is present while collecting, blocked, or proposed"
  - "AC-7: A locked open shows the confirmed surface instead of this page"
  - "AC-8: A load failure uses text-destructive and retry and omits any other plan's title, people, and places"
  - "AC-9: Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Rebuild the organizer plan surface from design/pages/plan.md with shadcn/ui per ADR-0002 and redesign-existing-projects. Same product outcomes. Locked open is not this page. No extra files.
