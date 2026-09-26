# Review PR-9 — T-001-03 Money and ids

Ticket: T-001-03 (`tickets/T-001-03-money-and-ids.md`)
Branch: `build/T-001-03-money-and-ids` @ `f6ae2c2`
Risk: low (L2 review)

## Checks

### 1. Diff ⊆ ticket `files:` (+ allowed extras)

Ticket `files:`: `src/server/money.ts`, `src/server/money.test.ts`, `src/server/ids.ts`, `src/server/ids.test.ts`.

| Path | Allowed because |
|---|---|
| `money.ts`, `money.test.ts`, `ids.ts`, `ids.test.ts` | ticket `files:` |
| `tickets/T-001-03-money-and-ids.md` status `ready` → `in_review` | build skill §6 |

No other production paths. Pass.

### 2. No new public seam vs CONTRACTS.md

No HTTP routes, tables, events, cookies, or Google clients. Helpers only encode shapes from `arch/CONTRACTS.md` § Identifiers, money, time, text. Pass (hard rule 4).

### 3. AC mapped to tests

| AC | Proof | Test |
|---|---|---|
| Money amounts are integers in minor units; `amount_minor` rejected outside 1..100000000000 | `money.ts:1-2`, `money.ts:26-33`; `parseMoney` via `isAmountMinor` `money.ts:35-44` | `money.test.ts` “accepts integers…”, “rejects amounts outside…”, `parseMoney` rejects |
| Currency list EGP, USD, SAR, AED, each exponent 2 | `money.ts:4-9` | `money.test.ts` “is EGP, USD, SAR, and AED…”; `isCurrencyCode` |
| Ids are `prefix_` + 22 lowercase base32; prefixes `acc_`, `pln_`, `win_`, `stp_`, `opt_`, `prt_`, `inv_` | `ids.ts:3-17`, `ids.ts:64-84` | `ids.test.ts` “id prefixes”, “is prefix_ plus 22 lowercase base32…” |
| Join token is `jt_` + 43 unpadded base64url | `ids.ts:19-22`, `ids.ts:86-98` (`randomBytes(32).toString("base64url")`) | `ids.test.ts` “is jt_ plus 43…”, reject padded/short/long |
| Distinguisher is four chars from `abcdefghjkmnpqrstuvwxyz23456789` | `ids.ts:24-25`, `ids.ts:101-110` | `ids.test.ts` alphabet + reject `i`/`l`/`o`/`0`/`1` |
| Tests are pure: no database and no network | imports are only `vitest`, `./money`, `./ids`, and `node:crypto` in production module | suite itself; `npx vitest run` money+ids → 13 passed |

Pass.

### 4. Patterns (backend-patterns / ADR-0001)

- Money is integer minor units, no floats (ADR-0001 Data; backend-patterns).
- Currency list matches ADR-0001 / CONTRACTS (EGP default list, all exponent 2).
- Id / join-token / distinguisher alphabets and lengths match CONTRACTS § Identifiers.
- Pure Vitest rules next to the module; no DB, no network (backend-patterns Testing).
- No second ORM, auth helper, route, or invented pattern.

Pass.

### 5. No silent `[OPEN]` resolution

None. Pass.

## Findings

None blocking.

Note (non-blocking): `isAmountMinor` uses JS `number` + `Number.isInteger`. The CONTRACTS cap `100000000000` is well below `Number.MAX_SAFE_INTEGER`, so the range check is exact for this slice.

## Verdict

**Approve.** All ticket AC met; AGENTS hard rules 4–5 and 8 honored for this money/ids slice. Do not merge from this review session — human / CI merge gate.
