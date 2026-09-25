---
name: backend-patterns
description: Product-locked backend patterns (API style, authz, persistence). Fill via ADR in the first /architect.
---

# Skill: backend-patterns

Hard rules: `AGENTS.md`. Stack: `decisions/ADR-0001-stack.md`. Seams: `arch/CONTRACTS.md`.

Change this lock only by a superseding ADR.

## Lock (fill in per product)

- API style (REST/RPC) and error envelope: JSON REST under `/v1`. Every error body is the envelope in `arch/CONTRACTS.md` § Error envelope. `fields` is always an array. Status codes are only 200, 201, 204, 400, 401, 403, 404, 409, 429, 503.
- Authn / authz placement: one module `src/server/auth/authorize.ts`. Each route handler calls it before any read or write. Domain functions used by Server Components call the same rules. Missing `X-HP-Request: 1` on POST, PUT, PATCH, and DELETE is 403 `csrf`. A caller who must not learn a plan exists gets 404 with the envelope only. Cookies: `hp_session`, `hp_guest`, `hp_link` as in ADR-0001.
- Persistence / transactions: PostgreSQL via Drizzle, one client in `src/server/db/client.ts`. The answered-count change and the response write share a transaction that locks the plan row. Schema is `src/server/db/schema.ts`. Tables are only those in `arch/CONTRACTS.md`.
- Jobs / queues: none. `runProposalAttempt` runs in the triggering request after that request's write commits. Timeout 20s. A second runner while the lock is younger than 20s gets 409 `attempt_in_progress`. `HP_PROPOSAL_ENABLED=0` writes a venue-data block and does not call Google.
- Logging / trace ids: one JSON line to stdout per request, field `request_id`, response header `X-Request-Id`. Do not log passwords, cookie values, join tokens, starting coordinates, or Google request URLs.
- Migrations: `drizzle-kit`, files in `drizzle/`. This slice's schema is `drizzle/0001_init.sql`. Forward only.
- Testing: Vitest. Pure rules next to the module. Handler tests call the route with a Postgres `DATABASE_URL` and fake Google clients. No SQLite. No test hits `places.googleapis.com` or `routes.googleapis.com`. `HP_HASH_TEST=1` is the only weaker argon2 setting, and only in test. e2e belongs to the test agent.

## Build agent rules

- Do not introduce a second ORM, logger, or auth helper
- Do not add a route, table, event, or column that `arch/CONTRACTS.md` does not name
- Google access goes through `src/server/google/places.ts` and `src/server/google/routes.ts`. Callers depend on the interfaces. Field masks are the ones in the contract. Never send `*`.
- Money is integer minor units. Time selection and fairness use the integer rules in the contract, not floating comparisons.
- Clock reads go through `src/server/clock.ts` so tests can freeze rate limits and the attempt lock
