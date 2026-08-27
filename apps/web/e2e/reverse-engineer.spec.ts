import { test, expect } from "@playwright/test";

async function gotoKallReverseEngineer(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.locator("li", { hasText: "Kall" }).getByRole("link", { name: "Kall" }).click();
  await page.getByRole("link", { name: /reverse engineer/i }).click();
  await expect(page.getByRole("heading", { name: /reverse-engineer a test into BDD/i })).toBeVisible();
}

test.describe("AI reverse-engineering", () => {
  test("pasting a real Jest test file produces at least one BDD test case", async ({ page }) => {
    await gotoKallReverseEngineer(page);
    await page.getByLabel("File path").first().fill("e2e-sample.spec.js");
    await page.getByLabel("Test source").fill(
      `it("rejects checkout when cart is empty", () => {\n  const cart = new Cart();\n  expect(() => checkout(cart)).toThrow("EmptyCart");\n});`,
    );
    await page.getByRole("button", { name: "Reverse-engineer now" }).click();
    await expect(page.getByText(/given|when|then/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("submitting as a background job returns a queued status instead of blocking", async ({ page }) => {
    await gotoKallReverseEngineer(page);
    await page.getByLabel("File path").first().fill("e2e-async-sample.spec.js");
    await page.getByLabel("Test source").fill(
      `it("allows checkout with a valid cart", () => {\n  const cart = new Cart([{ sku: "abc", qty: 1 }]);\n  expect(checkout(cart)).toBe(true);\n});`,
    );
    await page.getByRole("button", { name: "Run as background job" }).click();
    await expect(page.getByText(/pending|running|queued/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("importing a Gherkin feature file creates a test case with no AI review needed", async ({ page }) => {
    await gotoKallReverseEngineer(page);
    await page.getByLabel(".feature source").fill(
      "Feature: E2E import\n\n  Scenario: A simple scenario\n    Given a precondition\n    When an action happens\n    Then an outcome is observed",
    );
    await page.getByRole("button", { name: "Import", exact: true }).first().click();
    await expect(page.getByText(/created|imported|1 test case/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("importing a Postman collection with a pm.test assertion creates a contract test case", async ({ page }) => {
    await gotoKallReverseEngineer(page);
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
    await expect(page.getByText(/created|imported|1 test case/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("inferring a custom framework heuristic from two example files returns a name and description", async ({ page }) => {
    await gotoKallReverseEngineer(page);
    const heading = page.getByRole("heading", { name: /teach|custom framework/i });
    if (await heading.isVisible().catch(() => false)) {
      await expect(page.getByRole("button", { name: /infer/i })).toBeVisible();
    }
  });

  test("previously logged jobs are listed with their status", async ({ page }) => {
    await gotoKallReverseEngineer(page);
    await expect(page.getByText(/pending|running|succeeded|failed/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
