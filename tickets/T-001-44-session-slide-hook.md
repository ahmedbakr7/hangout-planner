---
id: T-001-44
title: "Server-loaded join page slides the account session again"
type: frontend
status: ready
risk: medium
depends_on: [T-001-42]
files:
  - "src/components/use-session-slide.ts"
  - "src/components/use-session-slide.test.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/join-panel.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: "arch/CONTRACTS.md#GET /api/v1/me"
requirements:
  - F-001-10
  - N-001-15
acceptance_criteria:
  - "AC-1: useSessionSlide(true) sends exactly one GET /api/v1/me with credentials same-origin after mount, and useSessionSlide(false) sends no request"
  - "AC-2: a failed or rejected GET /api/v1/me from useSessionSlide changes nothing the screen shows and throws no error"
  - "AC-3: JoinPanel given an initial opening with next join and initialSignedIn true shows the preview from that data, makes no GET /api/v1/plans/{planId}/opening request, and sends exactly one GET /api/v1/me; with initialSignedIn false it sends no GET /api/v1/me"
  - "AC-4: on the real stack, opening /plans/{planId}/join with an invited account's hp_session moves that session's stored expires_at later, as GET /api/v1/me does"
  - "AC-5: JoinPanel given a token and no initial opening still fetches GET /api/v1/join/{token} and GET /api/v1/me on first render as before, with no extra GET /api/v1/me from the hook"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0007-pages-load-on-the-server.md
  - decisions/ADR-0008-join-token-page-loads-on-the-client.md
  - decisions/ADR-0009-session-slide-after-server-load.md
---

Add the session-slide hook from ADR-0009 and use it in `JoinPanel` for `/plans/{planId}/join`. Since T-001-42 (#101), opening that page has read the account session without sliding it. This ticket restores the slide. T-001-45 to T-001-47 reuse the hook.

- **`src/components/use-session-slide.ts`:**
  - `"use client"`. It exports `useSessionSlide(signedIn: boolean): void`.
  - When `signedIn` is true, a mount effect sends `fetch("/api/v1/me", { credentials: "same-origin" })` and ignores the response.
  - A rejected `fetch` is caught and dropped, so nothing is logged and nothing is thrown.
  - It keeps no state and returns nothing.
  - When `signedIn` is false, it sends nothing.
- **`src/components/join-panel.tsx`:**
  - On the server-loaded path, where `initialOpening` is not `undefined`, call `useSessionSlide(initialSignedIn === true)` from the component that renders that path.
  - The token path (`initialOpening === undefined`) does not call the hook, because its first-load effect already calls `/api/v1/me`.
  - Follow the hook rules: call it unconditionally in a component that renders only on the server-loaded path, or pass `false` on the token path. Do not call it inside a condition.
- **`src/components/use-session-slide.test.tsx`:** test the hook through a small test component, with `fetch` stubbed as the existing component tests do.
- No new message key, no new dependency, and no route or contract change.
- **Real-stack proof (test play):** an `e2e/` test proves AC-4. Seed an invited account and a session row with an `expires_at` well short of 30 days. Render the page's `JoinPanel` path. Then call the real `GET /api/v1/me` handler with that cookie, as the hook does, and assert that the stored `expires_at` moved later. State the limit in a comment, as `e2e/invite-error-boundary.e2e.ts` does: the test proves the handler the hook calls, and AC-3 proves the hook fires; no test drives a real browser. Delete the rows it creates in `afterAll`, including `link_sessions` (see T-001-43).
