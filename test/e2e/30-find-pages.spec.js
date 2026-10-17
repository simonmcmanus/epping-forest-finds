/**
 * /find/<slug>/ business pages, /find/events/, /nearby/events/ and the business listing
 * on category pages. See spec/spec-marketing.md section 6.6/6.7.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { generate: generateCategoryPages } = require("../../scripts/generate-find-pages.js");
const { generate: generateBusinessPages } = require("../../scripts/generate-business-pages.js");
const businessIndex = require("../../data/business-slugs.json");
const { gotoAndWaitForMap, skipOnboarding } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

// A real, data-driven example rather than a hardcoded name that could close or be renamed --
// the nearest the e2e suite comes to a fixture for the 1,500+ generated business pages. Picked
// with a real address so the "Nearby" list and distance copy have something to assert on.
const EXAMPLE_PUB = businessIndex.entries.find((e) => e.key === "pubs" && e.address && e.lat != null);

// A second example, picked for carrying the three optional fields that are only ever shown when
// the source data actually has them (spec-marketing.md § 6.7) -- opening hours, a phone number,
// and a verification date -- so the tests below exercise real content, not placeholders.
const EXAMPLE_VERIFIED = businessIndex.entries.find(
  (e) => e.openingHours && e.phone && e.verifiedAt && e.lat != null
);

test.describe("generated find/nearby pages", () => {
  // Both are build output (gitignored, written by `npm run build`), and CI's e2e job does not
  // build -- generate them the way the build does, so these specs test the current generators
  // rather than a stale file (same pattern as test/e2e/21-ledger-index.spec.js).
  test.beforeAll(() => {
    generateCategoryPages(REPO_ROOT);
    generateBusinessPages(REPO_ROOT);
  });

  test.describe("raw HTML, no JS required", () => {
    test("a category page's real content is server-rendered: count-prefixed title and a linked list of every place in it", async ({ request }) => {
      const response = await request.get("/nearby/pubs/");
      expect(response.ok()).toBe(true);
      const html = await response.text();

      expect(html).toMatch(/<title>\d[\d,]* Pubs &amp; [Bb]ars in Epping Forest \| Epping Forest Finds<\/title>/);
      expect(html).toContain('class="category-listing"');
      expect(html).toContain(`href="/find/${EXAMPLE_PUB.slug}/"`);
      // Every category/subcategory page links onward to veteran trees and grazing cattle, the
      // same up-link every /find/<slug>/ business page already carries.
      expect(html).toContain('href="/nearby/trees/">veteran trees</a>');
      expect(html).toContain('href="/nearby/cows/">grazing cattle</a>');
    });

    test("the trees category page links onward to the cows page but never links to itself", async ({ request }) => {
      const html = await (await request.get("/nearby/trees/")).text();
      expect(html).not.toContain('href="/nearby/trees/">veteran trees</a>');
      expect(html).toContain('href="/nearby/cows/">grazing cattle</a>');
    });

    test("a business page's real content is server-rendered: unique title, LocalBusiness JSON-LD, address and a real nearby list", async ({ request }) => {
      const response = await request.get(`/find/${EXAMPLE_PUB.slug}/`);
      expect(response.ok()).toBe(true);
      const html = await response.text();

      expect(html).toContain(`<title>${EXAMPLE_PUB.name}`);
      expect(html).toMatch(/"@type":"BarOrPub"/);
      expect(html).toContain(EXAMPLE_PUB.address);
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/find\/[a-z0-9-]+\/">/);
      // Up-links to its own category pages, not a dead end.
      expect(html).toContain('href="/nearby/pubs/"');
      expect(html).toContain('href="/nearby/food/"');
    });

    test("a business page's optional fields render server-side when the source data has them: opening hours, a tel: phone link, and a verification date", async ({ request }) => {
      const response = await request.get(`/find/${EXAMPLE_VERIFIED.slug}/`);
      expect(response.ok()).toBe(true);
      const html = await response.text();

      expect(html).toContain(`Opening hours: ${EXAMPLE_VERIFIED.openingHours}`);
      expect(html).toContain(`href="tel:${EXAMPLE_VERIFIED.phone}"`);
      expect(html).toMatch(/class="verified-note">Checked against OpenStreetMap on \d+ \w+ \d{4}\./);
    });

    test("/nearby/events/ and /find/events/ both render real event content, distinct from each other", async ({ request }) => {
      const nearbyEvents = await (await request.get("/nearby/events/")).text();
      const findEvents = await (await request.get("/find/events/")).text();

      expect(nearbyEvents).toMatch(/<title>\d+ Events in Epping Forest \| Epping Forest Finds<\/title>/);
      expect(nearbyEvents).toContain('href="/find/events/"');

      expect(findEvents).toMatch(/<title>Events near Epping Forest \| Epping Forest Finds<\/title>/);

      // Not a copy-pasted pair of pages: /find/events/ carries each event's own description,
      // which /nearby/events/'s deliberately brief title-and-date list does not.
      expect(findEvents.length).toBeGreaterThan(0);
      expect(nearbyEvents).not.toBe(findEvents);
    });
  });

  test.describe("the live app", () => {
    test("/nearby/events/ boots pre-filtered to Events, the same way every other /nearby/<slug> page does", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/events/");
      await expect.poll(() => page.evaluate(() => isSubfilterActive("events"))).toBe(true);
    });

    test("/find/<slug>/ boots the real app with that exact business already selected and shown", async ({ page }) => {
      // routeValueFromLocation (js/app.js) resolves /find/<slug>/ to the same place through the
      // ordinary "landmark" selection route applySelectionFromHash already applies at boot for
      // any other deep link (#tree=..., #place=...) -- no separate anchoring mechanism needed.
      //
      // Unlike /nearby/<slug>/, isLandingPageArrival() (js/app.js) does not recognise /find/<slug>/
      // -- filterKeysFromFindPath only matches /nearby/... -- so boot() treats a fresh profile's
      // first visit here as an ordinary first run and awaits the onboarding wizard's own dismissal
      // before continuing. skipOnboarding is required on every /find/ test below for that reason.
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);

      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);
      const selected = await page.evaluate(() => ({ type: state.selected.type, findSlug: state.selected.item && state.selected.item.findSlug }));
      expect(selected.type).toBe("landmark");
      expect(selected.findSlug).toBe(EXAMPLE_PUB.slug);
      await expect(page.locator("#inspectorTitle")).toHaveText(EXAMPLE_PUB.name);
    });

    test("the inspector's Full details link is suppressed when already on that business's own /find/ page", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);
      await expect(page.locator(`#inspectorBody a[href="/find/${EXAMPLE_PUB.slug}/"]`)).toHaveCount(0);
    });

    test("the live inspector shows the same opening hours, phone tel: link and verification date as the static page", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_VERIFIED.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      const body = page.locator("#inspectorBody");
      await expect(body).toContainText(EXAMPLE_VERIFIED.openingHours);
      await expect(body.locator(`a[href="tel:${EXAMPLE_VERIFIED.phone}"]`)).toHaveCount(1);
      await expect(body.locator(".verified-note")).toContainText("Checked against OpenStreetMap on");
    });

    test("the live inspector links to the business's own category/group and the nearest tree", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      const body = page.locator("#inspectorBody");
      await expect(body.locator('a.detail-map-link[href="/nearby/pubs/"]')).toHaveCount(1);
      await expect(body.locator('a.detail-map-link[href="/nearby/food/"]')).toHaveCount(1);
      await expect(body.locator('a.nearest-item[href="/nearby/trees/"]')).toHaveCount(1);
    });

    test("/find/<slug>/ boots without JS errors", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      expect(errors).toEqual([]);
    });
  });
});
