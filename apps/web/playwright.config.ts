import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// E2E coverage for the Vaettir platform itself (dogfooding -- these are
// reverse-engineered into TestCases in Vaettir's own "TCM" project, same
// pipeline as any customer's repo). baseURL points at the local dev
// server; CI/staging targets can override via PLAYWRIGHT_BASE_URL.
//
// Two projects: "signed-out" runs auth.spec.ts with no stored session
// (it's testing the sign-in flow itself); "authenticated" runs everything
// else against the session globalSetup.ts signs in once and saves --
// signing in inside every single test would be slow and would make every
// spec a de-facto auth test.
export default defineConfig({
  testDir: "./e2e",
  // One disposable organization per authenticated test. A single worker
  // protects the dedicated identity and makes cleanup deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: "global-setup.ts",
    },
    {
      name: "signed-out",
      testMatch: "auth.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authenticated",
      testIgnore: "auth.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "e2e/.auth/user.json"),
      },
      dependencies: ["auth-setup"],
    },
  ],
});
