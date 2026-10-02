# ai-sdlc kit v1 pilot on Hangout Planner

Date: 2026-10-02. Branch: `claude/pensive-hypatia-6s88ya`. No app or test code was changed.

## Setup

| Step | Result |
|---|---|
| Kit pin | `.sdlc` 6ac198c (v0.x) → 0e32481 (v1.0.0-rc1 + 6 fixes found here) |
| Environment | Linux, Node 22.22, Python 3.11, Postgres 16.14 (local), `npm install` (no lockfile: 210 packages, floating versions) |
| `sdlc init --profile nextjs` | created sdlc.toml, CI workflow, adapters, evidence/, skills/vendor/; kept the v0 AGENTS.md |
| `sdlc doctor` | first: 6 errors (eslint, tsc, vitest, next, jscpd not installed). After `npm install` and sdlc.toml edits: 2 errors, both doctor bugs (fixed). Now `doctor: OK` |
| `sdlc migrate` | 211 AC numbered in 30 tickets; prefix only (verified: no wording changed) |
| `sdlc lint` | 259 errors before migrate → 49 errors, 5 warnings after |
| `sdlc gate ci` (fresh DB) | FAIL: 10 checks fail, 4 pass, 1 skipped |

### sdlc.toml choices

| Key | Value | Why |
|---|---|---|
| `lint` | `npm run --silent lint` | Hangout has no linter. Its `lint` script is `tsc` with tests excluded, so this check adds nothing. |
| `typecheck` | profile default (`tsc -p tsconfig.json`) | Includes test files, unlike Hangout's `tsconfig.typecheck.json` |
| `unit` | profile default (vitest + JUnit) | Works as shipped |
| `integration` | vitest with `vitest.e2e.config.mts` | `test:e2e` writes its config inside `bash -c`, which drops reporter arguments. The new file mirrors that config. |
| `duplication` | `npx --yes jscpd@4.3.0 ...` | jscpd is not a devDependency |
| `e2e` | unset | Hangout has no Playwright. Its "e2e" tests are Vitest + jsdom, calling route handlers in-process. |
| CI workflow | + Node 22, `npm install`, Postgres 16 service, `DATABASE_URL` | Every test command needs a database |

## gate ci: every check

| Check | Result | Real cause | Verdict |
|---|---|---|---|
| artifacts | FAIL, 49 errors | 30 done tickets lack `reviews/T-*.md` (v0 reviews are `reviews/pr-N.md`, a different format); plan-001 lacks v1 sections and `status`; 7 tickets cite no requirement; T-001-01 AC-5 "Vitest runs" is untestable; 4 tickets exceed size limits | Mixed: review/plan format and size limits on shipped tickets are **migration noise**; untestable AC and missing requirement links are **real** |
| immutable | PASS | - | - |
| contracts | FAIL, 36 problems | 25 routes served at `/api/v1/...`, CONTRACTS declares `/v1/...`; 11 pages exist that CONTRACTS does not declare | **Real**: the `/v1` vs `/api/v1` defect. Pages: real gap (v0 CONTRACTS never listed pages). |
| lint | PASS | Runs `tsc` | **Vacuous**: Hangout has no linter |
| typecheck | FAIL, 9 errors | All in test files, e.g. `schema.test.ts:141` (passes a PgEnum where a Table is expected), `views.test.ts:300` (`kind: string` vs `"busy"\|"free"`), `client.test.ts:146` (`dbCredentials` not on `Config`) | **Real**: hidden because `tsconfig.typecheck.json` excludes tests |
| unit | FAIL | On a fresh database, test files run migrations in parallel and collide: `duplicate key ... pg_type_typname_nsp_index` (swap route suite). Passes on re-runs once the schema exists. | **Real**: CI always starts from a fresh database |
| integration | FAIL, 2 of 3 files | `closeDatabase is not a function`, `setGoogleClientOptions is not a function`: PR #53 moved these exports out of `route.ts` and updated the unit tests but not `e2e/` | **Real regression on main**; v0 CI never ran e2e |
| e2e | skip | not configured | Correct: no Playwright |
| ac-coverage | FAIL | No test name carries a `T-001-xx/AC-n` tag (0 of 369 JUnit cases), so all 30 done tickets lack proof | **Expected migration debt** (MIGRATION step 2). It does say every AC is unproven by a named test. |
| test-quality | FAIL, 26 hits | Source-text tests: 11 files, ~191 assertions on file contents (`expect(panel).toContain('from "@/components/ui/button"')` etc.) | **Real**. First run caught 9 of 11 files; two were missed (fixed in kit, see below). |
| duplication | FAIL | 18% duplicated (217 clones); production code alone is 9.7% (70 clones). Catches the copied `planRoleFor` (join route vs plans/[planId] route). | **Real**, but noisy: 147 of 217 clones are in tests |
| build | PASS | `next build` passes | First attempt failed: a transient Google Fonts fetch in `next/font` (environment). `next build` also rewrites the tracked `tsconfig.json`. |
| smoke | FAIL | "the app serves 25 route(s), none at a CONTRACTS path, so no route was probed" | **Real** (same `/api/v1` defect). With rc1 it was a vacuous PASS (fixed). |
| skills | PASS | - | - |

`gate pr` on this branch: judged as a lead PR (after a kit fix). It fails only on `artifacts` (the same legacy lint errors). Scope warns about 16,525 untracked files (`.next/`, `node_modules/`) because Hangout has no `.gitignore`.

## Known Hangout defects: caught or not

| Defect | Caught by | Notes |
|---|---|---|
| UI fetches `/v1/...`, handlers served at `/api/v1/...` | contracts, smoke | The client check is silent: it checks UI paths against CONTRACTS (which says `/v1`), not against built routes. See open question 2. |
| Tests assert on source text via `readFileSync` | test-quality | 11 files / ~191 assertions. rc1 missed 2 files (helper `read("src/...")`); fixed. |
| Copy-pasted `planRoleFor` / `createDb` | duplication (partly) | `planRoleFor` copy caught. `createDb` wrappers (lazy `db()` singletons in `plans/http.ts`, `auth/http.ts`, `proposal/attempt.ts`) are ~5 lines, below jscpd's 12-line minimum: not caught. |
| Attempt lock should wait up to 20 s, fails immediately | **not caught** | CONTRACTS says the request "waits up to 20s to take that lock". Ticket T-001-24 AC-4 says "a lock younger than 20 seconds returns 409". The code and its tests follow the ticket. The contract was weakened when the ticket was written; only ticketize/review can catch that. |
| Rate limit kept in process memory | **not caught** | `src/server/response/place-search.ts:9`, a module-level `Map`. No contract or ADR says where rate-limit state lives, so there is nothing to check against. |

Extra real defects found: the broken e2e suite (PR #53), the fresh-database migration race, 9 test type errors, no lockfile, no `.gitignore`.

## nextjs profile

| Area | Finding |
|---|---|
| Vitest JUnit flags | Correct. `--reporter=default --reporter=junit --outputFile.junit={junit}` wrote 359 unit cases; tags map from test names. |
| typecheck | Correct choice: `tsconfig.json` includes tests and found 9 errors the product's own config hid |
| lint | Assumes ESLint. Products without it must point lint at something; doctor cannot tell that `tsc` is not a linter. |
| jscpd | `npx --no-install jscpd` fails unless jscpd is a devDependency (doctor reports it). The default `src` scan includes tests (68% of Hangout's clones) and 2% is far below this codebase (18%). Needs a decision: exclude tests, or a baseline. |
| `next start` readiness | Works: ready in 0.7 s, `ready_path = "/"` answered. Smoke needs `build` to have run first; the gate order guarantees that. |
| Playwright wiring | Not exercised: Hangout has no Playwright. Its in-process jsdom "e2e" tests count as real-stack proof for `ac-coverage` though they never send HTTP (open question 4). |
| init | Writes `.gitignore` with only `.sdlc-run/`; does not warn that the kept v0 AGENTS.md points at removed v0 paths (`.sdlc/commands/`, `.sdlc/scripts/`). |

## Kit fixes made (kit repo, branch `claude/pensive-hypatia-6s88ya`, each with a test)

| Commit | Problem |
|---|---|
| ab92663 | `bin/sdlc` committed non-executable: `.sdlc/bin/sdlc` and the shipped CI workflow failed with "Permission denied" on Linux/macOS |
| dafcd5a | doctor read `npm run --silent lint` as script `--silent`, and `npx --yes jscpd@4.3.0` as binary `jscpd@4.3.0` |
| 697c405 | smoke passed with 0 probes when no built route sat at a contract path |
| d8f49f8 | v0 `## Tables` markdown tables were not read: 22 false "table not in CONTRACTS" |
| 4c986aa | nextjs profile missed tests reading source via a `read("src/...")` helper |
| 0e32481 | a `sdlc migrate`-only branch was judged as moving 30 tickets, so the migration PR could never pass |

## Open questions

1. **Shipped v0 tickets.** 30 done tickets fail lint (no v1 review, size limits). Options: re-review each, a `legacy` marker that exempts shipped tickets from v1 review and size rules, or accept a red `artifacts` check until they are superseded.
2. **Client check.** Should UI calls also be checked against built routes? Today a UI path that matches CONTRACTS passes even when no route serves it; contracts and smoke still fail on the same root cause.
3. **Duplication policy.** Exclude test files in the nextjs profile, and/or support a baseline so an existing codebase is not stuck at 18% vs 2%?
4. **Real-stack proof.** In-process handler tests count as integration proof. Require HTTP (or Playwright) for `gate test`?
5. **Next steps for Hangout:** commit a lockfile and `.gitignore`, then fix the defects above through new tickets (MIGRATION step 5).
6. **Release:** this pilot runs on 0e32481, past `v1.0.0-rc1`. Tag `v1.0.0-rc2` once these fixes are merged to main?
