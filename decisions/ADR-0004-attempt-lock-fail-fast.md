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

The app runs as serverless functions. A request that waits 20 s holds a function instance and a database connection, and gets close to the platform's request timeout. The client already handles 409 `attempt_in_progress` by refetching the plan, because the triggering write has committed.

## Decision

A triggering request does not wait. If `attempt_lock` is held and younger than 20 s, it returns 409 `attempt_in_progress` at once. A lock older than 20 s may be taken over. The 20 s value is the stale-lock threshold only.

## Consequences

- CONTRACTS matches T-001-24 AC-4 and the shipped code. No code change.
- Two near-simultaneous triggers: one runs, the other gets 409 and refetches; the plan shows the run's result once it finishes.
