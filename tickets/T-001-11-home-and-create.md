---
id: T-001-11
title: "Home and create"
type: frontend
status: ready
risk: low
depends_on:
  - T-001-08
  - T-001-10
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
  - "Signed-out home shows a create action that opens the account gate and shows no plan rows; signed-in empty copy uses text-muted and is distinct from the error"
  - "A home load failure uses danger, offers retry, keeps create available, and does not show the empty-state sentence or another account's plan"
  - "A loaded row shows the authored title, answered count, threshold, and one state; collecting, blocked, and proposed open the organizer plan; locked opens confirmed"
  - "Create is one form in the order title, when, budget, steps, threshold; currency defaults to EGP; the timezone starts from the environment and stays editable; there is no venue search and no map"
  - "An invalid submit creates no plan, identifies each invalid field, and keeps the entered values; a save failure keeps the entered values, uses danger, and does not navigate"
  - "A valid submit opens the new organizer plan in collecting with answered count 0"
  - "A signed-out open of create is the account gate with next=/plans/new"
  - "Switching language keeps unsaved create input"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Build home and the one create form from design/pages/home.md and design/pages/create-plan.md. Call the plans routes. No extra files.
