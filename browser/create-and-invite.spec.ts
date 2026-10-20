import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { cleanupThenClose } from "../e2e/db-cleanup";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `journey-${runId}@example.test`;
const planTitle = `Browser journey ${runId}`;

let page: Page;
let planPath = "";

test.describe.configure({ mode: "serial" });

test.describe("create an account, create a plan, open its invite page", () => {
  test.beforeAll(async ({ browser }) => {
    // The form fills its timezone from the browser; the server rejects bare "UTC", so give it a region zone.
    page = await browser.newPage({ timezoneId: "Africa/Cairo" });
  });

  test.afterAll(async () => {
    await page.close();
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required");
    }
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    // Foreign-key order from src/server/db/schema.ts, found through the run's email:
    // invitations, participants -> plan_options -> plan_steps -> plan_windows -> plans -> sessions -> accounts.
    const ownPlans = sql`SELECT id FROM plans WHERE organizer_account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await cleanupThenClose(
      async () => {
        await sql`DELETE FROM invitations WHERE plan_id IN (${ownPlans})`;
        await sql`DELETE FROM participants WHERE plan_id IN (${ownPlans})`;
        await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id IN (${ownPlans}))`;
        await sql`DELETE FROM plan_steps WHERE plan_id IN (${ownPlans})`;
        await sql`DELETE FROM plan_windows WHERE plan_id IN (${ownPlans})`;
        await sql`DELETE FROM plans WHERE organizer_account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
        await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
        await sql`DELETE FROM accounts WHERE email = ${email}`;
      },
      () => sql.end(),
    );
  });

  test("T-001-64/AC-1 Create a plan opens the account page; creating an account opens the Create a plan form", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create a plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`pw-${runId}-Aa1!`);
    await page.getByLabel("Display name").fill("Journey Organizer");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Create a plan" })).toBeVisible();
  });

  test("T-001-64/AC-2 submitting the create form opens the new plan with its title as the heading", async () => {
    await page.getByLabel("Plan title").fill(planTitle);
    await expect(page.getByLabel("Timezone")).not.toHaveValue("");

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

    await page.getByLabel("Answered threshold").fill("1");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page).toHaveURL(/\/plans\/(?!new$)[^/]+$/);
    planPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name: planTitle })).toBeVisible();
  });

  test("T-001-64/AC-3 Invite opens the invite page showing a shareable /join/ link", async ({ baseURL }) => {
    await page.getByRole("link", { name: "Invite" }).click();

    await expect(page).toHaveURL(`${baseURL}${planPath}/invite`);
    await expect(page.getByRole("heading", { level: 1, name: "Invite" })).toBeVisible();

    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { level: 2, name: "Shareable link" }) });
    await expect(section.getByText(new RegExp(`^${baseURL}/join/`))).toBeVisible();
  });
});
