---
id: intent-002
title: A first-time user can finish the plan loop on production and the app looks finished
status: draft            # draft | accepted | rejected | superseded
author: sdlc-lead (from Ahmed Bakr's walkthrough, 2026-11-18)
---

# Intent 002: ux-polish

## Problem

On 2026-11-18 the lead walked https://hangout-planner-six.vercel.app as a new user: signed out, created an account, created a plan, joined it as a guest, and tried to respond. Ahmed's verdict: "the ui looks shit" and "these are all issues that are so easy yet they slipped away".

- **Guests cannot answer (blocking).** On the response page, the required "Approximate starting place" search always returns "A data source is unavailable. Retry." No guest response saves, so no plan reaches its threshold and no proposal forms. The core loop of intent-001 is broken in production. Suspected cause: the production Google Maps key or billing (not confirmed).
- **Signed-out home** is a bare card ("Create a plan", "Friends enter through an invite link."). It does not say what the product is, and a returning user has no way to sign in. `design/pages/home.md` specifies exactly this, so the gap is in the design, not the build.
- **Account:** signed in, `/account` shows only "Signed in as X" and "Go home". There is no way to sign out, and no way to change display name or password.
- **Organizer plan page:** the edit form sits inline with the status block, with nothing separating them. The plan cannot be deleted or cancelled. The join link can only be copied from `/invite`, not from the plan.
- **Create form:** the timezone defaults to UTC, not Africa/Cairo. Fields have no placeholders or hints. "Answered threshold" is not explained. Each step shows 4 option slots, empty ones included. Date and time pickers are bare.
- **Guest:** after saving, nothing says what happens next or how to come back to the response. The join page shows step names but not their options.
- **Organizer progress:** "0 answered of 1" does not say what the 1 counts. There are no per-option vote counts and no invite status (pending, accepted, declined).
- **Feedback and finish:** slow actions only fade the button (account create takes seconds). `/favicon.ico` returns 404. Overall visual quality is poor.

## Outcome

- A guest on production can search for and confirm a starting place, save a complete response, and the organizer sees the answered count rise. A plan that reaches its threshold gets a proposal.
- A first-time visitor to the signed-out home can tell in one screen what the app does, start a plan, or sign in to an existing account.
- A signed-in user can sign out from any page.
- On every page, each field says what it wants (label plus hint or placeholder), each slow action shows progress, and each empty state says what to do next. This holds in English and Arabic (RTL), at phone (390px) and desktop (1280px) widths.
- The create form defaults the timezone to Africa/Cairo and explains the answered threshold in plain words.
- The organizer plan page separates status from editing, offers copy-join-link, and states counts unambiguously ("N of M invited people answered").
- After saving, a guest is told what happens next and how to return to their response.
- `/favicon.ico` serves an icon.
- Success signal: a person who has never seen the app completes the walkthrough above on production without help, and a reviewed screenshot of every page state matches its page spec (see ADR-0019).

## Users and systems

- Organizer: home, account, create, plan and invite pages.
- Guest (with or without an account): join, respond, proposal and confirmed pages.
- Returning user: signed-out home and `/account` (sign in, sign out).
- Production Google Places/Maps key and billing on Vercel (the place-search failure).
- `design/DESIGN.md` and `design/pages/*.md`, which `/design` revises before any ticket.

## Constraints

- Polish and fixes to the existing loop only. Stack, tokens system and shadcn kit stay (ADR-0001, ADR-0002); `/design` may change token values and page specs.
- English and Arabic (RTL) stay equal; no new copy ships in one language only.
- The place-search fix is ticketed first and ships on its own, ahead of any polish.
- Every UI ticket in this slice proves its page states with reviewed screenshots (ADR-0019).

## Out of scope

- Chat or comments on a plan (observed absent; not added).
- Notifications (email, push, in-app).
- Map images or map pickers; start stays search-and-confirm (`[DECISION: start-by-search]`).
- Plan description or location fields, and any new plan data.
- New proposal logic, scoring or fairness changes.
- Native apps, a marketing site, analytics.
- A kit-level visual check in `.sdlc/` (a separate kit decision for Ahmed).

## Open questions

- [OPEN: Is deleting or cancelling a plan in scope? It changes plan states and CONTRACTS, not only UI.]
- [OPEN: Is editing display name and password in scope, or only sign-out?]
- [OPEN: Are per-option vote counts and invite status (pending, accepted, declined) for the organizer in scope? Invite status may need new data.]
- [OPEN: Should the join page show each step's options before joining, or only after?]
- [OPEN: Is the place-search failure the production key or billing? To confirm from Vercel logs before the fix ticket is written.]
