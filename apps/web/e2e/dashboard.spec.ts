import { test, expect } from "./fixtures";

test.describe("Org dashboard", () => {
  test("the dashboard shows the org's readiness summary and the fixture project row", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /readiness/i })).toBeVisible();
    await expect(page.getByText("Beta fixture")).toBeVisible();
  });

  test("the summary counts (ready/at-risk/blocked/no-active-release) are all numeric", async ({ page }) => {
    await page.goto("/dashboard");
    for (const label of ["Ready", "At risk", "Blocked", "No active release"]) {
      const panel = page.locator(".panel").filter({ has: page.getByText(label, { exact: true }) });
      await expect(panel.locator("div").first()).toHaveText(/^\d+$/);
    }
  });

  test("clicking the fixture project row navigates to its project overview", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Beta fixture" }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  });

  test("the dashboard link is reachable from the org sidebar", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
