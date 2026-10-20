---
id: ADR-0012
title: Browser-test ports come from the environment, with ADR-0010's ports as defaults
status: accepted
---

# ADR-0012: Browser-test ports come from the environment, with ADR-0010's ports as defaults

- Status: accepted
- Date: 2026-10-20
- Source: lead (approval in session on 2026-10-20 of the parallel-run work, roadmap item 21)
- Supersedes: none
- Amends: ADR-0010 § Decision, "What they run against" (the two fixed ports) and "Test environment" (the fixed `HP_E2E_GOOGLE_BASE_URL` value, and "never in the shell" for these two variables only)

## Context

ADR-0010 fixes the browser run's ports: the Google stub on `127.0.0.1:3125` and `next start -p 3124`. Both `webServer` entries use `reuseExistingServer: false`, so a second browser run on the same machine fails on a busy port. The kit's smoke port (3123) has the same problem, and kit v4.0.0 fixed it there: `SDLC_APP_PORT` overrides `app.port`.

So two tickets cannot run their full gates at once on one machine, even in separate worktrees. Each full gate takes several minutes, and a batch of independent tickets waits for each one in turn.

The ticket text built on ADR-0010 says the same: T-001-61's stub "reads no environment variable", and T-001-62's config "reads no other environment variable". Changing either is a change to an accepted ADR, so it needs this record (kit rule 7; product rule "ADRs bind").

## Decision

- `playwright.config.ts` reads `HP_E2E_APP_PORT` (default `3124`) and `HP_E2E_GOOGLE_STUB_PORT` (default `3125`) once, when it loads. `browser/google-stub.mjs` reads `HP_E2E_GOOGLE_STUB_PORT` when started as a script. `startGoogleStub(port)` keeps its argument.
- Both use the rule in `src/server/google/origin.ts`:
  - an unset or empty variable gives the default;
  - otherwise the value must be a decimal integer from 1 to 65535 with no leading zero (`^[1-9][0-9]{0,4}$`);
  - anything else throws an `Error` that names the variable. A value is never ignored or rewritten.
- If both variables give the same port, loading the config throws an `Error` that names both.
- The app entry's `HP_E2E_GOOGLE_BASE_URL` is `http://127.0.0.1:<stub port>`. `use.baseURL`, the app entry's `url` and its `next start -p` use the app port. Nothing else in the config changes. The app entry's `env` keeps exactly its five keys, and the stub entry keeps no `env`. The stub gets its variable through Playwright's default inheritance of `process.env`.
- These two variables are the one exception to ADR-0010's "never in the shell". They are set in the shell, by a person or a parallel-run script, and only to choose ports. CI, `sdlc.toml` and `.env` files set neither, so CI runs on 3124 and 3125 as now. ADR-0010's five app variables stay where ADR-0010 puts them.
- A parallel run sets all three ports: `SDLC_APP_PORT` (kit smoke), `HP_E2E_APP_PORT` and `HP_E2E_GOOGLE_STUB_PORT`. It also uses its own database (`DATABASE_URL`).
- Work, in order:
  1. **Ticket (`type: test`):** the stub script reads `HP_E2E_GOOGLE_STUB_PORT` (T-001-72). Only the test play may write `browser/**`.
  2. **Ticket (`type: chore`):** the config reads both variables (T-001-73). It comes second, so the stub already listens on the port the config waits for.
  3. **Lead PR:** the runbook in `docs/hangout-roadmap.md` gains the parallel-run steps.

## Consequences

- Two full gates can run at once on one machine, each in its own checkout with its own ports and database.
- ADR-0010's `.next` rule still holds: the build, smoke and browser steps share `.next`. Two runs in the same checkout still conflict, so the variables only help across checkouts.
- A git worktree with `node_modules` symlinked to the main checkout cannot run `next build` under Turbopack. A parallel checkout runs its own `npm ci`.
- `fe-builder`'s `next dev` port (3210, `ops/agent-fe-builder.sh`) stays fixed, so two `fe-builder` builds still cannot run at once. Making it configurable is a later lead PR to `ops/`.
- A malformed port fails the run at once, with the variable's name, instead of silently testing on the default port.
