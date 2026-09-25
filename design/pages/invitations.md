# Surface: Invitations

Who: a signed-in account that may have been invited in-app.
Spec: F-001-18, F-001-36, N-001-15.
A signed-out open is the account gate, then this surface.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Signed in, zero invitations. Empty copy uses `text-muted`. A way to home is present when this account also organizes plans. No error styling.

## Error

The list failed to load. `danger` and retry. Rows from a previous successful load of a different account are absent (N-001-15).

## Loaded

One row per plan. The row shows the authored plan title and the organizer display name. Opening a row follows the landing rules in the spec: join if they have not joined and the plan is not locked; response if they have joined and the plan is `collecting` or `blocked`; proposal if they have joined and the plan is `proposed`; confirmed if the plan is `locked`.

A second in-app invitation for the same plan does not add a second row.
