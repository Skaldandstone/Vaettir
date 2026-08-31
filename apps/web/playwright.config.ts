import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// One disposable organization per test. Serial workers protect the dedicated
// identity and keep each test independent of ordering and customer records.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: 0,
  reporter: [["html", { open: "never" }], ["list"]],
  grepInvert: process.env.VAETTIR_LIVE_AI_TESTS === "1" ? undefined : /@ai/,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "setup", testMatch: "auth.setup.ts" },
    { name: "signed-out", testMatch: "auth.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    { name: "authenticated", testMatch: "**/*.spec.ts", testIgnore: "auth.spec.ts", dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: path.join(__dirname, "e2e/.auth/user.json") } },
  ],
});
