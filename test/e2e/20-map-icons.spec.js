// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

// Every marker on the map is one pin family: the white pointer, with the
// place's artwork inside its head. Memorials and plaques used to miss every
// icon rule and get painted as a bare emoji glyph straight onto the map --
// no pointer, different weight, visibly not the same product.
test.describe("Map pins", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("a memorial draws the memorial artwork rather than a candle glyph", async ({ page }) => {
    const resolved = await page.evaluate(() => {
      const memorial = state.landmarks.find((place) => place.category === "memorial");
      if (!memorial) return null;
      // placeIconSlug, not landmarkIconSlug: the filter buckets get a say
      // first, and the "monuments and memorials" bucket was quietly handing
      // all 49 war memorials the standing-stone monument pin instead.
      const slug = placeIconSlug(memorial);
      return { name: memorial.name, slug, path: iconPath(slug) };
    });

    expect(resolved, "the dataset should carry memorials").not.toBeNull();
    expect(resolved.slug).toBe("landmark-memorial");
    expect(resolved.path).toContain("landmark-memorial.png");
  });

  test("a blue plaque draws a plaque, not whatever topic it is also tagged with", async ({ page }) => {
    const resolved = await page.evaluate(() => {
      const plaque = state.landmarks.find((place) => place.folkloreCategory === "plaque");
      if (!plaque) return null;
      const key = placePrimaryFilterKey(plaque);
      return { name: plaque.name, key, slug: filterKindIconSlug(key) };
    });

    expect(resolved, "the dataset should carry plaques").not.toBeNull();
    expect(resolved.key).toBe("blue_plaques");
    expect(resolved.slug).toBe("blue-plaques");
  });

  test("a dig keeps its own artwork rather than the broad historic bucket's", async ({ page }) => {
    const resolved = await page.evaluate(() => {
      const dig = state.landmarks.find((place) => place.category === "archaeological_site");
      if (!dig) return null;
      return { name: dig.name, slug: placeIconSlug(dig), inHistoric: matchesPlaceFilter(dig, "historic") };
    });

    expect(resolved, "the dataset should carry archaeological sites").not.toBeNull();
    expect(resolved.slug).toBe("landmark-archaeological");
    expect(resolved.inHistoric, "it is still a historic site for the filter chip").toBe(true);
  });

  test("no place the map draws is left without artwork of its own", async ({ page }) => {
    // placeIconSlug() is the same resolver the renderer and
    // `npm run audit:icons` use; this holds the line in the browser.
    const fallbacks = await page.evaluate(() => {
      const counts = {};
      for (const place of state.landmarks) {
        if (isPubCategory(place) || isCafeCategory(place) || isShopCategory(place)) continue;
        if (isTransportCategory(place)) continue;
        if (placeIconSlug(place)) continue;
        const category = place.category || place.folkloreCategory || "(none)";
        counts[category] = (counts[category] || 0) + 1;
      }
      return counts;
    });

    // `building=yes` carries no type at all, so there is nothing to draw for
    // it but the pointer and a plain dot. Everything else must have artwork.
    expect(Object.keys(fallbacks).filter((category) => category !== "yes")).toEqual([]);
  });

  test("a place with no artwork still gets the pointer the rest of the pins have", async ({ page }) => {
    const drawn = await page.evaluate(() => {
      const calls = [];
      const ctx = {
        save() {}, restore() {}, beginPath() { calls.push("beginPath"); },
        arc() { calls.push("arc"); }, lineTo() { calls.push("lineTo"); },
        closePath() { calls.push("closePath"); },
        fill() { calls.push(`fill:${this.fillStyle}`); },
        stroke() { calls.push(`stroke:${this.strokeStyle}`); },
        fillText() { calls.push("fillText"); },
        fillStyle: null, strokeStyle: null, lineWidth: 0, font: "", textAlign: "", textBaseline: "",
      };
      drawEmojiMapPin(ctx, "\u{1F6B2}", 200, 200, 35);
      return calls;
    });

    // The head, the wedge down to the point, the white fill and its outline.
    expect(drawn).toContain("arc");
    expect(drawn).toContain("lineTo");
    expect(drawn).toContain("fill:white");
    expect(drawn).toContain("stroke:rgba(0,0,0,0.25)");
    expect(drawn).toContain("fillText");
  });

  test("the history and location filter chips all match real places", async ({ page }) => {
    // These four switched on a vocabulary matchesPlaceFilter did not handle,
    // so they matched nothing: the chips hid every place they were meant to
    // show, and the icons behind them could never be reached.
    const matches = await page.evaluate(() => {
      const keys = ["historic", "plaques", "monuments", "churches", "campsites"];
      return Object.fromEntries(keys.map((key) => [
        key,
        state.landmarks.filter((place) => matchesPlaceFilter(place, key)).length,
      ]));
    });

    for (const [key, count] of Object.entries(matches)) {
      expect(count, `the ${key} filter should match something`).toBeGreaterThan(0);
    }
  });
});
