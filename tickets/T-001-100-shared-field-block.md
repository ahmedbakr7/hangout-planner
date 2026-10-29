---
id: T-001-100
title: "One shared FieldBlock for the form components"
type: frontend
lane: refactor
status: ready
risk: low
depends_on: [T-001-99]
files:
  - "src/components/field-block.tsx"
  - "src/components/field-block.test.tsx"
  - "src/components/account-gate.tsx"
  - "src/components/create-form.tsx"
  - "src/components/invite-panel.tsx"
  - "src/components/join-panel.tsx"
  - "src/components/organizer-plan.tsx"
  - "src/components/response-form.tsx"
  - "src/components/account-gate.test.tsx"
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
  - "AC-1: in each of account-gate, create-form, invite-panel, join-panel, organizer-plan and response-form, every input wrapped by a field block has a label whose for attribute equals the input's id, and when the server rejects that field the field's error text is shown in one p element placed after the input, whose id is the field's error id"
  - "AC-2: in each component in AC-1, a field with no error renders no error element for that field, and the label text is the same translated text the component shows on main"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0006-patterns-rulebook.md
  - .sdlc/decisions/ADR-0004-refactor-lane.md
---

Roadmap item 10 and the `.tsx` duplication note under "Decisions the lead owes". This is a **refactor** (kit ADR-0004), so behaviour does not change. The AC pin today's markup through the six components, so their tests pass on `main` and on this branch. No AC test may import `src/components/field-block.tsx`; its own test file is untagged.

`FieldBlock({ id, label, errorId, error, children })` is copied identically in the six components listed under `files:`. Each copy renders:

- a `div.flex.flex-col.gap-2` holding a `Label htmlFor={id}`;
- the children;
- when `error` is set, a `p` with `id={errorId}` and the classes `text-sm text-destructive text-start`.

The component is used 28 times across the six files.

- **`src/components/field-block.tsx`**: one exported `FieldBlock` with the same props, elements and class names. Copy `src/components/route-load-error.tsx` (T-001-85) as the example of a shared component extracted from screens. Add `"use client"` only if a caller needs it; today's copies use no hooks.
- **Each component**: delete its local `FieldBlock` and import the shared one. Change nothing else.
- **Tests**: keep every existing test line, adding only AC tags (ADR-0004). Add the AC-tagged tests where a component lacks one. Add an untagged `src/components/field-block.test.tsx`.
- **Order**: after T-001-99, because both tickets edit the same six components.
- **Not in scope**: the in-file clones that jscpd also reports (`join-panel` 592/617, `invite-panel` 520/742, `create-form` 669/689); `JoinShell`.

**Agent:** build with `fe-builder` (or `builder`). Run `npx --no-install vitest run src/components` before the gate. Refactor lane: no test play.
