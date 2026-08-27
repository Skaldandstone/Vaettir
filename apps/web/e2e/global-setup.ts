import { chromium, type FullConfig } from "@playwright/test";
import path from "node:path";

// Signs in once via the real Clerk email/password form and saves the
// resulting session so every other spec starts already authenticated
// (the standard Playwright pattern for an auth-gated app -- signing in
// inside every single test would be slow and would make every spec a
// de-facto auth test). Needs CLERK_TEST_EMAIL/CLERK_TEST_PASSWORD for a
// real seeded user with access to the "TCM" project -- see e2e/README.md.
const authFile = path.join(__dirname, ".auth", "user.json");

export default async function globalSetup(config: FullConfig) {
  const email = process.env.CLERK_TEST_EMAIL;
  const password = process.env.CLERK_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "CLERK_TEST_EMAIL and CLERK_TEST_PASSWORD must be set to run the authenticated e2e suite -- see e2e/README.md.",
    );
  }

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(baseURL);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Land somewhere only a signed-in session reaches (onboarding or the
  // project list, depending on whether this user already has an org).
  await page.waitForURL(/\/(onboarding|projects)/, { timeout: 15_000 });
  await page.context().storageState({ path: authFile });
  await browser.close();
}
