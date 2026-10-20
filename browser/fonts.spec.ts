import { expect, test, type Browser, type Page } from "@playwright/test";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const titles = { en: en.Home.title, ar: ar.Home.title } as const;

type Locale = keyof typeof titles;

function homeHeading(page: Page, locale: Locale) {
  return page.getByRole("heading", { level: 1, name: titles[locale] });
}

async function openHome(browser: Browser, baseURL: string, locale: Locale) {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: "hp_locale", value: locale, url: baseURL }]);
  const page = await context.newPage();
  return { context, page };
}

async function bodyFamilyLoaded(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");
    const family = unquote(getComputedStyle(document.body).fontFamily.split(",")[0]);
    const loaded = [...document.fonts].some((face) => unquote(face.family) === family && face.status === "loaded");
    return { family, loaded };
  });
}

async function fontRequests(browser: Browser, baseURL: string, locale: Locale) {
  const { context, page } = await openHome(browser, baseURL, locale);
  const requested: string[] = [];
  const answered: { url: string; status: number }[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("response", (response) => answered.push({ url: response.url(), status: response.status() }));
  await page.goto("/");
  await expect(homeHeading(page, locale)).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await context.close();
  return { requested, answered };
}

for (const locale of ["en", "ar"] as const) {
  test(`T-001-75/AC-1 ${locale} home loads every .woff2 from the app's own origin and nothing from Google Fonts`, async ({
    browser,
    baseURL,
  }) => {
    const { requested, answered } = await fontRequests(browser, baseURL!, locale);
    const origin = new URL(baseURL!).origin;

    const woff2 = requested.filter((url) => new URL(url).pathname.endsWith(".woff2"));
    expect(woff2.length).toBeGreaterThan(0);
    for (const url of woff2) {
      expect(new URL(url).origin, url).toBe(origin);
      const response = answered.find((entry) => entry.url === url);
      expect(response?.status, url).toBe(200);
    }
    for (const url of requested) {
      expect(["fonts.googleapis.com", "fonts.gstatic.com"], url).not.toContain(new URL(url).hostname);
    }
  });
}

test("T-001-75/AC-2 en body's first font family has a loaded FontFace", async ({ browser, baseURL }) => {
  const { context, page } = await openHome(browser, baseURL!, "en");
  await page.goto("/");
  await expect(homeHeading(page, "en")).toBeVisible();
  const { family, loaded } = await bodyFamilyLoaded(page);
  expect(family).not.toBe("");
  expect(loaded, family).toBe(true);
  await context.close();
});

test("T-001-75/AC-3 ar body's first font family has a loaded FontFace and differs from en", async ({
  browser,
  baseURL,
}) => {
  const en = await openHome(browser, baseURL!, "en");
  await en.page.goto("/");
  await expect(homeHeading(en.page, "en")).toBeVisible();
  const enBody = await bodyFamilyLoaded(en.page);
  await en.context.close();

  const ar = await openHome(browser, baseURL!, "ar");
  await ar.page.goto("/");
  await expect(homeHeading(ar.page, "ar")).toBeVisible();
  const arBody = await bodyFamilyLoaded(ar.page);
  await ar.context.close();

  expect(arBody.family).not.toBe("");
  expect(arBody.loaded, arBody.family).toBe(true);
  expect(arBody.family).not.toBe(enBody.family);
});
