import { test, expect } from "@playwright/test";

// Assumes a project named "Kall" exists and is reachable by the signed-in
// test user (it does in the real Vaettir org this suite runs against).
async function gotoKallTestCases(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Kall" }).getByRole("link", { name: "Kall" }).click();
  await page.getByRole("link", { name: /test cases/i }).click();
  await expect(page).toHaveURL(/\/test-cases$/);
}

test.describe("Test cases", () => {
  test("quick-add creates a case with just a title, via Enter", async ({ page }) => {
    const title = `E2E quick-add case ${Date.now()}`;
    await gotoKallTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("the full editor creates a case with BDD given/when/then", async ({ page }) => {
    const title = `E2E full-editor case ${Date.now()}`;
    await gotoKallTestCases(page);
    await page.getByRole("link", { name: "Full editor" }).click();
    await page.getByLabel(/title/i).fill(title);
    await page.getByPlaceholder(/given/i).first().fill("a signed-in user");
    await page.getByPlaceholder(/when/i).first().fill("they perform the action under test");
    await page.getByPlaceholder(/then/i).first().fill("the expected outcome occurs");
    await page.getByRole("button", { name: /create|save/i }).click();
    await expect(page).toHaveURL(/\/test-cases/);
  });

  test("searching filters the visible case list by title", async ({ page }) => {
    await gotoKallTestCases(page);
    await page.getByPlaceholder("Search title or tags…").fill("submission preview");
    await expect(page.getByText("Preparing an immutable submission preview succeeds")).toBeVisible();
  });

  test("bulk-selecting cases and adding a tag applies it to all selected", async ({ page }) => {
    await gotoKallTestCases(page);
    const tag = `e2e-${Date.now()}`;
    const checkboxes = page.locator('input[type="checkbox"]').and(page.locator(":visible"));
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();
    await page.getByPlaceholder("add tag…").fill(tag);
    await page.getByPlaceholder("add tag…").press("Enter");
    await expect(page.getByText(tag).first()).toBeVisible();
  });

  test("archiving a selected case removes it from the default (non-archived) view", async ({ page }) => {
    const title = `E2E archive-me ${Date.now()}`;
    await gotoKallTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    const row = page.locator("*", { hasText: title }).first();
    await row.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(title)).not.toBeVisible();
  });

  test("checking 'show archived' brings archived cases back into view", async ({ page }) => {
    const title = `E2E archived-visibility ${Date.now()}`;
    await gotoKallTestCases(page);
    const quickAdd = page.getByPlaceholder("+ Quick-add a case, press Enter…");
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    const row = page.locator("*", { hasText: title }).first();
    await row.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(title)).not.toBeVisible();

    await page.locator("label", { hasText: /archived/i }).locator('input[type="checkbox"]').check();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("importing a CSV creates the expected number of new cases and reports skipped rows", async ({ page }) => {
    await gotoKallTestCases(page);
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
    await gotoKallTestCases(page);
    await page.getByText("A wrong password is rejected without creating a session").click();
    await expect(page.locator(".drawer-panel")).toBeVisible();
    await expect(page.locator(".drawer-panel")).toContainText(/given/i);
  });
});
