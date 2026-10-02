---
id: T-001-11
title: "Home and create"
type: frontend
status: done
legacy: v0
risk: low
depends_on:
  - T-001-08
  - T-001-10
  - T-001-30
files:
  - "src/app/page.tsx"
  - "src/app/plans/new/page.tsx"
  - "src/components/home-list.tsx"
  - "src/components/home-list.test.tsx"
  - "src/components/create-form.tsx"
  - "src/components/create-form.test.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-4
  - F-001-12
  - F-001-13
  - F-001-14
  - F-001-37
  - N-001-4
  - N-001-14
  - N-001-15
acceptance_criteria:
  - "AC-1: Signed-out home shows a create action that uses bg-primary and opens the account gate and shows no plan rows; signed-in empty copy uses text-muted-foreground and is distinct from the error"
  - "AC-2: A home load failure uses text-destructive, offers retry, keeps create available, and does not show the empty-state sentence or another account's plan"
  - "AC-3: A loaded row shows the authored title, answered count, threshold, and one state; collecting, blocked, and proposed open the organizer plan; locked opens confirmed"
  - "AC-4: Create is one form in the order title, when, budget, steps, threshold; currency defaults to EGP; the timezone starts from the environment and stays editable; there is no venue search and no map"
  - "AC-5: An invalid submit creates no plan, identifies each invalid field, and keeps the entered values; a save failure keeps the entered values, uses text-destructive, and does not navigate"
  - "AC-6: A valid submit opens the new organizer plan in collecting with answered count 0"
  - "AC-7: A signed-out open of create is the account gate with next=/plans/new"
  - "AC-8: Switching language keeps unsaved create input"
  - "AC-9: Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Rebuild home and the one create form from design/pages/home.md and design/pages/create-plan.md with shadcn/ui per ADR-0002 and redesign-existing-projects. Same product outcomes. Call the plans routes. No extra files.
