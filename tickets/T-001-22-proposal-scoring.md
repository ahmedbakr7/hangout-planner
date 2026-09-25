---
id: T-001-22
title: "Proposal scoring"
type: backend
status: ready
risk: high
depends_on:
  - T-001-03
files:
  - "src/server/proposal/time.ts"
  - "src/server/proposal/time.test.ts"
  - "src/server/proposal/fairness.ts"
  - "src/server/proposal/fairness.test.ts"
  - "src/server/proposal/rank.ts"
  - "src/server/proposal/rank.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Time"
requirements: []
acceptance_criteria:
  - "A window 18:00–19:00 yields 18:00, 18:15, 18:30, and 18:45; a member free 18:00–18:30 and a member free 18:30–19:00 both cover 18:30; that instant is the unique maximum coverage of 2 and is the chosen time; a busy member adds no instant"
  - "Coverage 0 is time-blocked and stores no clock time"
  - "Trips of 600, 720, and 2400 seconds turn the fairness warning on, with median 720; trips of 600 and 720 turn it off, with median (600 + 720 + 1) // 2 = 660"
  - "Rank orders a fair chain ahead of a shorter unfair chain; among fair chains it picks the smallest sum of between-place durations, then the lexicographically smallest place-id sequence"
  - "If every chain is unfair, rank picks the smallest (max trip minus median), then the same place-id tie-break, and sets the fairness warning"
  - "Tests are pure: no database and no network, and they use the integer rules rather than floating comparisons"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement the worked time grid, the worked fairness numbers, and chain rank as unit tests against the contract. No Google calls and no extra files.
