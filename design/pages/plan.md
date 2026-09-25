# Surface: Organizer plan

Who: the organizing account.
Spec: F-001-15, F-001-16, F-001-21, F-001-24, F-001-27, F-001-37, F-001-38, N-001-5, N-001-13, N-001-15, N-001-18.
`[DECISION: progress-organizer-only]`, `[DECISION: collecting-hides-picks]`, `[DECISION: freeze-structure]`, `[DECISION: title-until-lock]`, `[DECISION: invite-until-lock]`.

Participants do not use this surface. Their statuses live here; their answers live on the response surface.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

A plan in `collecting` with answered count 0 and no one in progress. Title, timezone, windows, budget with currency, threshold, and ordered steps with their labels are visible. Copy states that the proposal waits for answers (`text-muted`). No itinerary. Invite action is available. Structural fields are editable (F-001-15, first branch). Unknown plan id is the error state, not this empty state.

## Error

The plan failed to load. `danger`, retry. The surface omits any other plan's title, people, and places (N-001-15).

A forbidden edit leaves the stored value and the field explains it can no longer be changed (N-001-13).

## Loaded

Header: authored title, state, timezone name.

While `collecting`: answered count, in-progress count, threshold, and the rule that the count is still below the threshold. No times, places, or travel from a proposal.

While `blocked` or `proposed`: the same counts, plus a primary way to the proposal surface. The itinerary itself is on that surface, not duplicated here.

Participant list: display name and `in progress` (`warning`) or `answered` (`success`). Shared names carry the distinguisher (N-001-5). No starting points. No step picks.

Edit controls follow F-001-15 for the current state. Budget shows the currency. Raising the budget while `blocked` is available and leads into the proposal attempt.

Invite action is present for `collecting`, `blocked`, and `proposed`. It is absent for `locked` (that open is the confirmed surface).

While `locked`, home and direct open show the confirmed surface instead of this one.
