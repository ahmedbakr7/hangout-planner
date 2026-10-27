---
name: frontend-patterns
description: Product-locked frontend patterns (framework, data fetching, tokens). Fill via ADR in the first /architect.
---

# Skill: frontend-patterns

Hard rules: `AGENTS.md`. Stack: `decisions/ADR-0001-stack.md` (Web UI kit superseded in part by `decisions/ADR-0002-shadcn-ui.md`). HTTP and screens: `arch/CONTRACTS.md`. Theme: `design/DESIGN.md`.

Change this lock only by a superseding ADR.

## Lock (fill in per product)

- Framework / router / bundler: Next.js App Router, React, TypeScript strict, Node 22. Routes are the screen paths in `arch/CONTRACTS.md` § Screens. Locale is the `hp_locale` cookie (`ar` | `en`), not a URL prefix. `dir` and `lang` sit on `<html>`.
- Folder layout: `src/app/` pages, `src/app/api/v1/` route handlers, `src/components/` shared UI (shadcn primitives under the agreed alias), `src/server/` domain (no React imports), `messages/en.json`, `messages/ar.json`, theme CSS in `src/app/globals.css` / `src/app/tokens.css`. Alias `@/` → `src/`.
- Server vs client data fetching: a page load calls the same view function as the matching route handler. The browser mutates through `fetch` to `/api/v1` with `credentials: "same-origin"` and header `X-HP-Request: 1`. No Server Actions for writes. No second response shape for RSC.
- Global state (allowed / forbidden): form state lives in the component that owns the form. Locale and session live in cookies. `GET /api/v1/me` answers "who is signed in". No Redux, Zustand, or other global store.
- Forms: one primary submit per surface. Field errors use `error.fields[].path` and `error.fields[].code`. A 400 or 500 leaves the inputs as the person typed them. Money inputs are decimal strings; the client converts to `amount_minor` with integer arithmetic from the currency exponent. The wire field is `amount_minor` plus `currency`.
- i18n: next-intl. Chrome keys only. Authored plan text is data and is rendered as stored. Missing Arabic key → English string, layout stays RTL. Language switch updates `hp_locale` and the messages around the current form without clearing it. Return path after the account gate is an allow-listed relative path: `/`, `/plans/new`, `/invitations`, or `/join/` plus a join token.
- Design tokens / UI kit (ADR-0002): load `design/DESIGN.md`. Hex and raw sizes appear only in the theme CSS. Map product tokens into shadcn variables (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary` ← brand accent `#0e6b4f`, `--destructive`, `--warning`, `--success`, `--ring`). Components use semantic Tailwind classes (`bg-background`, `text-foreground`, `bg-primary`, …). Kit is shadcn/ui + Radix. Logical CSS / logical utilities. Forward icons flip under `[dir=rtl]`. Focus uses `--ring`.
- Testing: component tests next to the file (`*.test.tsx`) on Vitest. e2e is the test agent's. Build does not add e2e.

## Build agent rules

- New page = add/update `design/pages/<route>.md` first (spec play), not here
- UI kit is shadcn/ui + Radix only (ADR-0002); do not add a second component library
- Tailwind + theme CSS variables only for brand hex; no CSS-in-JS runtime; no second type scale
- Do not format money with a floating-point multiply
- Do not send starting coordinates, emails of other people, or Google key material to the browser
- Clipboard failure leaves the link text on the page

## Conventions

Where files go, which library, how things are named. Builders follow this or name the gap (kit rule 11); reviewers treat a deviation as blocking.

### Where things go

Copy the named example; if nothing here or in the ticket settles it, stop and report (`AGENTS.md`).

| What | Where | Copy |
|---|---|---|
| Page | `src/app/<route>/page.tsx`, a Server Component: awaits `params` / `searchParams`, loads its first data through the surface loader (ADR-0007), renders one component | `src/app/plans/[planId]/page.tsx` |
| Screen logic, writes, refetch after writes | `src/components/<screen>.tsx` (`"use client"`): first render from the page's initial data, then `fetch` to `/api/v1/...` | `src/components/organizer-plan.tsx`; `src/components/response-form.tsx` for writes |
| Page load failure: a converted page whose loader throws | `src/app/<route>/error.tsx` (`"use client"`, `{ error, retry }`) renders `RouteLoadError` from `src/components/route-load-error.tsx` with the screen's own title, load error text and retry label. The component shows the text in `role="alert"`, calls `retry()` from its button (it re-runs the server load; `reset()` does not) and logs `console.error(error)` once; the boundary adds none of these itself | `src/app/plans/[planId]/error.tsx` (T-001-85) |
| Shared client hook | `src/components/use-<name>.ts` (`"use client"`), test beside it as `use-<name>.test.tsx` | `src/components/use-session-slide.ts` (ADR-0009, from T-001-44) |
| UI primitive | `src/components/ui/<name>.tsx` (shadcn) | `src/components/ui/button.tsx` |
| Component test | `<file>.test.tsx` beside the file | `src/components/response-form.test.tsx` |
| Real-stack test of a page's server load (test play, or a `type: test` ticket's build) | `e2e/<route>-server-load.e2e.ts`: seed through the route server and Postgres, mock `next/headers` cookies and `next/navigation`, `await` the page's default export and render the element it returns. Rendering a screen component with stubbed data proves no load | `e2e/organizer-plan-server-load.e2e.ts` (`openPage`) |
| Browser test (same plays) | `browser/<name>.spec.ts`, Playwright against `next start` (ADR-0010) | `browser/create-and-invite.spec.ts`; `browser/shipped-plans-shell.spec.ts` for `<html>` `lang` / `dir` |
| Chrome text | `messages/en.json` and `messages/ar.json`, read with `useTranslations` | `src/components/response-form.tsx` |
| Pure helper shared by pages and client components | `src/lib/<name>.ts` (no `"use client"`, no import from `src/server/`), test beside it as `<name>.test.ts` | `src/lib/plan-paths.ts` (T-001-50) |
| Class merging | `cn()` from `src/lib/utils.ts` | `src/components/ui/button.tsx` |
| Fonts | woff2 files and their licence in `src/app/fonts/`, loaded once in `src/app/layout.tsx` with `localFont` from `next/font/local` and exposed as CSS variables (`--font-latin`, `--font-arabic`) | `src/app/layout.tsx` (T-001-74) |

Pages load their first data on the server (ADR-0007, which keeps ADR-0001). Converted so far: `/plans/{planId}` (T-001-36), the example to copy; `/plans/{planId}/confirmed` (T-001-38), `/plans/{planId}/proposal` (T-001-39), `/plans/{planId}/respond` (T-001-40), `/plans/{planId}/invite` (T-001-41), `/plans/{planId}/join` (T-001-42), `/` (T-001-45), `/plans/new` (T-001-46), `/invitations` (T-001-47), `/account` (T-001-48). Exception: `/join/{token}` keeps client loading, because its `GET` sets the `hp_link` cookie, and needs no `error.tsx` (ADR-0008). A page not yet converted keeps today's pattern (a client component that fetches `/api/v1` in an effect) until its own ticket; a ticket that only edits such a page does not convert it. A ticket that adds a page follows ADR-0007.

- `src/app/error.tsx` (T-001-45) is the root boundary. On `/` it shows the home load error. On any other path it shows route-neutral text, because it also catches a throw from any route with no nearer `error.tsx` in its own segment or an ancestor's, such as `/join/{token}`. (A route under `/plans/{planId}` without its own falls to `src/app/plans/[planId]/error.tsx` instead.) A converted route still adds its own.
- A page does not catch its loader's errors. A thrown loader error renders the route's `error.tsx`, so it is logged and never looks like a `not_found` or `organizer_only` result. Each page ticket adds its route's `error.tsx` (lead decision 2026-10-12, #91 review).
- A screen whose page loader read the account session, and whose page called `/api/v1/me` on open before conversion, calls `useSessionSlide(signedIn)` so opening it still slides `hp_session` (ADR-0009). That one request is not a first load.
- A screen component seeds its state once from the page's initial data. It does not reset that state when a route param changes, because the App Router keys a segment by its dynamic params and remounts it for a new value. This holds while Cache Components is off; turning it on (an ADR, see Next 16 defaults) preserves page state across navigations and changes this rule.

### Use X, not Y

Rules for new and changed code. Some older files still break them (ADR-0006); never copy those parts.

- `next/navigation` (`useRouter`), not `next/router`; no `next/head`.
- `await params`, `await searchParams`, `await cookies()`, `await headers()`; Next 16 removed synchronous access.
- First page data through the surface loader in the page (ADR-0007); writes and refetches through route handlers and `fetch` to `/api/v1`. Not Server Actions, `getServerSideProps` or `getStaticProps`.
- Next 16 defaults: `proxy.ts`, not `middleware.ts`, if request interception is ever needed; no `webpack` key in `next.config.ts` (Turbopack builds); no Cache Components or React Compiler without an ADR.
- shadcn/ui primitives from `src/components/ui/`, not raw `<button>` / `<input>` or a second kit.
- Semantic Tailwind classes, not hex values or inline `style` colors.
- Fonts with `next/font/local` from `src/app/fonts/`, not `next/font/google` (it fetches at build time and broke CI builds, T-001-74) and not a `<link>` to a font host.
- Logical utilities (`ms-`, `pe-`, `start-`), not `ml-`, `pr-`, `left-`.
- Writes send `X-HP-Request: 1` and `credentials: "same-origin"`; copy the block from `response-form.tsx`, do not add a client fetch library.
- Loads in an effect: the async load function lives inside the `useEffect` and checks a local `cancelled` flag after each await, set in the cleanup. A Retry button does not call a second copy of the load. It increments a `reloadKey` state that the effect lists as a dependency, so the retry gets the same guard. Do not call a component-level function that sets state from an effect body (`react-hooks/set-state-in-effect`), and do not silence `react-hooks/*` with `eslint-disable`. Example: `src/components/join-panel.tsx` (T-001-56). When the page's first data comes from the server (ADR-0007) and only Retry reloads on the client, the effect returns early while `reloadKey` is 0, so mount fetches nothing. Examples: `src/components/organizer-plan.tsx` (T-001-77), `confirmed-view.tsx` (T-001-78) and `response-form.tsx` (T-001-79). If the reload must redirect through a component-level helper that also sets state, put a small local function inside the effect instead; that keeps `react-hooks/exhaustive-deps` clean without a ref or `useCallback` (T-001-79).
