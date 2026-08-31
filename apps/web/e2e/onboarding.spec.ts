import { test, expect } from "./fixtures";
import { prisma } from "@vaettir/db";

test.describe("Enrolled owner onboarding", () => {
  test.use({ fixtureMode: "enrolled" });
  test("a fresh owner creates a private workspace and first project", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible();
    await expect(page.getByText(/5 full seats, 2 read-only seats, and 500 AI credits/)).toBeVisible();
    await page.getByLabel("Organization name").fill("Synthetic onboarding team");
    await page.getByRole("button", { name: "Create organization", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText(/No projects yet. Create your first project/)).toBeVisible();
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.getByLabel("Project name").fill("First synthetic project");
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.getByRole("link", { name: "First synthetic project", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  });
});

test.describe("Unenrolled visitor", () => {
  test.use({ fixtureMode: "unenrolled" });
  test("has a clear invite-only path, not public organization creation", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Vaettir private beta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create organization", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Read the beta onboarding guide" })).toBeVisible();
  });
});

test.describe("Invitation acceptance", () => {
  test.use({ fixtureMode: "invitation" });
  test("a recipient accepts and reaches the team's useful project data", async ({ page, isolatedOrg }) => {
    const invite = await prisma.invitation.findFirstOrThrow({ where: { organizationId: isolatedOrg } });
    await page.goto("/invite/" + invite.token);
    await expect(page.getByRole("heading", { name: "Join Disposable beta fixture" })).toBeVisible();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("link", { name: "Beta fixture", exact: true }).click();
    await page.getByRole("link", { name: "Test Cases", exact: true }).click();
    await expect(page.getByText("A wrong password is rejected without creating a session", { exact: true })).toBeVisible();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe("ACCEPTED");
  });
  test("expired invitations explain how to recover", async ({ page, isolatedOrg }) => {
    const invite = await prisma.invitation.findFirstOrThrow({ where: { organizationId: isolatedOrg } });
    await prisma.invitation.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
    await page.goto("/invite/" + invite.token);
    await expect(page.getByText("This invitation has expired. Ask an admin to send a new one.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });
  test("a mismatched email cannot accept and has account-switch guidance", async ({ page, isolatedOrg }) => {
    const invite = await prisma.invitation.findFirstOrThrow({ where: { organizationId: isolatedOrg } });
    await prisma.invitation.update({ where: { id: invite.id }, data: { email: "other-fixture@example.invalid" } });
    await page.goto("/invite/" + invite.token);
    await expect(page.getByText(/Sign out using the account menu/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });
});

test("project network failures clear the view and can be retried", async ({ page }) => {
  await page.route("**/trpc/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/projects");
  await expect(page.getByRole("alert")).toContainText(/Check your connection/);
  await expect(page.getByRole("link", { name: "Beta fixture", exact: true })).toHaveCount(0);
  await page.unroute("**/trpc/**");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("link", { name: "Beta fixture", exact: true })).toBeVisible();
});
