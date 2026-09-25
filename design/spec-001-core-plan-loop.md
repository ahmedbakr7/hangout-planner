---
id: spec-001
title: Core hangout plan loop
status: accepted
source_intent: intent/intent-001-core-plan-loop.md
---

# Spec 001 — core hangout plan loop

Accepted source: `intent/intent-001-core-plan-loop.md`.

An organizer with an account creates a night-out plan (day windows, a per-person budget, ordered steps). Friends join from a shareable link or an in-app invitation, with an account or with a display name only. They give availability, a rough starting point, and a preference on each step. When the answered count reaches the threshold the organizer set, the product proposes one time and one place per step. Each place must fit the budget. Fairness is travel time, not cost. The organizer may swap a place. Cohort members may like or dislike the current place on a step. Lock is the confirmation. Anyone who can open the plan then sees the confirmed outing.

UI languages are Arabic and English. Each plan has one currency. A new plan defaults to EGP. Layouts are shared across currencies.

Google Places (venue search, details, price signals) and Google Maps routing (travel time) are the named sources from the intent. This spec defines no endpoint, payload, table, screen address, or SDK. Those are `[DECISION: ADR — …]` for `/architect`.

## Terms

- **Organizer** — the account that created the plan. This slice does not treat the organizer as a respondent.
- **Participant** — someone who joined the plan.
- **Answered** — a participant with a complete response. Join alone is not answered.
- **Cohort** — the participants included in a successful proposal.
- **Plan states** — `collecting`, `blocked`, `proposed`, `locked`. See `[DECISION: four-plan-states]`.

## Surfaces

Screen addresses are `[DECISION: ADR — screen addresses]`. Files under `design/pages/` name surfaces, not HTTP routes.

| Surface | File | Who |
|---|---|---|
| Account gate | `design/pages/account.md` | Anyone signing in |
| Home | `design/pages/home.md` | Signed-in organizer |
| Create plan | `design/pages/create-plan.md` | Organizer |
| Organizer plan | `design/pages/plan.md` | Organizer |
| Invite | `design/pages/invite.md` | Organizer |
| Invitations | `design/pages/invitations.md` | Signed-in invitee |
| Join | `design/pages/join.md` | Person with a link or an invitation |
| Response | `design/pages/respond.md` | Participant, while `collecting` or `blocked` |
| Proposal | `design/pages/proposal.md` | Organizer and joined participants, while `blocked` or `proposed` |
| Confirmed | `design/pages/confirmed.md` | Anyone who can open the plan, while `locked` |

## Loop

1. Signed-out create opens the account gate. Success returns to create.
2. The organizer submits one create form. The plan starts in `collecting`.
3. The organizer copies a link, sends an in-app invitation, or both. Invite stays available through `proposed` and stops at `locked`.
4. The person joins with an account or with a display name, then fills the response.
5. The first time that participant's response becomes complete, the answered count increases by one.
6. When the answered count becomes equal to the threshold, a proposal attempt runs. The cohort is whoever is complete at that moment.
7. A full attempt (a time inside the windows, and a budget-fitting place for every step, with a travel duration between consecutive places) moves the plan to `proposed`. Otherwise the plan is `blocked`.
8. On a proposal, the organizer may swap a place. Cohort members may set like or dislike. Signals do not move a place.
9. The organizer locks. State becomes `locked`. The confirmed surface is the outing.

Landing after open:

- Signed-out or not joined, plan not locked: join surface.
- Not joined, `locked`: confirmed surface.
- Joined, `collecting` or `blocked`: response surface. The organizer uses the organizer plan surface, and opens the proposal surface from there when `blocked`.
- Joined, `proposed`: proposal surface.
- Joined, `locked`: confirmed surface.
- Home opens the organizer plan surface for `collecting`, `blocked`, and `proposed`, and the confirmed surface for `locked`.

## Requirements

### Language and money

- **F-001-1** Every surface in the table above presents its chrome in Arabic and in English.
- **F-001-2** Arabic chrome uses RTL layout. English chrome uses LTR layout. Both languages use these same surfaces and states.
- **F-001-3** Plan title, step names, option labels, and display names appear as entered, under either UI language. A day window appears as its date and its start and end times.
- **F-001-4** Every surface has a language control. Switching language keeps unsaved input on create, invite, join, and response.
- **F-001-5** A plan has one currency. Every budget and every place price for that plan shows the amount and that currency.
- **F-001-6** A new plan's currency is EGP. Until the first answered participant, the organizer can change it to another currency in the list.
- **F-001-7** The currency list includes EGP and at least one other currency. Budget and price use the same layout for every currency in the list.
- **F-001-8** A place can be proposed or offered as a swap only when it has a per-person numeric amount in the plan currency and that amount is less than or equal to the plan budget.

### Account and join

- **F-001-9** Create, structural edit, invite, swap, budget raise, threshold change, retry, and lock are available to the signed-in organizing account. A signed-out create action opens the account gate and, after success, opens create.
- **F-001-10** Join offers two actions: join with an account, and join without an account. Join without an account requires a display name that is non-empty after trim, and it asks for no secret. Join with an account requires a successful sign-in and then uses that account's display name.
- **F-001-11** Join preview shows the plan title, the organizer display name, the timezone, the day windows, the per-person budget with currency, and the step names.

### Create and edit

- **F-001-12** Create is one form with stacked sections in this order: title, when (timezone and day windows), budget (amount and currency), steps, threshold. Submit requires: a title non-empty after trim; a timezone; at least one day window; a positive per-person budget; a currency; a threshold integer greater than or equal to 1; at least one step. Each step has a name non-empty after trim and 2, 3, or 4 option labels, each non-empty after trim. An option label is text the organizer writes.
- **F-001-13** A day window is a calendar date, a start time, and an end time, with the end after the start, read in the plan timezone. Every plan time on every surface shows the timezone name. The create form fills the timezone from the organizer's environment and leaves it editable before submit.
- **F-001-14** A valid submit creates the plan in `collecting` with answered count 0 and opens the organizer plan surface. An invalid submit creates no plan and identifies each invalid field.
- **F-001-15** Edit rights:
  - Before any participant is answered: title, timezone, windows, budget (any positive amount), currency, threshold (integer ≥ 1), step order, step names, and option labels are editable.
  - After at least one participant is answered, while `collecting`: title is editable; the budget may be replaced by a higher positive amount; the threshold may be replaced by an integer greater than or equal to the answered count and less than or equal to the current threshold. Timezone, windows, currency, steps, and option labels stay as stored.
  - While `blocked`: title is editable; the budget may be raised, and a raise runs a proposal attempt (F-001-38). Threshold, timezone, windows, currency, steps, and option labels stay as stored.
  - While `proposed`: title is editable. Budget, threshold, timezone, windows, currency, steps, and option labels stay as stored. Swap stays available (F-001-31).
  - While `locked`: title and the other fields above stay as stored.

### Invite

- **F-001-16** While the plan is not locked, the invite surface shows the shareable link and a control that copies it. The link grants join access and does not grant edit, swap, or lock. While the plan is not locked, opening the link opens join, and the organizing account instead arrives on the organizer plan surface without being added as a participant. While `locked`, that same link opens the confirmed surface (F-001-36). The link value is stable for the life of the plan. The sent list shows each invited account once, with that account's display name and one status: `invited`, `joined`, or `answered`.
- **F-001-17** The invite surface sends an in-app invitation to an existing account through one identifier field. The surface has no friend list, no suggested people, and no list of past co-planners.
- **F-001-18** A signed-in account has an invitations surface. Each row is one plan and shows that plan's title and the organizer's display name. Opening a row opens that plan. A further invitation of the same account to the same plan keeps a single row.
- **F-001-19** A failed identification or a failed send leaves the answered count unchanged and adds no invitations row.

### Response

- **F-001-20** A complete response has all of: for every day window, either busy, or free with an earliest and a latest inside that window and the latest after the earliest; one confirmed approximate starting place; exactly one of that step's option labels on every step.
- **F-001-21** The answered count increases by one the first time a participant becomes complete. Join, an incomplete save, and an edit of an already complete response leave the count unchanged. The organizer is not an entry in the count.
- **F-001-22** While `collecting` or `blocked`, the participant can save an incomplete response and can edit a complete one. A save that misses any part of F-001-20 stays incomplete. The response surface shows the plan budget with currency, every day window, every step name, and every option label. While `proposed` or `locked`, response fields are read-only and the participant uses the proposal surface or the confirmed surface.
- **F-001-23** The starting-point control is labeled approximate. The participant confirms a search result and then sees that place's name. The organizer plan, proposal, join, and confirmed surfaces omit every participant's starting point. A map image is not required.
- **F-001-24** The organizer plan surface lists participants by display name with status `in progress` or `answered`, plus the answered count, the in-progress count, and the threshold. The list omits starting points and step picks.

### Proposal

- **F-001-25** A proposal attempt runs when the answered count becomes equal to the threshold, either because a completion raises the count or because the organizer lowers the threshold to that count. The cohort for that attempt is the set of participants who are complete at that moment.
- **F-001-26** A full proposal has one time inside the organizer's day windows, one place for every step, and a travel duration between each pair of consecutive places. State becomes `proposed` only for a full proposal, and that proposal stores its cohort. While `proposed`, the cohort stays that set.
- **F-001-27** While `collecting`, the organizer plan surface shows the answered count and the threshold and shows no itinerary. While `collecting`, the answered count is below the threshold.
- **F-001-28** A `proposed` itinerary shows the time with the timezone, how many cohort members can make that time, and each cohort member's display name. The attendance line calls that set everyone only when the number equals the cohort size.
- **F-001-29** Each proposed step shows the step name, the option label that place satisfies, the place name, and the per-person amount with the plan currency.
- **F-001-30** The itinerary shows the travel duration between consecutive places. A fairness warning, when shown, talks about travel time and includes no money amount and no currency.
- **F-001-31** The organizer sees at most 3 swap alternatives on a step. Each alternative satisfies F-001-8 and is for that step. Choosing one replaces that step's place, refreshes the durations that touch that step, refreshes the fairness warning for the places now shown, sets that step's displayed like count and dislike count to none, and shows each cohort member's signal on that step as unset. The time and the other steps' places stay. A step with no alternative keeps its place and says there is no alternative.
- **F-001-32** A cohort member can set `like`, `dislike`, or `unset` on each current place, one signal at a time. The organizer sees the like count and the dislike count per step, counting only members who have a signal. A cohort member sees their own signal. Setting a signal leaves the time, the places, and the cohort unchanged.
- **F-001-33** Joined participants can open the proposal surface while `proposed`. Swap and lock are on that surface for the organizer. Signal controls are on that surface for cohort members.

### Block, lock, home

- **F-001-34** Lock is present for the organizer only while `proposed`. `collecting`, `blocked`, and `locked` omit the lock control.
- **F-001-35** Lock moves the plan to `locked`. The confirmed surface shows the title, the time with timezone, each step's place name and per-person amount with currency, the travel duration between consecutive places, and the cohort display names.
- **F-001-36** While `locked`, anyone who opens the plan by the share link or by an invitations row, and anyone already joined, sees the confirmed surface.
- **F-001-37** Home lists the plans the signed-in account organizes. Each row shows title, answered count, threshold, and one state of `collecting`, `blocked`, `proposed`, or `locked`. A row opens the organizer plan surface, except a `locked` row opens the confirmed surface.
- **F-001-38** From `blocked`, the organizer can retry. Raising the budget while `blocked` also retries. The attempt's cohort is the set of participants who are complete when the attempt starts. Saving a response while `blocked` does not start an attempt.
- **F-001-39** The browser session that joined without an account stays that participant through `locked`: response while `collecting` or `blocked`, proposal while `proposed`, confirmed while `locked`.
- **F-001-40** When an attempt does not produce a full proposal and the threshold is already met, the state is `blocked`. While the threshold is not met, the state stays `collecting`.
- **F-001-41** Chrome may name Google Places as the source of venue search, details, and price signals, and Google Maps routing as the source of travel time.

### Integrity

- **N-001-1** A missing Arabic chrome string shows the English string for that chrome, in the RTL layout, and the surface stays usable.
- **N-001-2** Every money amount on screen includes its currency. An amount the filter cannot use is omitted, and the place is absent from the proposal and the swap list.
- **N-001-3** A failed sign-in or failed account creation leaves the person signed out, with no new plan and no new participant.
- **N-001-4** A create save failure keeps the entered values on the create form.
- **N-001-5** Two participants who share a display name are visually distinct in every participant list. The distinguisher is free of email, phone, and starting point.
- **N-001-6** A response save failure keeps the entered values and the previous answered count.
- **N-001-7** A response with a time outside its window, with no starting place, or with a step missing its one label, stays incomplete.
- **N-001-8** A proposal time falls inside an organizer day window. When no cohort overlap exists inside the windows, the proposal surface shows the time-blocked state and no time.
- **N-001-9** Waiting for answers, time-blocked, budget-blocked, venue-or-travel data error, and the fairness warning each have their own copy. Waiting uses `text-muted`. Time-blocked, budget-blocked, and the data error use `danger`. Fairness uses `warning`. When time and budget both fail, both explanations are visible together.
- **N-001-10** When venue information or a between-step duration is unavailable, the proposal surface shows the retryable data error. A missing duration is left blank. Lock stays hidden. If the threshold is already met, the state is `blocked`.
- **N-001-11** `locked` has a single confirmed outing. The confirmed surface has no unlock control.
- **N-001-12** While `locked`, a response write, a swap, a signal change, and a structural edit report failure and leave the confirmed outing as locked.
- **N-001-13** An edit outside F-001-15 leaves the stored value as it was, and the field shows that it can no longer be changed.
- **N-001-14** A home load failure shows the home error state.
- **N-001-15** A failed open of plan A shows an error for that open and omits plan B's title, participants, and places.
- **N-001-16** The path from create through confirmed offers no native-app install step.
- **N-001-17** Each anonymous join creates its own participant. An equal display name does not attach the new session to an older participant.
- **N-001-18** The join surface and the response surface omit the answered count, the threshold, other participants' statuses, and other participants' starting points.
- **N-001-19** When the copy control fails, the link text stays visible on the invite surface.
- **N-001-20** One account is one participant on a plan. A second join with that account opens the landing for that existing participant.

## Decisions

Overturn any of these at spec acceptance. `/architect` implements them and does not reopen them in code.

- **[DECISION: four-plan-states]** User-visible states are `collecting` (answered count below threshold), `blocked` (threshold met, no full proposal), `proposed` (full proposal stored), `locked` (confirmed outing). How they are stored is `[DECISION: ADR — plan state persistence]`.
- **[DECISION: plan-title]** The organizer supplies a title so home, invite, and confirmed can name the outing.
- **[DECISION: create-is-one-form]** Create is a single form, sections stacked, not a wizard.
- **[DECISION: options-are-labels]** At create, a step option is a short label the organizer writes. Venue identity arrives on the proposal from Google Places. How labels and preferences become a Places query, and how candidates are ranked, is `[DECISION: ADR — venue ranking]`.
- **[DECISION: option-count]** 2 to 4 labels per step, from the intent's "a few options".
- **[DECISION: single-preference]** A complete response picks exactly one label per step.
- **[DECISION: one-plan-timezone]** One timezone per plan, defaulting to the organizer's environment at create, shown beside every plan time. This slice does not convert times into each viewer's local zone. Zone storage and DST handling are `[DECISION: ADR — plan timezone]`.
- **[DECISION: free-subrange]** Busy opts out of that whole window. Free supplies an earliest and latest inside the window.
- **[DECISION: threshold-floor]** Threshold is an integer ≥ 1. It is not a majority and it has no cap derived from a headcount, because the link is open. Lowering it to the current answered count starts an attempt.
- **[DECISION: organizer-not-in-cohort]** The organizer does not submit availability, a start, or step preferences in this slice and is outside the answered count and the cohort. Fairness compares cohort members. The intent's example is travel time versus the median friend, which this slice reads as the cohort.
- **[DECISION: budget-per-place]** The hard filter applies to each place on its own: per-person amount ≤ plan budget. This slice adds no second cap on the sum of places.
- **[DECISION: numeric-price-only]** The filter uses a per-person number in the plan currency. A relative price level, a missing signal, or an amount in another currency fails the filter. This slice has no exchange rates and no level-to-money table. Money precision is `[DECISION: ADR — money precision]`. The allowed currency set, beyond "EGP plus at least one other", is `[DECISION: ADR — currency list]`.
- **[DECISION: currency-is-data]** One budget layout and one price layout serve every supported currency.
- **[DECISION: english-fallback]** Missing Arabic chrome falls back to the English string.
- **[DECISION: no-machine-translation]** Authored plan text is stored as entered.
- **[DECISION: start-by-search]** The rough start is a confirmed search result, labeled approximate, echoed to that person as a name. The search product is `[DECISION: ADR — start search]`. Intent names Google Places for venues and Google Maps routing for travel time; this spec does not assign the start search to either product.
- **[DECISION: start-private]** Starting points are visible to the person who set them and omitted from every other surface.
- **[DECISION: travel-as-duration]** Between-step travel is duration text. A map image is not an acceptance requirement. Fetching routes is `[DECISION: ADR — travel time]`.
- **[DECISION: fairness-warns]** The attempt applies a travel-time fairness rule and still returns a full proposal when one exists. Residual unfairness is a warning. Lock stays available. Cost is outside the rule. The comparison, including the intent's median-friend example and the numeric cutoff, is `[DECISION: ADR — fairness formula]`.
- **[DECISION: cohort-fixed-once-proposed]** A successful proposal stores its cohort. Response create and edit stop while `proposed`. People who are already complete stay the cohort. Retry while `blocked` uses whoever is complete at the retry.
- **[DECISION: answers-editable-until-proposed]** Complete and incomplete responses can be saved in `collecting` and `blocked` only.
- **[DECISION: freeze-structure]** Windows, timezone, currency, steps, and labels freeze at the first answered participant, so answers stay attached to the question that was asked. Budget may move only upward until `proposed`, which keeps every previously legal place legal. Threshold may move only downward until it hits the answered count, and only while `collecting`. There is no flow in this slice to rebuild windows after a time block.
- **[DECISION: title-until-lock]** Title stays editable through `proposed` and freezes at lock.
- **[DECISION: invite-until-lock]** Link and in-app invite work in `collecting`, `blocked`, and `proposed`. At `locked` the same link opens the confirmed surface. Revoke and rotate are outside this slice. `[DECISION: stable-link]`.
- **[DECISION: join-to-see-itinerary]** Before lock, the itinerary is visible after join. Join preview is the pre-join content in F-001-11.
- **[DECISION: progress-organizer-only]** Answered count, threshold, and participant statuses are on the organizer plan surface and on home. Join and response omit them.
- **[DECISION: collecting-hides-picks]** The organizer's participant list is name plus `in progress` or `answered`.
- **[DECISION: swap-list-cap]** At most 3 alternatives are shown. Which three are strongest is part of `[DECISION: ADR — venue ranking]`.
- **[DECISION: likes-are-signals]** Like and dislike inform the organizer. They do not replace a place.
- **[DECISION: likes-organizer-counts]** Counts are on the organizer's proposal view. A cohort member sees their own signal.
- **[DECISION: likes-reset-on-swap]** After a swap, that step's displayed counts are none until new signals are set. Whether previous signals are retained off-screen is `[DECISION: ADR — signal retention]`.
- **[DECISION: confirmed-is-outing]** The confirmed surface is the locked itinerary and the cohort names. It omits signals and starting points.
- **[DECISION: home-organizer-plans]** Home lists plans this account organizes. A plan they only joined is reopened from the invitation or the link.
- **[DECISION: anonymous-this-session]** Continuation without an account is the same browser session (F-001-39). A new session is a new participant (N-001-17). Session mechanism is `[DECISION: ADR — anonymous session]`.
- **[DECISION: name-disambiguator]** Shared display names get a stable distinguisher that is not contact data and not a starting point. Token shape is `[DECISION: ADR — name distinguisher]`.
- **[DECISION: field-length]** Non-empty after trim is the acceptance rule for title, step name, option label, and anonymous display name. Maximum length is `[DECISION: ADR — field length]`.
- **[DECISION: account-mechanism]** Sign-in, account creation, and which account value is the display name are `[DECISION: ADR — account]`. After success the account has a non-empty display name. The gate's secret fields are part of that ADR, not this spec.
- **[DECISION: screen-addresses]** URL shape for these surfaces is `[DECISION: ADR — screen addresses]`.
- **[DECISION: no-native-install]** The loop is a web flow, matching the intent.
- **[DECISION: invite-by-email]** The one in-app identifier is the existing account's email. ADR-0001.

## Open

None. In-app invite identity is the account email (`[DECISION: invite-by-email]`). Failure behavior remains F-001-19.

## Out of scope

From the accepted intent, unchanged:

- Saved or reusable plan templates, including multi-day trip templates
- Paid organizer tier
- Venues paying for placement or sponsored suggestions
- In-app booking or payments to venues
- Persistent social graph, friend lists, or mandatory accounts for invitees
- Native mobile apps

Also outside this slice, as decisions above: link revoke and rotate, currency conversion, machine translation of plan text, per-viewer timezone conversion, a map as a required image, organizer self-response, rebuilding day windows after answers exist, and a sum-of-prices budget.

## Hand-off

Status: accepted. ADR markers in this spec are decided in `decisions/ADR-0001-stack.md` and `arch/CONTRACTS.md`.

Next command: `/ticketize`. Do not `/build` from a design or architect session.
