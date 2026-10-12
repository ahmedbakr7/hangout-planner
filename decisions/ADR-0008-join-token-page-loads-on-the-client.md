---
id: ADR-0008
title: The join-token page keeps client loading
status: accepted
---

# ADR-0008: The join-token page keeps client loading

- Status: accepted
- Date: 2026-10-12
- Source: lead
- Supersedes: none

## Context

ADR-0007 says every page loads its first data on the server, through the loader that the page's `GET` handler also uses. It rules out Server Actions. It also says the join route's own `planRoleFor` moves with the `/join/{token}` page ticket.

`/join/{token}` cannot follow that pattern. Its first load is `GET /api/v1/join/{token}`, and that handler has a side effect. `attachLink` creates or extends a link session, writes `link_session_plans`, and sets the `hp_link` cookie on the response. A Server Component cannot set cookies; only a route handler or a Server Action can. Running the loader in the page would write the session row but drop the cookie, so the browser would never hold the link session the row describes.

The lead weighed three options on 2026-10-12 (#98):

- (A) Make this page an exception to ADR-0007, so it keeps client loading.
- (B) Split the link attach into its own `POST`, so the `GET` only reads. That is a contract change.
- (C) Attach the link in `proxy.ts`. That puts a database write on the request path for every matched request, which is an architecture change.

## Decision

Option A. `/join/{token}` keeps today's pattern: its page renders `JoinPanel` with the token, and `JoinPanel` fetches `GET /api/v1/join/{token}` and `/api/v1/me` in its first-load effect.

- This is the only exception to ADR-0007. Every other page, `/plans/{planId}/join` included, loads on the server.
- `JoinPanel` serves both join pages. It uses its initial props when the page passes them (`/plans/{planId}/join`), and its first-load effect only when it gets a token and no initial data (`/join/{token}`).
- The join route keeps its own `planRoleFor(request, plan, joinToken)`. The ADR-0007 sentence about moving it with the page ticket no longer applies, since no such ticket exists.
- `GET /api/v1/join/{token}` and its contract do not change.
- A page load failure on this route stays the panel's own error state (`join.joinFailed` with retry). No `error.tsx` is required for it, because the page has no loader that can throw.

## Consequences

- No contract, API or proxy change.
- The join-token page keeps its loading state and its client round trip on open.
- Two loading patterns remain in the codebase, and the rulebook names this page as the exception.
- If the join flow is reworked, revisit option B: a read-only `GET` plus a `POST` attach would let this page follow ADR-0007. That needs a new ADR that supersedes this one.
