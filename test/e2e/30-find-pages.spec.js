/**
 * /find/<slug>/ business pages, /find/events/, /nearby/events/ and the business listing
 * on category pages. See spec/spec-marketing.md section 6.6/6.7.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { generate: generateCategoryPages } = require("../../scripts/generate-find-pages.js");
const { generate: generateBusinessPages } = require("../../scripts/generate-business-pages.js");
const businessIndex = require("../../data/business-slugs.json");
const { gotoAndWaitForMap } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

// A real, data-driven example rather than a hardcoded name that could close or be renamed --
// the nearest the e2e suite comes to a fixture for the 1,500+ generated business pages. Picked
// with a real address so the "Nearby" list and distance copy have something to assert on.
const EXAMPLE_PUB = businessIndex.entries.find((e) => e.key === "pubs" && e.address && e.lat != null);

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
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);

      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);
      const selected = await page.evaluate(() => ({ type: state.selected.type, findSlug: state.selected.item && state.selected.item.findSlug }));
      expect(selected.type).toBe("landmark");
      expect(selected.findSlug).toBe(EXAMPLE_PUB.slug);
      await expect(page.locator("#inspectorTitle")).toHaveText(EXAMPLE_PUB.name);
    });

    test("the inspector's Full details link is suppressed when already on that business's own /find/ page", async ({ page }) => {
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      await expect.poll(() => page.evaluate(() => state.selected != null)).toBe(true);
      await expect(page.locator(`#inspectorBody a[href="/find/${EXAMPLE_PUB.slug}/"]`)).toHaveCount(0);
    });

    test("/find/<slug>/ boots without JS errors", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
      expect(errors).toEqual([]);
    });
  });
});
