import { test, expect } from "@playwright/test";

// Signed-out flows -- runs in the "signed-out" project (no stored
// session), see playwright.config.ts.
test.describe("Authentication", () => {
  test("an unauthenticated visitor sees the branded sign-in form", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in to Vaettir" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("an unauthenticated request to a project page redirects to sign-in", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("submitting the sign-in form with no credentials keeps focus on the required field", async ({ page }) => {
    await page.goto("/sign-in");
    const email = page.getByLabel("Email address");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(email).toBeFocused();
    await expect(email).toHaveValue("");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("a wrong password is rejected with a visible error", async ({ page }) => {
    test.skip(!process.env.CLERK_TEST_EMAIL, "A real Clerk test identity is required to reach the password step.");
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(process.env.CLERK_TEST_EMAIL!);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("public sign-up offers account creation for the sales demo", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page).toHaveURL(/sign-up/);
    await expect(page.getByText("VAETTIR / SALES DEMO")).toBeVisible();
    await expect(page.getByText("Signing up opens the sales demo.", { exact: false })).toBeVisible();
  });
});
