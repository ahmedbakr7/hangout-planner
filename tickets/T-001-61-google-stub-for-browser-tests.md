---
id: T-001-61
title: "Tests: a local Google stub the real clients can call"
type: test
status: ready
risk: low
depends_on: [T-001-60]
files:
  - "browser/google-stub.mjs"
  - "e2e/google-stub.e2e.ts"
skills:
  - test
contracts: "arch/CONTRACTS.md#External Google"
requirements:
  - F-001-23
  - F-001-26
acceptance_criteria:
  - "AC-1: with HP_E2E_GOOGLE_BASE_URL set to the stub's origin, searchStartPlaces, searchVenuePlaces, getStartPlaceDetails, getVenuePlaceDetails and computeRouteMatrix resolve with the stub's fixture places and durations, parsed by the unchanged clients"
  - "AC-2: the stub answers 404 to any other method or path, and 400 to a request on one of its three paths that lacks the X-Goog-Api-Key or X-Goog-FieldMask header or sends a field mask of *"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
---

Step 3a of ADR-0010's work order. ADR-0010 names `browser/google-stub.mjs` as the server the browser suite's app talks to instead of Google (through `HP_E2E_GOOGLE_BASE_URL`, T-001-60). This ticket adds the stub and proves it against the real clients over HTTP. It changes no product code. The Playwright dependency, its config and `browser/global-setup.ts` are a later ticket (step 3b), because they have no behaviour to prove until a browser spec exists.

- **`browser/google-stub.mjs`:** a plain Node ES module using only `node:http`. It imports nothing from `src/` and no package.
  - Run as `node browser/google-stub.mjs`, it listens on `127.0.0.1` at the port in `HP_GOOGLE_STUB_PORT`, default `3125` (ADR-0010).
  - It also exports a `startGoogleStub(port)` function that resolves with the listening server, so the integration test can start it on a free port (`0`) and close it.
  - It answers exactly the three paths in ADR-0010: `POST /v1/places:searchText`, `GET /v1/places/{id}`, `POST /distanceMatrix/v2:computeRouteMatrix`. Fixtures are fixed JSON shaped like the Google responses the clients parse. Read `src/server/google/places.ts` and `routes.ts` for the fields: at least two places with `id`, `displayName.text`, `location`, and a `priceRange.startPrice` the plan currency can use; Place Details for those ids; and one matrix element per origin–destination pair with `condition: "ROUTE_EXISTS"` and a `duration` such as `"600s"`.
  - The three paths require `X-Goog-Api-Key` and `X-Goog-FieldMask` headers, and reject a field mask of `*`, with 400 (AC-2), as CONTRACTS § External Google requires of the clients.
  - It logs nothing.
- **`e2e/google-stub.e2e.ts`:** tests tagged `T-001-61/AC-1` and `T-001-61/AC-2`.
  - `beforeAll` starts the stub on port `0`; `afterAll` closes it. `beforeEach` sets the variable with `vi.stubEnv`; `afterEach` calls `vi.unstubAllEnvs`.
  - AC-1 calls the five client functions with the platform `fetch` and a dummy API key, and checks the parsed results match the fixtures.
  - AC-2 sends raw `fetch` requests to the stub.
  - No test calls `places.googleapis.com` or `routes.googleapis.com`.
- Copy the server-in-test shape of `e2e/google-origin.e2e.ts` (T-001-60).
- `browser/**` is in the test globs and `integration_globs` (#137), so a `type: test` ticket may write both files.
- **Requirements:** F-001-23 (start search and details) and F-001-26 (proposal places and travel times) are the features whose Google calls the stub answers. The citation does not claim this ticket proves them.

**Agent:** build with `builder`, as T-001-59 was.
