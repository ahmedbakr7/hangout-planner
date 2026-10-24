---
id: T-001-82
title: "ops/run-env.mjs: per-run database and browser-test ports for the gate"
type: chore
status: blocked
blocked_by: "Superseded by T-001-83 (ADR-0015): the kit keeps ops/** for lead artifacts, so no build may write ops/run-env.mjs"
risk: medium
depends_on: []
files:
  - "ops/run-env.mjs"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: node ops/run-env.mjs setup, with DATABASE_URL naming a reachable server, SDLC_RUN_ID, SDLC_RUN_ENV and SDLC_APP_PORT set, exits 0; it creates database hp_run_<id> (SDLC_RUN_ID lower-cased, characters outside [a-z0-9_] replaced by _), whose public schema then has the accounts table from drizzle/0001_init.sql, and appends exactly three lines to $SDLC_RUN_ENV: DATABASE_URL (the input URL with that database), HP_E2E_APP_PORT and HP_E2E_GOOGLE_STUB_PORT, two different decimal ports, neither equal to SDLC_APP_PORT, that a test can bind on 127.0.0.1 straight after"
  - "AC-2: node ops/run-env.mjs teardown, with the same SDLC_RUN_ID and DATABASE_URL set to the run's own database (as the kit passes it after setup), exits 0 and the database no longer exists; a second teardown for the same run also exits 0; with SDLC_RUN_ID empty or unset, teardown exits non-zero, prints SDLC_RUN_ID is required, and a sentinel hp_run_* database the test created beforehand still exists; with a SDLC_RUN_ID of 57 characters or more (a name over 63 bytes) and DATABASE_URL naming a port where nothing listens, setup and teardown both exit non-zero, print a message that names SDLC_RUN_ID and its length and does not name a connection failure, and a sentinel database named hp_run_ plus the first 56 characters of that id (the name Postgres would truncate it to) still exists"
  - "AC-3: setup with DATABASE_URL naming a port where nothing listens exits non-zero within 15 seconds, prints a message that contains the host, the port and DATABASE_URL and does not contain the URL's password, and leaves $SDLC_RUN_ENV missing or empty; setup and teardown with DATABASE_URL unset each exit non-zero and print DATABASE_URL is required; setup and teardown with a DATABASE_URL that new URL() cannot parse and that contains a searchable password each exit non-zero with one stderr line that names DATABASE_URL and does not contain the password; setup with SDLC_RUN_ENV unset exits non-zero, prints SDLC_RUN_ENV is required and leaves no hp_run_* database for that run"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0012-browser-test-ports-from-env.md
  - decisions/ADR-0013-kit-v5-claims-and-auto-port.md
  - decisions/ADR-0014-per-run-database-and-ports.md
---

**Blocked, superseded by T-001-83 (ADR-0015).** The kit keeps `ops/**` for lead artifacts, so no build may write `ops/run-env.mjs`. T-001-83 carries these AC with the script at `scripts/run-env.mjs`. Do not build this ticket.

ADR-0014 step 1: the script the gate's `[app] setup` and `teardown` will call. This ticket writes only the script, its unit test (build) and its real-stack test (test play). Wiring `sdlc.toml` is the lead PR that follows, because the gate reads `sdlc.toml` from main.

- **`ops/run-env.mjs`:** plain Node ESM, no TypeScript, run as `node ops/run-env.mjs <setup|teardown>`. Any other argument exits 2 with a usage line. Copy `browser/google-stub.mjs` for the shape of a runnable `.mjs` script. Use only `postgres` (already a dependency) and Node built-ins (`node:net`, `node:fs`, `node:path`, `node:url`). No new package.
  - Check, in this order and before connecting: `DATABASE_URL` set (`DATABASE_URL is required`), `SDLC_RUN_ENV` set for setup (`SDLC_RUN_ENV is required`), `SDLC_RUN_ID` and the name rule below. Parse `DATABASE_URL` with `new URL()` inside a `try`; on a parse error print one line naming `DATABASE_URL`, never the input. Every connection goes to the same URL with its path set to `/postgres` (the maintenance database), `max: 1`, and `connect_timeout` of 10 seconds or less. Always `end()` the client, error or not.
  - The run database name is built from `SDLC_RUN_ID` as AC-1 says, and quoted as an identifier (`sql(name)` in postgres.js). It is never interpolated as text. Both commands exit non-zero with `SDLC_RUN_ID is required` when it is empty or unset, and check the name against `^hp_run_[a-z0-9_]{1,56}$` (63 bytes at most, so Postgres never truncates it) before connecting.
  - `setup` runs `CREATE DATABASE`. It then connects to the new database and runs `sql.file(<repo>/drizzle/0001_init.sql)`; resolve the path from the script's own location, not the cwd. Then it picks the ports and appends the three lines with one `appendFileSync` call, after the database work succeeds, so a failure writes nothing. Pick each port by listening on `127.0.0.1` port 0 and closing. Retry until the two differ from each other and from `SDLC_APP_PORT`, 20 tries at most.
  - Errors print one line to stderr. For a connection failure, the line names `DATABASE_URL`, the host and the port. Never print the URL or the password. Exit 1.
  - `teardown` runs `DROP DATABASE IF EXISTS <name> WITH (FORCE)`.
- **`src/run-env.test.ts`** (`// @vitest-environment node`; build play), tagged `T-001-82/AC-1` to `AC-3`. It follows the precedent of `src/browser-config.test.ts` and `src/next-version.test.ts`, which test files outside `src/` from a unit test there. Unit tests already reach the gate's Postgres through `DATABASE_URL` (for example `src/server/plans/page-data.test.ts`). Run the script with `child_process.spawnSync(process.execPath, ["ops/run-env.mjs", ...])`, with a unique `SDLC_RUN_ID` per test and `SDLC_RUN_ENV` in a temp directory.
  - AC-1: parse the env file and check the three keys. Connect to the new `DATABASE_URL` and check that `accounts` exists. Bind both ports with `node:net`.
  - AC-2: run teardown, then query `pg_database` from the maintenance connection. For the bad-id cases, first create a sentinel `hp_run_<unique>` database through the maintenance connection. Run teardown with `SDLC_RUN_ID` removed, again with it set to `""`, and setup and teardown with a 57-character id and a closed-port `DATABASE_URL` (as in AC-3), so a missing length check fails on the stderr assertion; assert each exit code and stderr text. For the long-id cases, the sentinel is `hp_run_` plus the id's first 56 characters, lower-cased. Then assert the sentinels still exist before dropping them. Keep the positive and negative cases in one test, so that on main (no script) it fails at the first step.
  - AC-3: use a closed port: bind one with `node:net`, close it, and use it. Give a password the test can search for in the output. Also run setup and teardown with `DATABASE_URL` removed from the child's env, setup and teardown with an unparsable `DATABASE_URL` holding the searchable password (for example `postgres://u:<password>@[bad`), and setup with `SDLC_RUN_ENV` removed, then check `pg_database` has no database for that run.
  - Clean up any `hp_run_*` database a test made, even when it fails. Copy the `DROP DATABASE ... WITH (FORCE)` cleanup and the URL rewrite in `e2e/test-schema.e2e.ts`.
- **`e2e/run-env.e2e.ts`** (test play only; `integration_globs`, so the build may not write it): the real-stack proof the kit requires of the test play. It covers AC-1 to AC-3 the same way, tagged the same, and closes clients with `cleanupThenClose` from `e2e/db-cleanup.ts`.
- **Red check.** `ac-red` reverts only `src/**`, so it skips this ticket. On main, the script does not exist and every test fails. The lead confirms this by hand and posts it on the PR.
- **Out of scope:** `sdlc.toml`, the runbook, CI and `ops/agent-fe-builder.sh` (`FE_BUILDER_PORT` stays manual).

**Agent:** build with `builder`; it writes `ops/run-env.mjs` and `src/run-env.test.ts` and runs `npx --no-install vitest run src/run-env.test.ts` against the local Postgres in `DATABASE_URL`. The test play (`tester`) writes `e2e/run-env.e2e.ts`.
