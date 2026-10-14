# Hangout roadmap

Date: 2026-10-12. Main: `f92dcb2`, kit pin `38f11c3` (tag v3.2.1).

**Status: active.** The kit released lanes, areas and amendments, forge approvals, evidence in CI and derived status (ADR-0001), plus the v2 baseline, waivers and strictness presets (ADR-0002). T-001-33 ran end to end under the then-current v1.5.0 pin (#73, re-merged as #74); findings are in `docs/sdlc-pilot-report.md`.

## Where things stand

- `sdlc gate ci` passes on a fresh database.
- The baseline (`sdlc-baseline.json`, version 2) holds main's known failures as counts per key. It may only shrink.

| Baseline entry | Keys | Count |
|---|---|---|
| `artifacts` | 14 | 14 |
| `contracts` | 11 | 11 |
| `test-quality` | 11 | 26 |
| `ac-coverage` | 241 | 241 |
| `trace` | 241 | 241 |

- The `/api/v1` move is done. T-001-32 (#62) and T-001-33 (#73, #74) moved every UI call. #75 deleted the "Transitional: old `/v1` paths" section of `arch/CONTRACTS.md` and repointed 16 shipped tickets' `contracts:` references from `/v1/...` to `/api/v1/...`.
- The 11 `contracts` entries left are pages in code that CONTRACTS does not declare (`/`, `/account`, `/invitations`, `/join/{}`, `/plans/new`, `/plans/{}` and 5 plan subpages).
- Approvals are trust-based (`[approval] trust_unsigned = true`, one GitHub identity). A ticket PR's `sdlc/approval` turns green on a `role: review` record from a session that did not build the ticket. Since kit v3.0.0, a PR with no ticket needs a `role: review` record and a `role: lead` record; a fresh session with no development context reviews every PR, lead PRs included.
- T-001-33 is `done`. #73 was squash-merged, which buried its `Sdlc-Ticket` trailer, so main read it as `ready`. #74 merged the original commits (`a11821e`, `34f518a`) with a merge commit and no content change; derived status now reads `done`. The recovery is in the pilot report.
- Repo settings allow merge commits only. Squash and rebase merging are disabled.

## Plan, in order

| # | Item | Kind | Notes |
|---|---|---|---|
| 1 | Fix `e2e/ui-api-paths.e2e.ts` (from the #62 reviews) | New ticket (`type: test`) | Possible since kit v2.0.0 (pilot finding 19): a test ticket's build runs the real-stack suites and may write `e2e/**`, and may change nothing outside the test globs. Each test registers its own account and resets cookies; wait for loaded empty states; cover create form and join panel. Use `e2e/route-server.ts` (from #73), which already keeps a cookie jar per actor |
| 2 | Done: the 9 test type errors, in T-001-35 (#88) | New ticket | `typecheck` baseline removed |
| 3 | Replace source-text tests (`readFileSync` / `read("src/...")`) with behaviour tests | New tickets | 11 files, 26 hits; `test-quality` baseline |
| 4 | Declare the 11 pages in CONTRACTS | Lead | `contracts` baseline → 0 |
| 5 | Add Playwright e2e against `next start`; then remove the temporary `tests.real_stack = ["integration"]` override in `sdlc.toml` | New ticket + lead | Needs Playwright in CI |
| 6 | Tag shipped tests `T-001-xx/AC-n` | New tickets | Shrinks `ac-coverage` and `trace` (241 each) |
| 7 | Fix the 14 lead-artifact lint errors | Lead | plan-001 v1 sections and `status`; 7 tickets with no requirement; T-001-01 AC-5 untestable; T-001-01 cites all of CONTRACTS |
| 8 | Done: ADR-0004 keeps fail-fast (409 `attempt_in_progress` at once); CONTRACTS § Proposal attempt now matches T-001-24 AC-4 | Lead | No code change |
| 9 | Ticket: move the place-search limit from the in-process `Map` (`src/server/response/place-search.ts:9`) to the `place_searches` table, with its migration | New ticket | Decided in ADR-0005; the table is declared in CONTRACTS § Tables |
| 10 | Remove duplicates: `planRoleFor` copies and the `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`; the opening + me fetch pair in `join-panel.tsx`; the initial-load and retry-load pairs in the four plan views | New ticket | Then lower the jscpd threshold (10%) |
| 11 | Commit a lockfile; add ESLint so `lint` means something | New ticket | `npm install` writes an untracked `package-lock.json`. Since kit v3.0.2 the test and review plays leave it out of their commits, but a build still commits it as an out-of-area file (pilot finding 20). Committing it in this ticket ends that; until then, the build must not commit it |
| 12 | Blocked: update the `/v1` paths in the AC text of T-001-06, 10, 15, 17 and 24 to `/api/v1` | Lead | From the #75 CodeRabbit review; #75 moved only the `contracts:` lines. The ACs are kit-guarded, so this needs the lead. Not possible: `gate pr` `immutable` fails any AC reword, even a path rename, unless the spec changes or a `strengthen` amendment is added (pilot finding 18). ADR-0003 governs the path; the AC text stays as is |
| 13 | Tighten `e2e/plan-views-api-paths.e2e.ts` `fakeGoogle` (match the place-details URL, throw on any other) and check `isDirectory()` in `e2e/route-server.ts` | New ticket | From the #74 CodeRabbit review |
| 14 | Replace `/v1` with `/api/v1` in `skills/backend-patterns/SKILL.md:14` and `skills/frontend-patterns/SKILL.md:16-17`; record the move in a new ADR, since ADR-0001 (lines 29, 46) and ADR-0002 (line 37) are accepted and immutable | Lead | From the post-merge review of #75. Agents read these files during build. Done in #79 (ADR-0003) |
| 15 | `src/i18n/fallback.test.ts:90` stubs `/v1/me`, but AccountGate calls `/api/v1/me`, so the 401 path is never exercised; `src/app/api/v1/join/[token]/route.ts:128` logs the path as `/v1/join`; doc comments in `src/server/plans/views.ts:240,260` | New ticket | From the post-merge review of #75. Can join item 1's ticket. Optional: route-test request URLs to `/api/v1` |
| 16 | Done: T-001-34 (#85). On 409 `attempt_in_progress` after a `PUT` response or `PATCH` plan, the response form and organizer plan now refetch instead of showing a save error | New ticket | First ticket run end to end by `sdlc run` |
| 17 | Done: Next.js 16.4 (T-001-35, #88). Next: ESLint import boundaries in the gate (joins item 11), and a frontend builder agent with the Next.js MCP | New ticket | The rulebook's Next 16 lines are updated in this lead PR (ADR-0006 consequence) |
| 18 | Done: patterns rulebook (ADR-0006). `skills/frontend-patterns` and `skills/backend-patterns` each gain a "Where things go" table and a "Use X, not Y" list. Existing code moves to it only when a ticket touches it | Lead | #86 |
| 19 | Done: vendored `impeccable` and `webapp-testing` under `skills/vendor/`, pinned in `skills.lock.json` | Lead | #86. Runner agents read them but cannot run their scripts (no shell, no Python, no Playwright yet); `webapp-testing` becomes usable with item 5. The `impeccable` launcher (`scripts/impeccable`) downloads an executable on first run: do not add it to an agent's allowlist without a lead decision |
| 20 | Pages load their first data on the server (ADR-0007). Done for `/plans/{planId}`: T-001-36 (#91), the example. Its `error.tsx`: T-001-37 (#93) (lead decision: a page whose loader throws renders its route's error boundary, never catches). Then one ticket per remaining page, each with its own `error.tsx`, ticketed three per lead PR (lead decision of 2026-10-12). First batch done: T-001-38 `/plans/{planId}/confirmed` (#95), T-001-39 `/plans/{planId}/proposal` (#96), T-001-40 `/plans/{planId}/respond` (#97). Second batch done: T-001-41 `/plans/{planId}/invite` (#100), T-001-42 `/plans/{planId}/join` (#101), T-001-43 test cleanup (#102); ADR-0008 (#99): `/join/{token}` keeps client loading. Session slide: only `GET /api/v1/me` slides `hp_session`, so a server-loaded page cannot slide it; T-001-42 lost the slide on `/plans/{planId}/join` (lead decision B of 2026-10-12, ADR-0009: the screen sends one `GET /api/v1/me` after mount). Third batch done: T-001-44 the slide hook and the join page fix (#104), T-001-45 `/` (#105), T-001-46 `/plans/new` (#106), T-001-47 `/invitations` (#107). Fourth batch: T-001-48 `/account` (the last page; `AccountGate` takes an optional `initialAccount`, so its embedded uses keep their own `/me` and the page sends no second one), T-001-49 truncation boundary tests for the home and invitations loaders, T-001-50 one `planPath` helper replacing the five next-to-path copies. Not ticketed: the source-text guard in `src/components/home-list.test.tsx` (raw hex, inline styles); it moves to ESLint with item 11 rather than being deleted. Lesson from T-001-44: every AC needs a unit test the build can run; real-stack e2e is extra proof | New tickets | Lead decision of 2026-10-12. Each page ticket also removes that page's copy of the initial-load fetch (part of item 10) |

## Decisions the lead owes

- None open. `/join/{token}` was decided on 2026-10-12: it keeps client loading (ADR-0008, item 20).

## Running it

- Local Postgres for gates: start Postgres 16 on port 5433, and check it is still up before each run (an idle cloud container stops it). Point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5433/<db>` and use a fresh database per full run.
- The runner drives every ticket play. Three agents are configured in `sdlc.toml`, all headless `claude -p`: `builder`, `tester` and `reviewer`. Each run is a fresh process with no prior context. Permissions are file tools, the kit CLI, the test commands, and read-only git; the builder and tester also get the type-check commands. The reviewer has no Edit tool, but keeps Write for its review record. There are no MCP servers and no git writes. Pick models with `SDLC_BUILD_MODEL`, `SDLC_TEST_MODEL` and `SDLC_REVIEW_MODEL`, and give the reviewer a different model from the builder. Per ticket:
  1. `sdlc run build <id> --agent builder`. The runner branches `build/<id>`, runs the agent, gates each attempt (up to `[gate] max_attempts`), feeds failures back, and commits with the `Sdlc-*` trailers.
  2. `sdlc run test <id> --agent tester`, on the same branch.
  3. `sdlc run review <id> --agent reviewer --extra .sdlc-run/review-extra.md`. `--extra` takes a **file path**, not text; a sentence crashes the runner. The file says: set `reviewer: reviewer` in the record and write no model name (T-001-34's reviewer wrote its model id there). Since kit v3.2.1 the review skill exempts `test: none`, `type: test`, spike and mechanical builds from test evidence; before it, T-001-35's reviewer asked for evidence the kit refuses to produce. The kit refuses a reviewer with build or test commits on the branch. Publish its record with `sdlc review publish <id> --pr <n>`, or post `.sdlc-run/review-<id>.md` unchanged.
  4. Open the PR. CI runs `gate ci` and `gate pr`.
  5. The lead approves in chat with "approve #<n>"; the lead's agent posts the `role: lead` record on the head the lead saw, naming the instruction (who, when, PR, commit). A new head needs a new approval.
  6. Merge with a merge commit once CI and `sdlc/approval` are green and CodeRabbit has finished. Never squash: derived status reads `Sdlc-Ticket` from the commits on main.
  - Check a set-up without running an agent: `sdlc run build <id> --agent builder --dry-run` prints the branch and the exact command.
  - By hand, if the runner can't be used: commit with `sdlc commit <id> --agent <name> --play <play> -m "..."` and run `sdlc gate <play> <id>` on the clean commit. Evidence from a dirty tree records the base commit as proven.
- Lead PRs (no ticket): `sdlc prompt review --pr <n>` writes the review prompt to `.sdlc-run/prompts/review-pr-<n>.md`. A fresh `claude -p` process with the reviewer's tools runs it and writes `.sdlc-run/lead-review-<n>.md`. The author publishes it with `sdlc review publish --pr <n>`, or posts it unchanged. The `role: lead` record is posted as in step 5 above: only on the lead's "approve #<n>" for that head. `sdlc/approval` is judged by the kit pinned on the base branch.
- Never commit a `sdlc baseline --prune` result without reading it. If a check errors in that run (for example `ac-coverage`: "no test command wrote JUnit"), prune drops all of that check's entries.
- Prove AC tests by mutation: revert each changed path or branch one at a time and confirm a tagged test fails (`ac-red` does this for the build's files).
