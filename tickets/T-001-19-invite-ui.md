---
id: T-001-19
title: "Invite UI"
type: frontend
status: done
risk: low
depends_on:
  - T-001-12
  - T-001-16
  - T-001-17
  - T-001-30
files:
  - "src/app/plans/[planId]/invite/page.tsx"
  - "src/app/invitations/page.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/invite-panel.test.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}/invite"
requirements:
  - F-001-4
  - F-001-16
  - F-001-17
  - F-001-18
  - F-001-19
  - N-001-15
  - N-001-19
acceptance_criteria:
  - "AC-1: The invite surface shows the share-link text and a copy control; when copy fails the link text stays visible"
  - "AC-2: There is one email field and no friend list, suggested people, or past co-planners"
  - "AC-3: The sent list shows each invited account once, with display name and status invited, joined, or answered; an empty list uses text-muted-foreground"
  - "AC-4: A failed identification or failed send uses text-destructive, leaves the answered count unchanged, adds no row, and leaves the link section usable"
  - "AC-5: While locked this surface is absent"
  - "AC-6: Switching language keeps unsaved invite input"
  - "AC-7: The invitations page shows one row per plan with the authored title and the organizer display name, and opening a row follows that plan's opening next"
  - "AC-8: A load failure uses text-destructive and retry and omits another plan's link, title, or people"
  - "AC-9: Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Build the invite surface and the invitation inbox from design/pages/invite.md and design/pages/invitations.md with shadcn/ui per ADR-0002 and design/DESIGN.md. Same product outcomes. Copy failure leaves the link text. No extra files.
