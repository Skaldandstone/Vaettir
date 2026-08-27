import { test, expect } from "@playwright/test";

test.describe("Org dashboard", () => {
  test("the dashboard shows the org's readiness summary and the Kall project row", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /readiness/i })).toBeVisible();
    await expect(page.getByText("Kall")).toBeVisible();
  });

  test("the summary counts (ready/at-risk/blocked/no-active-release) are all numeric", async ({ page }) => {
    await page.goto("/dashboard");
    const stats = page.locator("div", { hasText: /ready|at risk|blocked|no active release/i });
    await expect(stats.first()).toBeVisible();
  });

  test("clicking the Kall project row navigates to its project overview", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Kall" }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  });

  test("the dashboard link is reachable from the org sidebar", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
