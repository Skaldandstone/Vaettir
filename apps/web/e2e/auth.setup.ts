import { test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { assertTestEnvironment } from "./test-environment";

setup("dedicated Clerk test identity", async ({ page }) => {
  assertTestEnvironment();
  const identifier = process.env.CLERK_TEST_EMAIL;
  const password = process.env.CLERK_TEST_PASSWORD;
  if (!identifier || !password || !process.env.CLERK_TEST_USER_ID) throw new Error("Dedicated Clerk test email, password and user ID are required.");
  await clerkSetup();
  await page.goto("/");
  await clerk.signIn({ page, signInParams: { strategy: "password", identifier, password } });
  await mkdir(path.join(__dirname, ".auth"), { recursive: true });
  await page.context().storageState({ path: path.join(__dirname, ".auth/user.json") });
});
