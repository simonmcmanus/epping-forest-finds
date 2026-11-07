// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

// The fixture oak (FIXTURE_TREE, tag 11383) sits at 51.6437884, 0.0236671. A walker 999.6 m due north of it is 999.6 m
// away in a straight line: a distance the app must read as "1 km", never "1000 m".
const TREE = { latitude: 51.6437884, longitude: 0.0236671 };
const METRES_PER_DEGREE_LATITUDE = 111_195;
const NEAR_A_KILOMETRE = { latitude: TREE.latitude + 999.6 / METRES_PER_DEGREE_LATITUDE, longitude: TREE.longitude, accuracy: 10 };

test.use({ geolocation: NEAR_A_KILOMETRE, permissions: ["geolocation"] });

test.describe("Distances read the way a walker would say them", () => {
  test("a tree 999.6 m away in a straight line is listed as 1 km, never as 1000 m", async ({ page }) => {
    await setup(page);
    // The precondition: the walker really is 999.6 m away by the app's own measure, so what follows is about rounding.
    const metres = await page.evaluate(
      ([lat1, lon1, lat2, lon2]) => distanceMetres(lat1, lon1, lat2, lon2),
      [NEAR_A_KILOMETRE.latitude, NEAR_A_KILOMETRE.longitude, TREE.latitude, TREE.longitude]
    );
    expect(metres).toBeGreaterThan(999.5);
    expect(metres).toBeLessThan(999.9);

    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);
    const result = page.locator("#mapSearchResults .nearest-item").first();
    await expect(result).toContainText("1 km");
    await expect(result).not.toContainText("1000 m");
  });
});
