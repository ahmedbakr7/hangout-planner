---
id: T-001-56
title: "JoinPanel loads the opening and the session in one function"
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
  - "AC-1: with a token and no initial opening, the first load and a retry after a failed load each send exactly one opening request and one /api/v1/me request, and a successful retry shows the preview and the signed-in state"
  - "AC-2: when JoinPanel unmounts before its first load resolves, it does not navigate, including for an opening whose next is not join"
  - "AC-3: every existing test in src/components/join-panel.test.tsx passes with its assertions unchanged"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0008-join-token-page-loads-on-the-client.md
---

Roadmap item 10 ("the opening + me fetch pair in `join-panel.tsx`") and the second `fe-builder` pilot (item 17).

`JoinPanel` (`src/components/join-panel.tsx`) has two copies of the same load: `loadOpening()`, used by retry, and `start()` inside the first-load `useEffect`. Both fetch the opening path and `/api/v1/me` together, set the session from the `me` answer, map a 404 to `unknown`, a non-OK answer or an unreadable body to `error`, redirect with `planPath` when `next` is not `join`, and otherwise show the preview. They differ only in that `start()` checks a `cancelled` flag after each await, and `loadOpening()` does not.

ADR-0008 binds: `/join/{token}` keeps client loading. The first-load effect still runs only when the panel gets no initial opening, and the panel still uses its initial props when the page passes them (`/plans/{planId}/join`).

- **One function.** Keep a single load function, used by both the first-load effect and retry, that takes an `isActive: () => boolean` argument and checks it after each await, as `start()` checks `cancelled` today. The effect passes `() => !cancelled` with its existing `cancelled` flag and cleanup; retry passes `() => true`. Remove the other copy. This keeps the existing guard; there is no ref or `AbortController` load guard in `src/components/` to copy, so do not add one.
- **No behaviour change:** same requests, same states, same redirects, same `useSessionSlide` call. AC-2 pins what the first load does today.
- **Unit tests** in `src/components/join-panel.test.tsx`, tagged `T-001-56/AC-n`. The existing "T-001-32/AC-1 retry after a failed load reloads the preview and the signed-in state" and "T-001-44/AC-5 a token with no initial opening sends exactly one me request" tests may gain the AC-1 tag if they pin it; add what they do not cover (one opening and one `me` request on retry). AC-2 needs a new test: start the first load with an opening whose `next` is `respond`, unmount before it resolves, then resolve it and assert `router.replace` was not called.
- No other file changes. No source-text test.

**Agent:** build with `fe-builder`. The page is `/join/{token}`; use `compile_route` and `get_compilation_issues` on it after the change, and say in the final message which Next.js tools you called and what they returned. The transcript in `.sdlc-run/logs/fe-builder-*.jsonl` is the pilot's record.
