---
id: T-001-26
title: "Lock and confirmed"
type: backend
status: done
legacy: v0
risk: medium
depends_on:
  - T-001-25
files:
  - "src/app/api/v1/plans/[planId]/lock/route.ts"
  - "src/app/api/v1/plans/[planId]/lock/route.test.ts"
  - "src/app/api/v1/plans/[planId]/confirmed/route.ts"
  - "src/app/api/v1/plans/[planId]/confirmed/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#POST /v1/plans/{planId}/lock"
requirements:
  - F-001-9
  - F-001-34
  - F-001-35
  - N-001-11
  - N-001-12
  - N-001-15
acceptance_criteria:
  - "AC-1: POST lock from proposed returns 200 with the confirmed document and sets state locked"
  - "AC-2: collecting and blocked return 409 not_proposed; already locked returns 409 plan_locked; there is no unlock route"
  - "AC-3: GET confirmed allows the organizer, a participant, an invited account, or a link reader; when the plan is not locked those callers get 409 not_locked and anyone else gets 404"
  - "AC-4: The confirmed document includes plan_id, title, state locked, time, steps with place name and amount, legs, and cohort display names, and omits option labels, signals, starting points, budget editing, threshold, and invite send"
  - "AC-5: A stranger gets 404 with the envelope only; a participant gets 403 organizer_only on lock; missing X-HP-Request: 1 on POST returns 403 csrf and writes nothing"
  - "AC-6: Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement lock from proposed and the confirmed read. There is no unlock route. Later writes of response, swap, signal, or structure get plan_locked from the routes that own those writes and leave this outing in place. No extra files.
