import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

async function gotoFixtureReverseEngineer(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Beta fixture" }).getByRole("link", { name: "Beta fixture" }).click();
  await page.getByRole("link", { name: /reverse engineer/i }).click();
  await expect(page.getByRole("heading", { name: /reverse-engineer a test into BDD/i })).toBeVisible();
}

test.describe("AI reverse-engineering", () => {
  test("@ai pasting a real Jest test file produces persisted cases awaiting review", async ({ page, isolatedOrg }) => {
    await gotoFixtureReverseEngineer(page);
    await page.getByLabel("File path").first().fill("e2e-sample.spec.js");
    await page.getByLabel("Test source").fill(
      `it("rejects checkout when cart is empty", () => {\n  const cart = new Cart();\n  expect(() => checkout(cart)).toThrow("EmptyCart");\n});`,
    );
    await page.getByRole("button", { name: "Reverse-engineer now" }).click();
    await expect(page.getByRole("heading", { name: /^Detected:/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => prisma.testCase.count({ where: { project: { organizationId: isolatedOrg }, origin: "AI_REVERSE_ENGINEERED", reviewStatus: "PENDING_REVIEW" } })).toBeGreaterThan(0);
  });

  test("@ai a background job appears promptly and completes before fixture cleanup", async ({ page, isolatedOrg }) => {
    test.setTimeout(180_000);
    await gotoFixtureReverseEngineer(page);
    await page.getByLabel("File path").first().fill("e2e-async-sample.spec.js");
    await page.getByLabel("Test source").fill(
      `it("allows checkout with a valid cart", () => {\n  const cart = new Cart([{ sku: "abc", qty: 1 }]);\n  expect(checkout(cart)).toBe(true);\n});`,
    );
    await page.getByRole("button", { name: "Run as background job" }).click();
    const job = page.locator("li").filter({ hasText: "e2e-async-sample.spec.js" });
    await expect(job).toContainText(/PENDING|RUNNING|SUCCEEDED/, { timeout: 10_000 });
    await expect.poll(async () => (await prisma.reverseEngineerJob.findFirst({ where: { project: { organizationId: isolatedOrg }, inputRef: "e2e-async-sample.spec.js" } }))?.status, { timeout: 150_000 }).toBe("SUCCEEDED");
  });

  test("importing a Gherkin feature file creates a test case with no AI review needed", async ({ page, isolatedOrg }) => {
    await gotoFixtureReverseEngineer(page);
    await page.getByLabel(".feature source").fill(
      "Feature: E2E import\n\n  Scenario: A simple scenario\n    Given a precondition\n    When an action happens\n    Then an outcome is observed",
    );
    await page.getByRole("button", { name: "Import", exact: true }).first().click();
    await expect(page.getByText(/^Imported 1 test case\(s\):/)).toBeVisible();
    expect(await prisma.testCase.count({ where: { project: { organizationId: isolatedOrg }, origin: "IMPORTED", reviewStatus: "APPROVED" } })).toBe(1);
  });

  test("importing a Postman collection with a pm.test assertion creates a contract test case", async ({ page, isolatedOrg }) => {
    await gotoFixtureReverseEngineer(page);
    const collection = JSON.stringify({
      info: { name: "E2E collection" },
      item: [
        {
          name: "Ping",
          request: { method: "GET", url: "https://example.com/ping" },
          event: [{ listen: "test", script: { exec: ["pm.test('is up', function(){ pm.response.to.have.status(200); });"] } }],
        },
      ],
    });
    await page.getByPlaceholder(/"info":/).fill(collection);
    await page.getByRole("button", { name: "Import", exact: true }).last().click();
    await expect(page.getByText(/^Imported 1 test case\(s\):/)).toBeVisible();
    expect(await prisma.testCase.count({ where: { project: { organizationId: isolatedOrg }, origin: "IMPORTED", reviewStatus: "APPROVED", testType: "CONTRACT" } })).toBe(1);
  });

  test("custom framework teaching exposes its explicit inference action", async ({ page }) => {
    await gotoFixtureReverseEngineer(page);
    const heading = page.getByRole("heading", { name: /teach|custom framework/i });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("button", { name: "Infer the pattern", exact: true })).toBeVisible();
  });

  test("previously logged jobs are listed with their status", async ({ page }) => {
    await gotoFixtureReverseEngineer(page);
    await expect(page.getByRole("heading", { name: "Recent jobs" })).toBeVisible();
    await expect(page.locator("li", { hasText: "fixture.spec.ts" })).toContainText("SUCCEEDED");
  });
});
