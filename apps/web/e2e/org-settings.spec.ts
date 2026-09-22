import { test, expect } from "./fixtures";

async function gotoOrgSettings(page: import("@playwright/test").Page) {
  await page.goto("/settings/organization");
  await expect(page.getByRole("heading", { name: /settings$/i })).toBeVisible();
}

test.describe("Organization settings", () => {
  test("step field labels can be renamed and saved", async ({ page }) => {
    await gotoOrgSettings(page);
    const label = `Trigger ${Date.now() % 10000}`;
    await page.getByLabel(/action \/ trigger/i).fill(label);
    await page.getByRole("button", { name: "Save labels" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("data retention can be updated within the allowed 1-20 year range", async ({ page }) => {
    await gotoOrgSettings(page);
    const retentionInput = page.locator('input[type="number"][min="1"][max="20"]').first();
    await retentionInput.fill("6");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("the retention dry-run report shows a plain-language summary", async ({ page }) => {
    await gotoOrgSettings(page);
    await expect(page.getByText(/currently older than your \d+-year policy|nothing is currently older/i)).toBeVisible();
  });

  test("the release gate policy can be switched between soft warning and hard block", async ({ page }) => {
    await gotoOrgSettings(page);
    const policySelect = page.locator("select").filter({ hasText: /soft warning|hard block/i });
    await policySelect.selectOption({ label: "Hard block" });
    await page.getByRole("button", { name: "Save" }).nth(1).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    // restore to the non-breaking default
    await policySelect.selectOption({ label: "Soft warning" });
    await page.getByRole("button", { name: "Save" }).nth(1).click();
  });

  test("saving a Slack webhook URL enables the digest toggle and 'Send now' appears", async ({ page }) => {
    await gotoOrgSettings(page);
    await page.getByPlaceholder(/hooks\.slack\.com/).fill("https://hooks.slack.com/services/E2E/TEST/WEBHOOK");
    await page.getByRole("checkbox", { name: /send automatically every day/i }).check();
    await page.getByRole("button", { name: "Save" }).nth(2).click();
    await expect(page.getByRole("button", { name: "Send now" })).toBeVisible();
  });

  test("a new API key can be created and shows its one-time secret", async ({ page }) => {
    await gotoOrgSettings(page);
    await page.getByPlaceholder(/GitHub Actions/).fill(`E2E key ${Date.now()}`);
    await page.getByRole("button", { name: "+ New key" }).click();
    await expect(page.getByText(/copy this now/i)).toBeVisible();
  });

  test("a custom plan type can be created from the vendor-security-questionnaire template", async ({ page }) => {
    await gotoOrgSettings(page);
    await page.getByRole("button", { name: "+ New plan type" }).click();
    await page.getByLabel(/start from a template/i).selectOption({ label: "Vendor security questionnaire" });
    const keyInput = page.getByLabel(/key/i).first();
    const key = `e2e-vendor-security-${Date.now()}`;
    await keyInput.fill(key);
    await page.getByRole("button", { name: "Create plan type" }).click();
    await expect(page.getByText(key)).toBeVisible();
  });
});
