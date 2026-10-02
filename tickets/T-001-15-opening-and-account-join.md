---
id: T-001-15
title: "Opening and account join"
type: backend
status: done
risk: medium
depends_on:
  - T-001-14
files:
  - "src/app/api/v1/plans/[planId]/opening/route.ts"
  - "src/app/api/v1/plans/[planId]/opening/route.test.ts"
  - "src/app/api/v1/plans/[planId]/join/route.ts"
  - "src/app/api/v1/plans/[planId]/join/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/plans/{planId}/opening"
requirements:
  - F-001-9
  - F-001-10
  - F-001-11
  - F-001-36
  - N-001-15
  - N-001-17
  - N-001-18
  - N-001-20
acceptance_criteria:
  - "AC-1: GET opening returns next organizer, respond, proposal, confirmed, or join according to the caller and state table, and preview is the join preview only when next is join"
  - "AC-2: An invited account who is not a participant gets next join while the plan is not locked and next confirmed while locked"
  - "AC-3: POST /v1/plans/{planId}/join accepts kind account only, uses the account display name, and does not return the join token"
  - "AC-4: An invited account who is not yet a participant gets 201; an account that is already a participant gets 200 and that same participant"
  - "AC-5: Locked, organizer, and full use the same 409s as token join and create no participant"
  - "AC-6: A stranger gets 404 with the envelope only; missing X-HP-Request: 1 on POST returns 403 csrf and writes nothing"
  - "AC-7: Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement the opening next table and in-app account join. This route does not reveal the join token. No extra files.
