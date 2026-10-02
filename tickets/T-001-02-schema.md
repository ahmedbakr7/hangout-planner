---
id: T-001-02
title: "Schema migration"
type: backend
status: done
risk: low
depends_on:
  - T-001-01
files:
  - "src/server/db/schema.ts"
  - "src/server/db/schema.test.ts"
  - "drizzle/0001_init.sql"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Tables"
requirements: []
acceptance_criteria:
  - "AC-1: drizzle/0001_init.sql creates every table and column named in arch/CONTRACTS.md Tables, including the partial unique on participants (plan_id, account_id), the unique (plan_id, account_id) on invitations, and exactly one of account_id and guest_session_id on participants"
  - "AC-2: The migration creates no table that arch/CONTRACTS.md does not name"
  - "AC-3: schema.test.ts applies the migration on Postgres from DATABASE_URL"
  - "AC-4: There is no down migration"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Add the forward-only init migration and the Drizzle schema for the CONTRACTS tables. No extra tables and no extra files.
