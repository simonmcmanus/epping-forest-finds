// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

const REPORT_URL = "**/api/community/report";
const OVERLAY_URL = "**/api/community/overlay";

test.describe("Community tree verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
  });

  test("a tree's detail screen offers the community checks", async ({ page }) => {
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".community-check")).toContainText("Help check this tree");
    await expect(page.locator("[data-action='community-report']")).toHaveCount(6);
  });

  test("the check block is one box and sits above the Nearest section", async ({ page }) => {
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    const box = page.locator(".community-check");
    await expect(box.locator("[data-action='community-report'][data-status='VERIFIED']")).toBeVisible();
    // "Something not right?" and its choices live inside the same box as the heading and verify action
    await expect(box.locator(".community-or")).toContainText("Something not right?");
    await expect(box.locator(".community-choices")).toBeVisible();
    const boxTop = (await box.boundingBox()).y;
    const nearestTop = (await page.locator('h3.detail-section-heading:has-text("Nearest")').boundingBox()).y;
    expect(boxTop).toBeLessThan(nearestTop);
  });

  test("verifying a tree shows the user's report at once and sends it to the server", async ({ page }) => {
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".community-mine")).toContainText("Other people may take up to a day to see this");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED" });
  });

  test("a report made offline is kept and sent when the connection returns", async ({ page, context }) => {
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await context.setOffline(true);
    await page.click("[data-action='community-report'][data-status='NOT_HERE']");
    await expect(page.locator(".community-mine")).toContainText("No tree found here");
    expect(posted).toHaveLength(0);
    await context.setOffline(false);
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].status).toBe("NOT_HERE");
  });

  test("the Community screen shows a log of the user's own contributions with their state", async ({ page }) => {
    await page.route(REPORT_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    );
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".community-mine")).toBeVisible();
    await page.click("#reportToggle");
    await expect(page.locator("#inspectorTitle").last()).toContainText("Community");
    await expect(page.locator(".community-contributions")).toContainText("Your contributions");
    await expect(page.locator(".community-rank")).toContainText("Seedling");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator(".community-log-item")).toContainText("Verified here");
  });

  test("a reported tree can be changed, which brings the choices back with the current one marked", async ({ page }) => {
    await page.route(REPORT_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    );
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await page.click("[data-action='community-report'][data-status='NOT_HERE']");
    await expect(page.locator("[data-action='community-report']")).toHaveCount(0);
    await page.click("[data-action='community-change']");
    await expect(page.locator("[data-action='community-report']")).toHaveCount(6);
    await expect(page.locator("[data-action='community-report'][data-status='NOT_HERE']")).toHaveClass(/is-chosen/);
  });

  test("a tree the community has questioned is flagged but keeps its official details", async ({ page }) => {
    await page.unroute(OVERLAY_URL);
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generatedAt: 1, entries: { [`tree:${FIXTURE_TREE.recordNumber}`]: { s: "questioned", st: "NOT_HERE", n: 2, t: 1 } } }),
      })
    );
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".community-badge-questioned")).toContainText("Questioned by the community");
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
  });

  test("Settings no longer carries the contributions card", async ({ page }) => {
    await setup(page, "/settings");
    await expect(page.locator(".settings-form")).toBeVisible();
    await expect(page.locator(".community-contributions")).toHaveCount(0);
  });

  test("adding a missing tree is a form: nothing is sent or logged until the user submits it", async ({ page }) => {
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, "/contribute");
    await page.click("[data-action='community-add-start']");
    await expect(page.locator("#communityAddTreeForm")).toBeVisible();
    await expect(page.locator("#communityLocationStatus")).toContainText("Turn on location");
    await expect(page.locator("#communityAddTreeSubmit")).toBeDisabled();
    expect(posted).toHaveLength(0);
    await expect(page.locator(".community-log-item")).toHaveCount(0);
  });
});

test.describe("Community tree verification with location shared", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

  test("a missing tree needs its tag number, then goes off with the user's own accurate position", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, "/contribute");
    await page.click("[data-action='community-add-start']");
    await expect(page.locator("#communityLocationStatus")).toContainText("accurate to");
    await expect(page.locator("#communityAddTreeSubmit")).toBeDisabled();
    await page.fill("#communityTagInput", "T-9001");
    await expect(page.locator("#communityAddTreeSubmit")).toBeEnabled();
    expect(posted).toHaveLength(0);
    await page.click("#communityAddTreeSubmit");
    await expect(page.locator(".community-add-tree .community-mine")).toContainText("Tree T-9001 saved");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ kind: "tree", status: "NEW_TREE", tagNumber: "T-9001" });
    expect(posted[0].lat).toBeCloseTo(51.665, 2);
    expect(posted[0].accuracy).toBeLessThanOrEqual(30);
    await expect(page.locator(".community-log-item")).toContainText("Tree T-9001");
  });

  test("a tag that is already on the map is not added again", async ({ page }) => {
    const posted = [];
    await page.route(REPORT_URL, (route) => { posted.push(1); route.fulfill({ status: 200, body: "{}" }); });
    await setup(page, "/contribute");
    await page.click("[data-action='community-add-start']");
    await page.fill("#communityTagInput", FIXTURE_TREE.tagNumber);
    await page.click("#communityAddTreeSubmit");
    await expect(page.locator("#communityAddTreeStatus")).toContainText("already on the map");
    expect(posted).toHaveLength(0);
  });
});

test.describe("Community place checks", () => {
  const ISSUE_URL = "**/.netlify/functions/report-missing-data";

  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
    await setup(page);
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", "Railway Bell");
    await page.locator("#mapSearchResults .nearest-item").first().click();
    await expect(page.locator(".community-check-place")).toBeVisible();
  });

  test("a place's detail screen has the boxed check at the bottom, below its Nearest and Related sections", async ({ page }) => {
    const box = page.locator(".community-check-place");
    await expect(box).toContainText("Help check this place");
    const nearest = page.locator('h3.detail-section-heading:has-text("Nearest")');
    if (await nearest.count()) {
      expect((await nearest.first().boundingBox()).y).toBeLessThan((await box.boundingBox()).y);
    }
    // nothing but the small "Noticed a problem" link follows it
    await expect(page.locator(".community-check-place ~ *:not(.report-issue)")).toHaveCount(0);
    await expect(box.locator(".community-or")).toContainText("Something not right?");
    await expect(box.locator("[data-action='community-place-choose']")).toHaveCount(6);
  });

  test("reporting a closure is filed as an issue for manual review, with an optional note", async ({ page }) => {
    const issues = [];
    await page.route(ISSUE_URL, async (route) => {
      issues.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issueUrl: "https://github.com/simonmcmanus/epping-forest-finds/issues/42" }) });
    });
    await page.click("[data-action='community-place-choose'][data-status='CLOSED']");
    await expect(page.locator(".community-note-input")).toBeVisible();
    expect(issues).toHaveLength(0);
    await page.fill(".community-note-input", "Shutters down since September");
    await page.click("[data-action='community-send-place']");
    await expect(page.locator(".community-mine")).toContainText("A person will review this");
    await expect.poll(() => issues.length).toBe(1);
    expect(issues[0]).toMatchObject({ reportType: "place-check", placeCheck: { status: "CLOSED" }, details: "Shutters down since September" });
  });

  test("a rename needs a few words before it can be sent", async ({ page }) => {
    const issues = [];
    await page.route(ISSUE_URL, (route) => { issues.push(1); route.fulfill({ status: 200, body: "{}" }); });
    await page.click("[data-action='community-place-choose'][data-status='RENAMED']");
    await page.click("[data-action='community-send-place']");
    await expect(page.locator(".community-status")).toContainText("Please add a few words");
    expect(issues).toHaveLength(0);
  });

  test("confirming a place never opens an issue", async ({ page }) => {
    const issues = [];
    const confirmations = [];
    await page.route(ISSUE_URL, (route) => { issues.push(1); route.fulfill({ status: 200, body: "{}" }); });
    await page.route(REPORT_URL, async (route) => {
      confirmations.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.click("[data-action='community-place-choose'][data-status='OPEN_CONFIRMED']");
    await expect(page.locator(".community-mine")).toContainText("counts towards your score");
    await expect.poll(() => confirmations.length).toBe(1);
    expect(confirmations[0]).toMatchObject({ kind: "place", status: "OPEN_CONFIRMED" });
    expect(issues).toHaveLength(0);
  });
});

test.describe("Community screen layout", () => {
  test("opens with a short summary that links to the full explanation", async ({ page }) => {
    await setup(page, "/contribute");
    const intro = page.locator(".community-intro");
    await expect(intro).toContainText("Help keep the map right");
    const link = intro.locator("a.community-intro-link");
    await expect(link).toHaveAttribute("href", "/community");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("the sheet opens taller than on other screens, leaving less map", async ({ page }) => {
    // The bottom sheet only exists in the phone layout; on desktop the inspector is a side panel.
    test.skip(page.viewportSize().width > 760, "phone layout only");
    await setup(page, "/settings");
    const settingsHeight = (await page.locator("#inspector").boundingBox()).height;
    await page.click("#reportToggle");
    await expect(page.locator(".community-intro")).toBeVisible();
    await expect.poll(async () => (await page.locator("#inspector").boundingBox()).height).toBeGreaterThan(settingsHeight);
  });
});

test.describe("Public community pages", () => {
  test("/community explains how checks work and links to the report and the app", async ({ page }) => {
    await page.goto("/community");
    await expect(page.locator("h1")).toHaveText("How community checks work");
    await expect(page.locator('a[href="/tree-report"]')).toHaveCount(1);
    await expect(page.locator('a[href="/contribute"]')).toHaveCount(1);
  });

  test("/tree-report is a public report with CSV and GeoJSON downloads", async ({ page, request }) => {
    await page.goto("/tree-report");
    await expect(page.locator("h1")).toHaveText("Community-reported tree discrepancies");
    await expect(page.locator("h2", { hasText: "Questioned trees" })).toBeVisible();
    await expect(page.locator('a[href="?format=csv"]')).toBeVisible();
    const csv = await request.get("/tree-report?format=csv");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toMatch(/^section,record_number,tag_number/);
    const geo = await request.get("/tree-report?format=geojson");
    expect((await geo.json()).type).toBe("FeatureCollection");
  });
});
