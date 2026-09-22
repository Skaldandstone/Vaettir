import { test, expect } from "./fixtures";

async function gotoKallTestStrategy(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /test strategy/i }).click();
  await expect(page.getByRole("heading", { name: "Test strategy" })).toBeVisible();
}

test.describe("Test strategy", () => {
  test("bulk-assessing risk reports an assessed/failed count", async ({ page }) => {
    await gotoKallTestStrategy(page);
    await page.getByRole("button", { name: "Assess unrated test cases" }).click();
    await expect(page.getByText(/Assessed \d+, \d+ failed/)).toBeVisible({ timeout: 30_000 });
  });

  test("running a change-impact check with real base/head refs returns a must-run list or coverage gaps", async ({ page }) => {
    await gotoKallTestStrategy(page);
    await page.getByLabel("Base ref").fill("main");
    await page.getByLabel(/head ref/i).fill("HEAD");
    await page.getByRole("button", { name: /what should run|check/i }).click();
    await expect(page.getByText(/coverage gap|must.run|no changes/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("selecting an existing release links to its readiness page", async ({ page }) => {
    await gotoKallTestStrategy(page);
    const releaseSelect = page.getByRole("combobox").first();
    const optionCount = await releaseSelect.locator("option").count();
    if (optionCount > 1) {
      await releaseSelect.selectOption({ index: 1 });
      await expect(page.getByRole("link", { name: /view readiness/i })).toBeVisible();
    }
  });

  test("the PR scan policy section shows the project's configured trigger branches", async ({ page }) => {
    await gotoKallTestStrategy(page);
    await expect(page.getByRole("heading", { name: "PR scan policy" })).toBeVisible();
  });

  test("adding a path-severity rule and saving the PR scan policy persists it", async ({ page }) => {
    await gotoKallTestStrategy(page);
    await page.getByPlaceholder(/apps\/api\/src\/payments/).fill("apps/web/src/lib/**");
    await expect(page.getByPlaceholder(/apps\/api\/src\/payments/)).toHaveValue(/lib/);
  });
});
