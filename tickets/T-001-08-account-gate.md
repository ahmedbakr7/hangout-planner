---
id: T-001-08
title: "Account gate"
type: frontend
status: ready
risk: low
depends_on:
  - T-001-06
  - T-001-07
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
  - "Signed out, the gate says an account is required to organize, and when next is a join path it offers a way back to join without an account"
  - "A failed sign-in or failed registration stays on the gate, signed out, keeps entered non-secret values, creates no plan and no participant, and uses danger"
  - "After success the gate continues to create, join, home, or invitations; opening the gate while already signed in shows the display name and a way home"
  - "next accepts only /, /plans/new, /invitations, or /join/ plus a join token; any other value is ignored and success returns home"
  - "The language control updates hp_locale and keeps unsaved input in the surrounding form"
  - "A missing Arabic key renders the English string in an RTL layout and the gate stays usable"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Build the account gate outcomes in design/pages/account.md and the language control. Call the auth routes. No extra files.
