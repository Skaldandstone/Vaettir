import { test, expect } from "./fixtures";

// Signed-out flows -- runs in the "signed-out" project (no stored
// session), see playwright.config.ts.
test.describe("Authentication", () => {
  test("an unauthenticated visitor sees the sign-in form on the home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/sign in/i).first()).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("an unauthenticated request to a project page redirects to sign-in", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("submitting the sign-in form with no credentials shows a validation error, not a silent failure", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/required|enter/i).first()).toBeVisible();
  });

  test("a wrong password is rejected with a visible error", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email address").fill(process.env.CLERK_TEST_EMAIL ?? "nonexistent@example.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("the sign-up link is reachable from the sign-in page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /sign up/i }).click();
    await expect(page).toHaveURL(/sign-up/);
  });
});
