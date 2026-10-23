import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

test.use({ memberRole: "VIEWER", memberSeat: "READ_ONLY" });

test("a read-only seat sees projects and allowances without administration controls", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Beta fixture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New project|^Edit$|^Delete$/ })).toHaveCount(0);
  await page.goto("/settings/members");
  await expect(page.getByRole("button", { name: /Invite someone|Remove/ })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.goto("/settings/organization");
  await expect(page.getByRole("heading", { name: "AI credits" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|New key|Send now/ })).toHaveCount(0);
});

test("read-only deep links never expose editors, reviews, imports, or project mutations", async ({ page, isolatedOrg }) => {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId: isolatedOrg, slug: "beta-fixture" } });
  const testCase = await prisma.testCase.findFirstOrThrow({ where: { projectId: project.id } });
  await prisma.testCase.update({ where: { id: testCase.id }, data: { reviewStatus: "PENDING_REVIEW", origin: "AI_REVERSE_ENGINEERED" } });
  const base = `/projects/${project.id}`;

  await page.goto(`${base}/test-cases/${testCase.id}/edit`);
  await expect(page.getByText(/full-seat Editor, Admin, or Owner is required/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|Create test case/ })).toHaveCount(0);
  await page.goto(`${base}/test-cases/review`);
  await expect(page.getByText(testCase.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve|Reject/ })).toHaveCount(0);
  await page.goto(`${base}/import`);
  await expect(page.getByText(/full-seat Owner, Admin, or Editor can import/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto(`${base}/requirements`);
  await expect(page.getByRole("button", { name: /Extract|New requirement/ })).toHaveCount(0);
  await page.goto(`${base}/shared-steps`);
  await expect(page.getByRole("button", { name: /New library|Edit|Delete/ })).toHaveCount(0);
});
