---
id: T-001-06
title: "Auth HTTP"
type: backend
status: done
risk: high
depends_on:
  - T-001-05
files:
  - "src/app/api/v1/accounts/route.ts"
  - "src/app/api/v1/accounts/route.test.ts"
  - "src/app/api/v1/sessions/route.ts"
  - "src/app/api/v1/sessions/route.test.ts"
  - "src/app/api/v1/me/route.ts"
  - "src/app/api/v1/me/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#POST /v1/accounts"
requirements:
  - F-001-9
  - N-001-3
  - N-001-15
acceptance_criteria:
  - "POST /v1/accounts returns 201 with the account object and sets hp_session; 409 email_taken and 400 invalid fields create no account and set no cookie"
  - "Email is trimmed and lowercased; password length is 8–72 characters and is not trimmed; display name is 1–40 characters after trim"
  - "POST /v1/sessions returns 200 with the same account object and sets hp_session; unknown email and wrong password are both 401 bad_credentials with the same envelope message and set no cookie"
  - "DELETE /v1/sessions returns 204, clears hp_session, and is idempotent when already signed out"
  - "GET /v1/me returns 200 with the account for a session, and 401 missing_session otherwise, including a guest-only browser"
  - "POST and DELETE without X-HP-Request: 1 return 403 csrf and write nothing"
  - "These payloads are the only ones that include the caller email, and a 404 body is the envelope only"
  - "Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement register, sign-in, sign-out, and me on the contracted routes. Same failure text for an unknown email and a bad password. No extra files.
