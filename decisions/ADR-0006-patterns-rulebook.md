---
id: ADR-0006
title: Patterns rulebook in the frontend and backend patterns skills
status: accepted
---

# ADR-0006: Patterns rulebook in the frontend and backend patterns skills

- Status: accepted
- Date: 2026-10-12
- Source: lead

## Context

Build agents start each ticket with no memory of the codebase. When the ticket, `arch/CONTRACTS.md` and the patterns skill do not say where a file goes or which idiom to use, an agent guesses. The guesses show in review: Next.js idioms from different major versions, a second way of doing something the code already does one way. `AGENTS.md` already tells agents to copy the closest existing example and to stop when there is none. Agents need a short list of those examples.

## Decision

Each patterns skill (`skills/frontend-patterns/SKILL.md`, `skills/backend-patterns/SKILL.md`) keeps its lock and adds two short sections:

- **Where things go**: a table of what goes where, each row naming one file to copy.
- **Use X, not Y**: one line per idiom the code has settled, with the one to avoid.

Both sections follow the code on main where it is consistent, and say which way new code goes where it is not. They are kept short, so an agent reads all of it. Existing code that breaks a rule moves only when a ticket touches it; no sweep ticket. A rule changes by a lead PR that edits the skill and names the change in its description; a rule that reverses an accepted ADR needs a superseding ADR.

ADRs are not pasted into prompts. A ticket cites the ADRs it depends on in `source_adr`; `AGENTS.md` makes the agent open them, and review checks it did.

## Open question

ADR-0001 says page loads call the same view functions as the route handlers. Every page on main instead awaits its params and renders a client component that fetches `/api/v1`. The rulebook records today's pattern for existing pages. A ticket that adds a page stops and asks until the lead either supersedes that line of ADR-0001 or tickets the pages to load on the server.

## Consequences

- Agents have a named example for the common cases, which narrows guessing to the cases the rulebook does not cover. In those cases they stop instead of inventing.
- The rulebook can drift from the code. Review checks new code against it.
- After the Next.js 16 upgrade ticket merges, a lead PR updates the "Use X, not Y" lines that change with the version (tickets cannot edit `skills/`).
