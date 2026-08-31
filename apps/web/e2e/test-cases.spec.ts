import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

// Each test receives its own synthetic project and case data.
async function gotoFixtureTestCases(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: "Test Cases", exact: true }).click();
  await expect(page).toHaveURL(/\/test-cases$/);
}

test.describe("Test cases", () => {
  test("quick-add creates a case with just a title, via Enter", async ({ page }) => {
    const title = `E2E quick-add case ${Date.now()}`;
    await gotoFixtureTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("the full editor creates a case with BDD given/when/then", async ({ page }) => {
    const title = `E2E full-editor case ${Date.now()}`;
    await gotoFixtureTestCases(page);
    await page.getByRole("link", { name: "Full editor" }).click();
    await page.getByLabel(/title/i).fill(title);
    await page.getByRole("button", { name: "+ Add Given", exact: true }).click();
    await page.getByLabel("Given 1", { exact: true }).fill("a signed-in user");
    await page.getByRole("button", { name: "+ Add When", exact: true }).click();
    await page.getByLabel("When 1", { exact: true }).fill("they perform the action under test");
    await page.getByRole("button", { name: "+ Add Then", exact: true }).click();
    await page.getByLabel("Then 1", { exact: true }).fill("the expected outcome occurs");
    await page.getByRole("button", { name: /create|save/i }).click();
    await expect(page).toHaveURL(/\/test-cases\/[^/]+$/);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  });

  test("searching filters the visible case list by title", async ({ page }) => {
    await gotoFixtureTestCases(page);
    await page.getByPlaceholder("Search title or tags…").fill("submission preview");
    await expect(page.getByText("Preparing an immutable submission preview succeeds")).toBeVisible();
    await expect(page.getByText("A wrong password is rejected without creating a session", { exact: true })).toHaveCount(0);
  });

  test("bulk-selecting cases and adding a tag applies it to all selected", async ({ page, isolatedOrg }) => {
    await gotoFixtureTestCases(page);
    const tag = `e2e-${Date.now()}`;
    const titles = ["A wrong password is rejected without creating a session", "Preparing an immutable submission preview succeeds"];
    for (const title of titles) {
      await page.locator("li").filter({ hasText: title }).getByRole("checkbox").check();
    }
    await page.getByPlaceholder("add tag…").fill(tag);
    await page.getByPlaceholder("add tag…").press("Enter");
    for (const title of titles) {
      await expect(page.locator("li").filter({ hasText: title }).getByText(tag, { exact: true })).toBeVisible();
    }
    await expect.poll(() => prisma.testCase.count({ where: { project: { organizationId: isolatedOrg }, title: { in: titles }, tags: { has: tag } } })).toBe(2);
  });

  test("archiving a selected case removes it from the default (non-archived) view", async ({ page }) => {
    const title = `E2E archive-me ${Date.now()}`;
    await gotoFixtureTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    const row = page.locator("li").filter({ hasText: title });
    await row.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(title)).not.toBeVisible();
  });

  test("checking 'show archived' brings archived cases back into view", async ({ page }) => {
    const title = `E2E archived-visibility ${Date.now()}`;
    await gotoFixtureTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    const row = page.locator("li").filter({ hasText: title });
    await row.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(title)).not.toBeVisible();

    await page.locator("label", { hasText: /archived/i }).locator('input[type="checkbox"]').check();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("importing a CSV creates the expected number of new cases and reports skipped rows", async ({ page }) => {
    await gotoFixtureTestCases(page);
    await page.getByRole("button", { name: "Import CSV" }).click();
    const csv = [
      "title,given,when,then,priority,tags",
      `"E2E CSV import ${Date.now()}","a user","they act","it works",MEDIUM,"e2e"`,
      '"","g","w","t",MEDIUM,""',
    ].join("\n");
    await page.locator("textarea").fill(csv);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText(/Imported 1 test case/)).toBeVisible();
    await expect(page.getByText(/Skipped 1 row/)).toBeVisible();
  });

  test("opening a test case shows its detail drawer with BDD content", async ({ page }) => {
    await gotoFixtureTestCases(page);
    await page.getByText("A wrong password is rejected without creating a session").click();
    await expect(page.locator(".drawer-panel")).toBeVisible();
    await expect(page.locator(".drawer-panel")).toContainText(/given/i);
  });

  test("reviewing a synthetic AI draft persists approval and removes it from the queue", async ({ page, isolatedOrg }) => {
    const testCase = await prisma.testCase.findFirstOrThrow({ where: { project: { organizationId: isolatedOrg } } });
    await prisma.testCase.update({ where: { id: testCase.id }, data: { origin: "AI_REVERSE_ENGINEERED", reviewStatus: "PENDING_REVIEW" } });
    await page.goto(`/projects/${testCase.projectId}/test-cases/review`);
    const row = page.locator("li").filter({ hasText: testCase.title });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText("Nothing pending review.", { exact: true })).toBeVisible();
    const reviewed = await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } });
    expect(reviewed.reviewStatus).toBe("APPROVED");
    expect(reviewed.reviewedById).not.toBeNull();
  });
});
