---
id: ADR-0019
title: UI tickets prove each page state with reviewed screenshots
status: draft
---

# ADR-0019: UI tickets prove each page state with reviewed screenshots

- Status: draft (the lead sets accepted)
- Date: 2026-11-18
- Source: lead. Ahmed asked on 2026-11-18 for "the polish intent and the ui-gate ADR" after the production walkthrough in intent-002.
- Supersedes: none
- Amends: none. Read with ADR-0010 (Playwright against `next start`), ADR-0012 (only the test play writes `browser/**`) and ADR-0017 (a `type: test` ticket's build counts as the test play).

## Context

The 2026-11-18 walkthrough of production (intent-002) found a broken guest response, a home page that does not explain the product, no sign-out, unexplained fields, a UTC default timezone, ambiguous counts, no loading states and a missing favicon. Every one of those pages had passed its gates.

Nothing in the pipeline looks at a rendered page:

- Unit, integration and browser tests prove behaviour: text, routes, cookies, `lang` and `dir`.
- The review play checks that each state in `design/pages/*.md` exists in the code, not how it renders.
- `smoke` only checks that each CONTRACTS page serves.

Options considered:

- **Kit change now** (a screenshot or visual check inside `.sdlc/`). Lost for now: it is a kit release, which is Ahmed's separate call, and the rule should first prove itself in this product.
- **Visual-diff baselines** (`toHaveScreenshot`). Lost for now: there is no approved design baseline to diff against, the polish slice will change every page, and pixel diffs across fonts and runners are flaky.
- **Do nothing.** Lost: the walkthrough shows the gap is real and recurs on every page.

## Decision

1. **Which tickets.** A ticket is a UI ticket when its `files:` or `areas:` include `src/app/**/page.tsx`, `src/app/**/error.tsx`, `src/app/**/loading.tsx`, `src/components/**`, `messages/**` or `src/app/**/*.css`, or it owns a page in `arch/CONTRACTS.md`.
2. **Screenshot spec (test play, or a `type: test` ticket's build per ADR-0017).** For each page the ticket touches, add or extend `browser/screens-<page>.spec.ts` (`<page>` is the `design/pages/<page>.md` file name). It visits every `##` state section of that page file (today Empty, Error and Loaded, and each variant a section names, such as signed out and signed in, or a slow action in progress) in `en` and `ar` (the `hp_locale` cookie, as `browser/fonts.spec.ts` does), at 390px and 1280px wide. For each it calls `page.screenshot({ fullPage: true })` and saves to `.sdlc-run/screens/<ticket-id>/<page>--<state>--<locale>--<width>.png`. Each test also asserts the state's visible copy from `messages/*.json`, so a wrong state fails as a test, not only in review. Error states use the Google stub (`browser/google-stub.mjs`) or a route that fails on purpose, never production.
3. **Where screenshots go.** `.sdlc-run/` is git-ignored and already uploaded by `.github/workflows/sdlc.yml` as the `sdlc-run` artifact, so CI keeps the screenshots with no workflow change. They are never committed.
4. **Review play.** The reviewer runs the ticket's screenshot specs on the reviewed head (`npx --no-install playwright test browser/screens-<page>.spec.ts`), opens every PNG, and adds a `## Screens` table to the review: one row per page, state, locale and width, with yes or no for each of:
   - matches the state in `design/pages/<page>.md` and the tokens in `design/DESIGN.md`;
   - the hint, empty, loading or error copy the spec names is visible;
   - no layout break (overflow, clipping, overlap, wrong side in RTL).
   Any no is a blocking finding and the verdict cannot be approve. Refactor and mechanical lanes have no test play: their reviewer runs the existing screenshot specs on the head and fills the same table.
5. **First-run walkthrough.** `browser/first-run.spec.ts` drives signed-out home → create account → create plan → open the join link as a guest → respond, including the starting-place search → the organizer sees the answer counted. It saves a screenshot per step, as in rule 2, and must stay green on main. The first polish ticket that touches any of these pages writes it.

## Consequences

- UI tickets get heavier: more browser tests, a longer `e2e` suite (one `next build` already serves all specs) and a longer review.
- The page specs matter more: a state that is not written in `design/pages/*.md` is not screenshotted, so `/design` must list every state it wants seen (signed out, signed in, slow action, saved).
- Human taste is still not automated. The review checks screenshots against the written spec; whether the spec is good stays a `/design` and lead question.
- A rulebook row in `skills/frontend-patterns/SKILL.md` ("Screenshot proof of a page's states") and a review checklist line are added when this ADR is accepted, not before.
- A kit-level check (screenshots or visual diff enforced by `.sdlc/`) stays out of scope. It would be a separate kit change for Ahmed.

## Not decided

- Visual-diff baselines once the polish slice has an accepted look.
- Whether `sdlc gate review` should fail a review with no `## Screens` table (kit change).
