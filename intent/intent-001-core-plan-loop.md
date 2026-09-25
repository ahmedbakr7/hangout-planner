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

An organizer can create a night-out plan with day windows, a per-person budget, and ordered outing steps (each with a few options). They share one link. Friends open it with no account, give a name, mark when they are free, drop a rough starting point, and pick preferences per step.

When enough people have answered, the product proposes one full plan: a time most people can make, a place for each step, and travel between steps. Places fit the budget, match group preferences, and avoid leaving one person with a much worse trip than the rest. The organizer can swap a place for another strong option. Friends can signal like/dislike per step. When the organizer locks the plan, everyone sees the confirmed outing.

## Affected users and systems

- Organizer (creates constraints, reviews proposal, swaps options, locks)
- Invitee / friend (anonymous link join: name, availability, start point, step picks, step reactions)
- Place / venue data used to propose and score options (source TBD — [OPEN])
- Maps / travel estimate between stops (provider TBD — [OPEN])

## Constraints

- Primary geography: Egypt first, designed to extend across MENA
- Invitees must participate without creating an account
- One shareable link is the join surface for a plan
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

- [OPEN: what is “enough people have answered” — organizer threshold, majority of invitees, or fixed minimum?]
- [OPEN: how is “much worse trip” measured — travel time, distance, cost, or a blend?]
- [OPEN: which place catalog and maps/travel providers for Egypt v1?]
- [OPEN: does the organizer need an account, or is create+manage also link-based?]
- [OPEN: languages for v1 — Arabic, English, or both?]
- [OPEN: currency and budget unit for Egypt v1 — EGP only?]
