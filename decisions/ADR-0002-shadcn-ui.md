---
id: ADR-0002
title: shadcn/ui + Tailwind theme
status: accepted
---

# ADR-0002: shadcn/ui + Tailwind theme

- Status: accepted
- Date: 2026-09-26
- Source: Ahmed (product lock 2026-09-26); `design/DESIGN.md`
- Supersedes: ADR-0001 Web bullet “No component library and no utility framework with its own spacing scale” only
- Does not supersede: Next.js App Router, locale cookie, messages, API, data, account, Google, caps, or screens locks in ADR-0001

ADR-0001 remains accepted for the rest of the stack. Do not edit ADR-0001 in place; this ADR records the deliberate change to the Web UI kit.

## Context

ADR-0001 locked the web layer to hand-rolled CSS tokens with no component library and no utility framework that carries its own spacing scale. Product chrome now needs accessible primitives (dialogs, menus, focus management) and a maintainable theme. The chosen direction is shadcn/ui on Radix, with Tailwind CSS variables as the single home for brand hex.

## Decision

Adopt **Tailwind CSS** and **shadcn/ui** (Radix primitives + theme CSS variables) for product UI.

### Web (replaces the ADR-0001 no-library lock)

- Next.js App Router, React, TypeScript strict remain as in ADR-0001.
- Locale remains the `hp_locale` cookie (`ar` or `en`), not a path segment. Chrome strings remain in `messages/en.json` and `messages/ar.json` via next-intl. Missing Arabic key → English string, `dir="rtl"` kept.
- Direction still comes from the locale. Prefer logical properties / logical utilities. Faces remain **IBM Plex Sans Arabic** and **IBM Plex Sans**.
- Brand tokens in `design/DESIGN.md` map into shadcn theme variables (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--destructive`, `--warning`, `--success`, `--ring`, and paired `*-foreground` where needed). Product `accent` `#0e6b4f` maps to `--primary`.
- Hex and raw sizes appear only in the theme stylesheet (`src/app/globals.css` / `src/app/tokens.css`). Components use semantic classes (`bg-background`, `text-foreground`, `bg-primary`, …).
- Mobile-first, one column; Arabic + English RTL/LTR unchanged.
- Do not add a second component library beside shadcn/ui. Do not invent a second product spacing language; keep the DESIGN.md scale and map Tailwind spacing to it.

### Unchanged from ADR-0001

API (`/v1`, cookies, `X-HP-Request: 1`), data (PostgreSQL 16, Drizzle, money, timezones, plan state), account (argon2id, `hp_session` / `hp_guest` / `hp_link`), Google server-only Places/Routes, caps, and screen paths stay as ADR-0001 and `arch/CONTRACTS.md`.

## Consequences

- Install and configure Tailwind + shadcn/ui in a later build ticket; this ADR + DESIGN.md are the design lock.
- Existing hand CSS that references `--bg` / `--accent` / … migrates to the shadcn variable names (or aliases that forward to them) without changing product roles.
- Taste / redesign skills (Leonxlnx taste-skill and related) guide visual quality; they do not override token values or ADR locks.
- A further change to the kit (different library, dropping Tailwind, changing brand primary) needs a new ADR.

## Not decided

- Exact Tailwind major (v3 vs v4) and the install path (`components.json` details) beyond “CSS variables + semantic utilities”.
- Which shadcn primitives ship in which ticket.
- Dark mode: not required for this slice; light theme values above are normative.
