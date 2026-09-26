# Review PR-7 — T-001-02 Schema migration

Ticket: T-001-02 (`tickets/T-001-02-schema.md`)
Branch: `build/T-001-02-schema` @ `574d716`
Risk: low (L2 review)

## Checks

### 1. Diff ⊆ ticket `files:` (+ allowed extras)

Ticket `files:`: `src/server/db/schema.ts`, `src/server/db/schema.test.ts`, `drizzle/0001_init.sql`.

| Path | Allowed because |
|---|---|
| `drizzle/0001_init.sql`, `schema.ts`, `schema.test.ts` | ticket `files:` |
| `tickets/T-001-02-schema.md` status `ready` → `in_review` | build skill §6 |

No other production paths. Pass.

### 2. No new public seam vs CONTRACTS.md

No HTTP routes, events, cookies, or Google clients. Tables/columns match `arch/CONTRACTS.md` § Tables exactly (22 tables). The `plan_state` enum is not a table; it backs `plans.state`. Pass (hard rule 4).

### 3. AC mapped to tests

| AC | Proof | Test |
|---|---|---|
| every CONTRACTS table/column in `0001_init.sql` | `drizzle/0001_init.sql:2-199` CREATE TABLE ×22; columns match `CONTRACTS.md:547-568` | `schema.test.ts` “creates every CONTRACTS table…”, “…column…” |
| partial unique participants `(plan_id, account_id)` where `account_id IS NOT NULL` | `0001_init.sql:236`; `schema.ts:126-128` | “enforces a partial unique…” |
| unique `(plan_id, account_id)` on invitations | `0001_init.sql:24`; `schema.ts:204` | “enforces unique… on invitations” |
| exactly one of `account_id` / `guest_session_id` | CHECK `participants_account_xor_guest` `0001_init.sql:48`; `schema.ts:122-125` | “requires exactly one of…” |
| no extra tables | 22 CREATE TABLE only; test asserts equality to `CONTRACT_TABLES` | “creates every CONTRACTS table and no other table” |
| `schema.test.ts` applies migration on Postgres from `DATABASE_URL` | `schema.test.ts:162-178` (`sql.file(migrationPath)` after `CREATE SCHEMA`) | suite itself |
| no down migration | `drizzle/` contains only `0001_init.sql` | “is the only migration file and has no down migration” |

Pass.

### 4. Patterns (backend-patterns / ADR-0001)

- Schema at `src/server/db/schema.ts`; migration `drizzle/0001_init.sql` forward-only (backend-patterns Migrations; ADR-0001 Data).
- Money columns are integer minor units (`bigint` / `moneyMinor`), not floats (ADR-0001; backend-patterns).
- Plan state enum values `collecting|blocked|proposed|locked` (ADR-0001).
- No second ORM, no SQLite, no invented tables/columns.
- Vitest + live `DATABASE_URL` (backend-patterns Testing).

Pass.

### 5. No silent `[OPEN]` resolution

None. Pass.

## Findings

None blocking.

Note (non-blocking): `response_windows.kind` and `step_signals.signal` CHECKs encode CONTRACTS domain values (`busy`/`free`, `like`/`dislike`). Not required as SQL CHECKs by the column list, but consistent with the contract and covered by migration text.

## Verdict

**Approve.** All ticket AC met; AGENTS hard rules 4–5 and 8 honored for this schema slice. Do not merge from this review session — human / CI merge gate.
