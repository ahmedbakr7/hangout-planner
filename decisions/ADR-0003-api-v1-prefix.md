---
id: ADR-0003
title: JSON API under /api/v1
status: accepted
---

# ADR-0003: JSON API under /api/v1

- Status: accepted
- Date: 2026-10-09
- Source: lead; T-001-32 (#62), T-001-33 (#73, #74), #75
- Supersedes: ADR-0001 API bullet "JSON over HTTP at `/v1`" and the `GET /v1/me` path in its account lock; the `/v1` path in ADR-0002's list of unchanged locks
- Does not supersede: anything else in ADR-0001 or ADR-0002

ADR-0001 and ADR-0002 stay accepted. Do not edit them in place; this ADR records the path change.

## Context

The JSON API was locked at `/v1`. Next.js App Router serves route handlers from `src/app/api/...`, so every handler already lived under `/api/v1`, and the UI moved its calls there in T-001-32 and T-001-33. #75 removed the transitional `/v1` section from `arch/CONTRACTS.md`. The two ADRs still named `/v1`.

## Decision

The JSON API lives under `/api/v1`. Every route in `arch/CONTRACTS.md` § HTTP is the only path for it. No `/v1` alias, rewrite, or redirect.

## Consequences

- `arch/CONTRACTS.md`, the tickets' `contracts:` lines, and the pattern skills name `/api/v1`.
- The AC text of T-001-06, 10, 15, 17 and 24 still says `/v1`, because the kit does not allow rewording a shipped AC (pilot finding 18). Read each such path as `/api/v1`.
- A route test or log that uses a `/v1` URL is stale text (roadmap item 15), not a second contract.
