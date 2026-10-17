---
id: T-001-59
title: "Tests: e2e afterEach tears down before asserting every request was served"
type: test
status: ready
risk: low
depends_on: [T-001-50, T-001-51, T-001-54, T-001-55]
files:
  - "e2e/teardown.ts"
  - "e2e/teardown.e2e.ts"
  - "e2e/confirmed-landing.e2e.ts"
  - "e2e/invitations-plan-path.e2e.ts"
  - "e2e/plan-paths.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: when the unserved list passed to teardownThenAssertServed is not empty, every teardown step passed with it still runs, and teardownThenAssertServed then throws an error that names the unserved requests"
  - "AC-2: when a teardown step throws, the remaining steps still run and teardownThenAssertServed throws that first error"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Follow-up from CodeRabbit on #126. This ticket is test-only. It changes no product code.

Three `e2e/` files start their `afterEach` with `expect(server.unserved).toEqual([])` and only then call `cleanup()`, `vi.unstubAllGlobals()`, and reset `process.env.HP_HASH_TEST` and the cookie jar: `e2e/confirmed-landing.e2e.ts`, `e2e/invitations-plan-path.e2e.ts` and `e2e/plan-paths.e2e.ts`. When the assertion fails, the teardown never runs, so rendered trees, stubs and environment leak into the next test, and later tests fail for an unrelated reason. The other `e2e/` files tear down first and are not part of this ticket.

- **`e2e/teardown.ts`:** export `teardownThenAssertServed(unserved: readonly string[], ...steps: Array<() => void>): void`.
  - It copies `unserved` first.
  - It then runs every step, each in its own `try`, whatever happened.
  - It throws the first step error if there was one. Otherwise, if the copy is not empty, it throws an `Error` whose message lists the unserved requests.
  - It imports nothing from `src/`. Model it on `e2e/db-cleanup.ts` (T-001-54).
- **`e2e/teardown.e2e.ts`:** tests tagged `T-001-59/AC-1` and `T-001-59/AC-2`, using fakes that record calls. No database is needed. Model them on `e2e/db-cleanup.e2e.ts`.
- **The three files:** each `afterEach` becomes one `teardownThenAssertServed(server.unserved, ...)` call, with the existing teardown lines as the steps, in their current order. Keep a comment line where one exists. Change nothing else in those files.
- No assertion is weakened and no test is skipped.

- `e2e/teardown.ts` is a helper, not a test, like `e2e/db-cleanup.ts`. `e2e/**` is in the kit's test globs, so a `type: test` ticket may write it.
- **Requirement:** N-001-15 is cited as T-001-54 cited it; the citation does not claim this ticket proves it.

**Agent:** build with `builder`, as T-001-54 was.
