---
id: ADR-0007
title: Pages load their first data on the server
status: accepted
---

# ADR-0007: Pages load their first data on the server

- Status: accepted
- Date: 2026-10-12
- Source: lead
- Supersedes: none

## Context

ADR-0001 says page loads call the same view functions as the route handlers, and the frontend Lock says the same. Every page on main does something else. It awaits its params and renders a client component, and that component then fetches `/api/v1` in an effect. ADR-0006 left this conflict open. The lead has decided: keep ADR-0001 and move the pages to it.

## Decision

A page loads its first data on the server. It uses the same code path as the `GET` route handler for that surface, so the two cannot drift.

- **One loader per surface**, in `src/server/<area>/page-data.ts`. It takes the route params and a cookie reader, `(name: string) => string | null`. It runs the same lookup, authorization and view function as the `GET` handler. It returns a result union: `{ kind: "ok", view }`, or one `kind` per non-200 outcome that handler has today.
- **The `GET` handler calls the loader.** It maps each `kind` to the response it sends today. Statuses, error codes and bodies do not change.
- **Authorization reads cookies through the reader**, not through `Request`. `src/server/plans/role.ts` gains a cookie-reader form of `planRoleFor`, and the `Request` form calls it. A route file does not keep its own copy of the role helpers.
- **The page** (`src/app/<route>/page.tsx`, a Server Component) builds the reader from `await cookies()` and calls the loader.
  - On `ok`, it passes `JSON.parse(JSON.stringify(view))` to the screen component as its initial data. That is the body `NextResponse.json` would send, so the component's existing parser reads it unchanged.
  - Each other `kind` maps to what the component does today for that status: a `redirect()` where the component redirects, and the component's existing error state where it shows one.
- **The screen component** stays `"use client"`. Its first render uses the initial data, so it makes no first-load `fetch`. Writes and refetches after writes still go through `/api/v1` (ADR-0003). The component keeps its reload function for those.
- Server Components are not a second API. The loader returns the view the route handler returns, and adds no field.

The first ticket converts the organizer plan page (`/plans/{planId}`), and its code becomes the example to copy. The other pages follow, one ticket each, after it merges.

## Consequences

- First paint shows data. There is no loading flash and no client round trip on open.
- Authorization for a page and for its `GET` is the same code.
- Until each page is converted, it keeps today's pattern. The rulebook says which pages are done.
- Supersedes nothing. It closes ADR-0006's open question in favor of ADR-0001.
