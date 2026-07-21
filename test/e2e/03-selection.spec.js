// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

test.describe("Selection and Inspector", () => {
  test.describe("tree selected via URL hash", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("inspector title changes to the selected tree name", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });

    test("inspector type line shows tree taxonomy", async ({ page }) => {
      await expect(page.locator("#inspectorType")).toContainText(FIXTURE_TREE.latinName, { timeout: 5_000 });
    });

    test("inspector body shows tree register details", async ({ page }) => {
      // Tag number should appear somewhere in the detail panel
      await expect(page.locator("#inspectorBody")).toContainText(FIXTURE_TREE.tagNumber, { timeout: 5_000 });
    });

    test("URL hash reflects the selected tree", async ({ page }) => {
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
    });

    test("snapshot: tree detail view", async ({ page }) => {
      await page.waitForTimeout(400);
      await expect(page).toHaveScreenshot("tree-detail.png", { fullPage: false });
    });
  });

  test.describe("returning to overview", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("back button returns inspector to overview mode", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
      await page.click("#nearbyToggle");
      await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 5_000 });
    });

    test("URL hash is cleared when returning to overview", async ({ page }) => {
      await page.click("#nearbyToggle");
      // Hash should no longer contain a tree key
      await expect(page).not.toHaveURL(/tree=/);
    });
  });

  test.describe("tree search panel", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page);
    });

    test("tree search toggle reveals the search input", async ({ page }) => {
      await expect(page.locator("#treeSearchPanel")).toBeHidden();
      await page.click("#treeSearchToggle");
      await expect(page.locator("#treeSearchPanel")).toBeVisible({ timeout: 3_000 });
    });

    test("searching by tree number selects the correct tree", async ({ page }) => {
      await page.click("#treeSearchToggle");
      await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
      await page.click("#treeSearchButton");
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });
  });

  test.describe("inspector state when location is selected", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });

    test("filter button is hidden in selected-detail mode", async ({ page }) => {
      await expect(page.locator("#filterToggle")).toBeHidden();
    });

    test("inspector back button is visible in selected-detail mode", async ({ page }) => {
      await expect(page.locator("#inspectorBack")).toBeVisible();
    });
  });
});
