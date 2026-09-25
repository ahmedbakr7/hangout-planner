---
id: T-001-18
title: "Join UI"
type: frontend
status: ready
risk: low
depends_on:
  - T-001-08
  - T-001-14
  - T-001-15
files:
  - "src/app/join/[token]/page.tsx"
  - "src/app/plans/[planId]/join/page.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/join-panel.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/join/{token}"
requirements:
  - F-001-10
  - F-001-11
  - N-001-15
  - N-001-17
  - N-001-18
  - N-001-20
acceptance_criteria:
  - "The preview shows the authored title, organizer display name, timezone, day windows, per-person budget with currency, and step names"
  - "Option labels, answered count, threshold, other people's statuses, starting points, and any itinerary are absent"
  - "Two actions are offered: join with an account, and join without an account; the without-account path shows a display name field and no password field"
  - "An unknown link uses danger and shows no other plan's title and no participant list; a failed account join stays here and still is not a participant; an empty display name is identified and creates no participant"
  - "While locked this surface is absent and the open shows the confirmed surface"
  - "A direct hit on the wrong path for this plan redirects to next"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Build the share-link and in-app join surfaces from design/pages/join.md. No counts and no password on the anonymous path. No extra files.
