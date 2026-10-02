---
id: T-001-08
title: "Account gate"
type: frontend
status: done
risk: low
depends_on:
  - T-001-06
  - T-001-30
files:
  - "src/app/account/page.tsx"
  - "src/components/account-gate.tsx"
  - "src/components/account-gate.test.tsx"
  - "src/components/language-control.tsx"
  - "src/components/language-control.test.tsx"
  - "src/i18n/fallback.test.ts"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-1
  - F-001-2
  - F-001-4
  - F-001-9
  - N-001-1
  - N-001-3
  - N-001-15
acceptance_criteria:
  - "AC-1: Signed out, the gate says an account is required to organize, and when next is a join path it offers a way back to join without an account"
  - "AC-2: A failed sign-in or failed registration stays on the gate, signed out, keeps entered non-secret values, creates no plan and no participant, and uses text-destructive"
  - "AC-3: After success the gate continues to create, join, home, or invitations; opening the gate while already signed in shows the display name and a way home"
  - "AC-4: next accepts only /, /plans/new, /invitations, or /join/ plus a join token; any other value is ignored and success returns home"
  - "AC-5: The language control updates hp_locale and keeps unsaved input in the surrounding form"
  - "AC-6: A missing Arabic key renders the English string in an RTL layout and the gate stays usable"
  - "AC-7: Chrome is composed from shadcn/ui primitives, component files use design/DESIGN.md semantic classes and contain no raw hex, a primary action uses bg-primary while copy, save, swap, and retry stay secondary, and the work follows design-taste-frontend, redesign-existing-projects, and vercel-react-best-practices without new product features"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Rebuild the account gate and the language control from design/pages/account.md with shadcn/ui per ADR-0002 and redesign-existing-projects. Same product outcomes. Call the auth routes. No extra files.
