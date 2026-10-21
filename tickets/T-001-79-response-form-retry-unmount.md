---
id: T-001-79
title: "ResponseForm reloads in one effect; a reload stops on unmount"
type: frontend
status: ready
risk: low
depends_on: [T-001-34, T-001-40, T-001-56, T-001-57]
files:
  - "src/components/response-form.tsx"
  - "src/components/response-form.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-22
  - F-001-39
  - N-001-15
acceptance_criteria:
  - "AC-1: when ResponseForm unmounts after Retry is pressed and before that reload resolves, it does not navigate, including when the reloaded plan is proposed or locked"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
---

Roadmap item 10's last open pair. The page loads the response on the server (T-001-40). `ResponseForm` (`src/components/response-form.tsx`) reloads it on the client through the component-level `loadResponse()`. Two places call it: the Retry button and a save answered `409 attempt_in_progress`. When the plan is closed (a 409 with a closed reason, or a plan state of `proposed` or `locked`), `loadResponse()` calls `leaveClosed()`, which calls `router.replace`. Nothing checks for unmount, so a reload that answers after the form unmounts can still navigate.

- **One reload, inside an effect.** Copy `src/components/join-panel.tsx` (T-001-56), the "Loads in an effect" row of `skills/frontend-patterns`.
  - Add a `reloadKey` number state that starts at 0. The reload runs in a `useEffect` only when `reloadKey > 0`.
  - The effect checks a local `cancelled` flag after each await, before any state change or `router.replace`, and sets the flag in the cleanup.
  - Both callers increment `reloadKey` instead of calling `loadResponse()`. Delete `loadResponse()`.
  - Keep `leaveClosed()` for the save path. The effect may call it only after its `cancelled` check.
- Keep the state resets that `loadResponse()` does first. Do them where JoinPanel does them, without a synchronous `setState` in the effect body (`react-hooks/set-state-in-effect`).
- No `eslint-disable`, no ref, no `AbortController`, no `useCallback`, no new hook file.
- **Otherwise no behaviour change:** the same request, states and redirects for a mounted form. The first render still uses `initialResponse`, with no client fetch on mount. One timing difference is allowed: the save path may clear `submitting` as soon as the reload starts. The user cannot see this, because the form renders only when the load state is `loaded`.
- **Out of scope:** the save handler's own `leaveClosed()` call, for a closed plan answered to a save. The AC names only the reload.
- **Tests** in `src/components/response-form.test.tsx`. For AC-1, render with an `initialResponse` that fails to parse (load error), press Retry, and assert the response request was issued, so the test cannot pass because nothing ran. Then unmount before the request resolves, and resolve it with a document whose plan state is `locked`. Assert `router.replace` was not called. Add the same case for `proposed`. Both must fail on `main`. Also add an untagged test that a save answered `409 attempt_in_progress` still reloads while mounted, and shows the reloaded form. Every existing test keeps its assertions; a test may only gain a tag.
- No other file changes. No source-text test.

**Agent:** build with `fe-builder`. The page is `/plans/{planId}/respond`. After the change, call `compile_route` and `get_compilation_issues` on it, and say in the final message which Next.js tools you called and what they returned.
