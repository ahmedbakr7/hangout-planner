---
id: ADR-0014
title: Each gate run gets its own database and browser-test ports from app.setup
status: accepted
---

# ADR-0014: Each gate run gets its own database and browser-test ports from app.setup

- Status: accepted
- Date: 2026-10-24
- Source: lead. On 2026-10-24 the lead chose "setup hook + ADR-0014" over a local wrapper script or keeping the manual steps.
- Supersedes: none
- Amends: ADR-0012 § Decision, the line "These two variables are the one exception to ADR-0010's 'never in the shell'. They are set in the shell, by a person or a parallel-run script, and only to choose ports. CI, `sdlc.toml` and `.env` files set neither". From now on, the gate's `app.setup` also sets them, locally and in CI.

## Context

ADR-0012 and ADR-0013 left a parallel run with manual steps: create a database for each worktree, export `DATABASE_URL`, and pick `HP_E2E_APP_PORT` and `HP_E2E_GOOGLE_STUB_PORT` so no two runs collide. ADR-0013 deferred kit v5.1.0's `[app] setup` / `teardown` to a ticket.

Two runs on 2026-10-22 and 2026-10-23 also showed that a dead local Postgres fails late and unclearly. After a container restart the gate reported smoke 500s and "No test files found" instead of "Postgres is down".

Kit v5.1.0 runs `app.setup` before a gate's checks with `SDLC_RUN_ID`, `SDLC_APP_PORT` and `SDLC_RUN_ENV` set. Each `KEY=VALUE` line it appends to `$SDLC_RUN_ENV` reaches every command the gate runs, and `app.teardown` too. `app.teardown` runs after the checks, pass or fail. A failed setup fails the gate and skips its checks.

## Decision

- `ops/run-env.mjs` has two commands, `setup` and `teardown`, wired as `[app] setup = "node ops/run-env.mjs setup"` and `teardown = "node ops/run-env.mjs teardown"`. The script is a ticket (T-001-82); the `sdlc.toml` lines are a lead PR after it merges, because `gate` reads `sdlc.toml` from main.
- **`setup`:**
  - It reads `DATABASE_URL` from the environment, as the shell or CI sets it today. That URL names the server and the credentials.
  - It connects to that server's `postgres` maintenance database and creates `hp_run_<id>`: `<id>` is `SDLC_RUN_ID` lower-cased, with every character outside `[a-z0-9_]` replaced by `_`.
  - It applies `drizzle/0001_init.sql` to the new database, so smoke and the browser suite find the tables even in a gate whose test commands do not run first. The database is new, so this needs no lock (unlike `applySchemaOnce` in `src/server/db/test-schema.ts`, which test runs keep using).
  - It picks two free TCP ports on 127.0.0.1, different from each other and from `SDLC_APP_PORT`.
  - It appends exactly three lines to `$SDLC_RUN_ENV`: `DATABASE_URL` (the same URL with the run's database), `HP_E2E_APP_PORT` and `HP_E2E_GOOGLE_STUB_PORT`.
  - If the server cannot be reached, it exits non-zero within 15 seconds with a message naming the host, the port and `DATABASE_URL`, never the password, and writes nothing.
- **`teardown`** derives the database name from `SDLC_RUN_ID` only, never from `DATABASE_URL`'s path. It refuses any name that does not match `^hp_run_[a-z0-9_]+$`, connects to the `postgres` maintenance database and runs `DROP DATABASE IF EXISTS ... WITH (FORCE)`.
- ADR-0012's port rules (defaults 3124 and 3125, validation, the same-port error) are unchanged. Outside the gate, a person may still set or leave the two variables. Inside the gate, setup's values win, because the kit applies `$SDLC_RUN_ENV` over the shell.
- ADR-0010's "never in the shell" for the five app variables is unchanged. `DATABASE_URL` was never one of them.

## Consequences

- A parallel run needs only its own worktree. The runbook's manual database and port steps go away in the lead PR that wires `sdlc.toml`. `FE_BUILDER_PORT` stays manual: `fe-builder`'s `next dev` runs in the agent, outside the gate.
- CI changes behaviour. Each `gate ci` and `gate pr` creates and drops its own database on the service container, and the browser suite runs on random free ports instead of 3124 and 3125. The service's `postgres` role is a superuser, so it may create databases. A role without `CREATEDB` fails setup with Postgres's own error.
- Every gate applies the schema once more, which costs about a second.
- A gate killed before teardown leaves an `hp_run_*` database behind. `teardown` cleans only its own run. Stray ones are dropped by hand (`DROP DATABASE hp_run_... WITH (FORCE)`), and none hold data that matters.
- `drizzle/0001_init.sql` gains a second loader. The rule from roadmap item 9 still holds: the first change after a database holds real data needs a migration ADR, and that ADR must cover this loader too.
