# Surface: Home

Who: the signed-in account, for plans they organize.
Spec: F-001-1, F-001-2, F-001-4, F-001-37, N-001-1, N-001-14, N-001-16.
`[DECISION: home-organizer-plans]`. Plans they only joined are reopened from an invitation or a link, not from this list.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Signed out: the language control, a create action that opens the account gate, and a sentence that friends enter through an invite link. No plan rows.

Signed in, zero organized plans: create action, a way to the invitations surface, and empty copy that this account has no plans yet. That copy uses `text-muted`, not `danger`.

## Error

The plan list failed to load. The error uses `danger` and offers retry. Create stays available. The empty-state sentence is absent, so a failure is distinct from zero plans (N-001-14).

## Loaded

One row per organized plan. Each row shows the title as authored, the answered count, the threshold, and one state: `collecting`, `blocked`, `proposed`, or `locked`.

- `collecting`, `blocked`, and `proposed` open the organizer plan surface.
- `locked` opens the confirmed surface. The state uses `success`.

`blocked` uses `danger`. `proposed` uses `text`. No row shows another account's private plan.
