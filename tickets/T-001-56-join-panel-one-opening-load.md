---
id: T-001-56
title: "JoinPanel loads in one effect; retry re-runs it and stops on unmount"
type: frontend
status: ready
risk: low
depends_on: [T-001-18, T-001-32, T-001-35, T-001-42, T-001-44, T-001-50, T-001-52, T-001-53]
files:
  - "src/components/join-panel.tsx"
  - "src/components/join-panel.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-11
  - N-001-15
acceptance_criteria:
  - "AC-3: when JoinPanel unmounts after Retry is pressed and before that load resolves, it does not navigate, including for an opening whose next is not join"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0008-join-token-page-loads-on-the-client.md
---

Roadmap item 10 ("the opening + me fetch pair in `join-panel.tsx`") and the second `fe-builder` pilot (item 17). Rewritten by the lead on 2026-10-16 after the first build failed; see Amendments.

`JoinPanel` (`src/components/join-panel.tsx`) has two copies of the same load: `start()` inside the first-load `useEffect`, which checks a `cancelled` flag after each await, and the component-level `loadOpening()`, used by both Retry buttons, which has no such check. So a Retry whose answer arrives after the panel unmounts can still call `router.replace` and set state.

ADR-0008 binds: `/join/{token}` keeps client loading. The panel still renders its initial props when the page passes them (`/plans/{planId}/join`), and the first load still runs only when it gets no initial opening.

- **One load, inside the effect.** Add a `reloadKey` number state (starts at 0). The effect keeps `start()` inside it with its `cancelled` flag and cleanup, and runs when `loadsOnMount` is true or `reloadKey > 0`; add `reloadKey` to its dependency list. Both Retry buttons call one handler that increments `reloadKey`. Delete `loadOpening()`. Retry then gets the same `cancelled` guard as the first load, which is AC-3.
- This is the pattern in `skills/frontend-patterns` ("Loads in an effect"). No `eslint-disable`, no ref, no `AbortController`, no `useCallback`, no new hook file.
- **Otherwise no behaviour change:** same requests in the same order, same states, same redirects, same `useSessionSlide` call. A Retry pressed on the `/plans/{planId}/join` page (initial props, then an error or unknown answer) still loads.
- **Tests** in `src/components/join-panel.test.tsx`. AC-3 needs a new test: render with a token and no initial opening, make the first load fail, press Retry, unmount before the retry's opening request resolves, resolve it with a `next` of `respond`, and assert `router.replace` and `router.push` were not called. It must fail on `main`. Also keep an untagged test for the first-load case (the removed AC-2's text); a `T-001-56/AC-2` tag would name no AC. Every existing test keeps its assertions; a test may only gain a tag.
- No other file changes. No source-text test.

**Agent:** build with `fe-builder`. The page is `/join/{token}`. After the change, call `compile_route` and `get_compilation_issues` on it and say in the final message which Next.js tools you called and what they returned. The transcript in `.sdlc-run/logs/fe-builder-*.jsonl` is the pilot's record.

## Amendments

- remove AC-1: today's code already meets it, so no test can fail on main and `ac-red` cannot pass; the existing T-001-32/AC-1 and T-001-44/AC-5 tests keep pinning it (lead, 2026-10-16)
- remove AC-2: today's first load already has the `cancelled` guard, so `ac-red` cannot pass; the body keeps a test for it (lead, 2026-10-16)
- add AC-3: the behaviour this ticket changes, a Retry that resolves after unmount no longer navigates (lead, 2026-10-16)
