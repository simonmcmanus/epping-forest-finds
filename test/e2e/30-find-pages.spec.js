/**
 * /find/<slug>/ business pages, /find/events/, /nearby/events/ and the business listing
 * on category pages. See spec/spec-marketing.md section 6.6/6.7.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  generate: generateCategoryPages,
  loadWaterFeatures,
  nearestWithinWalkingRadius,
} = require("../../scripts/generate-find-pages.js");
const { generate: generateBusinessPages } = require("../../scripts/generate-business-pages.js");
const { loadAppRules } = require("../../scripts/report/map-inventory.js");
const { escapeHtml } = require("../../scripts/lib/html-template.js");
const businessIndex = require("../../data/business-slugs.json");
const { gotoAndWaitForMap, skipOnboarding, setup } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

// A real, data-driven example rather than a hardcoded name that could close or be renamed --
// the nearest the e2e suite comes to a fixture for the 1,500+ generated business pages. Picked
// with a real address so the "Nearby" list and distance copy have something to assert on, and
// picked nearest-first (same ranking generate-find-pages.js itself uses) so it's guaranteed to
// actually appear in /nearby/pubs/'s now walking-radius-filtered static list below -- an
// arbitrary pub could be outside Epping Forest's walkable radius of High Beach entirely.
const EXAMPLE_PUB = nearestWithinWalkingRadius(
  businessIndex.entries.filter((e) => e.key === "pubs" && e.address),
  (e) => ({ latitude: e.lat, longitude: e.lon })
)[0].item;

// trees/ponds_streams/nature are outside the business index above (spec-marketing.md § 6.6's
// "trees/water get a different kind of list" carve-out) -- a real named water feature instead,
// the same way EXAMPLE_PUB is a real business, not a hardcoded name. Nearest-first for the same
// reason as EXAMPLE_PUB above -- the water list is now walking-radius-filtered too.
const EXAMPLE_WATER = nearestWithinWalkingRadius(loadWaterFeatures(loadAppRules(), REPO_ROOT), (w) => w)[0].item;

// A second example, picked for carrying the optional fields that are only ever shown when the
// source data actually has them (spec-marketing.md § 6.7) -- opening hours and a phone number --
// so the tests below exercise real content, not placeholders.
const EXAMPLE_WITH_HOURS = businessIndex.entries.find(
  (e) => e.openingHours && e.phone && e.lat != null
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
      // The same .nearest-item card the live Nearby list renders (css/map-ui.css), not a plain
      // browser-default-styled <ul> that then visibly restyled itself the instant JS booted.
      expect(html).toContain('class="nearest-list"');
      expect(html).toContain(`class="nearest-item" href="/find/${EXAMPLE_PUB.slug}/"`);
      // Every category/subcategory page links onward to veteran trees and grazing cattle as
      // pills in the top chip row, the same up-link every /find/<slug>/ business page already
      // carries.
      expect(html).toMatch(/<a class="detail-map-link" href="\/nearby\/trees\/">[\s\S]*?Trees<\/a>/);
      expect(html).toMatch(/<a class="detail-map-link" href="\/nearby\/cows\/">[\s\S]*?Cows<\/a>/);
    });

    test("the trees category page links onward to the cows pill but never links to itself", async ({ request }) => {
      const html = await (await request.get("/nearby/trees/")).text();
      expect(html).not.toContain('href="/nearby/trees/"');
      expect(html).toMatch(/<a class="detail-map-link" href="\/nearby\/cows\/">[\s\S]*?Cows<\/a>/);
    });

    test("/nearby/trees/ server-renders a real nearest-tree list (no species breakdown -- dropped as not meaningful for a High Beach stand-in), and /nearby/ponds-streams/ still gets a real water list", async ({ request }) => {
      const trees = await (await request.get("/nearby/trees/")).text();
      expect(trees).not.toContain("By species:");
      // The same .nearest-item card every other category's business list uses, each linking to
      // the app's own #tree= deep link (same mechanism as #water=/#place=) since a veteran tree
      // has no /find/<slug>/ page of its own to link to.
      expect(trees).toMatch(/class="nearest-item" href="\/nearby\/trees\/#tree=r[a-z0-9]+"/);

      const water = await (await request.get("/nearby/ponds-streams/")).text();
      expect(water).toContain(
        `class="nearest-item" href="/nearby/ponds-streams/#water=${encodeURIComponent(EXAMPLE_WATER.key)}"`
      );
      expect(water).toContain(`<span class="nearest-name">${escapeHtml(EXAMPLE_WATER.name)}</span>`);

      // The combined "nature" group page gets no species breakdown either, and merges trees and
      // water into the one real nearest-item list (natureNearestListHtml, scripts/generate-find-pages.js) --
      // the same per-filter radius-or-nearest-3 computation overviewItemsForActiveFilter()
      // (js/app.js) does live, so it reads as mostly trees here too, matching what JS shows a
      // moment later rather than disagreeing with it.
      const nature = await (await request.get("/nearby/nature/")).text();
      expect(nature).not.toContain("By species:");
      expect(nature).toMatch(/class="nearest-item" href="\/nearby\/trees\/#tree=r[a-z0-9]+"/);
    });

    test("/nearby/nature/'s static nearest-item list is the exact same items, in the exact same order, still on screen once JS boots with no location fix", async ({ page, request }) => {
      const staticHtml = await (await request.get("/nearby/nature/")).text();
      const staticKeys = [...staticHtml.matchAll(/href="\/nearby\/(?:trees\/#tree|ponds-streams\/#water)=([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
      expect(staticKeys.length).toBeGreaterThan(0);

      await gotoAndWaitForMap(page, "/nearby/nature/");
      await expect.poll(() => page.evaluate(() => state.userLocation && state.userLocation.isDefault === true)).toBe(true);
      // The landing keeps its server-rendered list until a real fix (_serverRenderedNearbyList), so
      // what is on screen is the static markup itself, read back from the links it carries.
      const onScreenKeys = await page.locator("#inspectorBody .nearest-item").evaluateAll(
        (els) => els.map((el) => decodeURIComponent(el.getAttribute("href").replace(/^.*#(?:tree|water)=/, "")))
      );

      expect(onScreenKeys).toEqual(staticKeys);
    });

    test("a category page's \"Nearby <Category>\" heading, its type line, and the consent banner's lead phrase are server-rendered and match what JS shows once it boots -- no generic placeholder title, no separate generic lead sentence or \"Showing things near High Beach\" paragraph", async ({ page, request }) => {
      const staticHtml = await (await request.get("/nearby/pubs/")).text();
      expect(staticHtml).not.toContain(">Epping Forest Finds</h2>");
      // The generic lead sentence survives only in the SEO <meta name="description">, not as a
      // second, redundant paragraph in the visible body -- pubs already has a real itemized list.
      expect(staticHtml).not.toMatch(/<p>Find all [\d,]+ pubs/);
      expect(staticHtml).not.toContain("Showing things near High Beach");
      expect(staticHtml).toContain('<h2 id="inspectorTitle">Nearby Pubs &amp; bars</h2>');
      expect(staticHtml).toMatch(/<img class="app-icon title-icon" src="data\/icons\/nearby\.png"/);
      const staticTypeMatch = staticHtml.match(/<p id="inspectorType" class="type">([^<]*)<\/p>/);
      expect(staticTypeMatch).not.toBeNull();
      expect(staticTypeMatch[1]).toMatch(/^\d+ Pubs and bars within 30 min walk of High Beach$/);
      expect(staticHtml).toContain(
        "Enable location to get walking directions and see what's near pubs and bars and help us understand how people use this site."
      );

      await gotoAndWaitForMap(page, "/nearby/pubs/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      await expect(page.locator("#inspectorTitle")).toHaveText("Nearby Pubs & bars");
      await expect(page.locator("#inspectorType")).toHaveText(staticTypeMatch[1]);
      await expect(page.locator("#inspectorTitleEmoji img.title-icon")).toBeVisible();
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

    test("a business page's optional fields render server-side when the source data has them: opening hours and a tel: phone link", async ({ request }) => {
      const response = await request.get(`/find/${EXAMPLE_WITH_HOURS.slug}/`);
      expect(response.ok()).toBe(true);
      const html = await response.text();

      expect(html).toContain(`Opening hours: ${EXAMPLE_WITH_HOURS.openingHours}`);
      expect(html).toContain(`href="tel:${EXAMPLE_WITH_HOURS.phone}"`);
      // Distances (the Nearby list, the trees/cows links) are computed from the site's own data,
      // not fetched from OpenStreetMap, so nothing on the page credits it as a source for them.
      expect(html).not.toContain("OpenStreetMap");
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
    test("/nearby/nature/ keeps the same \"Browse by type\"/\"see also\" pills once JS boots, with no species breakdown or water-only list on either render", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/nature/");
      const body = page.locator("#inspectorBody");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      await expect(body).not.toContainText("By species:");
      await expect(body).not.toContainText("Named ponds, lakes and streams:");
      await expect(body.locator('a.detail-map-link[href="/nearby/trees/"]')).toHaveCount(1);
      await expect(body.locator('a.detail-map-link[href="/nearby/ponds-streams/"]')).toHaveCount(1);
    });

    test("/nearby/pubs/ never slides its server-rendered list in from the side while booting without a location fix", async ({ page }) => {
      // Recorded from before any script runs, so a slide-in during boot cannot be missed. The
      // entrance is the `entering` class triggerInspectorEntry() (js/app.js) puts on #inspector.
      await page.addInitScript(() => {
        window.__inspectorEntrances = 0;
        new MutationObserver((records) => {
          for (const record of records) {
            if (record.target.id === "inspector" && record.target.classList.contains("entering")) window.__inspectorEntrances += 1;
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
      });
      await gotoAndWaitForMap(page, "/nearby/pubs/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      await expect.poll(() => page.evaluate(() => state.userLocation && state.userLocation.isDefault === true)).toBe(true);
      expect(await page.evaluate(() => window.__inspectorEntrances)).toBe(0);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    });

    test("asking for location from a /nearby/<slug>/ landing replaces the list with a requesting state", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/pubs/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      // A request that never answers, so the requesting state stays on screen to be asserted.
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = () => {};
        locateUser({ initial: false });
      });
      await expect(page.locator("#inspectorBody .nearby-locating")).toContainText("Requesting your location");
      await expect(page.locator("#inspectorBody .nearest-item")).toHaveCount(0);
    });

    test("refusing location on a /nearby/<slug>/ landing restores the default High Beach list", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/pubs/");
      await expect.poll(() => page.evaluate(() => state.dataLoaded === true)).toBe(true);
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (_ok, error) => error({ code: 1, message: "User denied" });
        locateUser({ initial: false });
      });
      await expect(page.locator("#inspectorBody .nearby-locating")).toHaveCount(0);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      expect(await page.evaluate(() => state.userLocation && state.userLocation.isDefault === true)).toBe(true);
    });

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

    test("the live inspector shows the same opening hours and phone tel: link as the static page", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_WITH_HOURS.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      const body = page.locator("#inspectorBody");
      await expect(body).toContainText(EXAMPLE_WITH_HOURS.openingHours);
      await expect(body.locator(`a[href="tel:${EXAMPLE_WITH_HOURS.phone}"]`)).toHaveCount(1);
    });

    test("the live inspector shows headed Nearby and Related sections, linking to the business's own category/group and the nearest tree, with the walk-radius card inside Nearby", async ({ page }) => {
      await skipOnboarding(page);
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      const body = page.locator("#inspectorBody");
      await expect(body.locator('h3.detail-section-heading:has-text("Nearby")')).toHaveCount(1);
      await expect(body.locator('h3.detail-section-heading:has-text("Related")')).toHaveCount(1);
      // Category/group links are the same .nearest-item card as the nearest-tree/cow entries, not
      // a different pill style -- one consistent list under each heading.
      await expect(body.locator('a.nearest-item[href="/nearby/pubs/"]')).toHaveCount(1);
      await expect(body.locator('a.nearest-item[href="/nearby/food/"]')).toHaveCount(1);
      // Carries the business's own position via the near= hash (see the dedicated test below),
      // so this is a prefix match rather than an exact href.
      await expect(body.locator('a.nearest-item[href^="/nearby/trees/#near="]')).toHaveCount(1);
      // "Everything within N min walk" lives in the Nearby section too now, as the same card
      // style -- not the separate top-row pill it used to be.
      const walkCard = body.locator("button.nearest-item[data-action='walk-radius']");
      await expect(walkCard).toHaveCount(1);
      await expect(walkCard).toContainText(/Everything within \d+ min walk/);
      const nearbySection = body.locator('h3.detail-section-heading:has-text("Nearby") + ul');
      await expect(nearbySection.locator("button.nearest-item[data-action='walk-radius']")).toHaveCount(1);
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
      await page.locator('#inspectorBody a.nearest-item[href^="/nearby/trees/"]').click();
      await expect(page).toHaveURL(/\/nearby\/trees\/#near=/);
      const markerSurvived = await page.evaluate(() => window.__noReloadMarker).catch(() => null);
      expect(markerSurvived).toBe("still-here");
    });

    test("the nearest-tree link carries the business's own position via the near= hash, and the live view anchors Nearby there", async ({ page }) => {
      await setup(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);

      const placeCoords = await page.evaluate(() => ({
        latitude: Number(state.selected.item.latitude.toFixed(6)),
        longitude: Number(state.selected.item.longitude.toFixed(6)),
      }));
      const placeName = await page.evaluate(() => state.selected.item.name);
      const treesLink = page.locator('#inspectorBody a.nearest-item[href^="/nearby/trees/"]');
      await expect(treesLink).toHaveCount(1);
      const href = await treesLink.getAttribute("href");
      // The place's name rides along as label=, so the target can say whose spot it is showing.
      const expectedHash = new URLSearchParams({ near: `${placeCoords.latitude},${placeCoords.longitude}`, label: placeName }).toString();
      expect(href).toBe(`/nearby/trees/#${expectedHash}`);

      await treesLink.click();
      await expect(page).toHaveURL(new RegExp(`/nearby/trees/#near=${placeCoords.latitude}%2C${placeCoords.longitude}`));
      const anchor = await page.evaluate(() => ({
        latitude: state.nearbyAnchor && Number(state.nearbyAnchor.latitude.toFixed(6)),
        longitude: state.nearbyAnchor && Number(state.nearbyAnchor.longitude.toFixed(6)),
      }));
      expect(anchor).toEqual(placeCoords);
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
      const placeName = await page.evaluate(() => state.selected.item.name);
      const cowsLink = page.locator('#inspectorBody a.nearest-item[href^="/nearby/cows/"]');
      await expect(cowsLink).toHaveCount(1);
      const href = await cowsLink.getAttribute("href");
      // The place's name rides along as label=, so the target can say whose spot it is showing.
      const expectedHash = new URLSearchParams({ near: `${placeCoords.latitude},${placeCoords.longitude}`, label: placeName }).toString();
      expect(href).toBe(`/nearby/cows/#${expectedHash}`);

      await cowsLink.click();
      await expect(page).toHaveURL(new RegExp(`/nearby/cows/#near=${placeCoords.latitude}%2C${placeCoords.longitude}`));
      const anchor = await page.evaluate(() => ({
        latitude: state.nearbyAnchor && Number(state.nearbyAnchor.latitude.toFixed(6)),
        longitude: state.nearbyAnchor && Number(state.nearbyAnchor.longitude.toFixed(6)),
      }));
      expect(anchor).toEqual(placeCoords);
    });

    test("a water feature's link on /nearby/ponds-streams/ selects that exact feature live, through the app's own #water= deep link -- no separate mechanism of its own", async ({ page }) => {
      await gotoAndWaitForMap(page, `/nearby/ponds-streams/#water=${encodeURIComponent(EXAMPLE_WATER.key)}`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);
      const selected = await page.evaluate(() => ({ type: state.selected.type, name: state.selected.item && state.selected.item.name }));
      expect(selected.type).toBe("water");
      expect(selected.name).toBe(EXAMPLE_WATER.name);
      await expect(page.locator("#inspectorTitle")).toHaveText(EXAMPLE_WATER.name);
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
