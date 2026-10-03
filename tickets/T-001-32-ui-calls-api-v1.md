---
id: T-001-32
title: "Account, home, create, invite and join call the API at /api/v1"
type: frontend
status: in_progress
risk: medium
depends_on: []
files:
  - "src/components/account-gate.tsx"
  - "src/components/create-form.tsx"
  - "src/components/home-list.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/join-panel.tsx"
skills:
  - build
  - frontend-patterns
contracts: []
requirements:
  - F-001-1
  - F-001-4
  - F-001-10
  - F-001-12
  - F-001-16
acceptance_criteria:
  - "AC-1: every API request the account gate, home list, create form, invite panel and join panel make goes to a path under /api/v1/ (method and path as CONTRACTS declares them), and none goes to /v1/"
  - "AC-2: the account gate, on a 401 from GET /api/v1/me, shows the sign-in form; on a 200 it shows the signed-in account"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
---

The route handlers live under `src/app/api/v1/`, so Next.js serves them at `/api/v1/...`. The UI calls `/v1/...`, which nothing serves: 29 calls in nine components fail in the running app (pilot report: `contracts` and `smoke`). The lead decided to keep the handlers where they are and move CONTRACTS to `/api/v1` (option A); CONTRACTS now declares the `/api/v1` paths, plus a transitional list of the old `/v1` paths that this ticket retires.

This ticket covers the first five components; T-001-33 covers the other four. Change every `fetch` path in the listed components from `/v1/...` to `/api/v1/...`. Do not move handlers. Update the components' tests so their fetch stubs answer `/api/v1/...` and assert the requested URL; a test that stubs fetch by URL must fail if a component calls an old `/v1/` path. Comments in `src/server/plans/views.ts` that name `/v1` paths are not in this ticket.

Each ticket removes its components' entries from the baseline with `sdlc baseline --prune`. After both, the lead deletes the transitional section from CONTRACTS.
