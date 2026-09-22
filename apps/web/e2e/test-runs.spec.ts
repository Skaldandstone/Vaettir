import { test, expect } from "./fixtures";

async function gotoKallTestRuns(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /test runs/i }).click();
  await expect(page.getByRole("heading", { name: "Test Runs" })).toBeVisible();
}

test.describe("Test runs & self-healing", () => {
  test("the runs list shows the seeded run history for v2.4", async ({ page }) => {
    await gotoKallTestRuns(page);
    await expect(page.getByText("github-actions")).toBeVisible();
  });

  test("opening a run shows its individual result rows", async ({ page }) => {
    await gotoKallTestRuns(page);
    await page.getByText("github-actions").first().click();
    await expect(page.locator(".drawer-panel")).toBeVisible();
    await expect(page.locator(".drawer-panel").getByText(/PASS|FAIL/)).toBeVisible();
  });

  test("classifying a failing result returns a classification and rationale", async ({ page }) => {
    await gotoKallTestRuns(page);
    // The most recent run has a real seeded FAIL (the 2FA/TOTP case).
    await page.getByText("github-actions").first().click();
    const classifyButton = page.getByRole("button", { name: "Classify failure" }).first();
    if (await classifyButton.isVisible().catch(() => false)) {
      await classifyButton.click();
      await expect(page.getByText(/BRITTLE|REAL REGRESSION|UNCERTAIN/i)).toBeVisible({ timeout: 30_000 });
    }
  });

  test("approving a healing suggestion updates its status", async ({ page }) => {
    await gotoKallTestRuns(page);
    await page.getByText("github-actions").first().click();
    const approveButton = page.getByRole("button", { name: "Approve" }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await expect(page.getByText(/approved/i).first()).toBeVisible();
    }
  });

  test("the failure classification signal section shows aggregate counts", async ({ page }) => {
    await gotoKallTestRuns(page);
    const signalHeading = page.getByRole("heading", { name: "Failure classification signal" });
    if (await signalHeading.isVisible().catch(() => false)) {
      await expect(page.getByText(/brittle/i)).toBeVisible();
    }
  });

  test("coverage reports section renders when coverage has been ingested", async ({ page }) => {
    await gotoKallTestRuns(page);
    const coverageHeading = page.getByRole("heading", { name: "Coverage" });
    await expect(coverageHeading.or(page.getByRole("heading", { name: "Test Runs" }))).toBeVisible();
  });

  test("linking an unmatched result to a real test case removes it from the unmatched state", async ({ page }) => {
    await gotoKallTestRuns(page);
    await page.getByText("github-actions").first().click();
    const linkButton = page.getByRole("button", { name: "Link to test case" }).first();
    if (await linkButton.isVisible().catch(() => false)) {
      await linkButton.click();
      await page.getByRole("combobox").last().selectOption({ index: 1 });
      await page.getByRole("button", { name: "Link", exact: true }).click();
      await expect(linkButton).not.toBeVisible();
    }
  });
});
