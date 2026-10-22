---
id: ADR-0013
title: Kit v5.1.0; builds claim tickets by push, and smoke uses an auto port
status: accepted
---

# ADR-0013: Kit v5.1.0; builds claim tickets by push, and smoke uses an auto port

- Status: accepted
- Date: 2026-10-22
- Source: lead. On 2026-10-21 the lead told the agent to do the recommended bump.
- Supersedes: none
- Amends: ADR-0012 § Decision, the line "A parallel run sets four ports". `SDLC_APP_PORT` is no longer one of them.

## Context

The pilot asked whether independent agents can share one repository without clashing. The kit's answer exposed two gaps in v4.0.0 (kit session, 2026-10-20):

- A claim is an unmerged branch that names the ticket. A branch exists on origin only after its first push, so two agents on two clones can build the same ticket at once.
- An abandoned branch holds its ticket forever.

Kit v4.1.0 closes both, behind settings:

- `vcs.claim = "push"`: the build pushes the branch with an empty `claim <id>` commit before the agent starts, and git refuses the second push.
- `vcs.claim_days`: a branch with no commit for that many days stops holding its ticket.

Kit v5.1.0 adds `app.port = "auto"`, which picks a free smoke port for each run. ADR-0012 asked a parallel run to set `SDLC_APP_PORT` by hand. With the auto port, the browser suite's two ports are the only ones left to set.

Kit v5.0.0 (MAJOR) requires a PR that raises a `mechanical` or `refactor` ticket into a lane that owes real-stack proof to record that lane (an `Sdlc-Lane` trailer). Otherwise `gate pr` fails. The runner adds the trailer itself. No ticket PR is open, so no PR is caught by the change.

## Decision

- Pin the kit at v5.1.0 (`078ca93`).
- `[vcs] claim = "push"` and `claim_days = 7`.
- `[app] port = "auto"`.
- Keep ADR-0012's browser ports: `HP_E2E_APP_PORT` and `HP_E2E_GOOGLE_STUB_PORT` (and `FE_BUILDER_PORT` for the fe-builder agent).
  - `[app] setup`/`teardown` could also give each run its own database and browser ports.
  - That needs a product script and a change to `playwright.config.ts`, so it is a ticket, not part of this record.

## Consequences

- Every build run, including a rebuild after review, needs network access and push rights, and pushes a claim commit first. On a branch with an open PR, that push starts CI. It may dismiss approvals before the fix exists.
- A build refuses a ticket whose branch on origin holds the claim. `--take-over` continues it.
- A busy smoke port can no longer come from a second gate on this machine. It can still come, rarely, from another process taking the picked port before the app binds; rerun the gate.
- Merges stay merge commits: a squash would bury `Sdlc-Lane` and fail the `trailers` check.
