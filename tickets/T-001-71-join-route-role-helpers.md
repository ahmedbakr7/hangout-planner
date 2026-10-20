---
id: T-001-71
title: "The join-token route's planRoleFor uses the shared role helpers"
type: backend
lane: refactor
status: ready
risk: medium
depends_on: [T-001-14, T-001-26, T-001-36, T-001-52, T-001-69]
files:
  - "src/server/plans/role.ts"
  - "src/server/plans/role.test.ts"
  - "src/app/api/v1/join/[token]/route.ts"
  - "src/app/api/v1/join/[token]/route.test.ts"
  - "src/app/api/v1/plans/[planId]/confirmed/route.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/join/{token}"
requirements:
  - F-001-16
  - F-001-36
  - F-001-39
  - N-001-20
acceptance_criteria:
  - "AC-1: GET /api/v1/join/{token} with a valid token and no cookies answers 200 with next join and a preview while the plan is collecting, and next confirmed with preview null while it is locked"
  - "AC-2: GET /api/v1/join/{token} with the organizer's hp_session answers next organizer while the plan is collecting and confirmed while it is locked, and inserts no participant"
  - "AC-3: GET /api/v1/join/{token} with the hp_session of an account that has a participant on the plan answers next respond while the plan is collecting and proposal while it is proposed"
  - "AC-4: GET /api/v1/join/{token} with an hp_guest cookie whose guest session owns a participant on the plan answers next respond while collecting; once that guest session's expires_at is in the past, the same request answers next join"
  - "AC-5: GET /api/v1/join/{token} with the hp_session of an account that has an invitation to the plan and no participant answers next join with a preview"
  - "AC-6: POST /api/v1/join/{token} with the organizer's hp_session answers 409 organizer_cannot_join, and with the hp_session of an account that already has a participant answers 200 with that participant; neither creates a participant"
  - "AC-7: GET /api/v1/plans/{planId}/confirmed on a locked plan answers 404 to a caller with no cookies and 200 to a caller whose hp_link session includes the plan"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0008-join-token-page-loads-on-the-client.md
  - .sdlc/decisions/ADR-0004-refactor-lane.md
---

> **Lead reading of ADR-0008 (2026-10-20).** ADR-0008 says "The join route keeps its own `planRoleFor(request, plan, joinToken)`." That keeps the function, with that signature, in the route. It does not keep the helper copies behind it, which ADR-0007 forbids ("A route file does not keep its own copy of the role helpers"), as does `skills/backend-patterns` ("never copy the role helpers into a route file"). So this ticket needs no new ADR.

Roadmap item 10: "`planRoleFor` copies". Every other copy was folded into `src/server/plans/role.ts` by the page-load tickets (ADR-0007, T-001-36). The one left is in `src/app/api/v1/join/[token]/route.ts`, which ADR-0008 kept out of that move. It is the largest clone left in `src/server`: about 55 lines that match `role.ts`. This is a **refactor** (kit ADR-0004): behaviour does not change, and the AC go through the routes `main` already has.

Copies on `main` (132ce4a), in `src/app/api/v1/join/[token]/route.ts`:

| Function | Lines | Same as in `src/server/plans/role.ts` |
|---|---|---|
| `accountParticipates` | L189–201 | L32–44 |
| `accountInvited` | L203–215 | L46–58 |
| `guestOwnsParticipant` | L237–256 | L62–83 (one joined query instead of `readGuestSession` + a participant query; same result) |
| `linkIncludesPlan` | L258–279 | L85–106 |
| `planRoleFor(request, plan, joinToken)` | L281–306 | `planRoleForCookies` L115–139, except `requestJoinToken: joinToken` |

- **`src/server/plans/role.ts`:** `planRoleForCookies(readCookieValue, plan, requestJoinToken: string | null = null)` passes `requestJoinToken` to `authorize` where it passes `null` today. `planRoleFor(request, plan)` is unchanged. Every existing caller passes two arguments, so it still sends `null` (AC-7 pins that a planId route does not start treating callers as link readers).
- **`src/app/api/v1/join/[token]/route.ts`:** `planRoleFor(request, plan, joinToken)` stays in the route with that signature (ADR-0008) and becomes one line: `return planRoleForCookies((name) => readCookie(request, name), plan, joinToken);`. Copy the call in `planRoleFor` in `role.ts` L108–113. Delete `accountParticipates`, `accountInvited`, `guestOwnsParticipant` and `linkIncludesPlan` from the route. Keep `cookieTokenHash`, `isFuture` and `readGuestSession`: `attachLink` and the anonymous `POST` still use them. Remove imports that become unused.
- **Tests.** Every existing test keeps every line; a test may only gain an AC tag. Most AC already have a test in `src/app/api/v1/join/[token]/route.test.ts` (the organizer and existing-participant cases at L450, the `POST` cases at L598 and L640): tag them where they assert the AC, and add a test beside them for each case no test covers (the expired guest session in AC-4, the invited account in AC-5). AC-7: tag the existing callers test in `src/app/api/v1/plans/[planId]/confirmed/route.test.ts` (L539) where it asserts the no-cookie 404 and the link-reader 200 on a locked plan; add a test beside it if it does not. The optional argument gets an untagged unit test in a new `src/server/plans/role.test.ts`; it cannot be AC proof, since it fails on `main`.
- **Equivalence the reviewer argues:** the route asks `authorize` the same seven facts. `guestOwnsParticipant` in `role.ts` finds a guest session by cookie hash joined to a participant on this plan and checks its expiry; the route's copy finds the guest session, checks expiry, then looks for the participant. Both are true exactly when an unexpired guest session with that hash owns a participant on the plan.
- Out of scope: the `gst_` / `lnk_` id helpers in this route (see T-001-68's out-of-scope list); `GET /api/v1/join/{token}`'s contract and the `hp_link` attach (ADR-0008); `src/server/response/caller.ts`'s own `tokenHash` / `isFuture` copies (L13–28).

**Agent:** build with `builder`.
