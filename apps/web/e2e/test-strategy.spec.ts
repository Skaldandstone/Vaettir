import { test, expect } from "./fixtures";

async function gotoFixtureTestStrategy(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /test strategy/i }).click();
  await expect(page.getByRole("heading", { name: "Test strategy" })).toBeVisible();
}

test.describe("Test strategy", () => {
  test("@ai bulk-assessing risk reports an assessed/failed count", async ({ page }) => {
    await gotoFixtureTestStrategy(page);
    await page.getByRole("button", { name: "Assess unrated test cases" }).click();
    await expect(page.getByText(/Assessed \d+, \d+ failed/)).toBeVisible({ timeout: 30_000 });
  });

  test("@ai running a change-impact check with real base/head refs returns a must-run list or coverage gaps", async ({ page }) => {
    await gotoFixtureTestStrategy(page);
    await page.getByLabel("Base ref").fill("main");
    await page.getByLabel(/head ref/i).fill("HEAD");
    await page.getByRole("button", { name: "Analyze change", exact: true }).click();
    await expect(page.getByText(/coverage gap|must.run|no changes/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("selecting an existing release links to its readiness page", async ({ page }) => {
    await gotoFixtureTestStrategy(page);
    const releaseSelect = page.locator("select").filter({ has: page.locator('option', { hasText: "v2.4 [BLOCKED]" }) });
    await releaseSelect.selectOption({ label: "v2.4 [BLOCKED]" });
    await page.getByRole("link", { name: /view readiness/i }).click();
    await expect(page.getByRole("heading", { name: "v2.4", exact: true })).toBeVisible();
  });

  test("the PR scan policy section shows the project's configured trigger branches", async ({ page }) => {
    await gotoFixtureTestStrategy(page);
    await expect(page.getByRole("heading", { name: "PR scan policy" })).toBeVisible();
  });

  test("adding a path-severity rule and saving the PR scan policy persists it", async ({ page }) => {
    await gotoFixtureTestStrategy(page);
    await page.getByRole("button", { name: "+ Add rule", exact: true }).click();
    await page.getByPlaceholder(/apps\/api\/src\/payments/).fill("apps/web/src/lib/**");
    await page.getByRole("button", { name: "Save policy", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder(/apps\/api\/src\/payments/)).toHaveValue("apps/web/src/lib/**");
  });
});
