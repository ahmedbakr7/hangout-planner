# Hangout roadmap (on hold)

Date: 2026-10-04. Main: `9672626`, kit pin `9e105b3`.

**Status: on hold.** Work moves to the ai-sdlc kit first: lighter lanes for mechanical changes, soft write sets, ticket amendments, and approvals tied to the PR. Pick this list up after the kit releases that work and Hangout pins it. Run mechanical items (1 and the path-only parts of 2) through the kit's mechanical lane once it exists, not through the full ticket flow.

Tracker adapters (Linear, GitHub Issues) are deferred: tickets stay in `tickets/`.

## Where things stand

- `sdlc gate ci` passes on a fresh database.
- The baseline (`sdlc-baseline.json`) holds main's known failures. It may only shrink.

| Baseline entry | Count |
|---|---|
| `artifacts` | 14 |
| `contracts` | 25 |
| `typecheck` | 9 |
| `test-quality` | 26 |
| `ac-coverage` | 241 |
| `trace` | 241 |

- The `/api/v1` move is half done. Option A applies: handlers stay in `src/app/api/v1`, while CONTRACTS and the UI move to `/api/v1`.
  - T-001-32 is done (#62): account gate, create form, home list, invite panel, join panel.
  - T-001-33 is `ready` and not started.
- Pilot findings and history: `docs/sdlc-pilot-report.md`.

## Plan, in order

| # | Item | Kind | Notes |
|---|---|---|---|
| 1 | Finish `/api/v1`: T-001-33 (organizer plan, response form, proposal view, confirmed view) plus the confirmed-view stub in `e2e/rtl.e2e.ts`, then delete the "Transitional: old `/v1` paths" section of `arch/CONTRACTS.md` | Ticket + lead | One PR if the kit allows; `sdlc baseline --prune` drops the remaining `contracts` entries |
| 2 | Fix `e2e/ui-api-paths.e2e.ts` (from the #62 reviews) | New ticket | Each test registers its own account and resets the cookie jar; wait for the loaded empty states; cover create form and join panel too |
| 3 | Fix the 9 test type errors | New ticket | `typecheck` baseline → 0 |
| 4 | Replace source-text tests (`readFileSync` / `read("src/...")`) with behaviour tests | New tickets | About 11 files and ~191 assertions; `test-quality` baseline |
| 5 | Add Playwright e2e against `next start`; then remove the temporary `tests.real_stack = ["integration"]` override in `sdlc.toml` | New ticket + lead | Needs Playwright in CI |
| 6 | Tag shipped tests `T-001-xx/AC-n` | New tickets | Shrinks `ac-coverage` and `trace` (241 each) |
| 7 | Fix the 14 lead-artifact lint errors | Lead | plan-001 v1 sections and `status`; 7 tickets with no requirement; T-001-01 AC-5 untestable; T-001-01 cites all of CONTRACTS |
| 8 | Decide, then ticket: attempt-lock wait (CONTRACTS says it waits up to 20 s, T-001-24 AC-4 returns 409 at once) | ADR, then ticket | The contract was weakened when the ticket was written |
| 9 | Decide, then ticket: rate-limit state (in-process `Map` in `src/server/response/place-search.ts:9`) | ADR, then ticket | No contract or ADR says where it lives |
| 10 | Remove duplicates: `planRoleFor` copies and the `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`; the opening + me fetch pair in `join-panel.tsx` | New ticket | Then lower the jscpd threshold (10%) |
| 11 | Commit a lockfile; add ESLint so `lint` means something | Lead | `lint` is currently `tsc` without tests |

## Decisions the lead owes

- Item 8: should the attempt lock wait up to 20 s (CONTRACTS) or fail fast (T-001-24)?
- Item 9: where rate-limit state lives (database, or in-process with a documented limit).

## Running it

- Local Postgres for gates: start Postgres 16 on port 5433. Point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5433/<db>` and use a fresh database per full run.
- Ticket flow, until the kit's new lanes land:
  1. Build.
  2. Test play (real-handler proof).
  3. Review in a separate session.
  4. Merge main into the branch.
  5. Run `sdlc gate pr`.
  6. Merge once CI is green and the CodeRabbit review (the review itself, not only its summary) has no blocking findings.
- Prove AC tests by mutation: revert each changed path or branch one at a time and confirm a tagged test fails.
