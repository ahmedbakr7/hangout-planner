---
id: T-001-37
title: "Organizer plan page shows an error boundary when its loader throws"
type: frontend
status: ready
risk: low
depends_on: [T-001-36]
files:
  - "src/app/plans/[planId]/error.tsx"
  - "src/app/plans/[planId]/error.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: when the /plans/{planId} page throws while loading (for example, the loader's database call rejects), the route renders src/app/plans/[planId]/error.tsx, which shows the organizer plan's load error text (plans.loadError) in a role=\"alert\" element, and none of the plan's own data (its authored title, participants or places)"
  - "AC-2: the error boundary shows a retry button labelled with plans.retry; pressing it calls the retry function Next passes to the boundary (Next 16.3+ `retry`, which re-runs the server load; not `reset`, which re-renders without re-fetching)"
  - "AC-3: the error boundary reports the error once with console.error, so the failure is not swallowed"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Since T-001-36, `/plans/{planId}` loads its first data on the server. If the loader throws, the page throws, and Next shows its default error page because the route has no error boundary. The lead decided on 2026-10-12, after the #91 CodeRabbit review, that a page whose loader throws renders its route's `error.tsx`. The page does not catch the error. This ticket adds the first boundary, and later page tickets copy it.

- **`src/app/plans/[planId]/error.tsx`:** a `"use client"` component taking `{ error, retry }`, as Next 16.4's `error.js` convention defines them (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). Use `retry`, not `reset`: `reset` re-renders without re-fetching, so a failed server load would fail again.
  - It renders the same text as the organizer plan's error state: the `plans` namespace, `title`, `loadError` in a `role="alert"` paragraph, and a secondary `Button` labelled `retry` whose click calls `retry()`. Copy the markup of the `load === "error"` branch in `src/components/organizer-plan.tsx`, and use `useTranslations` from `next-intl` as that component does.
  - It calls `console.error(error)` once, in an effect keyed on `error`.
  - No new message keys, no new dependency, and no change to the page, the loader or the component.
- **`src/app/plans/[planId]/error.test.tsx`:** renders the boundary with a thrown `Error` and a mock `retry`. It asserts the alert text and that no plan data appears, that the retry button calls `retry` once, and that `console.error` was called with the error. Copy the render and i18n set-up from `src/components/organizer-plan.test.tsx`.
- **Real-stack proof (test play):** an `e2e/` test that a throwing load on `/plans/{planId}` reaches this boundary, by the closest in-process means the harness allows. If it cannot exercise Next's segment wiring before roadmap item 5 (Playwright), the test play says so in its record, and AC-1 is proven by the unit test on the boundary.
