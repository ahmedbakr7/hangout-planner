---
id: T-001-13
title: "Google clients"
type: backend
status: done
legacy: v0
risk: medium
depends_on:
  - T-001-04
files:
  - "src/server/google/places.ts"
  - "src/server/google/places.test.ts"
  - "src/server/google/routes.ts"
  - "src/server/google/routes.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#External Google"
requirements: []
acceptance_criteria:
  - "AC-1: Places calls send X-Goog-Api-Key and the contracted field masks, never a wildcard; start search and start details omit priceRange; the venue mask includes places.priceRange"
  - "AC-2: Tests parse priceRange.startPrice as amount_minor = units * 100 + nanos / 10000000 with exact integer division, and a place that only has priceLevel does not qualify"
  - "AC-3: The Routes client calls computeRouteMatrix with travelMode DRIVE, routingPreference TRAFFIC_UNAWARE, and field mask originIndex,destinationIndex,status,condition,duration"
  - "AC-4: Tests use fakes only and do not call places.googleapis.com or routes.googleapis.com"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Add the Places and Routes clients behind the contracted masks. Fakes only. No extra files.
