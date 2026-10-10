---
id: ADR-0004
title: Proposal attempt lock fails fast
status: accepted
---

# ADR-0004: Proposal attempt lock fails fast

- Status: accepted
- Date: 2026-10-09
- Source: lead (roadmap item 8)
- Supersedes: the "waits up to 20s to take that lock" sentence of `arch/CONTRACTS.md` § Proposal attempt

## Context

CONTRACTS said a triggering request waits up to 20 s for `attempt_lock`, then returns 409 `attempt_in_progress`. T-001-24 AC-4 and its code return 409 at once when a lock younger than 20 s is held. The two disagreed.

The app runs as serverless functions. A request that waits 20 s holds a function instance and a database connection, and gets close to the platform's request timeout. For a `PUT` response or `PATCH` plan trigger, the triggering write has committed, so CONTRACTS has the client refetch the plan on 409 `attempt_in_progress`. A `POST` proposal-attempts conflict changes nothing.

## Decision

A triggering request does not wait. After the hourly run cap passes (a full hour returns 429 on the attempts route, or finishes as `venue_data` on a triggering write), if `attempt_lock` is held and younger than 20 s, it returns 409 `attempt_in_progress` at once. A lock 20 s old or older may be taken over (`ATTEMPT_LOCK_MS`, age < 20 000 ms is held). The 20 s value is the stale-lock threshold only.

## Consequences

- CONTRACTS matches T-001-24 AC-4 and the shipped code. No code change.
- Required client behavior: when two triggers race, one runs; the other gets 409 `attempt_in_progress`, and its client must refetch the plan so it shows the run's result once the run finishes. The current gap is below.
- Today `response-form.tsx` and `organizer-plan.tsx` show a generic save error on this 409 instead of refetching. That is out of contract and is a ticket (roadmap item 16).
