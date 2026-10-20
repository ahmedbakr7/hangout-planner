---
id: T-001-69
title: "Stale /v1 text: the join route's log path and two plan-view doc comments"
type: chore
lane: mechanical
status: ready
risk: low
test: none
depends_on: []
files:
  - "src/app/api/v1/join/[token]/route.ts"
  - "src/server/plans/views.ts"
transforms:
  - 'literal "http://localhost/v1/join" -> "http://localhost/api/v1/join"'
  - 'literal "GET /v1/plans/" -> "GET /api/v1/plans/"'
skills:
  - build
  - backend-patterns
contracts: []
requirements: []
acceptance_criteria: []
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0003-api-v1-prefix.md
---

This ticket covers the non-test part of roadmap item 15, from the post-merge review of #75. ADR-0003 puts the JSON API under `/api/v1` only. Its Consequences call a log that uses a `/v1` URL "stale text (roadmap item 15), not a second contract". This ticket replaces three such strings. It is a mechanical-lane ticket: the two literal transforms must produce the whole diff, byte for byte, and the full `gate ci` suite is the proof.

- **`src/app/api/v1/join/[token]/route.ts:128`:** `loggedJoin` passes `logged` (`src/server/auth/http.ts`) a synthetic `Request` for `http://localhost/v1/join`, so the request log line names a path that does not exist. The URL is fixed on purpose, so that the join token never reaches the log (`skills/backend-patterns`: never log join tokens). Keep it fixed and change only the prefix. The log line's `path` becomes `/api/v1/join`. The transforms replay only on changed files, so the same text in `route.test.ts` request URLs (`http://localhost/v1/join/${token}`) is untouched. Do not edit that file in this ticket.
- **`src/server/plans/views.ts:240` and `:260`:** the doc comments `Organizer GET /v1/plans/{planId}` and `Participant GET /v1/plans/{planId}/response` become `/api/v1/...`. These are comments only.
- The transforms are narrower than `"/v1/" -> "/api/v1/"`, so the review can check each match. Each matches only in its own target file (one hit in `route.ts`, two in `views.ts`). Neither file contains `/api/v1/` text that a broader literal could double.
- **Lane check:**
  - Neither file is `arch/CONTRACTS.md`, and the product sets no `lanes.strict_paths`.
  - No test reads the join log's `path`. `src/app/api/v1/join/[token]/route.test.ts` reads the log lines only to check that they hold no join or link token.
  - The output that changes is one log field's value. No contract or requirement names that value.
- **Out of scope:**
  - `src/i18n/fallback.test.ts:90` (`/v1/me` stub), item 15's test half. It is a behaviour change (the 401 path starts being exercised) and needs its own standard ticket.
  - The optional move of route-test request URLs to `/api/v1`, including `src/app/api/v1/accounts/route.test.ts:201`, whose `/v1/accounts` comes from the test's own request URL.
  - Shipped AC text that says `/v1` (ADR-0003 says to read it as `/api/v1`).
- **Requirements:** none. This is stale text in a log value and in comments, with no product feature (ADR-0003). `sdlc lint` exempts `type: chore` and the mechanical lane.
- **Precedent:** this is the first `lane: mechanical` ticket in this repo, so no ticket here shows the shape. It follows `.sdlc/skills/ticketize/SKILL.md` step 3 and the kit's ADR-0001 § mechanical, which names the `/api/v1` literal move as the lane's example. The ticket may be created in the PR that applies it. If the PR raises to standard, the ticket must already be `ready` on `main`.

**Agent:** build with `builder`. If the lead rules that the log value is behaviour, use the standard lane instead.
