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
