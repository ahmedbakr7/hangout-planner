---
id: T-001-82
title: "ops/run-env.mjs: per-run database and browser-test ports for the gate"
type: chore
status: ready
risk: medium
depends_on: []
files:
  - "ops/run-env.mjs"
  - "e2e/run-env.e2e.ts"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: node ops/run-env.mjs setup, with DATABASE_URL naming a reachable server, SDLC_RUN_ID, SDLC_RUN_ENV and SDLC_APP_PORT set, exits 0; it creates database hp_run_<id> (SDLC_RUN_ID lower-cased, characters outside [a-z0-9_] replaced by _), whose public schema then has the accounts table from drizzle/0001_init.sql, and appends exactly three lines to $SDLC_RUN_ENV: DATABASE_URL (the input URL with that database), HP_E2E_APP_PORT and HP_E2E_GOOGLE_STUB_PORT, two different decimal ports, neither equal to SDLC_APP_PORT, that a test can bind on 127.0.0.1 straight after"
  - "AC-2: node ops/run-env.mjs teardown, with the same SDLC_RUN_ID and DATABASE_URL set to the run's own database (as the kit passes it after setup), exits 0 and the database no longer exists; a second teardown for the same run also exits 0; with SDLC_RUN_ID empty or unset, teardown exits non-zero, prints SDLC_RUN_ID is required, and a sentinel hp_run_* database the test created beforehand still exists"
  - "AC-3: setup with DATABASE_URL naming a port where nothing listens exits non-zero within 15 seconds, prints a message that contains the host, the port and DATABASE_URL and does not contain the URL's password, and leaves $SDLC_RUN_ENV missing or empty; setup with DATABASE_URL unset exits non-zero and prints DATABASE_URL is required"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0012-browser-test-ports-from-env.md
  - decisions/ADR-0013-kit-v5-claims-and-auto-port.md
  - decisions/ADR-0014-per-run-database-and-ports.md
---

ADR-0014 step 1: the script the gate's `[app] setup` and `teardown` will call. This ticket writes only the script and its real-stack test. Wiring `sdlc.toml` is the lead PR that follows, because the gate reads `sdlc.toml` from main.

- **`ops/run-env.mjs`:** plain Node ESM, no TypeScript, run as `node ops/run-env.mjs <setup|teardown>`. Any other argument exits 2 with a usage line. Copy `browser/google-stub.mjs` for the shape of a runnable `.mjs` script. Use only `postgres` (already a dependency) and Node built-ins (`node:net`, `node:fs`, `node:path`, `node:url`). No new package.
  - Parse `DATABASE_URL` with `new URL()`. Every connection goes to the same URL with its path set to `/postgres` (the maintenance database), `max: 1`, and `connect_timeout` of 10 seconds or less. Always `end()` the client, error or not.
  - The run database name is built from `SDLC_RUN_ID` as AC-1 says, and quoted as an identifier (`sql(name)` in postgres.js). It is never interpolated as text. Both commands exit non-zero with `SDLC_RUN_ID is required` when it is empty or unset, and check the name against `^hp_run_[a-z0-9_]{1,56}$` (63 bytes at most, so Postgres never truncates it) before connecting.
  - `setup` runs `CREATE DATABASE`. It then connects to the new database and runs `sql.file(<repo>/drizzle/0001_init.sql)`; resolve the path from the script's own location, not the cwd. Then it picks the ports and appends the three lines with one `appendFileSync` call, after the database work succeeds, so a failure writes nothing. Pick each port by listening on `127.0.0.1` port 0 and closing. Retry until the two differ from each other and from `SDLC_APP_PORT`, 20 tries at most.
  - Errors print one line to stderr. For a connection failure, the line names `DATABASE_URL`, the host and the port. Never print the URL or the password. Exit 1.
  - `teardown` runs `DROP DATABASE IF EXISTS <name> WITH (FORCE)`.
- **`e2e/run-env.e2e.ts`** (`integration_globs`, real Postgres from `DATABASE_URL`, as every `e2e/` file), tagged `T-001-82/AC-1` to `AC-3`. Run the script with `child_process.spawnSync(process.execPath, ["ops/run-env.mjs", ...])`, with a unique `SDLC_RUN_ID` per test and `SDLC_RUN_ENV` in a temp directory.
  - AC-1: parse the env file and check the three keys. Connect to the new `DATABASE_URL` and check that `accounts` exists. Bind both ports with `node:net`.
  - AC-2: run teardown, then query `pg_database` from the maintenance connection. For the empty-id case, first create a sentinel `hp_run_<unique>` database through the maintenance connection, run teardown with `SDLC_RUN_ID` removed and again with it set to `""`, assert the stderr text, and then assert the sentinel still exists before dropping it. Keep the positive and negative cases in one test, so that on main (no script) it fails at the first step.
  - AC-3: use a closed port: bind one with `node:net`, close it, and use it. Give a password the test can search for in the output. Also run with `DATABASE_URL` removed from the child's env.
  - Clean up any `hp_run_*` database a test made, even when it fails. Copy the `DROP DATABASE ... WITH (FORCE)` cleanup and the URL rewrite in `e2e/test-schema.e2e.ts`, and close clients with `cleanupThenClose` from `e2e/db-cleanup.ts`.
- **Red check.** `ac-red` reverts only `src/**`, so it skips this ticket. On main, the script does not exist and every test fails. The lead confirms this by hand and posts it on the PR.
- **Out of scope:** `sdlc.toml`, the runbook, CI and `ops/agent-fe-builder.sh` (`FE_BUILDER_PORT` stays manual).

**Agent:** build with `builder`. It may run `npx --no-install vitest run --config vitest.e2e.config.mts e2e/run-env.e2e.ts` against the local Postgres in `DATABASE_URL`.
