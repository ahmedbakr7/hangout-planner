---
name: frontend-patterns
description: Product-locked frontend patterns (framework, data fetching, tokens). Fill via ADR in the first /architect.
---

# Skill: frontend-patterns

Hard rules: `AGENTS.md`. Stack: `decisions/ADR-0001-stack.md`. HTTP and screens: `arch/CONTRACTS.md`.

Change this lock only by a superseding ADR.

## Lock (fill in per product)

- Framework / router / bundler: Next.js App Router, React, TypeScript strict, Node 22. Routes are the screen paths in `arch/CONTRACTS.md` § Screens. Locale is the `hp_locale` cookie (`ar` | `en`), not a URL prefix. `dir` and `lang` sit on `<html>`.
- Folder layout: `src/app/` pages, `src/app/api/v1/` route handlers, `src/components/` shared UI, `src/server/` domain (no React imports), `messages/en.json`, `messages/ar.json`, `src/app/tokens.css`, `src/app/globals.css`. Alias `@/` → `src/`.
- Server vs client data fetching: a page load calls the same view function as the matching route handler. The browser mutates through `fetch` to `/v1` with `credentials: "same-origin"` and header `X-HP-Request: 1`. No Server Actions for writes. No second response shape for RSC.
- Global state (allowed / forbidden): form state lives in the component that owns the form. Locale and session live in cookies. `GET /v1/me` answers "who is signed in". No Redux, Zustand, or other global store.
- Forms: one primary submit per surface. Field errors use `error.fields[].path` and `error.fields[].code`. A 400 or 500 leaves the inputs as the person typed them. Money inputs are decimal strings; the client converts to `amount_minor` with integer arithmetic from the currency exponent. The wire field is `amount_minor` plus `currency`.
- i18n: next-intl. Chrome keys only. Authored plan text is data and is rendered as stored. Missing Arabic key → English string, layout stays RTL. Language switch updates `hp_locale` and the messages around the current form without clearing it. Return path after the account gate is an allow-listed relative path: `/`, `/plans/new`, `/invitations`, or `/join/` plus a join token.
- Design tokens: load `design/DESIGN.md`. Hex and raw spacing appear only in `src/app/tokens.css`, matching ADR-0001. Components use the token names. Logical CSS properties (`margin-inline`, `padding-inline`, `text-align: start`). Forward icons flip under `[dir=rtl]`. Focus uses an outline.
- Testing: component tests next to the file (`*.test.tsx`) on Vitest. e2e is the test agent's. Build does not add e2e.

## Build agent rules

- New page = add/update `design/pages/<route>.md` first (spec play), not here
- No new component library
- No Tailwind, no CSS-in-JS runtime, no second type scale
- Do not format money with a floating-point multiply
- Do not send starting coordinates, emails of other people, or Google key material to the browser
- Clipboard failure leaves the link text on the page
