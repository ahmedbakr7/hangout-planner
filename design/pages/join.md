# Surface: Join

Who: a person opening a share link or an invitation who has not joined, while the plan is not locked.
Spec: F-001-10, F-001-11, F-001-39, N-001-3, N-001-17, N-001-18, N-001-20.
`[DECISION: join-to-see-itinerary]`, `[DECISION: anonymous-this-session]`.

While `locked`, open shows the confirmed surface and this surface is absent.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

This surface always has a plan preview when the link resolves and the plan is not locked. There is no separate chrome-only empty. An unknown link is the error state.

## Error

The link does not resolve to a plan. `danger`. No create form, no other plan's title, no participant list.

Account join failed: the person is back here, still not a participant (N-001-3). The without-account action remains.

A display name that is empty after trim: the field is identified, and no participant is created.

## Loaded

Preview (F-001-11): authored title, organizer display name, timezone name, day windows, per-person budget with currency, step names. Option labels, answered count, threshold, other people's statuses, starting points, and any itinerary are absent (N-001-18).

Two actions:

- Join with an account. Success uses the account display name and opens the landing for that participant. The same account already on the plan opens that existing participant (N-001-20) and does not add a second one.
- Join without an account. The name field is shown. Success creates a new participant even if the name matches someone else (N-001-17). The new session opens the response surface while `collecting` or `blocked`, and the proposal surface while `proposed` (F-001-39).

No password field on the without-account path.
