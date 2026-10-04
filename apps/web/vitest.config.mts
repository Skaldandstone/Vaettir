import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Playwright fixtures remain in the separately gated browser suite.
    include: ["lib/**/*.test.ts"],
  },
});
