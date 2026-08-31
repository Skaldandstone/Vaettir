import { test, expect } from "./fixtures";

// Signed-out flows -- runs in the "signed-out" project (no stored
// session), see playwright.config.ts.
test.describe("Authentication", () => {
  test("an unauthenticated visitor can open sign-in from the home page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("an unauthenticated request to a project page redirects to sign-in", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("the sign-in form rejects empty credentials", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => page.getByLabel("Email address").evaluate((input) => !(input as HTMLInputElement).validity.valid || input.getAttribute("aria-invalid") === "true")).toBe(true);
  });

  test("a wrong password is rejected with a visible error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(process.env.CLERK_TEST_EMAIL ?? "nonexistent@example.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("the sign-up link is reachable from the sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: /sign up/i }).click();
    await expect(page).toHaveURL(/sign-up/);
  });
});
