---
id: T-001-10
title: "Plans HTTP"
type: backend
status: done
risk: medium
depends_on:
  - T-001-06
  - T-001-09
files:
  - "src/app/api/v1/currencies/route.ts"
  - "src/app/api/v1/currencies/route.test.ts"
  - "src/app/api/v1/plans/route.ts"
  - "src/app/api/v1/plans/route.test.ts"
  - "src/app/api/v1/plans/[planId]/route.ts"
  - "src/app/api/v1/plans/[planId]/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#POST /v1/plans"
requirements:
  - F-001-3
  - F-001-5
  - F-001-6
  - F-001-7
  - F-001-9
  - F-001-12
  - F-001-13
  - F-001-14
  - F-001-15
  - F-001-24
  - F-001-27
  - F-001-37
  - N-001-2
  - N-001-4
  - N-001-5
  - N-001-13
  - N-001-14
  - N-001-15
acceptance_criteria:
  - "GET /v1/currencies returns EGP, USD, SAR, and AED, each exponent 2, for an account"
  - "POST /v1/plans creates a collecting plan with answered_count 0 and a new join token, the caller is the organizer and not a participant, and 201 returns the organizer plan plus join_path; 400 names each invalid field and writes no row"
  - "GET /v1/plans returns only plans this account organizes, updated_at descending, at most 100, and empty is plans [] with truncated false"
  - "GET /v1/plans/{planId} returns the organizer document with editable, counts, and participants in created_at then id order, and includes no starting points, step picks, or itinerary; a participant, invited account, or link reader gets 403 organizer_only; a stranger gets 404; locked gets 409 plan_locked"
  - "PATCH applies a legal subset and returns the organizer plan; a frozen or illegal edit returns 409 field_frozen and writes nothing; PATCH while locked returns 409 plan_locked and writes nothing; stored title, step names, option labels, and display names come back as entered"
  - "This ticket does not call runProposalAttempt"
  - "Missing X-HP-Request: 1 on POST and PATCH returns 403 csrf and writes nothing; a 404 body is the envelope only"
  - "Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement currency list, create, home list, organizer get, and patch. Invalid create writes nothing. Leave the proposal-attempt call for the attempt-triggers ticket. No extra files.
