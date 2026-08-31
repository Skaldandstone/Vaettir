import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

async function gotoFixtureTestRuns(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /test runs/i }).click();
  await expect(page.getByRole("heading", { name: "Test Runs" })).toBeVisible();
}

test.describe("Test runs & self-healing", () => {
  test("the runs list shows the seeded run history for v2.4", async ({ page }) => {
    await gotoFixtureTestRuns(page);
    await expect(page.getByText("github-actions")).toBeVisible();
  });

  test("opening a run shows its individual result rows", async ({ page }) => {
    await gotoFixtureTestRuns(page);
    await page.getByText("github-actions").first().click();
    await expect(page.locator(".drawer-panel")).toBeVisible();
    await expect(page.locator(".drawer-panel").getByRole("cell", { name: "PASS", exact: true })).toHaveCount(2);
    await expect(page.locator(".drawer-panel").getByRole("cell", { name: "FAIL", exact: true })).toHaveCount(1);
  });

  test("@ai classifying a failing result returns a classification and rationale", async ({ page, isolatedOrg }) => {
    await prisma.healingSuggestion.deleteMany({ where: { project: { organizationId: isolatedOrg } } });
    await gotoFixtureTestRuns(page);
    // Classification still requires approved model access and source linkage.
    await page.getByText("github-actions").first().click();
    const classifyButton = page.getByRole("button", { name: "Classify failure" }).first();
    await expect(classifyButton).toBeVisible();
    await classifyButton.click();
    await expect(page.locator(".drawer-panel").getByText(/^(BRITTLE|REAL REGRESSION|UNCERTAIN)$/)).toBeVisible({ timeout: 30_000 });
  });

  test("approving a healing suggestion persists its reviewed status", async ({ page, isolatedOrg }) => {
    await gotoFixtureTestRuns(page);
    await page.getByText("github-actions").first().click();
    const approveButton = page.getByRole("button", { name: "Approve" }).first();
    await expect(approveButton).toBeVisible();
    await approveButton.click();
    await expect(page.locator(".drawer-panel").getByText("approved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await prisma.healingSuggestion.findFirstOrThrow({ where: { project: { organizationId: isolatedOrg } } })).status).toBe("APPROVED");
  });

  test("the failure classification signal section shows aggregate counts", async ({ page }) => {
    await gotoFixtureTestRuns(page);
    const signalHeading = page.getByRole("heading", { name: "Failure classification signal" });
    await expect(signalHeading).toBeVisible();
    await expect(page.getByText("1 brittle · 0 real regressions · 0 uncertain · 0 resolved (of 1 classified)")).toBeVisible();
  });

  test("coverage reports section renders when coverage has been ingested", async ({ page }) => {
    await gotoFixtureTestRuns(page);
    const coverageHeading = page.getByRole("heading", { name: "Coverage" });
    await expect(coverageHeading).toBeVisible();
    await expect(page.getByRole("cell", { name: "ISTANBUL", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "80% (8/10)", exact: true })).toBeVisible();
  });

  test("linking an unmatched result persists the selected case", async ({ page, isolatedOrg }) => {
    await gotoFixtureTestRuns(page);
    await page.getByText("github-actions").first().click();
    const linkButton = page.getByRole("button", { name: "Link to test case" }).first();
    await expect(linkButton).toBeVisible();
    await linkButton.click();
    const selected = await page.locator(".drawer-panel").getByRole("combobox").selectOption({ label: "A one-time code is required" });
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.locator(".drawer-panel").getByText(/unmatched-fixture/)).toHaveCount(0);
    await expect.poll(async () => (await prisma.testResult.findFirstOrThrow({ where: { externalTestId: "unmatched-fixture", testRun: { project: { organizationId: isolatedOrg } } } })).testCaseId).toBe(selected[0]);
  });
});
