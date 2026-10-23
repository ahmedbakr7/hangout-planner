---
id: T-001-81
title: "Upgrade drizzle-orm to 0.45.4 for the identifier-escaping advisory"
type: chore
status: ready
risk: medium
test: none
depends_on: [T-001-35, T-001-52, T-001-62, T-001-80]
files:
  - "package.json"
  - "package-lock.json"
  - "src/server/db/drizzle-version.test.ts"
skills:
  - build
  - backend-patterns
contracts: []
requirements: []
acceptance_criteria:
  - "AC-1: package.json declares drizzle-orm ^0.45.4, package-lock.json resolves node_modules/drizzle-orm to a 0.45.x version at or above 0.45.4, and the installed drizzle-orm package reports it"
  - "AC-2: a Postgres identifier built with sql.identifier from a name that contains a double quote renders with that quote doubled: PgDialect turns sql`select ${sql.identifier('a\"b')}` into select \"a\"\"b\""
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

`npm audit --omit=dev` on main (`cea2687`) reports GHSA-gpj5-g38j-94v9 (high, CVE-2026-39356) for drizzle-orm below 0.45.2: `escapeName()` does not double the quote inside a Postgres identifier, so untrusted input passed to `sql.identifier()` or `.as()` can inject SQL. Main locks 0.44.7. The app passes no runtime input to either today (no `sql.identifier`, `sql.raw` or `.as(` under `src/`), so the exposure is latent, but `^0.44.0` cannot reach the fix. The lead approved the bump on 2026-10-23.

The lead installs before the build runs (agents cannot run `npm install`), as for T-001-62 (`7aa0398`): `npm install drizzle-orm@^0.45.4`. In 0.x a minor bump is a breaking range, which is why `package.json` changes here. The 0.45.0 release notes list no breaking change for postgres-js or pg-core; `$onUpdate` now handles `SQL` values, and the schema uses no `$onUpdate`. drizzle-kit stays at ^0.31.0. The lead's dry run on `cea2687` (typecheck, lint, 717 unit, 220 integration, `next build`, 16 browser tests) passed except T-001-35/AC-1, which T-001-80 keeps green. The lead's commit names the command and the `npm audit` result.

- **`src/server/db/drizzle-version.test.ts`** (`// @vitest-environment node`), tagged `T-001-81/AC-1` and `T-001-81/AC-2`:
  - AC-1: reads `package.json`, `package-lock.json` and `node_modules/drizzle-orm/package.json` as JSON (`drizzle-orm` does not export `./package.json`, so read the file by path, as `src/next-version.test.ts` reads `next`'s).
  - AC-2: imports `sql` from `drizzle-orm` and `PgDialect` from `drizzle-orm/pg-core`, and checks `new PgDialect().sqlToQuery(...).sql`. No database. On 0.44.7 this renders `select "a"b"`, so the test fails on the old version.
- **Red check.** `ac-red` reverts only `src/**`, so it cannot fail these tests on the base. The lead runs them against main's install by hand and posts the failing output on the PR, as for T-001-76.
- **Security check.** The lead runs `npm audit --omit=dev` on the build head and posts the result: 0 vulnerabilities.
- `test: none`: the integration and browser suites already run every query through drizzle on Postgres. Nothing under `drizzle/**` changes, so the ticket runs in the standard lane.
- **Out of scope:** any use of the new 0.45 APIs; no change to queries, schema or `drizzle/0001_init.sql`.
