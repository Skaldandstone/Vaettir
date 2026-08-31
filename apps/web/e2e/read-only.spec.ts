import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

test.use({ memberRole: "VIEWER", memberSeat: "READ_ONLY" });

test("a read-only seat sees projects, seats and credits without administration controls", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Beta fixture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New project|^Edit$|^Delete$/ })).toHaveCount(0);
  await page.goto("/settings/members");
  await expect(page.getByText("Private beta plan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Invite someone|Remove/ })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.goto("/settings/organization");
  await expect(page.getByRole("heading", { name: "AI credits" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|New key|Send now/ })).toHaveCount(0);
});

test("a read-only seat sees cases, releases, run results and sign-offs without write actions", async ({ page, isolatedOrg }) => {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId: isolatedOrg, slug: "beta-fixture" } });
  const base = "/projects/" + project.id;
  await page.goto(base + "/test-cases");
  await expect(page.getByText("A wrong password is rejected without creating a session", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("+ Quick-add a case, press Enter…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import CSV", exact: true })).toHaveCount(0);
  await page.goto(base + "/releases");
  await expect(page.locator("li.panel").filter({ hasText: "v2.4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ New release" })).toHaveCount(0);
  await page.goto(base + "/test-runs");
  await page.getByRole("cell", { name: "github-actions", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("BRITTLE", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Approve|Reject|Classify failure|Link to test case/ })).toHaveCount(0);
  await page.goto(base + "/compliance");
  await page.getByRole("button", { name: /^SOC 2/ }).click();
  await page.locator("li").filter({ hasText: "Fixture access review" }).getByRole("button", { name: "Evidence & sign-off" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Sign-offs", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Record evidence|Sign off/ })).toHaveCount(0);
});

test("read-only seats cannot access deep-linked editors, review actions or imports", async ({ page, isolatedOrg }) => {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId: isolatedOrg, slug: "beta-fixture" } });
  const testCase = await prisma.testCase.findFirstOrThrow({ where: { projectId: project.id } });
  await prisma.testCase.update({ where: { id: testCase.id }, data: { reviewStatus: "PENDING_REVIEW", origin: "AI_REVERSE_ENGINEERED" } });
  const base = "/projects/" + project.id;
  await page.goto(base + "/test-cases/" + testCase.id + "/edit");
  await expect(page.getByText("A full-seat editor, admin or owner is required to edit test cases.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|Create test case/ })).toHaveCount(0);
  await page.goto(base + "/test-cases/review");
  await expect(page.getByText(testCase.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve|Reject/ })).toHaveCount(0);
  await page.goto(base + "/import");
  await expect(page.getByText(/A full-seat Owner, Admin or Editor can import/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto(base + "/requirements");
  await expect(page.getByRole("heading", { name: "Requirements", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Extract|New requirement/ })).toHaveCount(0);
  await page.goto(base + "/shared-steps");
  await expect(page.getByRole("heading", { name: "Shared step libraries", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New library|Edit|Delete/ })).toHaveCount(0);
});
