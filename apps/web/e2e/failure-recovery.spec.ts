import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

async function reverseEngineerPath(organizationId: string) {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId, slug: "beta-fixture" } });
  return "/projects/" + project.id + "/reverse-engineer";
}

test("invalid Postman input reports an error and preserves the source for correction", async ({ page, isolatedOrg }) => {
  await page.goto(await reverseEngineerPath(isolatedOrg));
  const input = page.getByPlaceholder(/"info":/);
  await input.fill("{ not valid JSON }");
  await page.getByRole("button", { name: "Import", exact: true }).last().click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("{ not valid JSON }");
  await expect(page.getByRole("button", { name: "Import", exact: true }).last()).toBeEnabled();
});

for (const failure of [
  { name: "exhausted credits", status: 403, code: "FORBIDDEN", message: "Not enough AI credits. Contact your beta support contact." },
  { name: "unavailable AI", status: 503, code: "INTERNAL_SERVER_ERROR", message: "AI provider unavailable. No result was returned." },
]) {
  test(`a simulated ${failure.name} response is actionable and is not automatically retried`, async ({ page, isolatedOrg }) => {
    let requests = 0;
    // This tests presentation/retry behavior only. It never calls a model and
    // does not establish live-provider availability or accounting correctness.
    await page.route("**/trpc/agent.reverseEngineerFile*", async (route) => {
      requests++;
      await route.fulfill({ status: failure.status, contentType: "application/json", body: JSON.stringify([
        { error: { message: failure.message, code: -32603, data: { code: failure.code, httpStatus: failure.status } } },
      ]) });
    });
    await page.goto(await reverseEngineerPath(isolatedOrg));
    const source = "it('synthetic test', () => expect(true).toBe(true));";
    await page.getByLabel("File path", { exact: true }).first().fill("synthetic.spec.ts");
    await page.getByLabel("Test source", { exact: true }).fill(source);
    await page.getByRole("button", { name: "Reverse-engineer now", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(failure.message);
    await expect(page.getByRole("alert")).toContainText(/A new AI attempt may consume credits/);
    await expect(page.getByLabel("Test source", { exact: true })).toHaveValue(source);
    await expect(page.getByRole("button", { name: "Reverse-engineer now", exact: true })).toBeEnabled();
    expect(requests).toBe(1);
  });
}

test("an expired-session response offers sign-in and hides project data", async ({ page }) => {
  await page.route("**/trpc/organization.mine*", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify([
      { error: { message: "Session expired. Sign in again.", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } },
    ]),
  }));
  await page.goto("/projects");
  await expect(page.getByRole("alert")).toContainText("Session expired");
  await expect(page.getByRole("alert").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Beta fixture", exact: true })).toHaveCount(0);
});
