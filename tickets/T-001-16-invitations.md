---
id: T-001-16
title: "Invitations"
type: backend
status: done
legacy: v0
risk: low
depends_on:
  - T-001-06
  - T-001-10
files:
  - "src/server/invites/send.ts"
  - "src/server/invites/send.test.ts"
  - "src/app/api/v1/plans/[planId]/invitations/route.ts"
  - "src/app/api/v1/plans/[planId]/invitations/route.test.ts"
  - "src/app/api/v1/plans/[planId]/invite/route.ts"
  - "src/app/api/v1/plans/[planId]/invite/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#POST /api/v1/plans/{planId}/invitations"
requirements:
  - F-001-9
  - F-001-16
  - F-001-17
  - F-001-18
  - F-001-19
  - N-001-15
acceptance_criteria:
  - "AC-1: GET invite returns a join_path that stays the same for the life of the plan, and one row per account in created_at order with display_name, distinguisher, and status invited, joined, or answered"
  - "AC-2: POST matches an existing account email after trim and lowercase, creates the invitation when missing, reuses the participant distinguisher when that account already joined, and does not change answered_count"
  - "AC-3: Unknown email returns 404 account_not_found and adds no row; an invalid email returns 400 and adds no row; the organizer email returns 409 cannot_invite_self and adds no row"
  - "AC-4: Sending again does not add a second row"
  - "AC-5: Locked returns 409 plan_locked and adds no row"
  - "AC-6: A stranger gets 404 with the envelope only; a participant, invited account, or link reader gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing"
  - "AC-7: Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement the organizer invite read and email invite. Unknown email and self-invite add no row. No extra files.
