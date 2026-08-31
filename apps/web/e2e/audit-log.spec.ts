import { test, expect } from "./fixtures";

async function gotoFixtureAuditLog(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /audit log/i }).click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
}

test.describe("Audit log", () => {
  test("creating a test case produces a matching audit log entry", async ({ page }) => {
    const title = `E2E audited case ${Date.now()}`;
    await page.goto("/projects");
    await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
    await page.getByRole("link", { name: "Test Cases", exact: true }).click();
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /audit log/i }).click();
    await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(1);
  });

  test("filtering by entity type narrows the visible entries to that type", async ({ page }) => {
    await gotoFixtureAuditLog(page);
    await page.getByRole("button", { name: "TestCase", exact: true }).click();
    await expect(page.getByRole("button", { name: "TestCase", exact: true })).toHaveClass(/btn-primary/);
    await expect(page.getByRole("cell", { name: "Created fixture case", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Created fixture plan", exact: true })).toHaveCount(0);
  });

  test("clicking 'All' resets the entity-type filter", async ({ page }) => {
    await gotoFixtureAuditLog(page);
    await page.getByRole("button", { name: "TestCase", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Created fixture plan", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("button", { name: "All", exact: true })).toHaveClass(/btn-primary/);
    await expect(page.getByRole("cell", { name: "Created fixture case", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Created fixture plan", exact: true })).toBeVisible();
  });
});
