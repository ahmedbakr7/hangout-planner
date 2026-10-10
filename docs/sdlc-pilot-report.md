# ai-sdlc kit v1 pilot on Hangout Planner

Date: 2026-10-02. Branch: `claude/pensive-hypatia-6s88ya` (PR #54). No app or test code was changed.

## Setup

| Step | Result |
|---|---|
| Kit pin | `.sdlc` 6ac198c (v0.x) → 5309fb6 (`v1.0.0-rc2` + the policy changes below) |
| Environment | Linux, Node 22.22, Python 3.11, Postgres 16.14 (local), `npm install` (no lockfile: 210 packages, floating versions) |
| `sdlc init --profile nextjs` | created sdlc.toml, CI workflow, adapters, evidence/, skills/vendor/; kept the v0 AGENTS.md |
| `sdlc doctor` | first: 6 errors (eslint, tsc, vitest, next, jscpd not installed). After `npm install` and sdlc.toml edits: 2 errors, both doctor bugs (fixed). Now `doctor: OK` |
| `sdlc migrate` | numbered 211 AC in 30 tickets (prefix only, wording unchanged); marked the 30 shipped tickets `legacy: v0` |
| `sdlc lint` | 259 errors → 49 after numbering → 14 after `legacy: v0` (all real, see below) |
| `sdlc gate ci` (fresh DB) | FAIL: 8 checks fail, 6 pass, 1 skipped |
| `sdlc gate pr` | judged as a lead PR; fails only on `artifacts` (the 14 lint errors) |

### sdlc.toml choices

| Key | Value | Why |
|---|---|---|
| `lint` | `npm run --silent lint` | Hangout has no linter: its `lint` script is `tsc` with tests excluded, so this check adds nothing |
| `typecheck`, `unit`, `build`, `start` | profile defaults | typecheck uses `tsconfig.json`, which includes tests |
| `integration` | vitest with `vitest.e2e.config.mts` | `test:e2e` writes its config inside `bash -c`, which drops reporter arguments. The new file mirrors that config. |
| `tests.real_stack` | `["integration"]`, **temporary** | The nextjs profile requires e2e (Playwright over HTTP). Hangout has none, so its in-process suite stands in. Without this, doctor fails (verified). |
| `duplication` | jscpd 4.3.0 via npx, tests ignored, `--threshold 10` | 10% is the 2026-10-02 baseline (9.69% of production code): new copies fail; lower it as clones are removed |
| `e2e` | unset | No Playwright yet |
| CI workflow | + Node 22, `npm install`, Postgres 16 service, `DATABASE_URL` | Every test command needs a database |

## gate ci: every check (fresh database)

| Check | Result | Real cause | Verdict |
|---|---|---|---|
| artifacts | FAIL, 14 errors | plan-001 lacks v1 sections and `status`; 7 tickets cite no requirement; T-001-01 AC-5 "Vitest runs" is untestable; T-001-01 cites the whole CONTRACTS file | **Real**, all lead-artifact fixes |
| immutable | PASS | - | - |
| contracts | FAIL, 65 problems | 25 routes served at `/api/v1/...` while CONTRACTS says `/v1/...`; 29 UI calls (e.g. `account-gate.tsx:178` fetches `/v1/me`) hit no built route; 11 pages not declared | **Real**: the `/v1` vs `/api/v1` defect, now named at every broken UI call. Pages: real gap (v0 CONTRACTS never listed pages). |
| lint | PASS | Runs `tsc` | **Vacuous**: Hangout has no linter |
| typecheck | FAIL, 9 errors | All in test files, e.g. `schema.test.ts:141` (passes a PgEnum where a Table is expected), `views.test.ts:300` (`kind: string` vs `"busy"\|"free"`), `client.test.ts:146` (`dbCredentials` not on `Config`) | **Real**: hidden because `tsconfig.typecheck.json` excludes tests |
| unit | PASS in this run; FAIL in 3 of 4 fresh-DB runs | Test files run migrations in parallel and collide (`duplicate key ... pg_type_typname_nsp_index`) | **Real, intermittent**: CI always starts from a fresh database |
| integration | FAIL, 2 of 3 files | `closeDatabase is not a function`, `setGoogleClientOptions is not a function`: PR #53 moved these exports out of `route.ts` and updated unit tests, not `e2e/` | **Real regression on main**; v0 CI never ran e2e |
| e2e | skip | not configured | Correct: no Playwright |
| ac-coverage | FAIL | No test name carries a `T-001-xx/AC-n` tag (0 of 369 JUnit cases), so no shipped ticket is proven | **Expected migration debt** (MIGRATION step 2): tag tests |
| test-quality | FAIL, 26 hits in 11 files | ~191 assertions on source text (`expect(panel).toContain('from "@/components/ui/button"')` etc.) | **Real** |
| duplication | PASS at the 10% baseline | 70 production clones, incl. the copied `planRoleFor` | **Real** debt, now ratcheted rather than blocking |
| build | PASS | - | A first attempt failed on a transient Google Fonts fetch (`next/font`). `next build` rewrites the tracked `tsconfig.json`. |
| smoke | FAIL | "the app serves 25 route(s), none at a CONTRACTS path, so no route was probed" | **Real** (same `/api/v1` defect). On rc1 this was a vacuous PASS. |
| skills | PASS | - | - |

## Known Hangout defects: caught or not

| Defect | Caught by | Notes |
|---|---|---|
| UI fetches `/v1/...`, handlers served at `/api/v1/...` | contracts (routes + 29 UI calls), smoke | |
| Tests assert on source text via `readFileSync` | test-quality | 11 files / ~191 assertions |
| Copy-pasted `planRoleFor` / `createDb` | duplication (partly) | `planRoleFor` copy found. The `createDb` wrappers (lazy `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`) are ~5 lines, below the 12-line minimum: not caught |
| Attempt lock should wait up to 20 s, fails immediately | **not caught** | CONTRACTS says the request "waits up to 20s to take that lock". Ticket T-001-24 AC-4 says "a lock younger than 20 seconds returns 409". The code and its tests follow the ticket: the contract was weakened when the ticket was written, which only ticketize/review can catch |
| Rate limit kept in process memory | **not caught** | `src/server/response/place-search.ts:9`, a module-level `Map`. No contract or ADR says where rate-limit state lives |

Extra real defects found: the broken e2e suite (PR #53), the fresh-database migration race, 9 test type errors, no lockfile, no `.gitignore` (added in this PR).

## nextjs profile

| Area | Finding |
|---|---|
| Vitest JUnit flags | Correct: 359 unit cases written; tags map from test names |
| typecheck | Correct: `tsconfig.json` includes tests and found 9 errors the product config hid |
| lint | Assumes ESLint; doctor cannot tell that `tsc` is not a linter |
| jscpd | Was wrong twice (fixed): it scanned tests (68% of clones), and `--exitCode 1` failed on any clone so `--threshold` never decided. Needs jscpd as a devDependency or a pinned `npx --yes` |
| `next start` readiness | Works: ready in 0.7 s; smoke runs after build |
| Real-stack proof | Was wrong (fixed): in-process jsdom tests counted as real-stack proof. Now `tests.real_stack = ["e2e"]` |
| Playwright wiring | Not exercised: Hangout has no Playwright |
| init | `.gitignore` gets only `.sdlc-run/`; the kept v0 AGENTS.md still points at removed v0 paths (`.sdlc/commands/`, `.sdlc/scripts/`) |

## Kit changes from this pilot (each with a test)

| Commit | Change |
|---|---|
| ab92663 | `bin/sdlc` committed executable (it failed with "Permission denied" on Linux/macOS, incl. the shipped CI workflow) |
| dafcd5a | doctor: npm flags (`npm run --silent lint`) and pinned `npx --yes` packages |
| 697c405 | smoke fails when no built route sits at a contract path (was a vacuous pass) |
| d8f49f8 | v0 `## Tables` markdown tables count as declared tables |
| 4c986aa | nextjs: tests reading source through a `read("src/...")` helper are flagged |
| 0e32481 | a `sdlc migrate`-only branch is a lead PR — **`v1.0.0-rc2`** |
| 3cac4af | `legacy: v0`: shipped v0 tickets skip the v1 review and size rules only; `migrate` sets it |
| 122d791 | a UI call must hit a built route, not just a declared one |
| 43cd16e | nextjs duplication scans production code; CONSUME.md documents the threshold ratchet |
| 2ce7d66 | `tests.real_stack`: which suites prove a ticket; nextjs = e2e; none configured fails doctor unless the lead sets `[]` |
| 5309fb6 | nextjs jscpd: `--threshold` decides, not `--exitCode` |

## Next for Hangout (through new tickets)

1. Repair `e2e/` after #53 and serialize test migrations (CI cannot be green otherwise).
2. Decide `/v1` vs `/api/v1` once (move handlers, or change CONTRACTS + UI); 29 UI calls are broken today.
3. Fix the 9 test type errors.
4. Replace source-text tests with behaviour tests.
5. Add Playwright e2e against `next start`, then remove the temporary `tests.real_stack` override.
6. Tag tests `T-001-xx/AC-n` so shipped tickets are proven.
7. Fix the 14 lead-artifact lint errors (plan sections, requirement links, AC-5).
8. Contract/ADR decisions first, then tickets: the 20 s lock wait, rate-limit storage, the `planRoleFor`/`db()` duplicates.
9. Commit a lockfile; add ESLint so `lint` means something.

## v1.5.0: one ticket end to end (T-001-33, #73, #74, #75)

Date: 2026-10-06. Kit pin `2c7beec` (v1.5.0). `[approval] mode = "forge"`, `trust_unsigned = true`, one GitHub identity, no `[agents.*]`, so every play ran by hand.

| Step | Commit | Result |
|---|---|---|
| Build | `a11821e` | 17 UI calls in 4 components moved to `/api/v1`. Tagged tests went red first, then green. `baseline --prune` dropped 7 `contracts` keys (14 occurrences). `gate build` PASS on a clean tree, `ac-red` included |
| Test | `34f518a` | `e2e/plan-views-api-paths.e2e.ts` runs the 4 real components against the real handlers and Postgres through a whole plan. The router moved to `e2e/route-server.ts`. `gate test --since a11821e` PASS |
| Review | `34f518a` | A separate session posted `role: review`, `verdict: approve`. `sdlc/approval` turned green without a lead record |
| CI | `34f518a` | `gate ci` and `gate pr` PASS |
| Merge | `c3741ea` | Squash merge by the lead. T-001-33 kept reading `ready` (see Recovery) |
| Re-merge | `6a77572` (#74) | The original commits merged with a merge commit and no content change. T-001-33 reads `done` |
| Lead follow-up | `f5fd406` (#75) | Deleted the transitional `/v1` section of CONTRACTS and repointed 16 shipped tickets' `contracts:` references |

### What the kit got right

- `sdlc/approval` refused the PR until a session that did not build it approved, then passed on its own. Every result said "trust-based".
- `ac-red` reverted the 4 components and confirmed the AC tests fail.
- Baseline v2 shrank by count and could not grow. `gate pr` re-proved every check on the PR head.
- `sdlc prompt` gave each play everything it needed: ticket, write set, changed files, evidence.
- Soft areas: the scope check was clear about what each play may touch.

### Kit findings (for the kit repo)

| # | Finding | Effect on this run |
|---|---|---|
| 1 | In forge mode, `gate test` starts the test play's scope at an `Sdlc-Play: build` trailer only. `sdlc commit` never writes one, and the `--since` help says the default is "the proven build commit" | `scope` charged the test play with the build's 8 files; worked around with `--since` |
| 2 | `sdlc commit` adds `Sdlc-Ticket` as its own paragraph, so git stops reading the trailers above it (`Co-Authored-By`) | Amended the commit by hand |
| 3 | A gate run on a dirty tree records the base commit as proven. The build play says "gate, then the runner commits", which leads here without a runner | Re-ran `gate build` after committing |
| 4 | The review prompt names two commits: "Set `commit: a11821e` (the latest proven commit)" and "the HEAD you reviewed" | Ambiguous review frontmatter |
| 5 | The test prompt includes the build play skill when the ticket lists `skills: [build]` | Conflicting instructions in the test play |
| 6 | Play skills still say "set it `in_progress`" and "do not change ticket status", although status is derived; `baseline --prune` says "pruned 14 entries" for 7 keys / 14 occurrences | Misleading text |
| 7 | `package-lock.json` is always allowed, so an untracked lockfile from `npm install` passes scope silently | Would have put a lead decision (item 12) into a ticket PR |
| 8 | `skills/frontend-patterns` is still the empty template; its "one API client" rule names a client Hangout does not have | No guidance for UI tickets |
| 9 | `tests.real_stack = ["integration"]` is still the stand-in for Playwright | The real-stack proof is in-process, not HTTP |
| 10 | An approval posted after the PR opens turns `sdlc/approval` green but leaves the earlier failed `approval` job runs on the head | GitHub showed #73 as "unstable" |
| 11 | Derived status reads `Sdlc-Ticket` with git's trailer parser. A GitHub squash merge appends `---------` and its own `Co-authored-by` as the last paragraph, so the trailer is lost | T-001-33 read `ready` on main and `sdlc next` returned it, until #74 |
| 12 | No gate noticed the buried trailer. `gate ci` on main passed, and status stayed `ready` with no warning that a merged PR for the ticket existed | Found by reading `sdlc status`, not by the kit |
| 13 | The commits carried no `Sdlc-Agent` or `Sdlc-Play: build` trailers, so the approval's reviewer-independence check had nothing to compare the reviewer against. It trusted the reviewer's own `reviewer:` field | Independence held only by convention |
| 14 | `sdlc review publish` needs a forge token. Cloud sessions have none, so the review record was posted by hand through the GitHub tools | The kit's publish path was unusable in a cloud session |
| 15 | `sdlc baseline --prune` dropped all 241 `ac-coverage` entries because that check errored in the run ("no test command wrote JUnit"), not because they passed | Caught by reading the diff before committing; committed as is, it would have emptied the `ac-coverage` baseline |
| 16 | Reverting a ticket PR re-adds the baseline entries it pruned, so the revert fails `immutable` ("may only shrink"), which cannot be waived | The planned revert-then-re-merge recovery was impossible |
| 17 | A PR with no ticket needs only a `role: lead` record: `gate pr` skips `review-file` ("lead PR: no ticket to review") and `approval` asks for `["lead"]` alone. The review play takes a ticket id, so it has nothing to run on. With trust-based approvals, the agent that wrote a lead PR can also post its lead record, and the independence check (`review`/`lead` vs build agents) has no build agent to compare against | #75 (CONTRACTS section deleted, 16 tickets' `contracts:` repointed) and #76 merged with no second agent reading the diff; only CodeRabbit. A review session was run on #75 after the merge (below) |
| 18 | `gate pr`'s `immutable` check fails any reworded AC, including a pure rename (`/v1/accounts` → `/api/v1/accounts`), unless the spec's requirements change or the ticket adds a `strengthen` amendment. A lead PR cannot correct stale AC text, and the check cannot be waived | Roadmap item 12 is blocked; ADR-0003 records the path instead |

Findings 1, 2, 3 and 11 block a by-hand flow in forge mode. Fixes for 11 to 14 are being made in the kit separately; the roadmap's "Running it" section lists the workarounds until the kit fixes them.

### Recovery from the squash merge

The lead's first plan was to revert `c3741ea` and re-merge the original commits. It failed at the first step: the revert re-adds the 14 `contracts` baseline occurrences #73 pruned, and `gate pr` fails `immutable` (finding 16). Reverting everything except the baseline would have left 14 unbaselined failures on main.

What worked, with no revert and no status-repair commit:

1. GitHub had auto-deleted the branch of #73. It was recreated at its original head `34f518a` (same sha, no force-push).
2. #74 opened from that branch. Its diff against the merge base `207ec21` equals #73 byte for byte, and its tree equals `c3741ea`'s, so merging it changes no content.
3. A separate review session posted a `role: review` record on `34f518a`. `sdlc/approval` passed, `gate` CI passed, CodeRabbit rated it low risk. It merged with a merge commit (`6a77572`).
4. `a11821e` and `34f518a` are now reachable from main with their trailers, so `sdlc status T-001-33` prints `done` and `sdlc next` no longer returns it.
5. #75 (lead) then retired the transitional CONTRACTS section. The repo now allows merge commits only.

### Review of #75 after the merge (finding 17)

#75 and #76 merged with only a lead record. A separate agent then reviewed #75 (`git diff f5fd406^1 f5fd406`) adversarially, read-only. Verdict: approve.

- All 16 repointed `contracts:` lines match a `###` route in `arch/CONTRACTS.md` by method and path. No ticket points at the deleted section.
- No hidden edits: 17 files, +16/−46. CONTRACTS lost exactly the 30-line block; each ticket changed only its `contracts:` line.
- `sdlc gate pr --base f5fd406^1` on `f5fd406` passed. `sdlc lint` output is the same before and after.
- Nothing serves or calls a bare `/v1` route.
- The stale-AC list for roadmap item 12 (T-001-06, 10, 15, 17, 24) is complete.
- Stale `/v1` text the PR did not create, now roadmap items 14 and 15: the pattern skills and ADR-0001/0002 still say the API lives at `/v1`. `src/i18n/fallback.test.ts:90` stubs `/v1/me`, so its 401 path is never exercised. The join route logs `/v1/join`.

The review caught nothing in #75 itself, but it found a test that passes without testing its path, which neither the lead record nor CodeRabbit flagged.
