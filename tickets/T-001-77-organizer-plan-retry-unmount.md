---
id: T-001-77
title: "OrganizerPlan reloads in one effect; a reload stops on unmount"
type: frontend
status: ready
risk: low
depends_on: [T-001-34, T-001-36, T-001-56]
files:
  - "src/components/organizer-plan.tsx"
  - "src/components/organizer-plan.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-24
  - N-001-15
acceptance_criteria:
  - "AC-1: when OrganizerPlan unmounts after Retry is pressed and before that reload resolves, it does not navigate, including when the reloaded plan is locked"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Roadmap item 10's last open pair. The page loads the plan on the server (T-001-36). `OrganizerPlan` (`src/components/organizer-plan.tsx`) reloads it on the client through the component-level `loadPlan()`, which two places call: the Retry button and a save answered `409 attempt_in_progress`. `loadPlan()` has no unmount check, so a reload that answers after the view unmounts can still call `router.replace` to `/plans/{planId}/confirmed` when the plan is locked.

- **One reload, inside an effect.** Copy `src/components/join-panel.tsx` (T-001-56), the "Loads in an effect" row of `skills/frontend-patterns`. Add a `reloadKey` number state that starts at 0. The reload runs in a `useEffect` only when `reloadKey > 0`, checks a local `cancelled` flag after each await, and sets it in the cleanup. Both callers increment `reloadKey` instead of calling `loadPlan()`. Delete `loadPlan()`.
- Keep the state resets `loadPlan()` does first (load state, plan, field errors, rejected-frozen set, form error). Do them where JoinPanel does them, without a synchronous `setState` in the effect body (`react-hooks/set-state-in-effect`).
- No `eslint-disable`, no ref, no `AbortController`, no `useCallback`, no new hook file.
- **Otherwise no behaviour change:** the same request, states and redirect for a mounted view. The first render still uses `initialPlan`, with no client fetch on mount. One timing difference is allowed. Today the save path does `await loadPlan()`, so its `finally` clears `submitting` only after the reload. After the change, it clears `submitting` as soon as the reload starts. The user cannot see this: the resets set the load state to `loading`, and the view does not render the form unless the load state is `loaded`.
- **Out of scope:** the save handler's own `router.replace` calls, for a locked plan answered to a save. The AC names only the reload.
- **Tests** in `src/components/organizer-plan.test.tsx`. For AC-1, render with an `initialPlan` that fails to parse (load error), press Retry, and assert the plan request was issued, so the test cannot pass because nothing ran. Then unmount before the request resolves, resolve it with a plan whose `state` is `locked`, and assert `router.replace` was not called. The test must fail on `main`. Also add an untagged test that a save answered `409 attempt_in_progress` still reloads while mounted, and shows the reloaded plan. Every existing test keeps its assertions; a test may only gain a tag.
- No other file changes. No source-text test.

**Agent:** build with `fe-builder`. The page is `/plans/{planId}`. After the change, call `compile_route` and `get_compilation_issues` on it, and say in the final message which Next.js tools you called and what they returned.
