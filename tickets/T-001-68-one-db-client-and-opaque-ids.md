---
id: T-001-68
title: "One database client for the server modules, and one opaque-id helper for proposals"
type: backend
lane: refactor
status: ready
risk: medium
depends_on: [T-001-01, T-001-03, T-001-06, T-001-10, T-001-14, T-001-17, T-001-23, T-001-24, T-001-52]
files:
  - "src/server/db/client.ts"
  - "src/server/db/close-database.test.ts"
  - "src/server/plans/http.ts"
  - "src/server/auth/http.ts"
  - "src/server/proposal/attempt.ts"
  - "src/server/proposal/attempt.test.ts"
  - "src/server/proposal/trigger.ts"
  - "src/server/proposal/trigger.test.ts"
  - "src/server/invites/inbox.ts"
  - "src/server/join/db.ts"
  - "src/server/ids.ts"
  - "src/server/ids.test.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md#Proposal attempt"
requirements:
  - F-001-25
  - F-001-40
  - N-001-10
acceptance_criteria:
  - "AC-1: src/server/auth/http.ts, src/server/plans/http.ts, src/server/proposal/attempt.ts, src/server/invites/inbox.ts and src/server/join/db.ts each export closeDatabase(); after their clients have been used, calling the five one after another resolves every call, and a second round of the five calls also resolves every call"
  - "AC-2: after a select through db() from src/server/plans/http.ts, src/server/invites/inbox.ts and src/server/join/db.ts and a readAccountSession call with a live session token, calling the five closeDatabase() functions at the same time through Promise.allSettled (as cleanupThenClose in e2e/db-cleanup.ts does) fulfils all five"
  - "AC-3: after any one of the five closeDatabase() calls resolves, a select through db() from src/server/plans/http.ts, from src/server/invites/inbox.ts and from src/server/join/db.ts each returns its rows, and readAccountSession with a live session token returns ok true for that account"
  - "AC-4: with DATABASE_URL unset, importing the five modules does not throw, and the first db() call from src/server/plans/http.ts, src/server/invites/inbox.ts or src/server/join/db.ts throws an Error whose message contains DATABASE_URL"
  - "AC-5: a runProposalAttempt that ends proposed stores one proposals row whose id matches ^prp_[0-9a-f]{32}$ and a proposal_runs row for that run whose id matches ^prn_[0-9a-f]{32}$"
  - "AC-6: applyHourFullVenueData(planId) on an existing plan stores one new proposal_runs row with outcome blocked, block_time false, block_budget false and block_venue_data true, whose id matches ^prn_[0-9a-f]{32}$; a second call on the same plan stores a second row with a different id"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0004-attempt-lock-fail-fast.md
  - decisions/ADR-0006-patterns-rulebook.md
  - .sdlc/decisions/ADR-0004-refactor-lane.md
---

Roadmap item 10: "the `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`" and "the private `newOpaqueId` copies in `proposal/attempt.ts` and `proposal/trigger.ts`". This is a **refactor** (kit ADR-0004): behaviour does not change. The AC pin today's behaviour through functions `main` already exports, so their tests pass on `main` and on this branch. No AC test may call a function this ticket adds.

There are five copies of the same lazy client, each with its own `closeDatabase()`:

| File | Lines on `main` (4ba8288) |
|---|---|
| `src/server/plans/http.ts` | `let database` L100, `db()` L103–108 (exported), `closeDatabase()` L110–116 |
| `src/server/auth/http.ts` | `let database` L65, `db()` L75–80 (private), `closeDatabase()` L82–88 |
| `src/server/proposal/attempt.ts` | `let database` L120, `db()` L122–127 (private), `closeDatabase()` L129–135 |
| `src/server/invites/inbox.ts` | L1, L5–22 (`db()` exported); `INBOX_LIMIT` (L3) stays |
| `src/server/join/db.ts` | the whole file, L1–20 (`db()` exported) |

And two copies of `newOpaqueId(prefix)` (`prefix + randomBytes(16).toString("hex")`): `src/server/proposal/attempt.ts` L141–143 (used for `prp_` L478 and `prn_` L555) and `src/server/proposal/trigger.ts` L43–45 (used for `prn_` L122).

`skills/backend-patterns` already says there is "one client in `src/server/db/client.ts`" (Lock, Persistence). It has no "Where things go" row for the lazy client, so this ticket settles it: the client moves into `src/server/db/client.ts`, and the five modules keep exporting what they export today. `src/server/plans/http.ts` cannot be the shared home: it imports `src/server/auth/http.ts`, so `auth/http.ts` importing its `db()` would make an import cycle.

- **`src/server/db/client.ts`:** keep `createDb()` as it is (its tests in `src/server/db/client.test.ts` stay green). Add `db()` and `closeDatabase()` below it. **Copy `src/server/join/db.ts`** (it is exactly the pair, with nothing else), with one change: `closeDatabase()` takes the current client into a local and sets the module variable to `undefined` *before* awaiting `$client.end({ timeout: 5 })`, so two concurrent calls end the client once (AC-2). The client is still created on first `db()` call, never at import (AC-4).
- **The five modules:** delete each module's `let database`, its `db()` body and its `closeDatabase()` body. Each module still exports exactly the names it exports today, from the shared pair:
  - `src/server/plans/http.ts`, `src/server/invites/inbox.ts`, `src/server/join/db.ts`: `import { closeDatabase, db } from "@/server/db/client";` and `export { closeDatabase, db };` (`plans/http.ts` also calls `db()` itself, so a bare `export ... from` is not enough; `inbox.ts` keeps `INBOX_LIMIT`). No caller changes its import; `src/app/api/v1/join/[token]/route.ts`, `src/server/plans/role.ts` and the other importers are not edited.
  - `src/server/auth/http.ts`, `src/server/proposal/attempt.ts`: the same import, and `export { closeDatabase };`. `db` stays private, as today.
  - Keep `type Database = ReturnType<typeof createDb>` only where a `Transaction` type still needs it (`plans/http.ts` L725, `attempt.ts` L54); remove an import that becomes unused.
  - There is no re-export in `src/` today; the ticket names this form so the build does not invent another.
- **`src/server/ids.ts`:** add `OPAQUE_ID_PREFIXES = ["prp_", "prn_"] as const`, `type OpaqueIdPrefix`, and `generateOpaqueId(prefix: OpaqueIdPrefix): string` returning `prefix + randomBytes(16).toString("hex")`. Copy the shape of `ID_PREFIXES` / `generateJoinToken` in the same file. `generateId` and the 22-character ids in `arch/CONTRACTS.md` § Identifiers do not change; proposal and run ids stay 32 hex characters.
- **`src/server/proposal/attempt.ts`, `src/server/proposal/trigger.ts`:** delete `newOpaqueId` and call `generateOpaqueId`. Drop `randomBytes` from `trigger.ts` if nothing else uses it. No other change; the attempt lock (product ADR-0004) and the hourly cap are untouched.
- **Tests.** Every existing test file keeps every line; a test may only gain an AC tag. All five `closeDatabase` imports in `src/**/*.test.*` and `e2e/**` keep working unchanged.
  - AC-1 to AC-4: new `src/server/db/close-database.test.ts` against the real `DATABASE_URL`. `src/server/db/client.test.ts` mocks `postgres` for the whole file, so these cannot live there. Copy the account setup (`register` through `POST /api/v1/accounts`) and the `postgres(databaseUrl, { max: 1, ... })` helper client from `src/server/auth/page-data.test.ts`. AC-4 runs in its own `describe` with `vi.resetModules()` and dynamic imports, and restores `DATABASE_URL` after.
  - AC-5: one new test in `src/server/proposal/attempt.test.ts`, copying the setup of the existing proposed-run tests there (`seedTwoMemberPlan`, `attemptDeps`, `googleFetch`).
  - AC-6: new `src/server/proposal/trigger.test.ts` (beside the module, as the rulebook's "Unit test" row says), seeding a plan the way `attempt.test.ts` does.
  - `generateOpaqueId` gets untagged unit tests in `src/server/ids.test.ts`, beside the existing `generateJoinToken` tests. They cannot be AC proof: they fail on `main`.
- **Equivalence the reviewer argues:** the five modules already used one database, through five `postgres` clients (pools); now they use one client per process. Each query, transaction and lock is the same SQL on a connection from that pool. Closing through any module now closes the one client, and the next `db()` call from any module opens a new one (AC-3). `closeDatabase()` without an open client still resolves (AC-1). The pool cap per process drops from five clients to one (postgres.js default `max` 10); nothing in `src/` holds a transaction on one module's client while waiting on another's.
- Out of scope: the other `prefix + randomBytes(16).toString("hex")` copies (`ses_` in `auth/http.ts` L90–92, `pse_` in `src/server/response/place-search.ts` L45, `gst_` / `lnk_` in `src/app/api/v1/join/[token]/route.ts` L76–82); the join route's own `planRoleFor` helpers (ADR-0008; a separate ticket, held for a lead reading of ADR-0008); `sdlc.toml`'s jscpd threshold (lead).
- No route, table, column, dependency or message key changes. No file under `drizzle/`.

**Agent:** build with `builder`. The refactor lane runs every suite in the build, so it needs `DATABASE_URL` and the Playwright browsers as for any full run.
