import { test, expect } from "./fixtures";

test.describe("Projects", () => {
  test("the projects list loads and shows at least one existing project", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: /projects/i }),
    ).toBeVisible();
    await expect(page.locator("li", { hasText: "Beta fixture" })).toBeVisible();
  });

  test("creating a new project adds it to the list", async ({ page }) => {
    const name = `E2E Project ${Date.now()}`;
    await page.goto("/projects");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test("editing a project's name persists after the modal closes", async ({
    page,
  }) => {
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

  test("a project's Overview page is reachable from the projects list", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page
      .locator("li", { hasText: "Beta fixture" })
      .getByRole("link", { name: "Beta fixture" })
      .click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  });

  test("deletion requires an exact project name and can be cancelled safely", async ({
    page,
  }) => {
    await page.goto("/projects");
    const row = page.locator("li", { hasText: "Beta fixture" });
    const opener = row.getByRole("button", { name: "Delete", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: "Delete project?",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    const confirm = dialog.getByRole("button", {
      name: "Delete project",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Project name confirmation").fill("Wrong project");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Project name confirmation").fill("Beta fixture");
    await expect(confirm).toBeEnabled();
    // Never submit a deletion in this usability regression.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(row).toBeVisible();
    await opener.click();
    await expect(dialog.getByLabel("Project name confirmation")).toHaveValue(
      "",
    );
    await expect(confirm).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("the project sidebar switcher lists other projects in the same org", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page
      .locator("li", { hasText: "Beta fixture" })
      .getByRole("link", { name: "Beta fixture" })
      .click();
    const switcher = page.locator(".sidebar-project-switcher");
    await expect(switcher.locator("option")).toHaveCount(2);
    await switcher.selectOption({ label: "Automation fixture" });
    await expect(
      page.getByRole("heading", { name: "Automation fixture", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Test Cases", exact: true }).click();
    await expect(
      page.getByText(
        "A wrong password is rejected without creating a session",
        { exact: true },
      ),
    ).toHaveCount(0);
  });
});
