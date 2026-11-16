---
id: ADR-0018
title: A type test ticket lists a shared e2e helper under files, not test_files
status: accepted
---

# ADR-0018: A `type: test` ticket lists a shared `e2e/` helper under `files:`, not `test_files`

- Status: accepted
- Date: 2026-11-16
- Source: lead. On 2026-11-16 the lead chose this option in chat ("Do what's recommended", on the two options listed under "Decisions the lead owes" in `docs/hangout-roadmap.md`).
- Supersedes: none
- Amends: ADR-0016 § Decision, the line "`test_files` is available to new tickets. It is the convention for a test helper shared by more than one test file (roadmap items 10 and 24), so long as the ticket lists it.", and ADR-0017 § Consequences, the line "A test helper that more than one test file shares still needs a ticket that lists it under `test_files` (ADR-0016)". The rest of both ADRs stands.

## Context

Roadmap item 6 leaves one open line: three `e2e/shipped-coverage-*.e2e.ts` files each carry their own copy of the child-Vitest run helpers. Extracting them needs a ticket, and that ticket is a `type: test` ticket, because only the e2e files change.

ADR-0016 and ADR-0017 say such a ticket lists the shared helper under `test_files`. Kit v5.5.0 lint rejects that. `_test_files_problems` in `.sdlc/sdlc/lint.py` reports "test_files has no effect: the ticket has no test play" for a `type: test` ticket. `test_files` widens the test play's write set (kit ADR-0007), and a `type: test` ticket has no test play: its build writes the real-stack tests (ADR-0017).

A `type: test` build already writes `e2e/**`. `e2e/**` is in `tests.integration_globs` in `sdlc.toml`, and `Gate._hard` lets a `type: test` build write those paths. Three tickets have used this path for a shared helper: T-001-54 (`e2e/db-cleanup.ts`), T-001-59 (`e2e/teardown.ts`) and T-001-67 (`e2e/route-server.ts`). Each listed the helper under `files:`.

Options:

- List the helper under `files:` on the `type: test` ticket. This needs no kit change and matches T-001-54, T-001-59 and T-001-67. Chosen.
- Change the kit so lint accepts `test_files` on a `type: test` ticket. This keeps ADR-0016's wording, but needs a kit release and a pin bump, and the field would have no effect on the write set. Rejected.

## Decision

- A test helper shared by two or more `e2e/` files is `e2e/<name>.ts`, with no `.e2e.` in its name (rulebook row in `skills/backend-patterns`).
- A `type: test` ticket that adds or changes such a helper lists it under `files:`, with the `e2e/` files that use it and the helper's own test file `e2e/<name>.e2e.ts`. It sets no `test_files`.
- `test_files` stays available to a feature ticket that has a test play, for a path outside production source that its test play may also write (kit ADR-0007, ADR-0016).

## Consequences

- T-001-98 extracts the copied child-Vitest helpers into `e2e/child-vitest.ts` and lists it under `files:`.
- The "Helper shared by two or more `e2e/` files" row in `skills/backend-patterns/SKILL.md` names `files:` and this ADR.
- No kit change and no pin bump. Kit v5.5.0 lint and the build's write-set check already accept such a ticket.
- A feature ticket's build still cannot write `e2e/**` (ADR-0017), so a feature ticket that needs a new shared `e2e/` helper still has a separate `type: test` ticket write it first.

## Not decided

- A helper shared by a `src/` unit test and an `e2e/` test (roadmap item 24). This ADR covers only helpers shared by `e2e/` files.
