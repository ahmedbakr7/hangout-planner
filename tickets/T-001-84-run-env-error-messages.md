---
id: T-001-84
title: "scripts/run-env.mjs: name the real cause when setup fails for a reason other than the connection"
type: chore
status: ready
risk: low
depends_on: [T-001-83]
files:
  - "scripts/run-env.mjs"
  - "src/run-env.test.ts"
  - "e2e/run-env.e2e.ts"
skills:
  - build
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: node scripts/run-env.mjs setup, with DATABASE_URL naming a reachable server, a fresh SDLC_RUN_ID, and SDLC_RUN_ENV naming a file inside a directory that does not exist, exits 1 with one stderr line that names SDLC_RUN_ENV, does not contain the text cannot reach and does not contain the URL's password, and leaves no database hp_run_<id> for that run"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0014-per-run-database-and-ports.md
  - decisions/ADR-0015-run-env-script-in-scripts.md
---

Follow-up to T-001-83, from its review on #184 (findings 1 to 4). Today `describeFailure` in `scripts/run-env.mjs` reports every error that is not a Postgres server error as "cannot reach the Postgres server named by DATABASE_URL at host H port P". That includes a failed `appendFileSync`, a missing schema file and the port-pick failure. ADR-0014 exists partly because a dead Postgres failed unclearly, so a gate failure must name its real cause.

- **`scripts/run-env.mjs`:** only a connection failure prints the existing connection line. Treat as a connection failure an error whose `code` is `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `EHOSTUNREACH` or `CONNECT_TIMEOUT`, or starts with `CONNECTION_`. Server errors keep today's line. Any other error prints one line that names the step and the cause, for example `setup failed writing SDLC_RUN_ENV (<path>): <error.message>`. Name the step in the catch around it: schema file, port pick, append. Before printing any line, remove the URL's password from it in both forms, `url.password` (percent-encoded) and `decodeURIComponent(url.password)`, and collapse any newline so the output stays one line. Behaviour on failure is unchanged: exit 1, nothing appended, and the database this run created is dropped.
- **`src/run-env.test.ts`** (build): add a test tagged `T-001-84/AC-1`. Use a temp directory and a child path in a directory that was never created. Then query `pg_database` for the run's name. Keep every existing test and its tag unchanged.
- Also add these untagged regression tests, which strengthen the T-001-83 proof:
  - A closed-port `DATABASE_URL` still prints the connection line (T-001-83 AC-3 must keep passing after the change).
  - With a closed-port `DATABASE_URL`, an unset `SDLC_RUN_ID` and an unset `SDLC_RUN_ENV` each print their `... is required` message and not the connection line. This proves the input checks run before connecting.
  - With `DATABASE_URL` naming an existing other database `hp_run_<other>` and `SDLC_RUN_ID` naming a live run, teardown drops the run's database and leaves `hp_run_<other>`. This proves the name comes only from `SDLC_RUN_ID`.
- **`e2e/run-env.e2e.ts`** (test play only): AC-1 through the real script and Postgres, tagged the same, with cleanup as in the file today.
- **Red check:** `ac-red` reverts only `src/**`, so it skips this ticket. On main, AC-1 fails because the line says "cannot reach". The lead confirms this by hand and posts it on the PR.
- **Out of scope:** a shared helper module for `src/run-env.test.ts` and `e2e/run-env.e2e.ts` (review finding 6). The repo has no example of a helper shared by a `src/` unit test and an `e2e/` test. The nearest is `src/server/db/test-schema.ts`, imported by `src/server/db/test-schema.test.ts`, `vitest.global-setup.ts` and `browser/global-setup.ts`; the convention discussion starts from it (roadmap row 24).

**Agent:** build with `builder`; it changes `scripts/run-env.mjs` and `src/run-env.test.ts` and runs `npx --no-install vitest run src/run-env.test.ts` against the local Postgres in `DATABASE_URL`. The test play (`tester`) changes `e2e/run-env.e2e.ts`.
