---
name: frontend-patterns
description: Product-locked frontend patterns (framework, data fetching, tokens). Fill via ADR in the first /architect.
---

# Skill: frontend-patterns

Hard rules: `AGENTS.md`. Stack: `decisions/ADR-0001-stack.md` (Web UI kit superseded in part by `decisions/ADR-0002-shadcn-ui.md`). HTTP and screens: `arch/CONTRACTS.md`. Theme: `design/DESIGN.md`.

Change this lock only by a superseding ADR.

## Lock (fill in per product)

- Framework / router / bundler: Next.js App Router, React, TypeScript strict, Node 22. Routes are the screen paths in `arch/CONTRACTS.md` § Screens. Locale is the `hp_locale` cookie (`ar` | `en`), not a URL prefix. `dir` and `lang` sit on `<html>`.
- Folder layout: `src/app/` pages, `src/app/api/v1/` route handlers, `src/components/` shared UI (shadcn primitives under the agreed alias), `src/server/` domain (no React imports), `messages/en.json`, `messages/ar.json`, theme CSS in `src/app/globals.css` / `src/app/tokens.css`. Alias `@/` → `src/`.
- Server vs client data fetching: a page load calls the same view function as the matching route handler. The browser mutates through `fetch` to `/v1` with `credentials: "same-origin"` and header `X-HP-Request: 1`. No Server Actions for writes. No second response shape for RSC.
- Global state (allowed / forbidden): form state lives in the component that owns the form. Locale and session live in cookies. `GET /v1/me` answers "who is signed in". No Redux, Zustand, or other global store.
- Forms: one primary submit per surface. Field errors use `error.fields[].path` and `error.fields[].code`. A 400 or 500 leaves the inputs as the person typed them. Money inputs are decimal strings; the client converts to `amount_minor` with integer arithmetic from the currency exponent. The wire field is `amount_minor` plus `currency`.
- i18n: next-intl. Chrome keys only. Authored plan text is data and is rendered as stored. Missing Arabic key → English string, layout stays RTL. Language switch updates `hp_locale` and the messages around the current form without clearing it. Return path after the account gate is an allow-listed relative path: `/`, `/plans/new`, `/invitations`, or `/join/` plus a join token.
- Design tokens / UI kit (ADR-0002): load `design/DESIGN.md`. Hex and raw sizes appear only in the theme CSS. Map product tokens into shadcn variables (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary` ← brand accent `#0e6b4f`, `--destructive`, `--warning`, `--success`, `--ring`). Components use semantic Tailwind classes (`bg-background`, `text-foreground`, `bg-primary`, …). Kit is shadcn/ui + Radix. Logical CSS / logical utilities. Forward icons flip under `[dir=rtl]`. Focus uses `--ring`.
- Testing: component tests next to the file (`*.test.tsx`) on Vitest. e2e is the test agent's. Build does not add e2e.

## Build agent rules

- New page = add/update `design/pages/<route>.md` first (spec play), not here
- UI kit is shadcn/ui + Radix only (ADR-0002); do not add a second component library
- Tailwind + theme CSS variables only for brand hex; no CSS-in-JS runtime; no second type scale
- Do not format money with a floating-point multiply
- Do not send starting coordinates, emails of other people, or Google key material to the browser
- Clipboard failure leaves the link text on the page
