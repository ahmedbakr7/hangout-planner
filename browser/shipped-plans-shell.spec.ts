import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { cleanupThenClose } from "../e2e/db-cleanup";
import en from "../messages/en.json";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emails: string[] = [];

function uniqueEmail(label: string): string {
  const email = `${label}-${runId}@example.test`;
  emails.push(email);
  return email;
}

async function register(page: Page, email: string): Promise<void> {
  await page.getByRole("tab", { name: en.Account.register }).click();
  await page.getByLabel(en.Account.email).fill(email);
  await page.getByLabel(en.Account.password).fill(`pw-${runId}-Aa1!`);
  await page.getByLabel(en.Account.displayName).fill("Shell Organizer");
  await page.getByRole("button", { name: en.Account.submitRegister }).click();
}

/** The page's own origin plus a path, so a redirect away from the app shows up as a different origin. */
function landing(page: Page): string {
  const url = new URL(page.url());
  return `${url.origin}${url.pathname}`;
}

async function signedOutPage(browser: Browser): Promise<Page> {
  // The create form fills its timezone from the browser; the server rejects bare "UTC".
  return browser.newPage({ timezoneId: "Africa/Cairo" });
}

test.afterAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const accountIds = sql`SELECT id FROM accounts WHERE email IN ${sql(emails)}`;
  const ownPlans = sql`SELECT id FROM plans WHERE organizer_account_id IN (${accountIds})`;
  await cleanupThenClose(
    async () => {
      if (emails.length === 0) {
        return;
      }
      const linkSessions = await sql<{ id: string }[]>`
        SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id IN (${ownPlans})
      `;
      await sql`DELETE FROM invitations WHERE plan_id IN (${ownPlans})`;
      await sql`DELETE FROM link_session_plans WHERE plan_id IN (${ownPlans})`;
      for (const link of linkSessions) {
        await sql`
          DELETE FROM link_sessions WHERE id = ${link.id}
          AND NOT EXISTS (SELECT 1 FROM link_session_plans WHERE link_session_id = ${link.id})
        `;
      }
      await sql`DELETE FROM participants WHERE plan_id IN (${ownPlans})`;
      await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id IN (${ownPlans}))`;
      await sql`DELETE FROM plan_steps WHERE plan_id IN (${ownPlans})`;
      await sql`DELETE FROM plan_windows WHERE plan_id IN (${ownPlans})`;
      await sql`DELETE FROM plans WHERE organizer_account_id IN (${accountIds})`;
      await sql`DELETE FROM sessions WHERE account_id IN (${accountIds})`;
      await sql`DELETE FROM accounts WHERE email IN ${sql(emails)}`;
    },
    () => sql.end(),
  );
});

test("T-001-87/AC-1 T-001-07/AC-3 dir and lang on html follow the hp_locale cookie: ar is rtl and en is ltr", async ({
  browser,
  baseURL,
}) => {
  const cases: { cookie: "ar" | "en" | null; lang: string; dir: string }[] = [
    { cookie: "ar", lang: "ar", dir: "rtl" },
    { cookie: "en", lang: "en", dir: "ltr" },
    { cookie: null, lang: "en", dir: "ltr" },
  ];
  for (const { cookie, lang, dir } of cases) {
    const context = await browser.newContext();
    try {
      if (cookie) {
        await context.addCookies([{ name: "hp_locale", value: cookie, url: baseURL! }]);
      }
      const page = await context.newPage();
      await page.goto("/");
      const html = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
      }));
      expect(html, `hp_locale=${cookie ?? "unset"}`).toEqual({ lang, dir });
    } finally {
      await context.close();
    }
  }
});

test("T-001-87/AC-2T-001-08/AC-4 next accepts only /, /plans/new, /invitations or /join/ plus a join token; any other value is ignored and success returns home", async ({
  browser,
  request,
  baseURL,
}) => {
  const origin = baseURL!;
  const organizerEmail = uniqueEmail("next-organizer");
  const headers = { "x-hp-request": "1" };
  const account = await request.post("/api/v1/accounts", {
    headers,
    data: { email: organizerEmail, password: `pw-${runId}-Aa1!`, display_name: "Join Host" },
  });
  expect(account.status()).toBe(201);
  const created = await request.post("/api/v1/plans", {
    headers,
    data: {
      title: `Join target ${runId}`,
      timezone: "Africa/Cairo",
      windows: [{ local_date: "2030-01-15", start_local: "18:00", end_local: "22:00" }],
      budget: { amount_minor: 25_000, currency: "EGP" },
      steps: [{ name: "Dinner", options: ["Koshary", "Grill"] }],
      threshold: 1,
    },
  });
  expect(created.status()).toBe(201);
  const joinPath = ((await created.json()) as { join_path: string }).join_path;

  const cases: { next: string; lands: string }[] = [
    { next: "/plans/new", lands: `${origin}/plans/new` },
    { next: "/invitations", lands: `${origin}/invitations` },
    { next: joinPath, lands: `${origin}${joinPath}` },
    { next: "/plans/pln_someone_elses", lands: `${origin}/` },
    { next: "https://evil.example/", lands: `${origin}/` },
    { next: "//evil.example", lands: `${origin}/` },
    { next: "/join/not-a-token", lands: `${origin}/` },
  ];
  for (const [index, { next, lands }] of cases.entries()) {
    const page = await signedOutPage(browser);
    try {
      await page.goto(`/account?next=${encodeURIComponent(next)}`);
      await expect(page.getByRole("heading", { level: 1, name: en.Account.title })).toBeVisible();
      await register(page, uniqueEmail(`next-${index}`));
      await expect.poll(() => landing(page), { message: `next=${next}` }).toBe(lands);
    } finally {
      await page.close();
    }
  }
});

test.describe("T-001-87 create form and theme", () => {
  test.describe.configure({ mode: "serial" });

  test("T-001-87/AC-5 T-001-11/AC-6 a valid submit opens the new organizer plan in collecting with answered count 0", async ({
    browser,
  }) => {
    const planTitle = `Shell create ${runId}`;
    const page = await signedOutPage(browser);
    try {
      await page.goto("/account?next=%2Fplans%2Fnew");
      await register(page, uniqueEmail("create"));
      await expect(page.getByRole("heading", { level: 1, name: en.Create.title })).toBeVisible();

      await page.getByLabel("Plan title").fill(planTitle);
      await page.getByRole("button", { name: "Add a day window" }).click();
      await page.getByLabel("Date").fill("2030-01-15");
      await page.getByLabel("Start").fill("18:00");
      await page.getByLabel("End").fill("22:00");
      await page.getByLabel("Per-person amount").fill("250");
      await page.getByLabel("Currency").selectOption("EGP");
      await page.getByRole("button", { name: "Add a step" }).click();
      await page.getByLabel("Step name").fill("Dinner");
      const options = page.getByLabel("Option label");
      await options.nth(0).fill("Koshary");
      await options.nth(1).fill("Grill");
      await page.getByLabel("Answered threshold").first().fill("2");
      await page.getByRole("button", { name: "Create", exact: true }).click();

      await expect(page).toHaveURL(/\/plans\/(?!new$)[^/]+$/);
      await expect(page.getByRole("heading", { level: 1, name: planTitle })).toBeVisible();
      await expect(page.getByText(en.Home.state.collecting, { exact: true })).toBeVisible();
      await expect(
        page.getByText(en.plans.answered.replace("{answered}", "0").replace("{threshold}", "2")),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("T-001-87/AC-7 T-001-30/AC-3 bg-primary resolves to --primary and text-destructive to --destructive", async ({
    page,
  }) => {
    // Resolve a custom property to the colour the browser computes for it, whatever syntax the CSS uses.
    async function resolved(variable: string): Promise<string> {
      return page.evaluate((name) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }, variable);
    }

    await page.goto("/");
    const create = page.getByRole("link", { name: en.Home.create });
    await expect(create).toBeVisible();
    await expect(create).toHaveClass(/\bbg-primary\b/);
    const primary = await resolved("--primary");
    expect(primary).not.toBe("");
    await expect(create).toHaveCSS("background-color", primary);

    await page.goto("/account");
    await page.getByLabel(en.Account.email).fill(`theme-${runId}@example.test`);
    await page.getByLabel(en.Account.password).fill(`pw-${runId}-Aa1!`);
    await page.getByRole("button", { name: en.Account.submitSignIn }).click();
    // Next.js keeps an empty role="alert" route announcer on every page; the error alert is the one with text.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toHaveClass(/\btext-destructive\b/);
    const destructive = await resolved("--destructive");
    expect(destructive).not.toBe("");
    await expect(alert).toHaveCSS("color", destructive);
  });
});
