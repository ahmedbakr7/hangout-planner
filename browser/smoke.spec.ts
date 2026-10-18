import { expect, test } from "@playwright/test";

test("T-001-63/AC-1 signed-out home page shows the Home heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});
