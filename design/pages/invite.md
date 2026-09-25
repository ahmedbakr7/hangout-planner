# Surface: Invite

Who: the organizing account, while the plan is `collecting`, `blocked`, or `proposed`.
Spec: F-001-16, F-001-17, F-001-18, F-001-19, N-001-19.
`[DECISION: stable-link]`, `[DECISION: invite-until-lock]`.
`[OPEN: in-app-invite-identity]` — one identifier field; the accepted format is undecided.

At `locked` this surface is absent. The link opens the confirmed surface.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Link text is visible and the copy control is present. The in-app section has the identifier field and an empty sent list (`text-muted`: no in-app invitations yet). No friend list, no suggestions, no past co-planners.

## Error

Identification failed or send failed: inline `danger` on the in-app section. Answered count is unchanged. No new invitations row exists for that attempt. The link section stays usable.

Copy failed: `danger` on the copy control, and the link text remains visible (N-001-19).

The plan failed to load: full-surface `danger` and retry, with no other plan's link.

## Loaded

The shareable link for this plan is shown and can be copied. Sent in-app invitations list each invited account once, with that account's display name and a status of `invited`, `joined`, or `answered`. Sending again to an account already invited to this plan keeps one row (F-001-18).

The identifier field does not resolve by picking from a stored social list.
