# Plan 001 — core hangout plan loop

Source: `design/spec-001-core-plan-loop.md` (accepted), `design/DESIGN.md`, `decisions/ADR-0001-stack.md`, `arch/CONTRACTS.md`.

`/ticketize` writes one ticket per cut below. It may split a cut that would exceed about 6 files or about 8 acceptance criteria. It does not merge cuts, add a phase, or invent a route. Every ticket lists `source_adr: [decisions/ADR-0001-stack.md]` and `contracts:` pointing at the heading in `arch/CONTRACTS.md`. Paired unit tests sit beside the source file and count in `files:`.

Do not release a build that accepts a completing response and does not yet run the attempt. The releasable set is this whole plan.

Next command after tickets are accepted: `/build <id>` in a new session, one ticket at a time. Not from this session.

## Cuts

| Cut | Type | Risk | Depends | Skills |
|---|---|---|---|---|
| C01 bootstrap | backend | low | — | build, backend-patterns |
| C02 schema | backend | low | C01 | build, backend-patterns |
| C03 money and ids | backend | low | C01 | build, backend-patterns |
| C04 errors and clock | backend | low | C01 | build, backend-patterns |
| C05 auth core | backend | high | C02, C04 | build, backend-patterns |
| C06 auth http | backend | high | C05 | build, backend-patterns |
| C07 shell and tokens | frontend | low | C01 | build, frontend-patterns |
| C08 account gate | frontend | low | C06, C07 | build, frontend-patterns |
| C09 plan rules | backend | medium | C02, C03, C04 | build, backend-patterns |
| C10 plans http | backend | medium | C06, C09 | build, backend-patterns |
| C11 home and create | frontend | low | C08, C10 | build, frontend-patterns |
| C12 organizer plan | frontend | low | C11 | build, frontend-patterns |
| C13 google clients | backend | medium | C04 | build, backend-patterns |
| C14 join by token | backend | medium | C06, C10 | build, backend-patterns |
| C15 opening and account join | backend | medium | C14 | build, backend-patterns |
| C16 invitations | backend | low | C06, C10 | build, backend-patterns |
| C17 invitation inbox | backend | low | C16 | build, backend-patterns |
| C18 join UI | frontend | low | C08, C14, C15 | build, frontend-patterns |
| C19 invite UI | frontend | low | C12, C16, C17 | build, frontend-patterns |
| C20 response http | backend | medium | C13, C14 | build, backend-patterns |
| C21 response UI | frontend | low | C18, C20 | build, frontend-patterns |
| C22 proposal scoring | backend | high | C03 | build, backend-patterns |
| C23 proposal attempt | backend | high | C13, C22 | build, backend-patterns |
| C24 attempt triggers | backend | high | C10, C20, C23 | build, backend-patterns |
| C25 swap and signal | backend | medium | C23 | build, backend-patterns |
| C26 lock and confirmed | backend | medium | C25 | build, backend-patterns |
| C27 proposal UI | frontend | medium | C12, C24, C25, C26 | build, frontend-patterns |
| C28 confirmed UI | frontend | low | C26, C27 | build, frontend-patterns |
| C29 e2e | test | medium | C11–C12, C18–C21, C27–C28 | test |

C05, C06, C22, C23, and C24 are first-of-kind auth or proposal work. Build them at L3. The human accepts that graph before those builds start.

C20 stores a completing response and the answered count. It does not call `runProposalAttempt`. C24 adds that call, the threshold and budget-raise calls, and `POST /v1/plans/{planId}/proposal-attempts`.

## File map

`package.json` dependencies, declared on C01 and not extended later: `next`, `react`, `react-dom`, `drizzle-orm`, `postgres`, `argon2`, `next-intl`. Dev: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `drizzle-kit`, `vitest`, `jsdom`, `@testing-library/react`. No Tailwind, Prisma, NextAuth, or second HTTP client. C29 may add a test-only runner under `e2e/` and may edit `package.json` for that devDependency only.

| Cut | Files |
|---|---|
| C01 | `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `src/server/db/client.ts` |
| C02 | `src/server/db/schema.ts`, `src/server/db/schema.test.ts`, `drizzle/0001_init.sql` |
| C03 | `src/server/money.ts`, `src/server/money.test.ts`, `src/server/ids.ts`, `src/server/ids.test.ts` |
| C04 | `src/server/http/errors.ts`, `src/server/http/errors.test.ts`, `src/server/clock.ts`, `src/server/clock.test.ts` |
| C05 | `src/server/auth/password.ts`, `src/server/auth/password.test.ts`, `src/server/auth/session.ts`, `src/server/auth/session.test.ts`, `src/server/auth/authorize.ts`, `src/server/auth/authorize.test.ts` |
| C06 | `src/app/api/v1/accounts/route.ts`, `src/app/api/v1/accounts/route.test.ts`, `src/app/api/v1/sessions/route.ts`, `src/app/api/v1/sessions/route.test.ts`, `src/app/api/v1/me/route.ts`, `src/app/api/v1/me/route.test.ts` |
| C07 | `src/app/layout.tsx`, `src/app/tokens.css`, `src/app/globals.css`, `messages/en.json`, `messages/ar.json`, `src/i18n/request.ts`. Also edits `next.config.ts` for next-intl. |
| C08 | `src/app/account/page.tsx`, `src/components/account-gate.tsx`, `src/components/account-gate.test.tsx`, `src/components/language-control.tsx`, `src/components/language-control.test.tsx`, `src/i18n/fallback.test.ts` |
| C09 | `src/server/plans/edit-rules.ts`, `src/server/plans/edit-rules.test.ts`, `src/server/plans/views.ts`, `src/server/plans/views.test.ts` |
| C10 | `src/app/api/v1/currencies/route.ts`, `src/app/api/v1/currencies/route.test.ts`, `src/app/api/v1/plans/route.ts`, `src/app/api/v1/plans/route.test.ts`, `src/app/api/v1/plans/[planId]/route.ts`, `src/app/api/v1/plans/[planId]/route.test.ts` |
| C11 | `src/app/page.tsx`, `src/app/plans/new/page.tsx`, `src/components/home-list.tsx`, `src/components/home-list.test.tsx`, `src/components/create-form.tsx`, `src/components/create-form.test.tsx` |
| C12 | `src/app/plans/[planId]/page.tsx`, `src/components/organizer-plan.tsx`, `src/components/organizer-plan.test.tsx` |
| C13 | `src/server/google/places.ts`, `src/server/google/places.test.ts`, `src/server/google/routes.ts`, `src/server/google/routes.test.ts` |
| C14 | `src/server/join/open.ts`, `src/server/join/open.test.ts`, `src/app/api/v1/join/[token]/route.ts`, `src/app/api/v1/join/[token]/route.test.ts` |
| C15 | `src/app/api/v1/plans/[planId]/opening/route.ts`, `src/app/api/v1/plans/[planId]/opening/route.test.ts`, `src/app/api/v1/plans/[planId]/join/route.ts`, `src/app/api/v1/plans/[planId]/join/route.test.ts` |
| C16 | `src/server/invites/send.ts`, `src/server/invites/send.test.ts`, `src/app/api/v1/plans/[planId]/invitations/route.ts`, `src/app/api/v1/plans/[planId]/invitations/route.test.ts`, `src/app/api/v1/plans/[planId]/invite/route.ts`, `src/app/api/v1/plans/[planId]/invite/route.test.ts` |
| C17 | `src/app/api/v1/invitations/route.ts`, `src/app/api/v1/invitations/route.test.ts` |
| C18 | `src/app/join/[token]/page.tsx`, `src/app/plans/[planId]/join/page.tsx`, `src/components/join-panel.tsx`, `src/components/join-panel.test.tsx` |
| C19 | `src/app/plans/[planId]/invite/page.tsx`, `src/app/invitations/page.tsx`, `src/components/invite-panel.tsx`, `src/components/invite-panel.test.tsx` |
| C20 | `src/server/response/save.ts`, `src/server/response/save.test.ts`, `src/app/api/v1/plans/[planId]/response/route.ts`, `src/app/api/v1/plans/[planId]/response/route.test.ts`, `src/app/api/v1/plans/[planId]/place-searches/route.ts`, `src/app/api/v1/plans/[planId]/place-searches/route.test.ts` |
| C21 | `src/app/plans/[planId]/respond/page.tsx`, `src/components/response-form.tsx`, `src/components/response-form.test.tsx` |
| C22 | `src/server/proposal/time.ts`, `src/server/proposal/time.test.ts`, `src/server/proposal/fairness.ts`, `src/server/proposal/fairness.test.ts`, `src/server/proposal/rank.ts`, `src/server/proposal/rank.test.ts` |
| C23 | `src/server/proposal/attempt.ts`, `src/server/proposal/attempt.test.ts`, `src/app/api/v1/plans/[planId]/proposal/route.ts`, `src/app/api/v1/plans/[planId]/proposal/route.test.ts` |
| C24 | `src/app/api/v1/plans/[planId]/proposal-attempts/route.ts`, `src/app/api/v1/plans/[planId]/proposal-attempts/route.test.ts`, `src/app/api/v1/plans/[planId]/route.ts`, `src/app/api/v1/plans/[planId]/route.test.ts`, `src/app/api/v1/plans/[planId]/response/route.ts`, `src/app/api/v1/plans/[planId]/response/route.test.ts` |
| C25 | `src/app/api/v1/plans/[planId]/steps/[stepId]/swap/route.ts`, `src/app/api/v1/plans/[planId]/steps/[stepId]/swap/route.test.ts`, `src/app/api/v1/plans/[planId]/steps/[stepId]/signal/route.ts`, `src/app/api/v1/plans/[planId]/steps/[stepId]/signal/route.test.ts` |
| C26 | `src/app/api/v1/plans/[planId]/lock/route.ts`, `src/app/api/v1/plans/[planId]/lock/route.test.ts`, `src/app/api/v1/plans/[planId]/confirmed/route.ts`, `src/app/api/v1/plans/[planId]/confirmed/route.test.ts` |
| C27 | `src/app/plans/[planId]/proposal/page.tsx`, `src/components/proposal-view.tsx`, `src/components/proposal-view.test.tsx` |
| C28 | `src/app/plans/[planId]/confirmed/page.tsx`, `src/components/confirmed-view.tsx`, `src/components/confirmed-view.test.tsx` |
| C29 | `e2e/core-loop.e2e.ts`, `e2e/authz.e2e.ts`, `e2e/rtl.e2e.ts` |

Schema tables are the CONTRACTS table list and nothing else. `src/server/` does not import React.

## What each cut owns

- **C01** — Vitest runs. Drizzle client reads `DATABASE_URL`. Engines field is Node 22.
- **C02** — Migration creates every CONTRACTS table. Test applies it on Postgres.
- **C03** — Minor units, the four currencies, id and join-token shapes.
- **C04** — Envelope helper. Clock function tests can replace.
- **C05** — argon2id, session cookie hash, `authorize` for organizer, participant, invited, and link reader. `HP_HASH_TEST=1` only in tests.
- **C06** — Register, sign-in, sign-out, me. Same 401 text for unknown email and bad password. CSRF header.
- **C07** — Token CSS matches `design/DESIGN.md`. `dir` follows `hp_locale`. Logical CSS only.
- **C08** — Gate outcomes in `design/pages/account.md`. Failed sign-in stays signed out. `next` allow-list. Arabic missing key renders English in RTL.
- **C09** — Freeze matrix and organizer/participant view redaction. No starting points on the organizer view.
- **C10** — Create, list, organizer get, patch. Invalid create writes nothing. Home list is only this account's plans.
- **C11** — Home empty, error, and loaded. Create one form, EGP default, environment timezone, values kept on failure.
- **C12** — Organizer plan: counts, statuses, distinguisher, editable controls, no itinerary while collecting, and a link to the proposal path while `blocked` or `proposed`. Locked open is not this page.
- **C13** — Places and Routes clients. Tests assert field masks and parse `priceRange.startPrice`. Fakes only.
- **C14** — Preview, anonymous and account join, guest cookie, organizer does not become a participant, second anonymous browser is a new participant.
- **C15** — Opening `next` table. In-app account join without revealing the join token.
- **C16** — Email invite, exact match, self-invite rejected, unknown email adds no row, one row per account, stable `join_path`.
- **C17** — Inbox, one row per plan.
- **C18** — Join preview and both actions. No password on the anonymous path. No counts.
- **C19** — Link text, copy failure leaves the text, email field, sent list. No people search.
- **C20** — Draft versus complete, count increments once, complete edit does not increment, invalid body writes nothing, start name stored, coordinates absent from JSON.
- **C21** — Response surface. Search confirm. Incomplete and complete saves. Values kept on failure.
- **C22** — The worked time grid and the worked fairness numbers in CONTRACTS, as unit tests. Rank orders a fair chain ahead of a shorter unfair one.
- **C23** — `runProposalAttempt` writes `proposed` or `blocked`. Drops `priceLevel` and wrong-currency prices. No zero durations. Stores the cohort and the pool.
- **C24** — The three triggers. A blocked save does not start a run. Retry and the hour cap. `HP_PROPOSAL_ENABLED=0` records `venue_data`.
- **C25** — Swap replaces one place, clears that step's signals, keeps time and other places. A failed route leaves the previous place. Signal does not move a place. Non-cohort gets 403.
- **C26** — Lock from `proposed` only. Confirmed document. Later writes get `plan_locked`. No unlock route.
- **C27** — Block copy roles, both sentences when both flags are set, fairness warning without money, swap list, lock control, organizer counts, member's own signal.
- **C28** — Confirmed outing. No unlock, no signals, no starting points. Share link and inbox land here when locked.
- **C29** — Test agent only. See test strategy.

## Requirement map

| Id | Where |
|---|---|
| F-001-1, F-001-2, N-001-1 | UI-only. C07, C08 |
| F-001-3 | Stored strings returned as entered. C10, C20 |
| F-001-4 | UI-only. C08, C11, C19, C21 |
| F-001-5, F-001-6, F-001-7, N-001-2 | C03, C10, attempt filter in C23 |
| F-001-8 | C23 |
| F-001-9, N-001-3 | C06, C08, authz on each route |
| F-001-10, F-001-11, N-001-17, N-001-18, N-001-20 | C14, C15, C18 |
| F-001-12, F-001-13, F-001-14, N-001-4 | C10, C11 |
| F-001-15, N-001-13 | C09, C10, C12 |
| F-001-16, N-001-19 | C16, C19. Copy failure is UI-only |
| F-001-17, F-001-18, F-001-19 | C16, C17, C19. Identifier is account email |
| F-001-20–F-001-23, N-001-6, N-001-7 | C20, C21 |
| F-001-24, F-001-27, N-001-5 | C10, C12. Collision display is UI-only on top of `distinguisher` |
| F-001-25, F-001-26, F-001-38, F-001-40 | C23, C24 |
| F-001-28–F-001-33, N-001-8, N-001-9, N-001-10 | C23, C25, C27. Block and fairness sentences are UI-only |
| F-001-34, F-001-35, N-001-11, N-001-12 | C26, C28 |
| F-001-36 | C15, C28 |
| F-001-37, N-001-14 | C10, C11 |
| F-001-39 | C14 guest cookie |
| F-001-41, N-001-16 | UI-only. C27, C28 |
| N-001-15 | 404 envelope. C06 onward, and each page's error state |

## Test strategy

Build tickets own unit and handler tests beside their files.

- Pure tests, no database and no network: money, ids, edit rules, time grid, fairness, rank, error envelope.
- Handler tests use Postgres from `DATABASE_URL` and the fake Google clients. Each backend cut covers its routes' authz: stranger 404, wrong role 403, missing CSRF 403, locked write 409.
- C22's tests include the CONTRACTS worked grid (18:30, attendance 2) and the worked trips (warning on for 600 / 720 / 2400, warning off for 600 / 720).
- No test calls `places.googleapis.com` or `routes.googleapis.com`.

The test agent (C29, skill `test`, not `build`) owns:

- `e2e/core-loop.e2e.ts` — account, create in EGP, copy path, anonymous join, complete response, proposal, swap, signal, lock, confirmed read on the share link.
- `e2e/authz.e2e.ts` — a second account cannot read another organizer's plan; a participant cannot lock; a locked write fails; an unknown invite email adds no inbox row.
- `e2e/rtl.e2e.ts` — Arabic locale sets `dir="rtl"` on create and on confirmed, and a missing Arabic key still shows the English string.

The test agent does not edit production source and does not delete acceptance criteria.

## Blast radius and rollback

This slice is the first schema. `drizzle/0001_init.sql` creates the whole database. There is no down migration.

- Before any real plan exists, rollback is reverting the app image. The empty database can be dropped and recreated.
- After plans exist, do not drop tables to undo a bad deploy. Revert the app image and leave the schema. Lock is explicit, so a bad proposal is not a confirmed outing until an organizer locks it.
- `HP_PROPOSAL_ENABLED=0` stops Google spend and records a venue-data block. Responses, invites, and joins keep working.
- Rotating `GOOGLE_MAPS_API_KEY` or `DATABASE_URL` needs no schema change.
- A failed swap does not change the stored place. A failed response write does not change the answered count.

## Skills future tickets load

| Tickets | Load |
|---|---|
| C01–C06, C09–C10, C13–C17, C20, C22–C26 | `skills/build`, `skills/backend-patterns`, the ticket, `arch/CONTRACTS.md`, ADR-0001 |
| C07–C08, C11–C12, C18–C19, C21, C27–C28 | `skills/build`, `skills/frontend-patterns`, the ticket, `arch/CONTRACTS.md`, `design/DESIGN.md`, the page file for that surface, ADR-0001 |
| C29 | `skills/test`, the ticket, `arch/CONTRACTS.md` |

No vendor skill. Google is the clients in C13, not a marketplace skill.
