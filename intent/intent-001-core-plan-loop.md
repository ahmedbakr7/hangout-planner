---
id: intent-001
title: Core hangout plan loop (organize → RSVP → propose → lock)
status: accepted
---

# Intent: core hangout plan loop

Author: sdlc-lead. Status: accepted.

## Problem

Groups in Egypt and the wider MENA region settle time, place, and what to do across scattered chat messages. Nobody can see a shared set of constraints, votes, or a single proposed outing, so plans stall or leave someone with a worse trip than everyone else.

## Proposed outcome

An organizer with an account creates a night-out plan with day windows, a per-person budget, and ordered outing steps (each with a few options). The plan is available in Arabic and English. Budget amounts use a currency on the plan: Egypt v1 defaults display and budget entry to EGP, and the product supports other currencies without a redesign. The organizer invites friends in two ways: a shareable link, and an in-app invitation to people who already use the app. A friend may open the plan with an account or without one. Someone who joins without an account gives a name. Either way, they mark when they are free, drop a rough starting point, and pick preferences per step.

When the number of people who have answered reaches a threshold the organizer set for this plan, the product proposes one full plan: a time most people can make, a place for each step, and travel between steps. Venue options come from Google Places (search, details, and price signals). Travel time between stops comes from Google Maps routing. Each place must fit the per-person budget and match group preferences. Budget is a hard filter. Fairness is separate: the proposal avoids leaving one person with a much longer trip than the group, measured by travel time compared with the group (for example, versus the median friend). Cost is not part of that fairness score. The organizer can swap a place for another strong option. Friends can signal like/dislike per step. When the organizer locks the plan, everyone sees the confirmed outing.

## Affected users and systems

- Organizer (account required to create and manage; sets constraints and the answer threshold, reviews the proposal, swaps options, locks)
- Invitee / friend (may join with an account or anonymously; anonymous joiners give a name; all give availability, start point, step picks, and step reactions). Invite paths: shareable link, and in-app invitation for existing app users.
- Google Places — venue catalog (search, details, price signals) used to propose and score options
- Google Maps routing — travel time between stops, including the travel-time inputs to the fairness check

## Constraints

- Primary geography: Egypt first, designed to extend across MENA
- Organizer needs an account. Create and manage are not link-only.
- Invitees may participate with an account or without one. Creating an account is optional for invitees; anonymous link join stays available.
- v1 languages: Arabic and English
- Currency is multi-currency, dynamic, and scalable. Egypt v1 may default display and budget entry to EGP. The product must support other currencies without a redesign.
- Two invite paths are in scope for this slice: a shareable link, and an in-app invitation for existing app users
- “Enough people have answered” is a threshold the organizer sets on the plan. It is neither a majority of invitees nor a fixed global minimum.
- Proposal must respect per-person budget (hard filter) and ordered steps
- Place catalog: Google Places for venue search, details, and price signals. Exact API products land in /architect.
- Between-stop travel and fairness inputs: Google Maps routing / travel time. Exact API products land in /architect.
- Fairness (“much worse trip”): the primary measure is travel time compared with the group (for example, versus the median friend). Per-person budget remains a hard filter, not the fairness score. Cost is not the fairness signal.
- Organizer can swap proposed places before lock; lock is the confirmation moment

## Out of scope

- Saved / reusable plan templates (including multi-day trips)
- Paid organizer tier
- Venues paying for placement / sponsored suggestions
- In-app booking or payments to venues
- Persistent social graph, friend lists, or mandatory accounts for invitees
- Native mobile apps (web link is enough for this slice)

## Open questions

None.
