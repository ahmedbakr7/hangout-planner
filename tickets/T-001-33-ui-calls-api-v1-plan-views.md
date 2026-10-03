---
id: T-001-33
title: "Organizer plan, response, proposal and confirmed views call the API at /api/v1"
type: frontend
status: ready
risk: medium
depends_on: [T-001-32]
files:
  - "src/components/organizer-plan.tsx"
  - "src/components/response-form.tsx"
  - "src/components/proposal-view.tsx"
  - "src/components/confirmed-view.tsx"
skills:
  - build
  - frontend-patterns
contracts: []
requirements:
  - F-001-15
  - F-001-20
  - F-001-28
  - F-001-34
acceptance_criteria:
  - "AC-1: every API request the organizer plan, response form, proposal view and confirmed view make goes to a path under /api/v1/ (method and path as CONTRACTS declares them), and none goes to /v1/"
  - "AC-2: the response form saves with PUT /api/v1/plans/{planId}/response and shows the saved state when it returns 200"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
---

The route handlers live under `src/app/api/v1/`, so Next.js serves them at `/api/v1/...`. The UI calls `/v1/...`, which nothing serves: 29 calls in nine components fail in the running app (pilot report: `contracts` and `smoke`). The lead decided to keep the handlers where they are and move CONTRACTS to `/api/v1` (option A); CONTRACTS now declares the `/api/v1` paths, plus a transitional list of the old `/v1` paths that this ticket retires.

T-001-32 covers the account gate, home list, create form, invite panel and join panel; this ticket covers the other four. Change every `fetch` path in the listed components from `/v1/...` to `/api/v1/...`. Do not move handlers. Update the components' tests so their fetch stubs answer `/api/v1/...` and assert the requested URL; a test that stubs fetch by URL must fail if a component calls an old `/v1/` path. Comments in `src/server/plans/views.ts` that name `/v1` paths are not in this ticket.

Each ticket removes its components' entries from the baseline with `sdlc baseline --prune`. After both, the lead deletes the transitional section from CONTRACTS.
