import { expect, test, type Page } from "@playwright/test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function homeHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: en.Home.title });
}

function homeCard(page: Page) {
  return page.locator("main > div").filter({ has: homeHeading(page) });
}

function channels(color: string): number[] {
  const numbers = color.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  if (color.startsWith("color(srgb")) {
    return numbers.slice(0, 3).map((value) => value * 255);
  }
  return numbers.slice(0, 3);
}

test("T-001-70/AC-1 html background and text colours hold in light and dark colour schemes", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await page.reload();
    await expect(homeHeading(page)).toBeVisible();
    const html = page.locator("html");
    await expect(html).toHaveCSS("background-color", "rgb(247, 244, 239)");
    await expect(html).toHaveCSS("color", "rgb(31, 26, 20)");
  }
});

test("T-001-70/AC-2 body spacing and the Home card surface, border and radius", async ({ page }) => {
  await page.goto("/");
  await expect(homeHeading(page)).toBeVisible();
  const body = page.locator("body");
  await expect(body).toHaveCSS("margin-top", "0px");
  await expect(body).toHaveCSS("margin-right", "0px");
  await expect(body).toHaveCSS("margin-bottom", "0px");
  await expect(body).toHaveCSS("margin-left", "0px");
  await expect(body).toHaveCSS("padding-top", "24px");
  await expect(body).toHaveCSS("padding-bottom", "24px");
  await expect(body).toHaveCSS("padding-left", "16px");
  await expect(body).toHaveCSS("padding-right", "16px");

  const card = homeCard(page);
  await expect(card).toHaveCSS("background-color", "rgb(255, 252, 248)");
  await expect(card).toHaveCSS("border-top-color", "rgb(230, 223, 212)");
  await expect(card).toHaveCSS("border-radius", "12px");
});

test("T-001-70/AC-3 Home heading and body paragraph type ramp", async ({ page }) => {
  await page.goto("/");
  const heading = homeHeading(page);
  await expect(heading).toHaveCSS("font-size", "28px");
  await expect(heading).toHaveCSS("line-height", "34px");
  await expect(heading).toHaveCSS("color", "rgb(31, 26, 20)");

  const paragraph = page.getByText(en.Home.signedOutFriends);
  await expect(paragraph).toHaveCSS("font-size", "16px");
  await expect(paragraph).toHaveCSS("line-height", "24px");
});

test("T-001-70/AC-4 Create a plan link uses the accent background, light text and small radius", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: en.Home.create });
  await expect(link).toHaveCSS("background-color", "rgb(14, 107, 79)");
  await expect(link).toHaveCSS("color", "rgb(255, 252, 248)");
  await expect(link).toHaveCSS("border-radius", "6px");
});

test("T-001-70/AC-5 the first Tab focuses the Language select with the 2px focus ring", async ({ page }) => {
  await page.goto("/");
  await expect(homeHeading(page)).toBeVisible();
  await page.keyboard.press("Tab");
  const select = page.getByRole("combobox", { name: en.common.language });
  await expect(select).toBeFocused();
  await expect(select).toHaveCSS("outline-style", "solid");
  await expect(select).toHaveCSS("outline-width", "2px");
  await expect(select).toHaveCSS("outline-color", "rgb(30, 79, 140)");
  await expect(select).toHaveCSS("outline-offset", "2px");
});

test("T-001-70/AC-6 account page muted text and the selected tab's secondary mix", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByText(en.Account.requiredToOrganize)).toHaveCSS("color", "rgb(107, 100, 91)");

  const tab = page.getByRole("tab", { name: en.Account.signIn });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const background = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  const expected = [242, 238, 231];
  const actual = channels(background);
  expect(actual, background).toHaveLength(3);
  actual.forEach((value, index) => {
    expect(Math.abs(value - expected[index]), `${background} channel ${index}`).toBeLessThanOrEqual(1);
  });
});

test("T-001-70/AC-7 a failed sign-in shows a danger-coloured alert and stays signed out on /account", async ({ page }) => {
  await page.goto("/account");
  await page.getByLabel(en.Account.email).fill(`styles-${runId}@example.test`);
  await page.getByLabel(en.Account.password).fill(`pw-${runId}-Aa1!`);
  await page.getByRole("button", { name: en.Account.submitSignIn }).click();

  // Next.js keeps an empty role="alert" route announcer on every page; the error alert is the one with text.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCSS("color", "rgb(157, 44, 44)");
  expect(new URL(page.url()).pathname).toBe("/account");
});

test("T-001-70/AC-8 hp_locale sets html lang, dir and the side of the card the link sits on", async ({
  page,
  context,
  baseURL,
}) => {
  const cases = [
    { locale: "ar", dir: "rtl", name: ar.Home.create, side: "right" },
    { locale: "en", dir: "ltr", name: en.Home.create, side: "left" },
  ] as const;
  for (const { locale, dir, name, side } of cases) {
    await context.addCookies([{ name: "hp_locale", value: locale, url: baseURL! }]);
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", locale);
    await expect(html).toHaveAttribute("dir", dir);
    await expect(html).toHaveCSS("direction", dir);

    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    const linkBox = await link.boundingBox();
    const cardBox = await page.locator("main > div").first().boundingBox();
    expect(linkBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    const linkCentre = linkBox!.x + linkBox!.width / 2;
    const cardCentre = cardBox!.x + cardBox!.width / 2;
    if (side === "right") {
      expect(linkCentre).toBeGreaterThan(cardCentre);
    } else {
      expect(linkCentre).toBeLessThan(cardCentre);
    }
  }
});
