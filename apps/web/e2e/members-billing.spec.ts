import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

async function gotoMembers(page: import("@playwright/test").Page) {
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();
}

test.describe("Members, seats & plan", () => {
  test("the members list loads with at least one member", async ({ page }) => {
    await gotoMembers(page);
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
    await expect(page.getByRole("table")).toContainText(process.env.CLERK_TEST_EMAIL!);
  });

  test("the seat-usage panel shows the org's current plan tier", async ({ page }) => {
    await gotoMembers(page);
    const panel = page.locator(".panel").filter({ hasText: "Private beta plan" });
    await expect(panel.getByText("1/5", { exact: true })).toBeVisible();
    await expect(panel.getByText("0/2", { exact: true })).toBeVisible();
    await expect(panel).toContainText("500 AI credits per month");
  });

  test("inviting a new member by email generates a shareable invite link", async ({ page }) => {
    await gotoMembers(page);
    await page.getByRole("button", { name: "+ Invite someone" }).click();
    await page.getByLabel("Email").fill(`e2e-invite-${Date.now()}@example.invalid`);
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
    const email = `e2e-revoke-${Date.now()}@example.invalid`;
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(/Invite created/)).toBeVisible();
    await page.keyboard.press("Escape");
    const row = page.locator("li", { hasText: email });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText(email)).not.toBeVisible();
  });
});

test.describe("AI credits", () => {
  test("the AI credits panel shows the beta allowance and monthly ledger grant", async ({ page, isolatedOrg }) => {
    await page.goto("/settings/organization");
    await expect(page.getByRole("heading", { name: "AI credits" })).toBeVisible();
    await expect(page.getByText(/credits remaining · 500\/month included on the Private beta plan/)).toBeVisible();
    await expect(page.locator(".panel").filter({ hasText: "credits remaining" }).getByText("500", { exact: true })).toBeVisible();
    const ledger = await prisma.aiCreditTransaction.findMany({ where: { organizationId: isolatedOrg } });
    expect(ledger.reduce((sum, entry) => sum + entry.amount, 0)).toBe(500);
    expect(ledger.filter((entry) => entry.type === "GRANT")).toHaveLength(1);
  });
});
