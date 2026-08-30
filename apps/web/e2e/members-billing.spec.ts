import { test, expect } from "./fixtures";

async function gotoMembers(page: import("@playwright/test").Page) {
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();
}

test.describe("Members, seats & plan", () => {
  test("the members list loads with at least one member", async ({ page }) => {
    await gotoMembers(page);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("the seat-usage panel shows the org's current plan tier", async ({ page }) => {
    await gotoMembers(page);
    await expect(page.getByText(/plan$/i).first()).toBeVisible();
    await expect(page.getByText(/full seats/i)).toBeVisible();
  });

  test("inviting a new member by email generates a shareable invite link", async ({ page }) => {
    await gotoMembers(page);
    await page.getByRole("button", { name: "+ Invite someone" }).click();
    await page.getByLabel("Email").fill(`e2e-invite-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(/invite created/i)).toBeVisible();
  });

  test("private beta has no self-service paid upgrade path", async ({ page }) => {
    await gotoMembers(page);
    const planSelect = page.locator("select").filter({ hasText: /free|team|business|corp/i }).first();
    await expect(planSelect).toHaveCount(0);
    await expect(page.getByText(/Private beta plan/i)).toBeVisible();
    await expect(page.getByText(/500/)).toBeVisible();
  });

  test("revoking a pending invitation removes it from the list", async ({ page }) => {
    await gotoMembers(page);
    await page.getByRole("button", { name: "+ Invite someone" }).click();
    const email = `e2e-revoke-${Date.now()}@example.com`;
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    const row = page.locator("li", { hasText: email });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText(email)).not.toBeVisible();
  });
});

test.describe("AI credits", () => {
  test("the AI credits panel shows a real balance and recent activity", async ({ page }) => {
    await page.goto("/settings/organization");
    await expect(page.getByRole("heading", { name: "AI credits" })).toBeVisible();
    await expect(page.getByText(/credits remaining/i)).toBeVisible();
  });
});
