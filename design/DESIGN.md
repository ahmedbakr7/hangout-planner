# DESIGN.md

Design-system stub for spec-001. Roles and layout rules only. Concrete values, typefaces, and any component kit are `[DECISION: ADR — visual values]` for `/architect`. Product code maps these names; it does not invent a parallel scale.

## Color roles

- `bg` — page
- `surface` — a grouped section
- `text` — primary text
- `text-muted` — secondary text, including the waiting-for-answers state
- `border` — dividers and field outlines
- `accent` — the single primary action on a surface (create, lock)
- `danger` — time block, budget block, data error, failed save
- `warning` — fairness warning, in-progress status
- `success` — answered status, locked outing
- `focus` — keyboard focus

A role is not a hue in this stub. Budget block and fairness warning use different roles and different sentences (spec N-001-9).

## Space

One scale: `space-2xs`, `space-xs`, `space-sm`, `space-md`, `space-lg`, `space-xl`. Padding and gaps use the scale.

## Type

One ramp for Arabic and English: `title`, `section`, `body`, `caption`. The Arabic face and the Latin face may differ. Sizes stay on this ramp.

## Shape

`radius-sm` on controls. `radius-md` on sections. The focus ring uses `focus` and stays visible in RTL and LTR.

## Layout

- Mobile-first, one column. On a wide window the column stays a readable measure. Extra width does not add a second product.
- Sections on create follow the form order in spec F-001-12: title, when, budget, steps, threshold.
- Step order is the reading order. The first step is the first step in that order.
- One primary action per surface, in `accent`. Copy link, save, swap, and retry are secondary.
- A module for a state that is not current stays off the surface. No confirmed block before lock. No itinerary while `collecting`.
- Authored plan text follows the direction of that text. Chrome follows the UI language.

## Internationalization

- Languages: Arabic (RTL) and English (LTR). The column mirrors: back controls, step sequence, and forward icons flip with the language. Numerals inside amounts, clock times, and place names the author wrote keep their own direction.
- A language control sits on every spec-001 surface. Switching language reflows chrome and keeps unsaved field values (F-001-4).
- Missing Arabic chrome shows the English string and keeps RTL (N-001-1).
- Plan times show in the plan timezone with the zone name visible. Money shows the plan currency and an amount formatted for the active language. The layout does not convert currency.

## Motion

This slice does not require motion. Lock, error, and proposal-ready each have a visible state with text.
