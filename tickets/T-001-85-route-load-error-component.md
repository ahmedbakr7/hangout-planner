---
id: T-001-85
title: "One shared load-error card for the ten route error boundaries"
type: frontend
lane: refactor
status: ready
risk: low
depends_on: [T-001-37, T-001-38, T-001-39, T-001-40, T-001-41, T-001-42, T-001-45, T-001-46, T-001-47, T-001-48]
files:
  - "src/components/route-load-error.tsx"
  - "src/components/route-load-error.test.tsx"
  - "src/app/error.tsx"
  - "src/app/error.test.tsx"
  - "src/app/account/error.tsx"
  - "src/app/account/error.test.tsx"
  - "src/app/invitations/error.tsx"
  - "src/app/invitations/error.test.tsx"
  - "src/app/plans/new/error.tsx"
  - "src/app/plans/new/error.test.tsx"
  - "src/app/plans/[planId]/error.tsx"
  - "src/app/plans/[planId]/error.test.tsx"
  - "src/app/plans/[planId]/confirmed/error.tsx"
  - "src/app/plans/[planId]/confirmed/error.test.tsx"
  - "src/app/plans/[planId]/invite/error.tsx"
  - "src/app/plans/[planId]/invite/error.test.tsx"
  - "src/app/plans/[planId]/join/error.tsx"
  - "src/app/plans/[planId]/join/error.test.tsx"
  - "src/app/plans/[planId]/proposal/error.tsx"
  - "src/app/plans/[planId]/proposal/error.test.tsx"
  - "src/app/plans/[planId]/respond/error.tsx"
  - "src/app/plans/[planId]/respond/error.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: rendering the default export of each route error boundary in English with an Error and a retry function shows a level-1 heading and one role=alert element with these texts: src/app/account/error.tsx Account.title and errors.code.upstream; src/app/invitations/error.tsx invitations.title and invitations.loadError; src/app/plans/new/error.tsx Create.title and errors.code.upstream; src/app/plans/[planId]/error.tsx plans.title and plans.loadError; src/app/plans/[planId]/confirmed/error.tsx confirmed.title and confirmed.loadError; src/app/plans/[planId]/invite/error.tsx invite.title and invite.loadError; src/app/plans/[planId]/join/error.tsx join.title and join.joinFailed; src/app/plans/[planId]/proposal/error.tsx proposal.title and proposal.loadError; src/app/plans/[planId]/respond/error.tsx respond.title and errors.code.upstream"
  - "AC-2: for each boundary in AC-1, and for src/app/error.tsx on any path, the page shows exactly one button, labelled in English with invitations.retry for src/app/invitations/error.tsx, plans.retry for src/app/plans/[planId]/error.tsx, proposal.retry for src/app/plans/[planId]/proposal/error.tsx and common.retry for the other boundaries in AC-1 and for src/app/error.tsx off / (on / it is Home.retry, see AC-3); clicking it calls the retry function once; console.error is called exactly once, with the Error the boundary received; and the text of an Error message passed in does not appear on the page"
  - "AC-3: src/app/error.tsx with the pathname / shows the heading Home.title, an alert with Home.loadError and a button with Home.retry; with the pathname /join/abc it shows no heading and an alert with errors.code.upstream"
  - "AC-4: each boundary in AC-1 rendered with the Arabic messages shows the Arabic text of the same heading, alert and button keys as in English (AC-1 and AC-2), and src/app/error.tsx in Arabic shows the Arabic text of the AC-3 keys with the pathname / and with the pathname /join/abc"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - .sdlc/decisions/ADR-0004-refactor-lane.md
---

Roadmap item 10 (duplication). This is a **refactor** (kit ADR-0004): behaviour does not change. The AC pin today's behaviour through the default exports `main` already has, so their tests pass on `main` and on this branch. No AC test may import `src/components/route-load-error.tsx`; its own test file is untagged.

The gate's duplication log on `main` (1ce887e) lists six clones of 16 to 31 lines between `src/app/plans/[planId]/respond/error.tsx` and the other route boundaries. All ten boundaries render the same card: `<main>`, a `Card` with an optional `CardHeader` holding an `h1`, a `role="alert"` paragraph, and a secondary `Button` that calls `retry()`, plus `useEffect(() => console.error(error), [error])`. They differ only in the three strings and, for `src/app/error.tsx`, in hiding the heading off `/`.

- **`src/components/route-load-error.tsx`** (`"use client"`): one component that takes the error, the retry function, an optional title, the alert text and the retry label, and renders the card above with the same elements and class names as today. It logs the error once, as the boundaries do now.
- **Each `error.tsx`** keeps its own file and default export, as the rulebook's page-load-failure row and the lead decision of 2026-10-12 it records require (`skills/frontend-patterns`, "Each page ticket adds its route's `error.tsx`"); ADR-0007 is the server-loading decision those boundaries serve. Each picks its own strings with `useTranslations` exactly as today, then renders the shared component. `src/app/error.tsx` keeps its `usePathname() === "/"` choice and passes no title off `/`.
- **Tests:** the existing boundary tests keep their tags (`T-001-37`, `T-001-38`, … `T-001-48`) and assertions. Add the AC-tagged tests where a boundary lacks one for an AC: for example, Arabic (AC-4), and the error message text staying off the page (AC-2). Add an untagged `src/components/route-load-error.test.tsx` for the component itself.
- **Not in scope:** changing any text, class or element; the route-neutral copy; `src/app/join/[token]`, which has no boundary (ADR-0008).

**Copy:** `src/components/language-control.tsx` is the shared client component in `src/components/` that nine screens render. Keep the boundary's markup exactly as `src/app/plans/[planId]/error.tsx` has it today; that file is the rulebook's example for the page-load-failure row. After merge, the lead updates that row to name the shared component and adds its location to the "Where things go" table.

**Agent:** build with `fe-builder` (or `builder`); run `npx --no-install vitest run src/app src/components/route-load-error.test.tsx`. Refactor lane: no test play.
