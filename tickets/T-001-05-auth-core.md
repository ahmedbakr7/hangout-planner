---
id: T-001-05
title: "Auth core"
type: backend
status: done
legacy: v0
risk: high
depends_on:
  - T-001-02
  - T-001-04
files:
  - "src/server/auth/password.ts"
  - "src/server/auth/password.test.ts"
  - "src/server/auth/session.ts"
  - "src/server/auth/session.test.ts"
  - "src/server/auth/authorize.ts"
  - "src/server/auth/authorize.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Authz"
requirements: []
acceptance_criteria:
  - "AC-1: Passwords are hashed with argon2id"
  - "AC-2: HP_HASH_TEST=1 is the only weaker argon2 setting, and tests are the only place it is set"
  - "AC-3: hp_session, hp_guest, and hp_link are httpOnly, SameSite=Lax, Path=/, with a 30-day sliding expiry, and Secure when HP_COOKIE_SECURE=1"
  - "AC-4: The database stores the SHA-256 of each cookie token, and this ticket does not hash the plan join token"
  - "AC-5: authorize returns the first match among organizer, participant, invited, and link reader, in that order, and no role for anyone else"
  - "AC-6: Tests cover those four roles and the no-role result"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement argon2id passwords, hashed session cookies, and authorize for organizer, participant, invited, and link reader. No HTTP routes and no extra files.
