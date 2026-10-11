# AGENTS.md (product shim)

This product pins the AI-SDLC kit at `.sdlc/`. Read **`.sdlc/AGENTS.md` first** and obey it.

Path map for this repo:

| Kit path in `.sdlc/AGENTS.md` | Where it is here |
|---|---|
| `AGENTS.md` (kit OS) | `.sdlc/AGENTS.md` |
| play skills `skills/<play>/` | `.sdlc/skills/<play>/` |
| `skills/frontend-patterns`, `backend-patterns` | `skills/frontend-patterns`, `skills/backend-patterns` |
| vendor / craft skills | `skills/vendor/` |
| `adapters/MODELS.md` | `adapters/MODELS.md` |
| `arch/CONTRACTS.md`, tickets, intent, design, decisions | same paths at repo root |
| commands | `.sdlc/commands/` |
| scripts / hooks | `.sdlc/scripts/`, `.sdlc/hooks/` |

If a play skill and a product file disagree, `.sdlc/AGENTS.md` still wins, then this product's `CONTRACTS.md` and ADRs.

Do not edit `.sdlc/` in this session. Open a kit-repo change instead.

## Product rules for every play

- **ADRs bind.** Before building, open every file the ticket lists under `source_adr`. A change that conflicts with one stops and says so; it does not work around it.
- **Don't guess structure.** If the ticket, `arch/CONTRACTS.md` and the ticket's patterns skill (`skills/frontend-patterns`, `skills/backend-patterns`) don't settle where a file goes, which library to use or how a pattern is done, copy the closest existing example in this repo and name it in the commit message. If there is no example, stop and report the gap instead of inventing a convention.
