---
id: T-001-28
title: "Confirmed UI"
type: frontend
status: done
risk: low
depends_on:
  - T-001-26
  - T-001-27
  - T-001-30
files:
  - "src/app/plans/[planId]/confirmed/page.tsx"
  - "src/components/confirmed-view.tsx"
  - "src/components/confirmed-view.test.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}/confirmed"
requirements:
  - F-001-34
  - F-001-35
  - F-001-36
  - F-001-41
  - N-001-11
  - N-001-12
  - N-001-15
  - N-001-16
acceptance_criteria:
  - "AC-1: Before lock this surface is absent, and opening it shows the current surface for that person and state"
  - "AC-2: The loaded outing shows state locked, the authored title, the time with the timezone, each step's place name and per-person amount with currency, the travel duration between consecutive places, and the cohort display names"
  - "AC-3: The distinguisher is shown only when cohort names collide"
  - "AC-4: The surface has no unlock, no signals, no starting points, no option labels, no swap, no response fields, no budget editing, no threshold, and no invite send"
  - "AC-5: The share link and an invitations row for a locked plan land on this surface"
  - "AC-6: Chrome may name Google Places and Google Maps routing, and there is no map image and no native-app install step"
  - "AC-7: A load failure uses text-destructive and retry and omits another plan's title and places"
  - "AC-8: Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Build the confirmed outing from design/pages/confirmed.md with shadcn/ui per ADR-0002 and design/DESIGN.md. Same product outcomes. No unlock, no signals, and no starting points. No extra files.
