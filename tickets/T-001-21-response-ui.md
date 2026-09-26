---
id: T-001-21
title: "Response UI"
type: frontend
status: ready
risk: low
depends_on:
  - T-001-18
  - T-001-20
  - T-001-30
files:
  - "src/app/plans/[planId]/respond/page.tsx"
  - "src/components/response-form.tsx"
  - "src/components/response-form.test.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}/response"
requirements:
  - F-001-4
  - F-001-20
  - F-001-21
  - F-001-22
  - F-001-23
  - N-001-6
  - N-001-7
  - N-001-15
acceptance_criteria:
  - "The surface shows the plan budget with currency, every day window, every step name, and every option label as authored, and the starting-point control is labeled approximate"
  - "Answered count, threshold, other participants, and other starting points are absent, and no map is shown"
  - "Confirming a search result shows that place's name; an incomplete save and a complete save both keep the fields editable while collecting or blocked"
  - "A save failure keeps the entered values and the previous answered count and uses text-destructive; a save that misses a valid window, a start, or one label on a step stays incomplete and identifies those fields"
  - "While proposed this open shows the proposal surface, and while locked it shows the confirmed surface"
  - "Switching language keeps unsaved response input"
  - "A failed open uses text-destructive for this plan and omits another plan's title, people, and places"
  - "Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Build the response surface from design/pages/respond.md with shadcn/ui per ADR-0002 and design/DESIGN.md, including search confirm and incomplete and complete saves. Same product outcomes. No extra files.
