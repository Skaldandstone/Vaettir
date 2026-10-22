import assert from "node:assert/strict";
import path from "node:path";

export async function checkPublication(page, output) {
  for (const theme of ["dark", "light"]) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    const review = page.getByRole("button", { name: "Review publication", exact: true });
    await review.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Publish local access rules?" });
    await dialog.waitFor();
    await page.screenshot({ path: path.join(output, `review-${theme}.png`), fullPage: true });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    }
    await page.keyboard.press("Escape");
    assert.equal(await review.isEnabled(), true);
    await page.evaluate(() => localStorage.setItem("fail-publish", "before"));
    await review.click(); await page.getByRole("button", { name: "Publish local rules", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
    assert.equal(await review.isDisabled(), true);
    await page.evaluate(() => localStorage.removeItem("fail-publish"));
    await page.getByRole("button", { name: "Reload saved version", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reload", exact: true }).click();
    assert.equal(await review.isEnabled(), true);
    // A committed but unacknowledged publication must not be replayed blindly.
    await page.evaluate(() => localStorage.setItem("fail-publish", "after"));
    await review.click(); await page.getByRole("button", { name: "Publish local rules", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
    assert.equal(await review.isDisabled(), true);
    await page.evaluate(() => localStorage.removeItem("fail-publish"));
    await page.getByRole("button", { name: "Reload saved version", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reload", exact: true }).click();
    await page.getByText("Published v1", { exact: true }).waitFor();
    assert.equal(await review.isDisabled(), true);
    await page.reload(); await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.getByText("Published v1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit Test author", exact: true }).click();
    await page.getByRole("checkbox", { name: "Edit cases", exact: true }).uncheck();
    await page.getByRole("button", { name: "Apply to draft", exact: true }).click();
    assert.equal(await review.isDisabled(), true);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
    assert.equal(await review.isEnabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await review.click();
    await dialog.waitFor();
    await page.screenshot({ path: path.join(output, `review-narrow-${theme}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Publish local rules", exact: true }).click();
    await page.getByText("Published v2", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `published-narrow-${theme}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, `published-${theme}.png`), fullPage: true });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("identity-fixture")));
    assert.equal(saved.publication.revision, 2);
    assert.equal(saved.configuration.roles[0].permissions.includes("cases.write"), false);
    await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem("identity-fixture")); saved.publication.available = false; localStorage.setItem("identity-fixture", JSON.stringify(saved)); });
    await page.reload(); assert.equal(await review.count(), 0);
  }
}
