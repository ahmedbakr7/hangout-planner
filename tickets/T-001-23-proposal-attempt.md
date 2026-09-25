---
id: T-001-23
title: "Proposal attempt"
type: backend
status: ready
risk: high
depends_on:
  - T-001-13
  - T-001-22
files:
  - "src/server/proposal/attempt.ts"
  - "src/server/proposal/attempt.test.ts"
  - "src/app/api/v1/plans/[planId]/proposal/route.ts"
  - "src/app/api/v1/plans/[planId]/proposal/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Proposal attempt"
requirements:
  - F-001-5
  - F-001-6
  - F-001-7
  - F-001-8
  - F-001-9
  - F-001-25
  - F-001-26
  - F-001-28
  - F-001-29
  - F-001-30
  - F-001-31
  - F-001-32
  - F-001-33
  - F-001-38
  - F-001-40
  - N-001-2
  - N-001-8
  - N-001-9
  - N-001-10
  - N-001-15
acceptance_criteria:
  - "runProposalAttempt writes proposed for a full chain, or blocked otherwise, and on a proposal stores the cohort and the pool"
  - "A place with only priceLevel, or a price in another currency, or an amount outside 1 through the plan budget, is dropped; amount_minor uses the integer startPrice rule"
  - "A duration under 1 second is not stored; a full proposal has one leg between each consecutive pair with duration_seconds at least 1"
  - "An empty cohort stores no proposal and finishes blocked with time true, budget false, venue_data false, and no Google calls"
  - "GET proposal returns the organizer and participant shapes from the contract: alternatives, like_count, and dislike_count are organizer-only; a cohort member gets my_signal and no alternatives or counts; a non-cohort participant gets the itinerary without alternatives, counts, or my_signal"
  - "A participant while collecting or blocked gets 409 not_proposed; locked is 409 plan_locked; a stranger gets 404 with the envelope only"
  - "HP_PROPOSAL_ENABLED=0 skips Google and finishes as venue_data with the other two flags false for the parts that did not finish"
  - "Tests use Postgres where the route needs it, and fakes only; they do not call places.googleapis.com or routes.googleapis.com"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement runProposalAttempt and the proposal read. It writes proposed or blocked, drops prices the filter cannot use, and stores the cohort and the pool. The three triggers are a later ticket. No extra files.
