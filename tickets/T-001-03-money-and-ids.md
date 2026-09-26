---
id: T-001-03
title: "Money and ids"
type: backend
status: done
risk: low
depends_on:
  - T-001-01
files:
  - "src/server/money.ts"
  - "src/server/money.test.ts"
  - "src/server/ids.ts"
  - "src/server/ids.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Identifiers, money, time, text"
requirements:
  - F-001-5
  - F-001-6
  - F-001-7
  - N-001-2
acceptance_criteria:
  - "Money amounts are integers in minor units, and amount_minor is rejected outside 1 through 100000000000"
  - "The currency list is EGP, USD, SAR, and AED, each with exponent 2"
  - "Ids are prefix_ plus 22 lowercase base32 characters, and the prefixes are acc_, pln_, win_, stp_, opt_, prt_, and inv_"
  - "A join token is jt_ plus 43 unpadded base64url characters"
  - "A distinguisher is four characters from abcdefghjkmnpqrstuvwxyz23456789"
  - "Tests are pure: no database and no network"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Implement minor-unit money, the four currencies, and the id and join-token shapes. No extra files.
