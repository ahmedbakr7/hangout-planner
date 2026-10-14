---
id: T-001-51
title: "Invitations list uses the shared plan path helper"
type: frontend
status: ready
risk: low
depends_on: [T-001-47, T-001-50]
files:
  - "src/components/invite-panel.tsx"
  - "src/components/invite-panel.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: opening an invitation from InvitationsList navigates, both when the row carries next and when it is read from GET /api/v1/plans/{planId}/opening, to /plans/{planId} for organizer, and /plans/{planId}/respond, /plans/{planId}/proposal, /plans/{planId}/confirmed and /plans/{planId}/join for respond, proposal, confirmed and join"
  - "AC-2: every existing InvitationsList and InvitePanel test passes unchanged"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

The review of T-001-50 (#110) found a sixth copy of the next-to-path mapping: `hrefForInvitationNext` in `src/components/invite-panel.tsx`. T-001-50 listed five copies, so it left this one.

- Replace `hrefForInvitationNext` with `planPath` from `src/lib/plan-paths.ts` at both call sites in `openInvitation`: a row that carries `next`, and the `next` read from `GET /api/v1/plans/{planId}/opening`. Remove the local function.
- `hrefForInvitationNext` maps every value to a path, `join` included, which is what `planPath` does. Behaviour does not change.
- **Unit tests:** in `src/components/invite-panel.test.tsx`, one case per `next` value for AC-1 on each of the two paths, tagged `T-001-51/AC-1`, asserting the exact pushed path. Every AC needs a passing tagged unit test in the build. No test reads source text.
- No new message key and no new dependency.
