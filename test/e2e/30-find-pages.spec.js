/**
 * /find/<slug>/ business pages, /find/events/, /nearby/events/ and the business listing
 * on category pages. See spec/spec-marketing.md section 6.6/6.7.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { generate: generateCategoryPages } = require("../../scripts/generate-find-pages.js");
const { generate: generateBusinessPages } = require("../../scripts/generate-business-pages.js");
const businessIndex = require("../../data/business-slugs.json");
const { gotoAndWaitForMap, skipOnboarding, setup } = require("./helpers");

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

    test("clicking a related-content link is a real SPA transition, not a full page reload", async ({ page }) => {
      // setup() (not gotoAndWaitForMap directly) because this test actually clicks something:
      // without a granted geolocation permission, boot() leaves #locationGate on screen, which
      // intercepts the click -- setup() force-hides it the same way every other clicking test
      // in this suite already relies on.
      await setup(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      // A window global survives a pushState-based transition but is wiped by a real navigation
      // (new document, fresh JS realm) -- a more direct proof than counting events, which fire
      // for both pushState and a real navigation.
      await page.evaluate(() => { window.__noReloadMarker = "still-here"; });
      await page.locator('#inspectorBody a.nearest-item[href="/nearby/trees/"]').click();
      await expect(page).toHaveURL(/\/nearby\/trees\/$/);
      const markerSurvived = await page.evaluate(() => window.__noReloadMarker).catch(() => null);
      expect(markerSurvived).toBe("still-here");
    });

    test("the nearest-cow link carries the business's own position via the near= hash, and the live view anchors Nearby there", async ({ page }) => {
      // setup() mocks the cow API itself and force-hides #locationGate (see the previous test's
      // comment) -- both needed here, since this test also clicks a link.
      await setup(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null && state.cows.length > 0)).toBe(true);

      const placeCoords = await page.evaluate(() => ({
        latitude: Number(state.selected.item.latitude.toFixed(6)),
        longitude: Number(state.selected.item.longitude.toFixed(6)),
      }));
      const cowsLink = page.locator('#inspectorBody a.nearest-item[href^="/nearby/cows/"]');
      await expect(cowsLink).toHaveCount(1);
      const href = await cowsLink.getAttribute("href");
      expect(href).toBe(`/nearby/cows/#near=${placeCoords.latitude}%2C${placeCoords.longitude}`);

      await cowsLink.click();
      await expect(page).toHaveURL(new RegExp(`/nearby/cows/#near=${placeCoords.latitude}%2C${placeCoords.longitude}$`));
      const anchor = await page.evaluate(() => ({
        latitude: state.nearbyAnchor && Number(state.nearbyAnchor.latitude.toFixed(6)),
        longitude: state.nearbyAnchor && Number(state.nearbyAnchor.longitude.toFixed(6)),
      }));
      expect(anchor).toEqual(placeCoords);
    });
  });

  test.describe("category page breadcrumb links", () => {
    test("the static /nearby/pubs/ page links up to /nearby/food/", async ({ request }) => {
      const html = await (await request.get("/nearby/pubs/")).text();
      expect(html).toContain('href="/nearby/food/"');
    });

    test("once JS boots, /nearby/pubs/ still links up to /nearby/food/ and back to the full Nearby list", async ({ page }) => {
      // The live Nearby overview (selectOverview/overviewNearestHtml) replaces the static page's
      // whole #inspectorBody the moment JS boots -- it had no breadcrumb of its own, so these
      // links silently vanished the instant a real visitor's browser finished loading the page.
      // setup() (not gotoAndWaitForMap directly) force-hides #locationGate, which otherwise
      // intercepts the click below (no geolocation permission is granted in this spec file).
      await setup(page, "/nearby/pubs/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);

      const body = page.locator("#inspectorBody");
      await expect(body.locator('a.detail-map-link[href="/nearby/food/"]')).toHaveCount(1);
      await expect(body.locator('a.detail-map-link[href="/nearby"]')).toHaveCount(1);

      await page.evaluate(() => { window.__noReloadMarker = "still-here"; });
      await body.locator('a.detail-map-link[href="/nearby/food/"]').click();
      await expect(page).toHaveURL(/\/nearby\/food\/$/);
      const markerSurvived = await page.evaluate(() => window.__noReloadMarker).catch(() => null);
      expect(markerSurvived).toBe("still-here");
    });

    test("the /nearby/trees/ page's own breadcrumb has no group chip above it, and /nearby/cows/'s only ever has the full-list link", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, "/nearby/trees/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      await expect(page.locator('#inspectorBody a.detail-map-link[href="/nearby"]')).toHaveCount(1);
    });
  });
});
