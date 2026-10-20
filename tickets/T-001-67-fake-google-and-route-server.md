---
id: T-001-67
title: "Tests: plan-views fake Google fails closed and routeFor descends only into directories"
type: test
status: ready
risk: low
depends_on: [T-001-33, T-001-43, T-001-54, T-001-57]
files:
  - "e2e/plan-views-api-paths.e2e.ts"
  - "e2e/route-server.ts"
  - "e2e/route-server.e2e.ts"
skills:
  - test
contracts: []
requirements:
  - F-001-23
acceptance_criteria:
  - "AC-1: fakeGoogle in e2e/plan-views-api-paths.e2e.ts answers GET https://places.googleapis.com/v1/places/ChIJ-start with status 200 and the start place (id ChIJ-start, Maadi, Cairo)"
  - "AC-2: fakeGoogle rejects, with an Error whose message contains the requested URL, for any URL other than the Places text search, the Routes matrix and that place-details URL, including https://places.googleapis.com/v1/places/ChIJ-other and https://places.googleapis.com/v1/places:autocomplete"
  - "AC-3: routeFor(\"/api/v1/plans/route.ts\") returns src/app/api/v1/plans/[planId]/route.ts with params { planId: \"route.ts\" }: a segment that names a file is matched as the dynamic segment, as Next.js would"
  - "AC-4: routeFor(\"/api/v1/me/route.ts/x\") returns null and does not throw"
  - "AC-5: a route server's serve(\"/api/v1/me/route.ts/x\") answers 404 and records \"GET /api/v1/me/route.ts/x\" in unserved"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Follow-up from the CodeRabbit review on #74 (roadmap item 13). This ticket is test-only. It changes no product code. Two weak spots in the in-process e2e harness let a wrong request look fine or crash instead of failing cleanly. First, `fakeGoogle` in `e2e/plan-views-api-paths.e2e.ts` answers the start place with status 200 for every URL that is not the text search or the routes matrix. That fallback exists for one real call, the start-place details lookup `GET https://places.googleapis.com/v1/places/{placeId}` (`src/server/google/places.ts` `getPlaceDetails`, reached from `src/app/api/v1/plans/[planId]/response/route.ts`). Any other Google call would get a plausible payload and pass. Second, `routeFor` in `e2e/route-server.ts` descends into a path segment whenever `existsSync` is true, so a segment that names a file (`route.ts`) becomes the current "directory": the next segment calls `readdirSync` on a file and throws `ENOTDIR`, and `serve` neither records the request nor answers its documented 404.

- **`e2e/plan-views-api-paths.e2e.ts`:**
  - In `fakeGoogle`, replace the final `return json(startPlace);` with a match on the exact details URL `https://places.googleapis.com/v1/places/ChIJ-start` that returns `json(startPlace)`, then `throw new Error(\`unexpected Google URL: ${url}\`)` for anything else. Copy the throw in `googleFetch` in `e2e/proposal-server-load.e2e.ts`. The details URL is written as a literal, as `e2e/google-origin.e2e.ts` does: `src/server/google/places.ts` exports no constant for it, and this ticket may not add one.
  - Keep the text-search and routes-matrix branches, `startPlace`, `venuesByLabel` and `unavailableGoogle` as they are.
  - Add one `describe("fakeGoogle")` block at the end of the file with tests tagged `T-001-67/AC-1` and `T-001-67/AC-2` that call `fakeGoogle` directly (no render, no route server). AC-2 checks at least: another place id's details URL, `places:autocomplete`, and a `https://routes.googleapis.com/` URL other than `ROUTES_MATRIX_URL`; each rejects with the URL in the message.
  - The two `T-001-33/*` tests stay unchanged and must still pass; the whole-plan test is the proof that the details match covers the real call.
- **`e2e/route-server.ts`:** in `routeFor`, descend into a literal segment only when it exists and `statSync(...).isDirectory()` is true; otherwise fall through to the dynamic-segment lookup as today. Import `statSync` from `node:fs` beside `existsSync` and `readdirSync`. This is the fix CodeRabbit proposed on #74. No other change to the file, its exports or the doc comment's meaning.
- **`e2e/route-server.e2e.ts`** (new): tests tagged `T-001-67/AC-3`, `T-001-67/AC-4` and `T-001-67/AC-5`. AC-3 compares the returned `file` with `resolve(process.cwd(), "src/app/api/v1/plans/[planId]/route.ts")`. AC-5 uses `createRouteServer().serve(...)`; nothing reaches a handler, so no database or stubbed `fetch` is needed. Model the file on `e2e/teardown.e2e.ts`, the test beside the `e2e/teardown.ts` helper.
- `e2e/ui-api-paths.e2e.ts` and the other importers of `e2e/route-server.ts` are not edited and must still pass.
- No assertion is weakened and no test is skipped. Nothing under `src/` changes, so CONTRACTS § External Google ("Tests use fakes") is unchanged.
- **depends_on:** T-001-33 wrote both files; T-001-43, T-001-54 and T-001-57 also list `e2e/plan-views-api-paths.e2e.ts`, and `sdlc lint` asks for the order. All four are merged.
- **Requirement:** F-001-23 (confirm a start-place search result) is the feature whose details call `fakeGoogle` answers. The citation does not claim this ticket proves it.

**Agent:** build with `builder`, as T-001-59 was.
