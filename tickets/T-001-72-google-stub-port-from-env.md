---
id: T-001-72
title: "Tests: the Google stub script reads its port from HP_E2E_GOOGLE_STUB_PORT"
type: test
status: ready
risk: low
depends_on: [T-001-61]
files:
  - "browser/google-stub.mjs"
  - "e2e/google-stub.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - F-001-23
  - F-001-26
acceptance_criteria:
  - "AC-1: node browser/google-stub.mjs, run with HP_E2E_GOOGLE_STUB_PORT set to a free port P, listens on 127.0.0.1:P and answers a POST /v1/places:searchText that carries X-Goog-Api-Key and a field mask other than * with 200"
  - "AC-2: with HP_E2E_GOOGLE_STUB_PORT unset or empty, the stub's script port is 3125"
  - "AC-3: node browser/google-stub.mjs, run with HP_E2E_GOOGLE_STUB_PORT set to a value that is not a decimal integer from 1 to 65535 (abc, 0, 65536, 3125x, 03125), exits non-zero with a stderr message naming HP_E2E_GOOGLE_STUB_PORT, and listens on no port"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0012-browser-test-ports-from-env.md
---

This is the first half of ADR-0012, which lets two browser runs share one machine. It is split from T-001-73 because only the test play may write `browser/**` (`integration_globs`), as T-001-63 was split from T-001-62. It changes no product code. `startGoogleStub(port)` and every T-001-61 behaviour stay as they are.

- **`browser/google-stub.mjs`:**
  - Replace `const SCRIPT_PORT = 3125` with an exported `scriptPort()` that reads `HP_E2E_GOOGLE_STUB_PORT` each time it is called.
  - Copy the rule in `src/server/google/origin.ts`. Unset or empty gives the default, `3125`. Otherwise the value must match `^[1-9][0-9]{0,4}$` and be at most 65535. Anything else throws an `Error` whose message names the variable. The value is never silently ignored or rewritten.
  - The script entry (the `import.meta.url === process.argv[1]` block) calls `startGoogleStub(scriptPort())`. A throw there ends the process with a non-zero exit and the message on stderr. Use Node's default unhandled-rejection exit for this. Do not add a logger: the stub "logs nothing" (T-001-61).
  - The module still imports only `node:http`. It still reads no other variable.
- **`e2e/google-stub.e2e.ts`:** add tests tagged `T-001-72/AC-1` to `AC-3`. Keep the T-001-61 tests as they are.
  - AC-1 and AC-3 spawn the script with `node:child_process` `spawn`, as `e2e/browser-config.e2e.ts` does (async, so the worker heartbeat is not starved).
  - For AC-1, get a free port by listening on `0`, reading the port and closing. Then spawn with the variable set, retry a request to that port until it answers or 5 s pass, and kill the child in `finally`.
  - For AC-3, use each listed value. Expect exit status ≠ 0 and the variable name in stderr.
  - AC-2 calls `scriptPort()` with `vi.stubEnv` set to unset and to `""` (copy the `beforeEach`/`afterEach` stubbing already in this file). **It never binds 3125**, because another run on the machine may hold that port, which is the reason for this ticket.
- **Precedent:** the env-reading rule copies `src/server/google/origin.ts` (T-001-60). The spawn helper copies `run()` in `e2e/browser-config.e2e.ts`.
- **Out of scope:** `playwright.config.ts` (T-001-73). The kit's smoke port has its own variable, `SDLC_APP_PORT` (kit v4.0.0).
- **Requirements:** F-001-23 and F-001-26, as T-001-61: the stub stands in for place search in browser runs.

**Agent:** build with `builder`, as T-001-61 was.
