---
id: ADR-0009
title: Server-loaded pages slide the account session from the client
status: accepted
---

# ADR-0009: Server-loaded pages slide the account session from the client

- Status: accepted
- Date: 2026-10-12
- Source: lead
- Supersedes: none
- Amends: ADR-0007, for pages that read the account session: the "no first-load `fetch`" rule does not cover the one slide request below

## Context

ADR-0001 and `arch/CONTRACTS.md` (Cookies) give `hp_session` a 30-day sliding expiry. Only one route slides it: `GET /api/v1/me` calls `slideSession`, which moves the stored expiry and resets the cookie. Before ADR-0007, the pages that read the account session called `/api/v1/me` in a first-load effect, so opening them slid the session. Those pages are `/`, `/account`, `/plans/new`, `/invitations`, `/plans/{planId}/join` and `/join/{token}`.

ADR-0007 moves first loads into the page, and a Server Component cannot set cookies. A server-loaded page can read the session but cannot slide it. T-001-42 (#101) converted `/plans/{planId}/join` this way, and that page no longer slides the session. Converting the other four would leave `/join/{token}` as the only page that slides it.

The lead weighed four options on 2026-10-12:

- (A) Slide in `proxy.ts` for every request that carries `hp_session`. This adds a database read, and sometimes a write, on the request path. ADR-0008 avoided that for the link attach.
- (B) The page's client component sends one `GET /api/v1/me` after mount, only to slide the session.
- (C) Every authenticated route handler slides the session. A person who only views pages would still never slide it.
- (D) Drop the sliding expiry. That would supersede ADR-0001 and CONTRACTS.

## Decision

Option B.

- **The hook.** `src/components/use-session-slide.ts` exports `useSessionSlide(signedIn: boolean)`. When `signedIn` is true, it sends `GET /api/v1/me` with `credentials: "same-origin"` once after mount. It ignores the response and any error. It never changes what the screen shows. When `signedIn` is false, it sends nothing.
- **Who calls it.** A screen component that a server-loaded page renders, where the page's loader read an account session and the page before conversion called `/api/v1/me` on open. It passes true only when that loader found a signed-in account. These screens are `JoinPanel` on `/plans/{planId}/join`, `HomeList`, `CreateForm`, `InvitationsList`, and `AccountGate` on `/account` when it converts.
- **What it does not change.** The request is not a data load. The screen's first render still comes from the page's initial data (ADR-0007). `GET /api/v1/me` and its contract do not change.
- **`/join/{token}`** keeps its own first-load `/api/v1/me` call (ADR-0008), which already slides the session. It does not add the hook.

## Consequences

- Opening these pages slides the session again, as it did before ADR-0007. First paint is still server-loaded.
- One extra request per page open, the same count as before conversion. It runs after first paint and nothing waits for it.
- Unchanged and out of scope: the organizer plan, confirmed, proposal, respond and invite pages never called `/api/v1/me`, so opening them did not slide the session before ADR-0007 either. Widening the slide to them needs its own decision.
- If the slide moves server-side later (option A), that needs a new ADR that supersedes this one, and the hook goes away.
