import { test as setup } from "@playwright/test";
import path from "node:path";
import { assertTestEnvironment } from "./test-environment";

// This setup project is a dependency of the authenticated project only. That
// keeps signed-out checks credential-free while authenticated checks still
// fail closed when a real Clerk identity is unavailable.
const authFile = path.join(__dirname, ".auth", "user.json");

setup("authenticate", async ({ page }) => {
  assertTestEnvironment();
  const email = process.env.CLERK_TEST_EMAIL;
  const password = process.env.CLERK_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "CLERK_TEST_EMAIL and CLERK_TEST_PASSWORD must be set to run the authenticated e2e suite -- see e2e/README.md.",
    );
  }

  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Land somewhere only a signed-in session reaches (onboarding or the
  // project list, depending on whether this user already has an org).
  await page.waitForURL(/\/(onboarding|projects)/, { timeout: 15_000 });
  await page.context().storageState({ path: authFile });
});
