# Surface: Proposal

Who: the organizer while `blocked` or `proposed`; any joined participant while `proposed`. A joined participant while `blocked` is on the response surface.
Spec: F-001-8, F-001-25, F-001-26, F-001-28, F-001-29, F-001-30, F-001-31, F-001-32, F-001-33, F-001-34, F-001-38, F-001-40, F-001-41, N-001-2, N-001-8, N-001-9, N-001-10, N-001-12.
`[DECISION: fairness-warns]`, `[DECISION: travel-as-duration]`, `[DECISION: budget-per-place]`, `[DECISION: numeric-price-only]`, `[DECISION: swap-list-cap]`, `[DECISION: likes-are-signals]`, `[DECISION: likes-organizer-counts]`, `[DECISION: likes-reset-on-swap]`, `[DECISION: cohort-fixed-once-proposed]`.

While `collecting`, the organizer stays on the organizer plan surface (waiting copy, no itinerary). While `locked`, open shows the confirmed surface.

Direction follows the UI language (`design/DESIGN.md`). Step order matches the plan. Chrome may name Google Places and Google Maps routing as sources (F-001-41) without an endpoint or a vendor control name.

## Empty

Threshold not yet met: this surface is not shown. The organizer plan surface carries the waiting state (`text-muted`). No place rows, no fake time, no zero-minute travel.

## Error

These states are for the organizer. A joined participant while `blocked` who opens this surface sees the response surface instead.

Distinct messages and roles (N-001-9, N-001-10). Lock is absent in all of these. State is `blocked` when the threshold is met.

- Time-blocked (`danger`): no time inside the windows works for the cohort. No clock time is shown (N-001-8). Windows are not editable here.
- Budget-blocked (`danger`): no place set covers every step under F-001-8. Over-budget places are absent. The organizer can raise the budget, which starts another attempt (F-001-38).
- Both time and budget failed: both messages are visible.
- Venue or travel data unavailable (`danger`): retry is available. A missing between-step duration is blank, not zero.

Retry and a budget raise use whoever is complete at that moment as the cohort (F-001-38).

A load failure is `danger` and retry, and it omits any other plan's places.

## Loaded

State `proposed`. One time in the plan timezone, the number of cohort members who can make it, and those members' display names (with distinguishers when names collide). The attendance wording calls the set everyone only when the number equals the cohort size.

Each step, in order: step name, the option label this place satisfies (as authored), place name, per-person amount and plan currency. Amounts include the currency (N-001-2).

Between consecutive places: a travel duration. No starting points. No map is required.

Fairness warning, when the current places are flagged: `warning` role, travel-time wording, no amount and no currency. Lock stays available (F-001-34 together with `[DECISION: fairness-warns]`).

Organizer only: up to 3 alternatives per step, each already passing the budget rule, each showing place name, amount, and currency. Choosing one updates that place, the durations that touch it, and the fairness warning, and shows like count 0 and dislike count 0 on that step. A step with no alternative keeps the current place and says so. Lock is the primary `accent` action.

Cohort member: on each step, their signal is `like`, `dislike`, or unset. They do not see counts, swap, or lock. Changing the signal leaves the place in place.

A joined person who is outside the stored cohort sees the same itinerary, read-only, without signal controls.

The proposal names its stored cohort. People who were incomplete at attempt time are absent from that list.
