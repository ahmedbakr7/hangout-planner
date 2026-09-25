# Surface: Confirmed

Who: anyone who opens the plan while `locked` — joined participants, the organizer, a share link, or an invitations row.
Spec: F-001-35, F-001-36, N-001-11, N-001-12, N-001-15, N-001-16.
`[DECISION: confirmed-is-outing]`, `[DECISION: start-private]`.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Before lock, this surface is absent. Opening it shows the current surface for that person and state: organizer plan, response, or proposal. No confirmed module, no lock badge, no empty itinerary.

## Error

The locked plan failed to load. `danger` and retry. Another plan's title and places are absent (N-001-15).

A response write, swap, signal change, or structural edit while locked reports failure and the outing stays as locked (N-001-12).

## Loaded

State `locked`, role `success`. Authored title. The locked time with the timezone name. Steps in order: place name, per-person amount with the plan currency. Travel duration between consecutive places. Cohort display names, with distinguishers when names collide.

Omitted: starting points, option labels, like and dislike counts, swap, response fields, budget editing, threshold, invite send, and unlock.

The share link and an invitations row for this plan open this surface directly. No native install step.
