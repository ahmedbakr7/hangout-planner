---
id: T-001-17
title: "Invitation inbox"
type: backend
status: done
legacy: v0
risk: low
depends_on:
  - T-001-16
files:
  - "src/app/api/v1/invitations/route.ts"
  - "src/app/api/v1/invitations/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/invitations"
requirements:
  - F-001-9
  - F-001-17
  - F-001-18
  - F-001-19
  - N-001-15
acceptance_criteria:
  - "AC-1: GET /v1/invitations returns this account's invitations, created_at descending, at most 100, one row per plan with plan_id, title, and organizer_display_name"
  - "AC-2: A second invite of the same account to the same plan does not add a second row"
  - "AC-3: Empty is invitations [] and truncated false, and another account's invitation is absent"
  - "AC-4: No account session returns 401 missing_session"
  - "AC-5: A failed read does not include another plan's people or places"
  - "AC-6: Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement the account invitation inbox, one row per plan. No extra files.
