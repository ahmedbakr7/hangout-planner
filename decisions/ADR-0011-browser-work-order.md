---
id: ADR-0011
title: Browser test work order puts the first journey after the gate runs it
status: accepted
---

# ADR-0011: Browser test work order puts the first journey after the gate runs it

- Status: accepted
- Date: 2026-10-18
- Source: lead (approval in session on 2026-10-17 of the step-3 split, and on 2026-10-18 of recording it as an ADR)
- Supersedes: ADR-0010 Consequences, "Work, in order" items 3 and 4 only
- Amends: none

## Context

ADR-0010 step 3 is one ticket holding the Playwright dependency, its config, the Vitest, tsconfig and ESLint changes, the Google stub, `browser/global-setup.ts` and the first journey spec. Step 4 then wires `commands.e2e` and the CI step.

Two kit rules make that ticket unprovable as written:

- `ac-coverage` reads JUnit only from the configured test commands. Until `commands.e2e` is set (step 4), no gate runs a `browser/*.spec.ts`, so the journey's ACs would pass review without a gate ever running them in a browser.
- A `type: test` ticket may change only test files, and `ac-red` needs a production change to revert. The stub and specs are test files; the dependency and config files are not. One ticket cannot be both kinds.

## Decision

ADR-0010's items 3 and 4 become these four steps. Items 1, 2 and 5, and every other decision in ADR-0010, are unchanged.

1. **3a. Ticket (`type: test`):** `browser/google-stub.mjs` and its integration test against the real clients (T-001-61).
2. **3b. Ticket (`type: chore`, on the T-001-52 pattern):** the `@playwright/test` dependency, `playwright.config.ts`, `browser/global-setup.ts`, and the `vitest.config.ts`, `tsconfig.json` and `eslint.config.mjs` changes, each proved by a Vitest test that loads the config.
3. **4. Lead PR:** the CI step and browser cache in `.github/workflows/sdlc.yml`, `commands.e2e`, and agent access, as ADR-0010 item 4.
4. **4a. Ticket:** the first journey spec (create an account, create a plan, open its invite page), proved by the gate through `commands.e2e`.

## Consequences

- Every browser spec's ACs are proved by a gate run in Chromium, not by review alone.
- The suite is wired before it has a spec. Step 4's lead PR must show `commands.e2e` passes with no spec, or carry a placeholder the kit accepts; that PR decides which.
- One more ticket and one more review round than ADR-0010's order.
