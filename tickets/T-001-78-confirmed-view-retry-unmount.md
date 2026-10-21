---
id: T-001-78
title: "ConfirmedView reloads in one effect; a reload stops on unmount"
type: frontend
status: ready
risk: low
depends_on: [T-001-38, T-001-55, T-001-56]
files:
  - "src/components/confirmed-view.tsx"
  - "src/components/confirmed-view.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-35
  - F-001-36
  - N-001-15
acceptance_criteria:
  - "AC-1: when ConfirmedView unmounts after Retry is pressed and before that reload resolves, it does not navigate, including when the plan is not locked and its opening names another page"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Roadmap item 10's last open pair. The page loads the confirmed document on the server (T-001-38). `ConfirmedView` (`src/components/confirmed-view.tsx`) reloads it on the client through the component-level `loadConfirmed()`, called by the Retry button. When the plan is not locked, `loadConfirmed()` calls `redirectNotLocked()`, which fetches the opening and calls `router.replace`. Neither function checks for unmount, so a reload that answers after the view unmounts can still navigate.

- **One reload, inside an effect.** Copy `src/components/join-panel.tsx` (T-001-56), the "Loads in an effect" row of `skills/frontend-patterns`. Add a `reloadKey` number state that starts at 0. The reload, including the not-locked opening fetch and redirect, runs in a `useEffect` only when `reloadKey > 0`. It checks a local `cancelled` flag after each await, including the opening fetch, and sets it in the cleanup. Retry increments `reloadKey`. Delete `loadConfirmed()` and `redirectNotLocked()`; `redirectNotLocked()` has no other caller. Keep `hrefFromOpeningBody()`.
- Keep the state resets `loadConfirmed()` does first. Do them where JoinPanel does them, without a synchronous `setState` in the effect body (`react-hooks/set-state-in-effect`).
- No `eslint-disable`, no ref, no `AbortController`, no `useCallback`, no new hook file.
- **Otherwise no behaviour change:** the same requests, states and redirects for a mounted view (404 from the opening goes to `/join`; otherwise the opening's `next` decides). The first render still uses `initialDoc`, with no client fetch on mount.
- **Tests** in `src/components/confirmed-view.test.tsx`. For AC-1, render with an `initialDoc` that fails to parse (load error), press Retry, and let the confirmed request answer not-locked. Assert the `/opening` request was issued, so the test cannot pass because nothing ran. Then unmount before it resolves, then resolve it with an opening whose `next` names another page. Assert `router.replace` was not called. The test must fail on `main`. Every existing test keeps its assertions; a test may only gain a tag.
- No other file changes. No source-text test.

**Agent:** build with `fe-builder`. The page is `/plans/{planId}/confirmed`. After the change, call `compile_route` and `get_compilation_issues` on it, and say in the final message which Next.js tools you called and what they returned.
