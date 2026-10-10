---
id: ADR-0005
title: Place-search rate limit counted in Postgres
status: accepted
---

# ADR-0005: Place-search rate limit counted in Postgres

- Status: accepted
- Date: 2026-10-09
- Source: lead (roadmap item 9)

## Context

CONTRACTS limits place search to 30 calls per participant per rolling hour. The code counts calls in an in-process `Map` (`src/server/response/place-search.ts`). On serverless each instance has its own `Map` and loses it on cold start, so the limit is not enforced across instances. The proposal-attempt limit (20 per plan per hour) is already counted in Postgres through `proposal_runs`.

## Decision

Count place searches in a `place_searches` table (`id`, `participant_id`, `searched_at`), declared in `arch/CONTRACTS.md` § Tables. A call is allowed when fewer than 30 rows for that participant are newer than one hour. The count and the insert run in one transaction that first takes a per-participant transaction lock (`pg_advisory_xact_lock` on the participant id), so two concurrent calls cannot both see 29 rows. The same transaction deletes that participant's rows older than one hour. No in-process counter and no external store (Redis or similar).

## Consequences

- The limit holds across instances and restarts, using the database the app already has.
- One extra query and insert per search; acceptable at 30 calls per participant per hour.
- Storage stays bounded: at most 30 rows per participant at any time.
- A ticket replaces the `Map` with the table and adds the migration. CONTRACTS § Tables allows this one delete.
