---
id: T-001-34
title: "Response form and organizer plan refetch the plan on 409 attempt_in_progress"
type: frontend
status: ready
risk: medium
depends_on: [T-001-33]
files:
  - "src/components/response-form.tsx"
  - "src/components/response-form.test.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Proposal attempt"
requirements:
  - F-001-25
acceptance_criteria:
  - "AC-1: when PUT /api/v1/plans/{planId}/response returns 409 attempt_in_progress, the response form shows no save error and requests GET /api/v1/plans/{planId}/response again, then shows the refetched response"
  - "AC-2: when PATCH /api/v1/plans/{planId} returns 409 attempt_in_progress, the organizer plan shows no save error and requests GET /api/v1/plans/{planId} again, then shows the refetched plan"
  - "AC-3: any other 409 reason on those two writes keeps today's behavior: plan_locked and the closed-plan reasons still redirect, and the rest still show the save error"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0004-attempt-lock-fail-fast.md
---

A `PUT` response or `PATCH` plan that triggers a proposal attempt can get 409 `attempt_in_progress` when another trigger holds the attempt lock (ADR-0004). The write has already committed, so CONTRACTS § Proposal attempt says the client refetches the plan. Today `src/components/response-form.tsx` (the `PUT` handler) and `src/components/organizer-plan.tsx` (the `PATCH` handler) show a generic save error instead.

On that one reason, reload with the component's existing load function (`loadResponse` in the response form, `loadPlan` in the organizer plan) instead of setting the save error. Do not retry the write. Do not change any other status or reason. Unit tests stub fetch by URL, return 409 `attempt_in_progress` for the write, and assert the second GET and the refetched content. The test play proves AC-1 through the real route handlers (`e2e/`) with a held attempt lock.
