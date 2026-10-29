---
id: T-001-99
title: "One shared readJson and parseError for the client components"
type: frontend
lane: refactor
status: ready
risk: low
depends_on: [T-001-50, T-001-51, T-001-52, T-001-53, T-001-55, T-001-56, T-001-77, T-001-78, T-001-79, T-001-85, T-001-92, T-001-93, T-001-94, T-001-95, T-001-96]
files:
  - "src/lib/api-error.ts"
  - "src/lib/api-error.test.ts"
  - "src/components/account-gate.tsx"
  - "src/components/confirmed-view.tsx"
  - "src/components/create-form.tsx"
  - "src/components/home-list.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/proposal-view.tsx"
  - "src/components/response-form.tsx"
  - "src/components/account-gate.test.tsx"
  - "src/components/confirmed-view.test.tsx"
  - "src/components/create-form.test.tsx"
  - "src/components/invite-panel.test.tsx"
  - "src/components/join-panel.test.tsx"
  - "src/components/organizer-plan.test.tsx"
  - "src/components/response-form.test.tsx"
skills:
  - build
  - frontend-patterns
contracts: []
requirements:
  - N-001-15
acceptance_criteria:
  - "AC-1: for each of account-gate, create-form, invite-panel, join-panel, organizer-plan and response-form, a submit whose response is status 400 with a body that is not valid JSON shows the same alert text and the same field errors as a submit whose response is status 400 with the body {}"
  - "AC-2: for each of account-gate, create-form, invite-panel, join-panel and organizer-plan, a submit whose response is status 400 with an error envelope whose fields are [{path P, code C}, {path 1, code C}, \"junk\", null] shows the same field errors as a submit whose fields are [{path P, code C}], where P is a field that component shows and C is a field code it maps to a message"
  - "AC-3: for each of confirmed-view (reason not_locked), invite-panel (plan_locked) and organizer-plan (plan_locked), a status 409 response whose error envelope has that reason and no code takes the same branch as one with that reason and code conflict, and a 409 whose reason is the number 1 takes the same branch as a 409 with the body {}"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - .sdlc/decisions/ADR-0004-refactor-lane.md
---

Roadmap item 10 and the `.tsx` duplication note under "Decisions the lead owes". This is a **refactor** (kit ADR-0004), so behaviour does not change. The AC pin today's behaviour through the components' rendered output, so their tests pass on `main` and on this branch. No AC test may import `src/lib/api-error.ts`; its own test file is untagged.

There are three copied helpers today (measured on `main` `82c77b7`):

- `readJson(response)`, which returns the parsed body or `null`, is copied identically in all nine components listed under `files:`.
- `parseError(body)` is copied identically in six of them (`account-gate`, `create-form`, `invite-panel`, `join-panel`, `organizer-plan`, `response-form`). It returns `{ code, reason, fields }` and keeps only `fields` entries with string `path` and `code`.
- `confirmed-view` and `proposal-view` hold a smaller copy that returns `{ code, reason }` only. `home-list` has `readJson` alone.
- The gate's duplication log lists several of these as `.tsx` clones of 13 to 44 lines.

Changes:

- **`src/lib/api-error.ts`**: no `"use client"` and no import from `src/server/` (rulebook: "Pure helper shared by pages and client components", example `src/lib/plan-paths.ts`). It exports `readJson`, `parseError`, `type FieldError` and `type ParsedError` with the six-copy behaviour. The two smaller copies become callers of the full `parseError`; they read only `code` and `reason`, so the extra `fields` is unused.
- **Each component**: delete its local copies and types, and import from `@/lib/api-error`. Change nothing else: not a string, branch, class or element.
- **Tests**:
  - Keep every existing test line, adding only AC tags (ADR-0004).
  - Add the AC-tagged tests where a component lacks one, by stubbing `fetch` as the component's existing tests do.
  - Add an untagged `src/lib/api-error.test.ts` for the helper itself. It covers non-JSON, a non-object body, `error` not an object, malformed `fields` entries, and non-string `code` or `reason`.
- **Not in scope**: `FieldBlock` (T-001-100); `chromeFor`; any server-side envelope code (`src/server/http/errors.ts`).

**Agent:** build with `fe-builder` (or `builder`). Run `npx --no-install vitest run src/components src/lib` before the gate. Refactor lane: no test play.
