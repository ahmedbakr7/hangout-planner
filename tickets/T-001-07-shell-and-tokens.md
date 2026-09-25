---
id: T-001-07
title: "Shell and tokens"
type: frontend
status: ready
risk: low
depends_on:
  - T-001-01
files:
  - "src/app/layout.tsx"
  - "src/app/tokens.css"
  - "src/app/globals.css"
  - "messages/en.json"
  - "messages/ar.json"
  - "src/i18n/request.ts"
  - "next.config.ts"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-1
  - F-001-2
  - N-001-1
acceptance_criteria:
  - "src/app/tokens.css defines the color, space, type, and radius token values from design/DESIGN.md, and hex and raw spacing appear only in that file"
  - "Components and globals use those token names, logical CSS properties, and an outline focus ring"
  - "dir and lang on html follow the hp_locale cookie: ar is rtl and en is ltr"
  - "Locale is that cookie, not a URL prefix, and next.config.ts is edited only to add next-intl"
  - "messages/en.json and messages/ar.json hold chrome strings for the slice surfaces"
  - "A missing Arabic chrome key resolves to the English string while dir stays rtl"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Add the app shell, DESIGN.md tokens, and next-intl catalogs. The next.config.ts edit is the next-intl wiring this cut names. No extra files.
