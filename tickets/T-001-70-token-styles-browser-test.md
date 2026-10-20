---
id: T-001-70
title: "Replace the token source-text tests with a browser test of computed styles"
type: test
status: ready
risk: low
depends_on: [T-001-64]
files:
  - "browser/shell-styles.spec.ts"
  - "src/app/shell-tokens.test.ts"
  - "src/app/theme-mapping.test.ts"
skills:
  - test
  - frontend-patterns
contracts: "arch/CONTRACTS.md#Screens"
requirements: [F-001-2]
acceptance_criteria:
  - "AC-1: signed out, on / the html element's computed background-color is rgb(247, 244, 239) and its color is rgb(31, 26, 20), both with prefers-color-scheme light and with prefers-color-scheme dark"
  - "AC-2: signed out, on / the body has margin 0px, padding-top and padding-bottom 24px, padding-left and padding-right 16px; the card around the Home heading has background-color rgb(255, 252, 248), border color rgb(230, 223, 212) and border-radius 12px"
  - "AC-3: signed out, on / the level-1 heading Home has font-size 28px, line-height 34px and color rgb(31, 26, 20), and the paragraph Friends enter through an invite link. has font-size 16px and line-height 24px"
  - "AC-4: signed out, on / the Create a plan link has background-color rgb(14, 107, 79), color rgb(255, 252, 248) and border-radius 6px"
  - "AC-5: signed out, on / after one Tab key press the Language select has focus and its computed outline is 2px solid rgb(30, 79, 140) with outline-offset 2px"
  - "AC-6: signed out, on /account the text An account is required to organize a plan. has color rgb(107, 100, 91), and the selected Sign in tab has a background-color within 1 per channel of rgb(242, 238, 231), the sRGB mix of 72% rgb(247, 244, 239) and 28% rgb(230, 223, 212)"
  - "AC-7: signed out, on /account a sign-in with an email that has no account shows an alert whose color is rgb(157, 44, 44), and the person stays on /account signed out"
  - "AC-8: with the hp_locale cookie set to ar, / renders html with lang ar, dir rtl and computed direction rtl, and the Create a plan link (إنشاء خطة) sits on the right half of its card; with the cookie set to en, html has lang en, dir ltr and computed direction ltr, and the link sits on the left half"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0002-shadcn-ui.md
  - decisions/ADR-0006-patterns-rulebook.md
  - decisions/ADR-0010-browser-tests-with-playwright.md
  - decisions/ADR-0011-browser-work-order.md
---

Roadmap item 3, third and last slice. Lead decision of 2026-10-20: replace the five source-text hits left in the `test-quality` baseline with a browser test that reads computed styles on real pages. The hits are five tests that `read("src/app/...")` and match strings: in `src/app/shell-tokens.test.ts`, "tokens.css defines DESIGN.md color, space, type, and radius values", "globals use token names, logical CSS properties, and an outline focus ring" and "layout sets html lang and dir from the hp_locale cookie helpers" (3); in `src/app/theme-mapping.test.ts`, "maps DESIGN.md hex into shadcn CSS variables in tokens.css" and "registers semantic utilities in globals.css without a dark theme" (2). None of them carries an AC tag. The tickets they came from, T-001-07 and T-001-30, are `legacy: v0`, and every one of their ACs is already in the `ac-coverage` and `trace` baselines as `missing` / `proof is none`, so removing these tests takes no proof away from any ticket.

Each AC is the rendered result of a token the old tests matched as text, using the DESIGN.md values (`design/DESIGN.md`, ADR-0002): `bg`/`--background` and `text`/`--foreground` (AC-1), `space-lg`/`space-md`, `surface`/`--card`, `border` and `radius-md` (AC-2), the `title` and `body` type ramp (AC-3), `accent`/`--primary`, `--primary-foreground` and `radius-sm`/`--radius` (AC-4), the focus ring `focus`/`--ring` (AC-5), `text-muted`/`--muted-foreground` and the `--secondary` colour-mix (AC-6), `danger`/`--destructive` (AC-7), and `lang`/`dir` from the `hp_locale` cookie (AC-8, F-001-2). AC-1's dark case replaces "without a dark theme": ADR-0002 makes the light theme normative. Every surface used is reachable signed out, and the failed sign-in in AC-7 writes no row (N-001-3), so the spec creates no data and needs no cleanup.

- **`browser/shell-styles.spec.ts`:** one test per AC, each titled with its `T-001-70/AC-n` tag. Copy the shape of `browser/smoke.spec.ts` (imports only from `@playwright/test`, `page.goto` on a relative path, locators by role and accessible name) and T-001-64's `browser/create-and-invite.spec.ts` for strings from `messages/en.json` and `messages/ar.json` (`Home.*`, `Account.*`, `common.language`).
  - Read styles with `await expect(locator).toHaveCSS(property, value)`, which waits and compares the computed value. Compare each colour as the `rgb(...)` string in the AC. Use longhand properties (`padding-top`, `outline-color`, `border-top-color`, …); shorthands do not come back from `getComputedStyle`.
  - AC-1: `page.emulateMedia({ colorScheme: "light" })`, check, then `{ colorScheme: "dark" }`, reload, check again.
  - AC-2: the card is the nearest ancestor of the Home heading that carries the card's border; find it with a locator (for example `page.locator("main > div").filter({ has: heading })`), not a class name.
  - AC-5: press Tab once after the page loads, assert the Language combobox `toBeFocused()`, then check `outline-style`, `outline-width`, `outline-color` and `outline-offset`.
  - AC-6: Chromium may serialize a `color-mix()` result as `color(srgb r g b)` rather than `rgb(...)`. Read `background-color` with `locator.evaluate((el) => getComputedStyle(el).backgroundColor)`, accept both forms, and compare each 0–255 channel within 1.
  - AC-7: fill Email with an address unique to the run at `example.test` and any password, choose the Sign in submit button, and wait for the `alert` role. Then assert the URL path is still `/account`.
  - AC-8: set the cookie with `context.addCookies([{ name: "hp_locale", value: "ar", url: baseURL }])` (and `en`) before `goto("/")`. Compare the link's `boundingBox()` centre with the card's centre.
- **`src/app/shell-tokens.test.ts`:** remove the three tests named above. Keep "hex and raw spacing appear only in tokens.css under src/app", "next.config.ts only wires next-intl and locale is cookie not URL prefix" and "messages/en.json and messages/ar.json hold chrome for slice surfaces" unchanged, with the helpers they use. Delete constants nothing uses any more (`DESIGN_COLOR_TOKENS` and its siblings).
- **`src/app/theme-mapping.test.ts`:** remove the two tests named above. Keep "configures shadcn for App Router CSS variables without a Tailwind v3 config" (it reads `components.json`, which is not a hit) and the `read` helper it uses.
- **Baseline:** run `sdlc baseline --prune` and commit `sdlc-baseline.json` with the build, as T-001-53 and T-001-55 did. Both `test-quality` entries go away; nothing else may change.
- **Order:** depends on T-001-64 only because `e2e/playwright-list.e2e.ts` on `main` still asserts exactly one browser test; T-001-64 relaxes it, and this ticket's spec would otherwise break `T-001-63/AC-1`. No file overlaps T-001-64's.
- **Proof:** a `type: test` ticket has no test play; its build runs the real-stack suites before `ac-coverage`. The gate's `e2e` suite (Playwright JUnit through `commands.e2e`) proves every AC in Chromium. The builder may run `npx --no-install playwright test`; it never runs `playwright install`. No product file changes, no new test reads source text, and nothing in `browser/` imports from `src/`.

**Agent:** build with `fe-builder`: only its launcher allows `npx --no-install playwright test` (`ops/agent-fe-builder.sh`), so the build can run its own spec before the gate. If an AC disagrees with what Chromium computes (AC-5 relies on the unlayered `:focus-visible` rule in `globals.css` winning over the select's layered utilities), stop and report; the fix is a ticket amendment, not a product change.
