---
id: T-001-04
title: "Errors and clock"
type: backend
status: done
legacy: v0
risk: low
depends_on:
  - T-001-01
files:
  - "src/server/http/errors.ts"
  - "src/server/http/errors.test.ts"
  - "src/server/clock.ts"
  - "src/server/clock.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Error envelope"
requirements: []
acceptance_criteria:
  - "AC-1: The helper builds the error envelope with code, message, and fields, and fields is always an array"
  - "AC-2: reason is omitted when the code is enough, and message is log text rather than product chrome"
  - "AC-3: The helper only emits 400, 401, 403, 404, 409, 429, and 503"
  - "AC-4: src/server/clock.ts is the clock, and tests can replace it"
  - "AC-5: Tests are pure: no database and no network"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Add the error envelope helper and a replaceable clock. No extra files.
