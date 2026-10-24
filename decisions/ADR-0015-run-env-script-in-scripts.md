---
id: ADR-0015
title: The gate's run-env script lives at scripts/run-env.mjs, not ops/
status: accepted
---

# ADR-0015: The gate's run-env script lives at scripts/run-env.mjs, not ops/

- Status: accepted
- Date: 2026-10-24
- Source: lead. On 2026-10-24 the lead chose "move to `scripts/`" over a lead-written script in `ops/` or an in-place amendment of T-001-82.
- Supersedes: none
- Amends: ADR-0014 § Decision, first bullet, and § Consequences, the raw-client bullet. Every `ops/run-env.mjs` there now reads `scripts/run-env.mjs`, and the wiring becomes `[app] setup = "node scripts/run-env.mjs setup"` and `teardown = "node scripts/run-env.mjs teardown"`. The script is ticket T-001-83, which supersedes T-001-82. Nothing else in ADR-0014 changes.

## Context

ADR-0014 put the script in `ops/`, next to `ops/agent-fe-builder.sh`. The kit treats `paths.ops` (`ops/` here, the observe play's folder) as a lead artifact: `lead_write_set` in `.sdlc/sdlc/gate.py` lists `ops/**`, and `_hard` refuses any lead-artifact file in a ticket's build, whatever the ticket's `files:` says. The T-001-82 build on 2026-10-24 wrote the script and its unit test, and every check passed except `scope`: "outside build write set: ops/run-env.mjs". `ops/agent-fe-builder.sh` is in `ops/` because the lead wrote it in a lead PR.

The four reviews of #182 missed this, because none checked `lead_write_set`.

## Decision

- The script is `scripts/run-env.mjs`. `scripts/` already holds `scripts/mark-ticket-done.sh`, it is not in `lead_write_set` or `tests.integration_globs`, and a build may write it when its ticket lists it.
- T-001-82 is set to `blocked` (`blocked_by` names T-001-83), and its `files:` keeps only `ops/run-env.mjs`, so the two tickets do not both own the test files, because a ready ticket's AC cannot be reworded without its spec or an amendment, and a path change is neither a strengthening nor a weakening. T-001-83 carries T-001-82's AC and body, with the path changed and `ADR-0015` added to `source_adr`.
- `skills/backend-patterns`' raw-client exception names `scripts/run-env.mjs`.

## Consequences

- The `sdlc.toml` wiring lead PR uses `scripts/run-env.mjs`.
- The claim branch `build/T-001-82` on origin holds an unmerged build that will not merge. It stays until the lead deletes it.
- A future gate-tooling script that a ticket builds goes in `scripts/`, not `ops/`. `ops/` stays for files the lead writes.
