---
id: T-001-14
title: "Join by token"
type: backend
status: done
legacy: v0
risk: medium
depends_on:
  - T-001-06
  - T-001-10
files:
  - "src/server/join/open.ts"
  - "src/server/join/open.test.ts"
  - "src/app/api/v1/join/[token]/route.ts"
  - "src/app/api/v1/join/[token]/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /v1/join/{token}"
requirements:
  - F-001-9
  - F-001-10
  - F-001-11
  - F-001-39
  - N-001-15
  - N-001-17
  - N-001-18
  - N-001-20
acceptance_criteria:
  - "AC-1: GET with an unknown token returns 404; success attaches the plan to hp_link and uses the opening body shape"
  - "AC-2: When next is join, preview has title, organizer display name, timezone, windows, budget, and step names, and omits option labels, counts, threshold, statuses, starting points, and any itinerary"
  - "AC-3: The organizer receives next organizer or confirmed and is not inserted as a participant; an existing account or guest participant is returned without a second participant"
  - "AC-4: Anonymous join requires a display name of 1–40 characters after trim, asks for no password, and 201 sets or extends hp_guest; the same guest and plan return the existing participant; a new guest session creates a new participant even when the display name matches"
  - "AC-5: Account join requires hp_session, uses the account display name, returns 401 missing_session without a session, and returns an existing participant with 200 instead of creating another"
  - "AC-6: Locked, organizer, and full return 409 plan_locked, organizer_cannot_join, or plan_full and create no participant; POST without X-HP-Request: 1 returns 403 csrf and writes nothing"
  - "AC-7: A new participant receives a distinguisher from the contract alphabet, unique among participants and pending invitations on that plan"
  - "AC-8: Handler tests use Postgres from DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement join preview, anonymous join, and account join by token, including the guest cookie. The organizer does not become a participant. No extra files.
