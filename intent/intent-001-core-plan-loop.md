---
id: intent-001
title: Core hangout plan loop (organize → RSVP → propose → lock)
status: draft
---

# Intent: core hangout plan loop

Author: sdlc-lead. Status: draft.

## Problem

Groups in Egypt and the wider MENA region settle time, place, and what to do across scattered chat messages. Nobody can see a shared set of constraints, votes, or a single proposed outing, so plans stall or leave someone with a worse trip than everyone else.

## Proposed outcome

An organizer can create a night-out plan with day windows, a per-person budget, and ordered outing steps (each with a few options). They invite friends in two ways: a shareable link, and an in-app invitation to people who already use the app. A friend may open the plan with an account or without one. Someone who joins without an account gives a name. Either way, they mark when they are free, drop a rough starting point, and pick preferences per step.

When the number of people who have answered reaches a threshold the organizer set for this plan, the product proposes one full plan: a time most people can make, a place for each step, and travel between steps. Places fit the budget, match group preferences, and avoid leaving one person with a much worse trip than the rest. The organizer can swap a place for another strong option. Friends can signal like/dislike per step. When the organizer locks the plan, everyone sees the confirmed outing.

## Affected users and systems

- Organizer (creates constraints, sets the answer threshold, reviews proposal, swaps options, locks)
- Invitee / friend (may join with an account or anonymously; anonymous joiners give a name; all give availability, start point, step picks, and step reactions). Invite paths: shareable link, and in-app invitation for existing app users.
- Place / venue data used to propose and score options (source TBD — [OPEN])
- Maps / travel estimate between stops (provider TBD — [OPEN])

## Constraints

- Primary geography: Egypt first, designed to extend across MENA
- Invitees may participate with an account or without one. Creating an account is optional; anonymous link join stays available.
- Two invite paths are in scope for this slice: a shareable link, and an in-app invitation for existing app users
- “Enough people have answered” is a threshold the organizer sets on the plan. It is neither a majority of invitees nor a fixed global minimum.
- Proposal must respect per-person budget and ordered steps
- Fairness: avoid solutions that leave one person with a much worse trip than the group
- Organizer can swap proposed places before lock; lock is the confirmation moment

## Out of scope

- Saved / reusable plan templates (including multi-day trips)
- Paid organizer tier
- Venues paying for placement / sponsored suggestions
- In-app booking or payments to venues
- Persistent social graph, friend lists, or mandatory accounts for invitees
- Native mobile apps (web link is enough for this slice)

## Open questions

- [OPEN: how is “much worse trip” measured — travel time, distance, cost, or a blend?]
- [OPEN: which place catalog and maps/travel providers for Egypt v1?]
- [OPEN: does the organizer need an account, or is create+manage also link-based? Invitees may join with an account or anonymously; that part is decided.]
- [OPEN: languages for v1 — Arabic, English, or both?]
- [OPEN: currency and budget unit for Egypt v1 — EGP only?]
