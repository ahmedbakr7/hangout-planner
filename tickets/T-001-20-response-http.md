---
id: T-001-20
title: "Response HTTP"
type: backend
status: done
risk: medium
depends_on:
  - T-001-13
  - T-001-14
files:
  - "src/server/response/save.ts"
  - "src/server/response/save.test.ts"
  - "src/app/api/v1/plans/[planId]/response/route.ts"
  - "src/app/api/v1/plans/[planId]/response/route.test.ts"
  - "src/app/api/v1/plans/[planId]/place-searches/route.ts"
  - "src/app/api/v1/plans/[planId]/place-searches/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#PUT /v1/plans/{planId}/response"
requirements:
  - F-001-3
  - F-001-9
  - F-001-20
  - F-001-21
  - F-001-22
  - F-001-23
  - N-001-6
  - N-001-7
  - N-001-15
acceptance_criteria:
  - "AC-1: An incomplete valid save by an incomplete caller returns 200 complete false and leaves answered_count unchanged; the first complete save returns 200 complete true, first_completion true, and increments answered_count by one in the same transaction as the write"
  - "AC-2: A later complete valid save returns first_completion false, replaces the stored answers, and does not increment the count; an incomplete or invalid body from a complete caller returns 400 and leaves the stored complete response"
  - "AC-3: An invalid window or pick returns 400 and writes nothing; a complete response requires every window, a stored start, and exactly one pick per step"
  - "AC-4: A present start_place_id is resolved with Place Details; the server stores the place id, display name, latitude, and longitude; response JSON includes the start name only and omits coordinates and place id; a Details failure is 503 upstream and writes nothing"
  - "AC-5: GET and PUT while proposed return 409 responses_closed, and while locked return 409 plan_locked; the payload has no answered count, threshold, other participants, or other starting points; title, labels, and the start name are returned as stored"
  - "AC-6: Place search requires q of 1–80 characters after trim, returns at most 5 results with no coordinates and no prices, returns 429 after 30 calls per participant per rolling hour, and returns 503 upstream on Google failure"
  - "AC-7: This ticket does not call runProposalAttempt, so a completing save leaves plan_state unchanged"
  - "AC-8: A stranger gets 404 with the envelope only; missing X-HP-Request: 1 on PUT returns 403 csrf and writes nothing; handler tests use Postgres and the fake Google clients"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Store draft and complete responses and the start search. The answered count increments once. Do not call runProposalAttempt. No extra files.
