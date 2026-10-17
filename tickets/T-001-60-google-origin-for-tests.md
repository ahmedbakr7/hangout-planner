---
id: T-001-60
title: "Google clients take a loopback origin for browser tests"
type: backend
status: ready
risk: medium
depends_on: [T-001-13]
files:
  - "src/server/google/origin.ts"
  - "src/server/google/origin.test.ts"
  - "src/server/google/places.ts"
  - "src/server/google/places.test.ts"
  - "src/server/google/routes.ts"
  - "src/server/google/routes.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#External Google"
requirements:
  - F-001-23
  - F-001-26
acceptance_criteria:
  - "AC-1: with HP_E2E_GOOGLE_BASE_URL unset or empty, Text Search, Place Details and Route Matrix requests go to https://places.googleapis.com and https://routes.googleapis.com as today"
  - "AC-2: with HP_E2E_GOOGLE_BASE_URL set to http://127.0.0.1:<port> or http://localhost:<port>, Text Search, Place Details and Route Matrix requests go to that origin with the same path, method, headers, field mask and body"
  - "AC-3: with HP_E2E_GOOGLE_BASE_URL set to any other value (https, another host, no port, a trailing slash, a path, a query, a fragment, or credentials), the first Google call rejects with an error whose message does not contain the value, and no request is sent"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
---

First ticket in ADR-0010's order. A browser test drives a started production server, which cannot take the in-process fakes the Vitest suites inject. ADR-0010 decides that the Google clients read one test-only variable to choose the request origin, so a local stub can answer.

- **`src/server/google/origin.ts`:** one helper, for example `googleOrigin(defaultOrigin: string): string`.
  - It reads `process.env.HP_E2E_GOOGLE_BASE_URL` on every call, not once at import, so tests can set and clear it.
  - Unset or empty: it returns `defaultOrigin`.
  - Otherwise the value must be exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`, with a port of 1 to 65535 and nothing after it. It returns that value.
  - Anything else throws an `Error` with a fixed message that names the variable but not its value. It never rewrites or trims the value, and never falls back to the default.
  - It logs nothing.
- **`places.ts` and `routes.ts`:** the three request sites build their URL from `googleOrigin(...)` at request time.
  - `PLACES_SEARCH_TEXT_URL` and `ROUTES_MATRIX_URL` stay exported with their current values, and remain the URLs used when the variable is unset.
  - Place Details keeps its `encodeURIComponent` path.
  - The origin is resolved before `fetch` is called, so a bad value sends nothing (AC-3).
  - Paths, methods, headers, field masks, bodies and error messages are unchanged. No new log line.
- **Tests:** `origin.test.ts` covers each accepted and each rejected form. `places.test.ts` and `routes.test.ts` add tests tagged `T-001-60/AC-n` that capture the URL through the injected `fetch`, for all three calls. Each test that sets the variable restores it in `afterEach` (copy the env save/restore in `src/server/auth/password.test.ts` if one is needed; otherwise `vi.stubEnv` with `vi.unstubAllEnvs`).
  - When the variable is set and the value is bad, AC-3 has priority over AC-2; a combined test is not needed.
- The existing tests that assert `PLACES_SEARCH_TEXT_URL`, `ROUTES_MATRIX_URL` and the literal `https://places.googleapis.com/v1/places/...` URLs keep passing unchanged. Do not edit them.
- The `setGoogleClientOptions` setters in `src/server/response/` and `src/server/proposal/`, and `setProposalAttemptGoogleOptions`, are not touched.
- No change to CONTRACTS § External Google (ADR-0010 says why), to `.env` files, or to deploy settings. Production and preview never set the variable.
- **Requirements:** F-001-23 (start search and details) and F-001-26 (proposal places and travel times) are the features whose Google calls this hook redirects under test. The citation does not claim this ticket proves them.

**Agent:** build with `builder`.
