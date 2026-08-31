import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";
import type { Page } from "@playwright/test";

async function gotoFixtureCompliance(page: Page, organizationId: string) {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId, slug: "beta-fixture" } });
  await page.goto("/projects/" + project.id + "/compliance");
  await expect(page.getByRole("heading", { name: "Compliance", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^SOC 2/ }).click();
  const row = page.locator("li").filter({ hasText: "Fixture access review" });
  await expect(row).toBeVisible();
  return { projectId: project.id, row };
}

test.describe("Compliance", () => {
  test("the SOC 2 fixture control shows its exact mapped count", async ({ page, isolatedOrg }) => {
    const { row } = await gotoFixtureCompliance(page, isolatedOrg);
    await expect(row.getByText("1 mapped", { exact: true })).toBeVisible();
  });

  test("mapping another case persists and increases the selected control count", async ({ page, isolatedOrg }) => {
    const { row } = await gotoFixtureCompliance(page, isolatedOrg);
    await row.getByRole("button", { name: "+ Map a test case" }).click();
    await row.getByRole("combobox").selectOption({ label: "A one-time code is required" });
    await row.getByRole("button", { name: "Map", exact: true }).click();
    await expect(row.getByText("2 mapped", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^SOC 2/ }).click();
    await expect(row.getByText("2 mapped", { exact: true })).toBeVisible();
  });

  test("recording evidence persists the note against the selected mapped case", async ({ page, isolatedOrg }) => {
    const { row, projectId } = await gotoFixtureCompliance(page, isolatedOrg);
    await row.getByRole("button", { name: "Evidence & sign-off" }).click();
    const drawer = page.getByRole("dialog");
    const selected = await drawer.getByRole("combobox").selectOption({ label: "Preparing an immutable submission preview succeeds" });
    await drawer.getByPlaceholder("Optional note").fill("Synthetic access review evidence");
    await drawer.getByRole("button", { name: "Record evidence" }).click();
    await expect(drawer.getByText("Synthetic access review evidence", { exact: true })).toBeVisible();
    await expect.poll(() => prisma.complianceEvidence.count({ where: { projectId, testCaseId: selected[0], note: "Synthetic access review evidence" } })).toBe(1);
  });

  test("an owner records exactly one immutable control sign-off", async ({ page, isolatedOrg }) => {
    const { row, projectId } = await gotoFixtureCompliance(page, isolatedOrg);
    await row.getByRole("button", { name: "Evidence & sign-off" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByPlaceholder(/2026-Q3/).fill("2026-Q3");
    await drawer.getByPlaceholder("Attestation statement", { exact: true }).fill("Synthetic owner attestation");
    await drawer.getByRole("button", { name: "Sign off", exact: true }).click();
    await expect(drawer.getByText("Synthetic owner attestation", { exact: true })).toBeVisible();
    await expect.poll(() => prisma.complianceSignOff.count({ where: { projectId, statement: "Synthetic owner attestation" } })).toBe(1);
    await expect(drawer.getByPlaceholder(/2026-Q3/)).toHaveValue("");
  });

  test("exporting coverage downloads a CSV", async ({ page, isolatedOrg }) => {
    await gotoFixtureCompliance(page, isolatedOrg);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export/i }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.csv$/);
  });

  test("configured retention is shown", async ({ page, isolatedOrg }) => {
    await gotoFixtureCompliance(page, isolatedOrg);
    await expect(page.getByText(/retained for \d+ years?/)).toBeVisible();
  });
});

test.describe("Editor compliance authority", () => {
  test.use({ memberRole: "EDITOR" });
  test("an editor may record evidence but cannot sign off", async ({ page, isolatedOrg }) => {
    const { row } = await gotoFixtureCompliance(page, isolatedOrg);
    await row.getByRole("button", { name: "Evidence & sign-off" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Record evidence" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Sign off", exact: true })).toHaveCount(0);
  });
});

test.describe("Auditor compliance authority", () => {
  test.use({ memberRole: "COMPLIANCE_AUDITOR" });
  test("a full-seat auditor may sign off without project-edit controls", async ({ page, isolatedOrg }) => {
    const { row } = await gotoFixtureCompliance(page, isolatedOrg);
    await expect(row.getByRole("button", { name: "+ Map a test case" })).toHaveCount(0);
    await row.getByRole("button", { name: "Evidence & sign-off" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Sign off", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Record evidence" })).toHaveCount(0);
  });
});
