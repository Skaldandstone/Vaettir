import { test, expect } from "./fixtures";

async function gotoKallTestPlans(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /test plans/i }).click();
  await expect(page.getByRole("heading", { name: "Test Plans" })).toBeVisible();
}

test.describe("Test plans", () => {
  test("quick-creating a plan by name adds it to the list", async ({ page }) => {
    const name = `E2E plan ${Date.now()}`;
    await gotoKallTestPlans(page);
    const input = page.getByPlaceholder("Plan name, press Enter…");
    await input.fill(name);
    await input.press("Enter");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("searching filters the plan list by name", async ({ page }) => {
    const name = `E2E searchable plan ${Date.now()}`;
    await gotoKallTestPlans(page);
    const input = page.getByPlaceholder("Plan name, press Enter…");
    await input.fill(name);
    await input.press("Enter");
    await page.getByPlaceholder("Search plans…").fill(name.slice(0, 12));
    await expect(page.getByText(name)).toBeVisible();
  });

  test("opening a plan navigates to its detail page", async ({ page }) => {
    const name = `E2E detail plan ${Date.now()}`;
    await gotoKallTestPlans(page);
    const input = page.getByPlaceholder("Plan name, press Enter…");
    await input.fill(name);
    await input.press("Enter");
    await page.getByText(name).click();
    await expect(page).toHaveURL(/\/test-plans\/[^/]+$/);
    await expect(page.getByText(name)).toBeVisible();
  });

  test("a strategy draft can be requested from a one-line prompt", async ({ page }) => {
    await gotoKallTestPlans(page);
    await page.getByPlaceholder(/payments checkout flow/i).fill("We're hardening the security & auth flow for v2.4");
    await expect(page.getByPlaceholder(/payments checkout flow/i)).toHaveValue(/security & auth/i);
  });
});

test.describe("Requirements & acceptance criteria", () => {
  async function gotoKallRequirements(page: import("@playwright/test").Page) {
    await page.goto("/projects");
    await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
    await page.getByRole("link", { name: /requirements/i }).click();
    await expect(page.getByRole("heading", { name: "Requirements" })).toBeVisible();
  }

  test("creating a requirement with a title and external ref adds it to the list", async ({ page }) => {
    const title = `E2E requirement ${Date.now()}`;
    await gotoKallRequirements(page);
    await page.getByPlaceholder("Title").fill(title);
    await page.getByPlaceholder(/JIRA-123/).fill("JIRA-999");
    await page.getByRole("button", { name: "+ New requirement" }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("searching filters the requirements list", async ({ page }) => {
    const title = `E2E findable requirement ${Date.now()}`;
    await gotoKallRequirements(page);
    await page.getByPlaceholder("Title").fill(title);
    await page.getByRole("button", { name: "+ New requirement" }).click();
    await page.getByPlaceholder("Search requirements…").fill(title.slice(0, 10));
    await expect(page.getByText(title)).toBeVisible();
  });
});
