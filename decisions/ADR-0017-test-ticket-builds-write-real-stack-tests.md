---
id: ADR-0017
title: A type test ticket's build writes the real-stack tests
status: accepted
---

# ADR-0017: A `type: test` ticket's build writes the real-stack tests

- Status: accepted
- Date: 2026-10-27
- Source: lead. On 2026-10-27 the lead approved this change ("Go" on the list that named it).
- Supersedes: none
- Amends: the "Testing" line of the Lock in `skills/frontend-patterns/SKILL.md` and in `skills/backend-patterns/SKILL.md`. A Lock line changes only by an ADR.

## Context

Each Lock says real-stack tests are the test agent's. The frontend Lock reads "e2e is the test agent's. Build does not add e2e." The backend Lock reads "e2e belongs to the test agent."

The lines predate `type: test` tickets. Since kit v2.0.0 (roadmap item 1, pilot finding 19), a `type: test` ticket has no test play. Its build writes the integration and e2e files and runs those suites. The kit's ticketize skill, item 8, says so.

The product has used this path since T-001-66. T-001-86..90 (#190–#194) used it to give every shipped ticket real-stack proof, as the kit session advised on 2026-10-26.

PR #195 added rulebook rows for this path. Those rows read the Lock as covering only feature tickets. The two reviews of #195 noted that this reading is not in the Lock itself, so a reader of the Lock alone would think the path is forbidden.

## Decision

- Frontend Lock, "Testing": component tests sit next to the file (`*.test.tsx`) on Vitest. Real-stack tests (`e2e/`, `browser/`) are written by the test play or by a `type: test` ticket's build. A feature ticket's build does not add them.
- Backend Lock, "Testing": the closing sentence becomes "Real-stack tests (`e2e/`) are written by the test play or by a `type: test` ticket's build; a feature ticket's build does not add them."
- The rulebook rows from #195 drop their reading of the Lock and point to this ADR.

## Consequences

- Nothing that already ran changes. T-001-66 and T-001-86..90 followed this rule before it was written down.
- A feature ticket still cannot write `e2e/` or `browser/` in its build. The kit's scope check enforces that, not this text.
- A test helper that more than one test file shares still needs a ticket that lists it under `test_files` (ADR-0016).
