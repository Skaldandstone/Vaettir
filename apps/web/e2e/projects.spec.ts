import { test, expect } from "@playwright/test";

test.describe("Projects", () => {
  test("the projects list loads and shows at least one existing project", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
    await expect(page.locator("li", { hasText: "Kall" })).toBeVisible();
  });

  test("creating a new project adds it to the list", async ({ page }) => {
    const name = `E2E Project ${Date.now()}`;
    await page.goto("/projects");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test("editing a project's name persists after the modal closes", async ({ page }) => {
    const originalName = `E2E Editable ${Date.now()}`;
    const renamedTo = `${originalName} (renamed)`;
    await page.goto("/projects");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.getByLabel("Project name").fill(originalName);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(originalName)).toBeVisible();

    const row = page.locator("li", { hasText: originalName });
    await row.getByRole("button", { name: "Edit" }).click();
    const editNameInput = page.getByLabel("Project name");
    await editNameInput.fill(renamedTo);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(renamedTo)).toBeVisible();
  });

  test("a project's Overview page is reachable from the projects list", async ({ page }) => {
    await page.goto("/projects");
    await page.locator("li", { hasText: "Kall" }).getByRole("link", { name: "Kall" }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  });

  test("the project sidebar switcher lists other projects in the same org", async ({ page }) => {
    await page.goto("/projects");
    await page.locator("li", { hasText: "Kall" }).getByRole("link", { name: "Kall" }).click();
    await expect(page.locator(".sidebar-project-switcher")).toContainText("Kall");
  });
});
