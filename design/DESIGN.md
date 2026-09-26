# DESIGN.md

Design system for spec-001. Product roles below stay the same; the implementation kit is **shadcn/ui + Radix** with **Tailwind CSS variables**, per ADR-0002. Hex and raw sizes live only in the theme stylesheet (`src/app/globals.css` and/or `src/app/tokens.css`). Components use semantic Tailwind classes (`bg-background`, `text-foreground`, `bg-primary`, …), never raw hex.

## Theme mapping (product → shadcn)

Map existing product tokens into the shadcn theme CSS variables. Brand primary stays `#0e6b4f` (product `accent` → `--primary`). shadcn’s own `--accent` / `--accent-foreground` remain the muted hover/highlight pair, not the brand CTA.

| Product token | Value | shadcn CSS variable(s) | Semantic class examples |
|---|---|---|---|
| `bg` | `#f7f4ef` | `--background` | `bg-background` |
| `surface` | `#fffcf8` | `--card`, `--popover` | `bg-card`, `bg-popover` |
| `text` | `#1f1a14` | `--foreground`, `--card-foreground`, `--popover-foreground` | `text-foreground`, `text-card-foreground` |
| `text-muted` | `#6b645b` | `--muted-foreground` | `text-muted-foreground` |
| *(surface tint)* | soft wash of `bg` / `border` | `--muted`, `--secondary` | `bg-muted`, `bg-secondary` |
| `border` | `#e6dfd4` | `--border`, `--input` | `border-border`, `border-input` |
| `accent` | `#0e6b4f` | `--primary` | `bg-primary`, `text-primary` |
| *(on primary)* | light cream / white for contrast on `#0e6b4f` | `--primary-foreground` | `text-primary-foreground` |
| `danger` | `#9d2c2c` | `--destructive` | `bg-destructive`, `text-destructive` |
| *(on destructive)* | light foreground for contrast | `--destructive-foreground` | `text-destructive-foreground` |
| `warning` | `#8a5b10` | `--warning` (theme extension) | `bg-warning`, `text-warning` |
| *(on warning)* | light foreground for contrast | `--warning-foreground` | `text-warning-foreground` |
| `success` | `#1d6b3a` | `--success` (theme extension) | `bg-success`, `text-success` |
| *(on success)* | light foreground for contrast | `--success-foreground` | `text-success-foreground` |
| `focus` | `#1e4f8c` | `--ring` | `ring-ring`, focus-visible ring utilities |
| `radius-sm` | `6px` | `--radius` base (sm derived) | `rounded-sm` / component radius |
| `radius-md` | `12px` | `--radius` (md / card) | `rounded-md`, `rounded-lg` |

Tailwind must register these variables (v4 `@theme inline` or v3 `theme.extend.colors`) so utilities resolve to `var(--…)`. `--warning` and `--success` are first-class theme extensions; they are not charts or ad-hoc one-offs.

### Values (locked brand)

Hex and pixel sizes appear only in the theme CSS. Components use the names / semantic classes above.

| Token | Value |
|---|---|
| `bg` | `#f7f4ef` |
| `surface` | `#fffcf8` |
| `text` | `#1f1a14` |
| `text-muted` | `#6b645b` |
| `border` | `#e6dfd4` |
| `accent` | `#0e6b4f` |
| `danger` | `#9d2c2c` |
| `warning` | `#8a5b10` |
| `success` | `#1d6b3a` |
| `focus` | `#1e4f8c` |
| `space-2xs` | 4px |
| `space-xs` | 8px |
| `space-sm` | 12px |
| `space-md` | 16px |
| `space-lg` | 24px |
| `space-xl` | 40px |
| `radius-sm` | 6px |
| `radius-md` | 12px |

Type faces: IBM Plex Sans Arabic for Arabic, IBM Plex Sans for Latin. Ramp: `title` 1.75rem / 2.125rem, `section` 1.25rem / 1.75rem, `body` 1rem / 1.5rem, `caption` 0.8125rem / 1.125rem. Focus ring: 2px solid `focus` (`--ring`), 2px offset, visible in RTL and LTR.

## Color roles

- `bg` / `--background` — page
- `surface` / `--card` — a grouped section
- `text` / `--foreground` — primary text
- `text-muted` / `--muted-foreground` — secondary text, including the waiting-for-answers state
- `border` / `--border` — dividers and field outlines
- `accent` / `--primary` — the single primary action on a surface (create, lock)
- `danger` / `--destructive` — time block, budget block, data error, failed save
- `warning` / `--warning` — fairness warning, in-progress status
- `success` / `--success` — answered status, locked outing
- `focus` / `--ring` — keyboard focus

A role is not a hue in this stub. Budget block and fairness warning use different roles and different sentences (spec N-001-9).

## Space

One conceptual scale: `space-2xs` … `space-xl` (4 / 8 / 12 / 16 / 24 / 40). Prefer Tailwind spacing utilities that match this scale (`p-1`, `p-2`, `p-3`, `p-4`, `p-6`, `p-10`, or theme-extended aliases). Do not invent a second product spacing language beside this scale.

## Type

One ramp for Arabic and English: `title`, `section`, `body`, `caption`. The Arabic face and the Latin face may differ. Sizes stay on this ramp. Wire the faces through Next.js font loading into the theme; body copy uses IBM Plex Sans / IBM Plex Sans Arabic as locked.

## Shape

`radius-sm` on controls. `radius-md` on sections/cards. Map into shadcn `--radius` so `rounded-*` on components stays consistent. Focus uses `--ring` and stays visible in RTL and LTR.

## Layout

- Mobile-first, one column. On a wide window the column stays a readable measure. Extra width does not add a second product.
- Sections on create follow the form order in spec F-001-12: title, when, budget, steps, threshold.
- Step order is the reading order. The first step is the first step in that order.
- One primary action per surface, in `accent` / `bg-primary`. Copy link, save, swap, and retry are secondary.
- A module for a state that is not current stays off the surface. No confirmed block before lock. No itinerary while `collecting`.
- Authored plan text follows the direction of that text. Chrome follows the UI language.
- Prefer logical CSS / logical Tailwind where available (`ms-`, `me-`, `ps-`, `pe-`, `text-start`) so RTL/LTR mirrors correctly.

## Internationalization

- Languages: Arabic (RTL) and English (LTR). The column mirrors: back controls, step sequence, and forward icons flip with the language. Numerals inside amounts, clock times, and place names the author wrote keep their own direction.
- A language control sits on every spec-001 surface. Switching language reflows chrome and keeps unsaved field values (F-001-4).
- Missing Arabic chrome shows the English string and keeps RTL (N-001-1).
- Plan times show in the plan timezone with the zone name visible. Money shows the plan currency and an amount formatted for the active language. The layout does not convert currency.

## Component kit

- **shadcn/ui** primitives (built on **Radix**) are the UI kit. Compose product chrome from those primitives; do not add a second component library.
- Style only through the theme variables and semantic classes above. Do not hard-code brand hex in component files.
- Icons and overlays follow Radix/shadcn patterns; keep focus rings on `--ring`.

## Motion

This slice does not require motion. Lock, error, and proposal-ready each have a visible state with text.
