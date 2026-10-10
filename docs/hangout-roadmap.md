# Hangout roadmap

Date: 2026-10-09. Main: `27bf4d5`, kit pin `cd8a8fc` (v1.5.2).

**Status: active.** The kit released lanes, areas and amendments, forge approvals, evidence in CI and derived status (ADR-0001), plus the v2 baseline, waivers and strictness presets (ADR-0002). T-001-33 ran end to end under the then-current v1.5.0 pin (#73, re-merged as #74); findings are in `docs/sdlc-pilot-report.md`.

## Where things stand

- `sdlc gate ci` passes on a fresh database.
- The baseline (`sdlc-baseline.json`, version 2) holds main's known failures as counts per key. It may only shrink.

| Baseline entry | Keys | Count |
|---|---|---|
| `artifacts` | 14 | 14 |
| `contracts` | 11 | 11 |
| `typecheck` | 7 | 9 |
| `test-quality` | 11 | 26 |
| `ac-coverage` | 241 | 241 |
| `trace` | 241 | 241 |

- The `/api/v1` move is done. T-001-32 (#62) and T-001-33 (#73, #74) moved every UI call. #75 deleted the "Transitional: old `/v1` paths" section of `arch/CONTRACTS.md` and repointed 16 shipped tickets' `contracts:` references from `/v1/...` to `/api/v1/...`.
- The 11 `contracts` entries left are pages in code that CONTRACTS does not declare (`/`, `/account`, `/invitations`, `/join/{}`, `/plans/new`, `/plans/{}` and 5 plan subpages).
- Approvals are trust-based (`[approval] trust_unsigned = true`, one GitHub identity). `sdlc/approval` turns green on a `role: review` record from a session that did not build the ticket, or on a `role: lead` record.
- T-001-33 is `done`. #73 was squash-merged, which buried its `Sdlc-Ticket` trailer, so main read it as `ready`. #74 merged the original commits (`a11821e`, `34f518a`) with a merge commit and no content change; derived status now reads `done`. The recovery is in the pilot report.
- Repo settings allow merge commits only. Squash and rebase merging are disabled.

## Plan, in order

| # | Item | Kind | Notes |
|---|---|---|---|
| 1 | Fix `e2e/ui-api-paths.e2e.ts` (from the #62 reviews) | New ticket; blocked by pilot finding 19 (a test-only ticket cannot pass `gate build`) | Each test registers its own account and resets cookies; wait for loaded empty states; cover create form and join panel. Use `e2e/route-server.ts` (from #73), which already keeps a cookie jar per actor |
| 2 | Fix the 9 test type errors | New ticket | `typecheck` baseline → 0 |
| 3 | Replace source-text tests (`readFileSync` / `read("src/...")`) with behaviour tests | New tickets | 11 files, 26 hits; `test-quality` baseline |
| 4 | Declare the 11 pages in CONTRACTS | Lead | `contracts` baseline → 0 |
| 5 | Add Playwright e2e against `next start`; then remove the temporary `tests.real_stack = ["integration"]` override in `sdlc.toml` | New ticket + lead | Needs Playwright in CI |
| 6 | Tag shipped tests `T-001-xx/AC-n` | New tickets | Shrinks `ac-coverage` and `trace` (241 each) |
| 7 | Fix the 14 lead-artifact lint errors | Lead | plan-001 v1 sections and `status`; 7 tickets with no requirement; T-001-01 AC-5 untestable; T-001-01 cites all of CONTRACTS |
| 8 | Done: ADR-0004 keeps fail-fast (409 `attempt_in_progress` at once); CONTRACTS § Proposal attempt now matches T-001-24 AC-4 | Lead | No code change |
| 9 | Ticket: move the place-search limit from the in-process `Map` (`src/server/response/place-search.ts:9`) to the `place_searches` table, with its migration | New ticket | Decided in ADR-0005; the table is declared in CONTRACTS § Tables |
| 10 | Remove duplicates: `planRoleFor` copies and the `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`; the opening + me fetch pair in `join-panel.tsx`; the initial-load and retry-load pairs in the four plan views | New ticket | Then lower the jscpd threshold (10%) |
| 11 | Commit a lockfile; add ESLint so `lint` means something | New ticket | `npm install` writes an untracked `package-lock.json` that every gate accepts silently |
| 12 | Blocked: update the `/v1` paths in the AC text of T-001-06, 10, 15, 17 and 24 to `/api/v1` | Lead | From the #75 CodeRabbit review; #75 moved only the `contracts:` lines. The ACs are kit-guarded, so this needs the lead. Not possible: `gate pr` `immutable` fails any AC reword, even a path rename, unless the spec changes or a `strengthen` amendment is added (pilot finding 18). ADR-0003 governs the path; the AC text stays as is |
| 13 | Tighten `e2e/plan-views-api-paths.e2e.ts` `fakeGoogle` (match the place-details URL, throw on any other) and check `isDirectory()` in `e2e/route-server.ts` | New ticket | From the #74 CodeRabbit review |
| 14 | Replace `/v1` with `/api/v1` in `skills/backend-patterns/SKILL.md:14` and `skills/frontend-patterns/SKILL.md:16-17`; record the move in a new ADR, since ADR-0001 (lines 29, 46) and ADR-0002 (line 37) are accepted and immutable | Lead | From the post-merge review of #75. Agents read these files during build. Done in this lead PR (ADR-0003) |
| 15 | `src/i18n/fallback.test.ts:90` stubs `/v1/me`, but AccountGate calls `/api/v1/me`, so the 401 path is never exercised; `src/app/api/v1/join/[token]/route.ts:128` logs the path as `/v1/join`; doc comments in `src/server/plans/views.ts:240,260` | New ticket | From the post-merge review of #75. Can join item 1's ticket. Optional: route-test request URLs to `/api/v1` |
| 16 | Ticket T-001-34. On 409 `attempt_in_progress` after a `PUT` response or `PATCH` plan, `src/components/response-form.tsx` and `src/components/organizer-plan.tsx` show a generic save error; CONTRACTS § Proposal attempt says the client refetches the plan (the write committed) | New ticket | From the CodeRabbit review of #79 (ADR-0004) |

## Decisions the lead owes

- None open. Items 8 and 9 are decided in ADR-0004 and ADR-0005.

## Running it

- Local Postgres for gates: start Postgres 16 on port 5433. Point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5433/<db>` and use a fresh database per full run.
- No `[agents.*]` is configured, so `sdlc run` is unavailable and each play runs by hand. Since kit v1.5.1, `sdlc approval` fails a ticket PR with any commit that lacks an `Sdlc-Agent` trailer:
  1. Build, commit with `sdlc commit <id> --agent <name> --play build -m "..."`, then run `sdlc gate build <id>` on the clean commit. Evidence from a dirty tree records the base commit as proven.
  2. Test play: commit with `--play test` and a different `--agent`, then `sdlc gate test <id>`. `sdlc commit` now writes the `Sdlc-Play: build` trailer the test boundary looks for.
  3. `sdlc commit` writes `Sdlc-Agent`, `Sdlc-Play` and `Sdlc-Ticket` as the last paragraph. Do not put `Co-Authored-By` in `-m`: it would sit in an earlier paragraph that git's trailer parser ignores (finding 2).
  4. Open the PR. CI runs `gate ci` and `gate pr`.
  5. Review in a separate session; it posts the `sdlc: approval` record on the PR.
  6. Merge with a merge commit once CI and `sdlc/approval` are green. Never squash: derived status reads `Sdlc-Ticket` from the commits on main.
- Never commit a `sdlc baseline --prune` result without reading it. If a check errors in that run (for example `ac-coverage`: "no test command wrote JUnit"), prune drops all of that check's entries.
- Prove AC tests by mutation: revert each changed path or branch one at a time and confirm a tagged test fails (`ac-red` does this for the build's files).
