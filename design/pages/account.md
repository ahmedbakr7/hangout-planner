# Surface: Account gate

Who: a signed-out person creating a plan, joining with an account, or opening home or invitations.
Spec: F-001-1, F-001-2, F-001-4, F-001-9, F-001-10, N-001-1, N-001-3.
Account fields and the secret are `[DECISION: ADR — account]`. This surface defines outcomes.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Signed out, gate ready. Copy says an account is required to organize. When the person arrived from join, the gate also offers a way back to join without an account. Create and join have not happened.

## Error

Sign-in or account creation failed. The person stays on the gate, signed out. Entered non-secret values remain. No plan is created. No participant is added. The message uses `danger`.

## Loaded

Signed in. The account display name is visible and non-empty. The surface continues to the place that sent them: create, join, home, or invitations. Opening the gate directly while already signed in shows the display name and a way to home.
