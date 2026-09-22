import { defineConfig } from "@playwright/test";

// Database fixture contract only. These synthetic identifiers are not usable
// browser credentials and no Clerk or API network calls are made.
process.env.CLERK_TEST_USER_ID = "fixture-contract-local-user";
process.env.CLERK_TEST_EMAIL = "fixture-contract@example.invalid";
process.env.CLERK_SECRET_KEY = "sk_test_fixture_contract_not_a_credential";
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fixture_contract_not_a_credential";
process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
process.env.PLAYWRIGHT_BASE_URL = "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: "fixtures.contract.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
});
