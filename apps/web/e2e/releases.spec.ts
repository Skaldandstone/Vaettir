import { test, expect } from "./fixtures";

async function gotoFixtureReleases(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /release readiness/i }).click();
  await expect(page.getByRole("heading", { name: "Release readiness" })).toBeVisible();
}

test.describe("Release readiness", () => {
  test("the releases list shows the seeded v2.4 release with a readiness badge", async ({ page }) => {
    await gotoFixtureReleases(page);
    const release = page.locator("li.panel").filter({ hasText: "v2.4" });
    await expect(release).toBeVisible();
    await expect(release).toContainText(/\/100/);
  });

  test("trend charts render when more than one release exists", async ({ page }) => {
    await gotoFixtureReleases(page);
    await expect(page.getByText(/pass rate/i)).toBeVisible();
  });

  test("creating a new release adds it to the list", async ({ page }) => {
    const name = `E2E release ${Date.now()}`;
    await gotoFixtureReleases(page);
    await page.getByRole("button", { name: "+ New release" }).click();
    await page.getByLabel("Release name").fill(name);
    await page.getByRole("button", { name: "Create release" }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test("opening the v2.4 release shows its acceptance criteria and their live status", async ({ page }) => {
    await gotoFixtureReleases(page);
    await page.locator("li.panel").filter({ hasText: "v2.4" }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Acceptance criteria" })).toBeVisible();
    await expect(page.getByText(/MET|NOT_MET|AT_RISK/).first()).toBeVisible();
  });

  test("the v2.4 release shows its open risk flag", async ({ page }) => {
    await gotoFixtureReleases(page);
    await page.locator("li.panel").filter({ hasText: "v2.4" }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Risk flags" })).toBeVisible();
    await expect(page.getByText(/totp\.ts/)).toBeVisible();
  });

  test("resolving an open risk flag moves it out of the default (unresolved) view", async ({ page }) => {
    await gotoFixtureReleases(page);
    await page.locator("li.panel").filter({ hasText: "v2.4" }).getByRole("link").click();
    const flagRow = page.locator("li", { hasText: "connectorFallback.ts" });
    const resolveButton = flagRow.getByRole("button", { name: /resolve/i });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();
    await expect(flagRow).toHaveCount(0);
  });

  test("hard-block policy refuses READY and preserves the blocked release status", async ({ page }) => {
    await gotoFixtureReleases(page);
    await page.locator("li.panel").filter({ hasText: "v2.4" }).getByRole("link").click();
    const statusSelect = page.getByRole("combobox").filter({ has: page.locator('option[value="READY"]') });
    let refused = false;
    page.once("dialog", async (dialog) => { refused = /can't be marked READY/.test(dialog.message()); await dialog.accept(); });
    await statusSelect.selectOption("READY");
    await expect.poll(() => refused).toBe(true);
    await page.reload();
    await expect(statusSelect).toHaveValue("BLOCKED");
  });
});
