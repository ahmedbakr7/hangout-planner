---
id: T-001-75
title: "Browser test: pages load the IBM Plex faces from the app's own origin"
type: test
status: ready
risk: low
depends_on: [T-001-74, T-001-70]
files:
  - "browser/fonts.spec.ts"
skills:
  - test
  - frontend-patterns
contracts: []
requirements: [F-001-1, F-001-2]
acceptance_criteria:
  - "AC-1: signed out, loading / with the hp_locale cookie set to en and then to ar requests at least one .woff2 file each time; every .woff2 request goes to the app's own origin and answers 200, and no request goes to fonts.googleapis.com or fonts.gstatic.com"
  - "AC-2: signed out, with the hp_locale cookie set to en, once document.fonts.ready resolves on /, the first family in the body's computed font-family has a FontFace in document.fonts with status loaded"
  - "AC-3: signed out, with the hp_locale cookie set to ar, once document.fonts.ready resolves on /, the first family in the body's computed font-family has a FontFace in document.fonts with status loaded, and it is not the first family of the en body"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

The browser half of T-001-74, split off as T-001-63 was from T-001-62: only the test play may write `browser/**`. T-001-74 moved the IBM Plex faces from `next/font/google` to `next/font/local`. This spec proves, in Chromium against `next start`, that the pages get the faces from the app and from nowhere else. It changes no product file.

- **`browser/fonts.spec.ts`:** one test per AC, each titled with its `T-001-75/AC-n` tag. Copy the shape of `browser/shell-styles.spec.ts` (T-001-70): imports only from `@playwright/test`; the cookie set with `context.addCookies([{ name: "hp_locale", value, url: baseURL }])` before `goto("/")`; wait for the Home heading.
  - AC-1: collect requests with `page.on("request")` before `goto`, and responses with `page.on("response")`. After the heading is visible and `document.fonts.ready` has resolved, assert that at least one URL ends in `.woff2`, that every `.woff2` URL has the `baseURL` origin and a 200 response, and that no URL's host is `fonts.googleapis.com` or `fonts.gstatic.com`. Do this for `en`, then for `ar` in a new context.
  - AC-2 and AC-3: in `page.evaluate`, await `document.fonts.ready`, read `getComputedStyle(document.body).fontFamily`, take the first comma-separated family with quotes removed, and return whether `[...document.fonts]` has a face with that `family` (quotes removed) and `status === "loaded"`. `next/font/local` generates the family names, so never assert a literal name; AC-3 compares the `ar` family with the `en` one.
- **Proof:** a `type: test` ticket's build runs the real-stack suites, and the gate's `e2e` suite (Playwright through `commands.e2e`) proves every AC. The spec creates no data and needs no cleanup.

**Agent:** build with `fe-builder`: only its launcher allows `npx --no-install playwright test`, so the build can run its own spec before the gate. If an AC disagrees with what Chromium does (for example, the body's first family is a fallback because `display: swap` has not swapped yet), stop and report; the fix is a ticket amendment, not a product change.
