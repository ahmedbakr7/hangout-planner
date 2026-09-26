# Review PR-5 — T-001-01 App bootstrap

Ticket: T-001-01 (`tickets/T-001-01-bootstrap.md`)
Branch: `build/T-001-01-bootstrap` @ `e65a652`
Risk: low (L2 review)

## Checks

### 1. Diff ⊆ ticket `files:` (+ allowed extras)

Ticket `files:`: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `src/server/db/client.ts`.

| Path | Allowed because |
|---|---|
| listed configs + `client.ts` | ticket `files:` |
| `src/server/db/client.test.ts` | AGENTS `/build` May write: unit tests beside listed files; build skill §4 |
| `tickets/T-001-01-bootstrap.md` status `ready` → `in_review` | build skill §6 |

No other production paths. Pass.

### 2. No new public seam vs CONTRACTS.md

No HTTP routes, tables, schema module, events, cookies, or Google clients. `drizzle.config.ts` points at `./src/server/db/schema.ts` for a later ticket; this PR does not create tables. Pass.

### 3. AC mapped to tests

| AC | Proof | Test |
|---|---|---|
| engines Node 22 | `package.json:4-6` | `client.test.ts` “declares Node 22 in engines” |
| locked dependencies / devDependencies | `package.json:13-31` exact key sets | `client.test.ts` “has the locked dependency set” |
| no Tailwind / Prisma / NextAuth / second HTTP client | same manifest | `client.test.ts` forbidden-name filter |
| tsconfig strict + `@/` → `src/` | `tsconfig.json:7`, `tsconfig.json:16-18` | `client.test.ts` “is TypeScript strict…” |
| Vitest runs | `vitest.config.ts`; `npm test` → 8 passed | suite itself |
| Drizzle client reads `DATABASE_URL` | `client.ts:4-8`; `drizzle.config.ts:7-9` | `createDb` + `drizzle.config` describes |

Pass.

### 4. Patterns (backend-patterns / ADR-0001)

- Single Drizzle client at `src/server/db/client.ts` (backend-patterns persistence lock).
- Stack deps match ADR-0001 (Next, React, drizzle-orm, postgres, argon2, next-intl; Node 22; Vitest; drizzle-kit).
- No second ORM, auth helper, logger, or HTTP client.
- No invented FE/BE pattern.

Pass.

### 5. No silent `[OPEN]` resolution

None. Pass.

## Findings

None blocking.

Note (non-blocking): `package-lock.json` is present locally after install but not in the PR; AC does not require it.

## Verdict

**Approve.** All ticket AC met; AGENTS hard rules 4–5 and 8 honored for this bootstrap slice. Do not merge from this review session — human / CI merge gate.
