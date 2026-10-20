// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");
const businessIndex = require("../../data/business-slugs.json");
const PLACE = businessIndex.entries.find((e) => e.key === "pubs" && e.lat != null);

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

  test("a cold load of /community never flashes the Nearby list", async ({ page }) => {
    await page.addInitScript(() => {
      window.__sawNearby = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-overview-type]") && !document.querySelector(".community-intro")) window.__sawNearby = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (m) => { if (m.type() === "error" && /initiali[sz]ation/.test(m.text())) errors.push(m.text()); });
    await setup(page, "/community");
    await expect(page.locator(".community-intro")).toBeVisible();
    expect(await page.evaluate(() => window.__sawNearby)).toBe(false);
    expect(errors).toEqual([]);
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
    await expect(page.locator(".community-mine")).toContainText("Other people may take an hour or two to see this");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED" });
  });

  test("verifying a tree bumps the verified count at the top of its page straight away", async ({ page }) => {
    await page.route(REPORT_URL, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".detail-top-row .community-verified-chip")).toHaveCount(0);
    await page.evaluate((rn) => {
      const tree = state.trees.find((t) => String(t.recordNumber ?? t.id) === rn);
      state.userLocation = { latitude: tree.lat ?? tree.latitude, longitude: tree.lon ?? tree.longitude, accuracy: 5, isDefault: false };
    }, FIXTURE_TREE.recordNumber);
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".detail-top-row .community-verified-chip")).toContainText("1");
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
    await setup(page, "/community");
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

  test("a cold load of /community next to a tree does not put the nudge card over the Community screen", async ({ page }) => {
    await page.addInitScript(() => {
      window.__sawNearby = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-overview-type]") && !document.querySelector(".community-intro")) window.__sawNearby = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await setup(page, "/community");
    await expect(page.locator(".community-intro")).toBeVisible();
    await page.waitForFunction(() => state.userLocation && !state.userLocation.isDefault && state.nearestTree);
    await page.waitForTimeout(1800);
    await expect(page.locator("#communityNudge")).toHaveCount(0);
    expect(await page.evaluate(() => window.__sawNearby)).toBe(false);
  });

  test("a missing tree needs its tag number, then goes off with the user's own accurate position", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, "/community");
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

  test("the Community screen highlights what the user has marked on the map, and only there", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ff-community-local-v1", JSON.stringify({
        "tree:900001": { id: "m1", status: "VERIFIED", ts: Date.now(), lat: 51.6663, lon: 0.045 },
        "tree:900002": { id: "m2", status: "NOT_HERE", ts: Date.now(), lat: 51.6637, lon: 0.045 },
        "new:T-1": { id: "m3", status: "NEW_TREE", ts: Date.now(), lat: 51.665, lon: 0.0473, name: "Tree T-1" },
      }));
    });
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {}, reports: [] }) })
    );
    await page.route(REPORT_URL, (route) => route.fulfill({ status: 200, body: "{}" }));
    await setup(page, "/community");
    const legend = page.locator(".community-legend");
    await expect(legend).toContainText("Verified");
    await expect(legend).toContainText("Reported wrong");
    await expect(legend).toContainText("Added by you");
    expect(await page.evaluate(() => communityMapMarks().map((m) => m.kind).sort())).toEqual(["added", "questioned", "verified"]);

    // The verified mark is a green disc on the overlay canvas; sample just beside its tick. Only that
    // mark is drawn for this check, so a neighbour's disc can never sit over the sampled pixel.
    await page.evaluate(() => {
      const verified = communityMapMarks().filter((m) => m.kind === "verified");
      window.communityMapMarks = () => verified;
      requestDraw();
    });
    const sampleVerified = () => page.evaluate(() => {
      const mark = communityMapMarks().find((m) => m.kind === "verified");
      const toScreen = typeof worldToScreenForOverlay === "function" ? worldToScreenForOverlay : worldToScreen;
      const p = toScreen(projectLonLat(mark.lon, mark.lat));
      const dpr = pixelRatio();
      const data = els.overlayCanvas.getContext("2d").getImageData(Math.round(p.x + 7 * dpr), Math.round(p.y), 1, 1).data;
      return { r: data[0], g: data[1], b: data[2], a: data[3] };
    });
    await expect.poll(async () => {
      const c = await sampleVerified();
      return c.a > 200 && c.g > c.r + 30 && c.g > c.b + 30;
    }).toBe(true);

    // ...and it is gone again once the user leaves the Community screen.
    await page.click("#nearbyToggle");
    await expect.poll(async () => (await sampleVerified()).a).toBeLessThan(40);
  });

  test("a tag that is already on the map is not added again", async ({ page }) => {
    const posted = [];
    await page.route(REPORT_URL, (route) => { posted.push(1); route.fulfill({ status: 200, body: "{}" }); });
    await setup(page, "/community");
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
    // nothing but the small "Noticed a problem" link follows it (and the "issues raised on this place"
    // line, which stays hidden unless GitHub reports some)
    await expect(page.locator(".community-check-place ~ *:not(.report-issue):not(.community-place-issues)")).toHaveCount(0);
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

  test("a report the server refuses is shown as not sent, with the reason, and can be sent again", async ({ page }) => {
    let refuse = true;
    const calls = [];
    await page.route(ISSUE_URL, (route) => {
      calls.push(route.request().postDataJSON());
      return refuse
        ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Resource not accessible by personal access token" }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issueNumber: 9, issueUrl: "https://github.com/example/repo/issues/9" }) });
    });
    await page.click("[data-action='community-place-choose'][data-status='CLOSED']");
    await page.fill(".community-note-input", "Shut for good");
    await page.click("[data-action='community-send-place']");
    await expect.poll(() => calls.length).toBe(1);
    await page.click("#reportToggle");
    await expect(page.locator(".community-log-item .community-pill")).toContainText("Couldn't send");
    await expect(page.locator(".community-log-error")).toContainText("Resource not accessible");
    refuse = false;
    await page.click("[data-action='community-retry']");
    await expect(page.locator(".community-log-item .community-pill")).toContainText("Sent for review");
    await expect(page.locator(".community-issue-link")).toHaveAttribute("href", "https://github.com/example/repo/issues/9");
    expect(calls.length).toBe(2);
    expect(calls[0].requestId).toBe(calls[1].requestId);
  });

  test("a rename needs a few words before it can be sent", async ({ page }) => {
    const issues = [];
    await page.route(ISSUE_URL, (route) => { issues.push(1); route.fulfill({ status: 200, body: "{}" }); });
    await page.click("[data-action='community-place-choose'][data-status='RENAMED']");
    await page.click("[data-action='community-send-place']");
    await expect(page.locator(".community-status")).toContainText("Please add a few words");
    expect(issues).toHaveLength(0);
  });

  test("confirming a place earns nothing, sends nothing and hides its check card", async ({ page }) => {
    const sent = [];
    await page.route(ISSUE_URL, (route) => { sent.push("issue"); route.fulfill({ status: 200, body: "{}" }); });
    await page.route(REPORT_URL, (route) => { sent.push("report"); route.fulfill({ status: 200, body: "{}" }); });
    await page.click("[data-action='community-place-choose'][data-status='OPEN_CONFIRMED']");
    await expect(page.locator(".community-check-place")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(sent).toHaveLength(0);
    // and it stays hidden when the place is opened again
    await page.click("#nearbyToggle");
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", "Railway Bell");
    await page.locator("#mapSearchResults .nearest-item").first().click();
    await expect(page.locator("[data-action='report-issue']")).toBeVisible();
    await expect(page.locator(".community-check-place")).toHaveCount(0);
  });
});

test.describe("Community screen map", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 8 }, permissions: ["geolocation"] });

  test("shows only what the user has marked: no ordinary pins are drawn underneath, and they come back on Nearby", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await setup(page);
    const pinCount = () => page.evaluate(() => { const l = activeIconLookup(); return l.tree.size + l.landmark.size + l.cow.size + l.path.size + l.water.size; });
    await expect.poll(pinCount).toBeGreaterThan(0);
    await page.click("#reportToggle");
    await expect(page.locator(".community-contributions")).toBeVisible();
    expect(await pinCount()).toBe(0);
    await page.click("#nearbyToggle");
    await expect.poll(pinCount).toBeGreaterThan(0);
  });
});

test.describe("Community screen layout", () => {
  test("opens with a one-row summary that links out to the full explanation", async ({ page }) => {
    await setup(page, "/community");
    const intro = page.locator("a.community-intro");
    await expect(intro).toContainText("Help keep the map right");
    await expect(intro).toHaveAttribute("href", "/contribute");
    await expect(intro).toHaveAttribute("target", "_blank");
    // minimal space: a single compact row, not a paragraph
    expect((await intro.boundingBox()).height).toBeLessThan(70);
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
  test("/contribute explains how checks work and links to the report and the app", async ({ page }) => {
    await page.goto("/contribute");
    await expect(page.locator("h1")).toHaveText("How community checks work");
    await expect(page.locator('a[href="/reports/tree-report"]').first()).toBeVisible();
    await expect(page.locator('a[href="/community"]').first()).toBeVisible();
  });

  test("/reports/tree-report is a public report with CSV and GeoJSON downloads", async ({ page, request }) => {
    await page.goto("/reports/tree-report");
    await expect(page.locator("h1")).toHaveText("Community-reported tree discrepancies");
    await expect(page.locator("h2", { hasText: "Questioned trees" })).toBeVisible();
    await expect(page.locator('a[href="?format=csv"]')).toBeVisible();
    const csv = await request.get("/reports/tree-report?format=csv");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toMatch(/^section,record_number,tag_number/);
    const geo = await request.get("/reports/tree-report?format=geojson");
    expect((await geo.json()).type).toBe("FeatureCollection");
  });
});

test.describe("Nudges to check a tree you are standing next to", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

  // Puts the user right next to the first tree in the data, with a good real fix.
  async function standNextToATree(page) {
    await page.waitForFunction(() => state.userLocation && !state.userLocation.isDefault && state.trees.length > 0);
    await page.evaluate(() => {
      localStorage.removeItem("ff-community-nudge-seen-v1");
      localStorage.removeItem("ff-community-nudges-off-v1");
      localStorage.removeItem("ff-community-local-v1");
      const tree = state.trees[0];
      state.userLocation = { ...state.userLocation, accuracy: 8, isDefault: false };
      state.nearestTree = { tree, metres: 6 };
      // Later GPS ticks recompute the nearest tree from the real mock position; keep it this one.
      window.nearestTreesTo = () => [{ tree, metres: 6 }];
    });
  }

  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
  });

  test("on the Nearby screen a dismissible prompt offers to check the tree, once", async ({ page }) => {
    await setup(page);
    await standNextToATree(page);
    await page.evaluate(() => communityNudgeCheck());
    const nudge = page.locator("#communityNudge");
    await expect(nudge).toContainText("You're next to");
    await page.click("[data-community-nudge-close]");
    await expect(nudge).toHaveCount(0);
    // A GPS tick may have prompted for the tree first, so let the check run once more, clear it, then
    // run it again: by now this tree has been asked about, and it is not asked again the same day.
    await page.evaluate(() => { communityNudgeLastAt = 0; communityNudgeCheck(); communityNudgeDismiss(); communityNudgeLastAt = 0; communityNudgeCheck(); });
    await expect(nudge).toHaveCount(0);
  });

  test("the prompt goes away once you leave the Nearby screen", async ({ page }) => {
    await setup(page);
    await standNextToATree(page);
    await page.evaluate(() => communityNudgeCheck());
    await expect(page.locator("#communityNudge")).toHaveCount(1);
    await page.click("#reportToggle");
    await expect(page.locator(".community-contributions")).toBeVisible();
    await page.evaluate(() => communityNudgeCheck());
    await expect(page.locator("#communityNudge")).toHaveCount(0);
  });

  test("Check it opens the tree with its check card", async ({ page }) => {
    await setup(page);
    await standNextToATree(page);
    await page.evaluate(() => communityNudgeCheck());
    await page.click("[data-community-nudge-go]");
    await expect(page.locator("#communityNudge")).toHaveCount(0);
    await expect(page.locator(".community-check")).toHaveCount(1);
    await expect(page.locator("#communityNudge")).toHaveCount(0);
  });

  test("already on the tree's page there is no prompt, only a pulse on the check card", async ({ page }) => {
    await setup(page);
    await standNextToATree(page);
    await page.evaluate(() => { focusOverviewItem("tree", treeHashKey(state.trees[0])); });
    await expect(page.locator(".community-check")).toHaveCount(1);
    await standNextToATree(page);
    await page.evaluate(() => communityNudgeCheck());
    await expect(page.locator(".community-check.community-nudge-pulse")).toHaveCount(1);
    await expect(page.locator("#communityNudge")).toHaveCount(0);
  });

  test("nudges stay quiet when turned off on the Community screen", async ({ page }) => {
    await setup(page, "/community");
    await page.uncheck("#communityNudgeToggle");
    await standNextToATree(page);
    await page.evaluate(() => { localStorage.setItem("ff-community-nudges-off-v1", "1"); communityNudgeCheck(); });
    await expect(page.locator("#communityNudge")).toHaveCount(0);
  });
});

test.describe("Recovery code", () => {
  test("the code can be copied, and restoring brings back the score and reports of that code", async ({ page }) => {
    await page.route(/\/api\/community\/overlay\?me=restoredid1234567890abcd&list=1/, (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ generatedAt: 1, reports: [{ id: "r-old-1", kind: "tree", target: "tree:77", status: "VERIFIED", ts: 1, outcome: "confirmed" }] }),
      }));
    await page.route(/\/api\/community\/overlay\?me=restoredid1234567890abcd$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ points: 12, reports: 1, verified: 1, confirmed: 1, validated: 0, fixed: 0 }) }));
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await setup(page, "/community");
    await page.click(".community-recover summary");
    const shown = (await page.locator("#communityRecoveryCode").innerText()).trim();
    expect(shown).toMatch(/^([a-z0-9]{4}-){5}[a-z0-9]{4}$/);
    expect(await page.evaluate(() => localStorage.getItem("ff-community-device-v1"))).toBe(shown.replace(/-/g, ""));

    await page.fill("#communityRestoreInput", "nonsense!");
    await page.click("[data-action='community-restore']");
    await expect(page.locator("#communityRecoveryStatus")).toContainText("doesn't look like a recovery code");

    await page.fill("#communityRestoreInput", "restoredid1234567890abcd");
    await page.click("[data-action='community-restore']");
    await expect(page.locator("#communityRecoveryStatus")).toContainText("Restored. 1 report found");
    expect(await page.evaluate(() => localStorage.getItem("ff-community-device-v1"))).toBe("restoredid1234567890abcd");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator(".community-rank-points")).toContainText("12 points");
  });
});

test.describe("Reporting from too far away", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await page.route(REPORT_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  });

  test.describe("with location shared but not at the tree", () => {
    test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 8 }, permissions: ["geolocation"] });

    test("it says how far away you are, still lets you report, and notes that it will not earn points", async ({ page }) => {
      await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
      const note = page.locator(".community-range");
      await expect(note).toContainText(/You're about \d+ m away/);
      await expect(note).toContainText("within 10 m of the tree to earn points");
      await expect(note).toContainText("Outside the 10 m check zone");
      await expect(note.locator(".community-range-points")).toContainText("Points: 0 from this check");
      await page.click("[data-action='community-report'][data-status='VERIFIED']");
      await expect(page.locator(".community-mine")).toContainText("It only earns points when you report within 10 m of the tree");
      await expect(page.locator(".community-mine .community-range-points")).toContainText("Points: 0 from this check");
      await page.click("#reportToggle");
      await expect(page.locator(".community-log-item .community-pill")).toContainText("Not close enough for points");
    });
  });

  test("with no location it says you can report from anywhere but need to be close for points", async ({ page }) => {
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".community-range")).toContainText("You can report this from anywhere");
    await expect(page.locator(".community-range")).toContainText("within 10 m of the tree");
    await expect(page.locator(".community-range")).toContainText("Location is off");
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".community-mine")).toContainText("Thank you");
  });
});

test.describe("Community reports on a place", () => {
  test("a place that people have raised issues about links to them, filtered by label", async ({ page }) => {
    await page.route("https://api.github.com/search/issues**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total_count: 2, items: [{ state: "open" }, { state: "closed" }] }) }));
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/nearby#place=id:${PLACE.id}`);
    const line = page.locator(".community-place-issues");
    await expect(line).toBeVisible();
    await expect(line).toContainText("The community has raised 2 issues about this place");
    await expect(line).toContainText("1 still open");
    const href = await line.locator("a").getAttribute("href");
    expect(decodeURIComponent(href)).toContain("label:place-check");
    expect(decodeURIComponent(href)).toContain(`place-key:place:id:${PLACE.id}`);
  });

  test("a place with no issues shows nothing extra", async ({ page }) => {
    await page.route("https://api.github.com/search/issues**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total_count: 0, items: [] }) }));
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/nearby#place=id:${PLACE.id}`);
    await expect(page.locator(".community-place-issues")).toHaveCount(1);
    await expect(page.locator(".community-place-issues")).toBeHidden();
  });
});

test.describe("Verified badge on a tree", () => {
  test("one person verifying a tree shows a tappable count beside the walking distance", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: { [`tree:${FIXTURE_TREE.recordNumber}`]: { s: "verified", n: 1, t: 1 } } }) }));
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    const chip = page.locator(".detail-top-row .community-verified-chip");
    await expect(chip).toHaveAttribute("aria-label", "Verified by 1 person");
    await expect(chip).toContainText("1");
    const detail = page.locator(".community-verified-detail");
    await expect(detail).toBeHidden();
    await chip.click();
    await expect(detail).toContainText("1 person has confirmed this tree is where the map says it is");
  });
});

test.describe("Optimistic score", () => {
  const seed = async (page, { local, score }) => {
    await page.addInitScript(({ local, score }) => {
      if (localStorage.getItem("seeded")) return;
      localStorage.setItem("seeded", "1");
      localStorage.setItem("ff-community-local-v1", JSON.stringify(local));
      localStorage.setItem("ff-community-score-v1", JSON.stringify(score));
    }, { local, score });
    await page.route(/\/api\/community\/overlay\?me=[^&]*$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(score) }));
  };

  test("a report newer than the server's score is added to the points and verified count", async ({ page }) => {
    const score = { points: 4, verified: 3, confirmed: 0, generatedAt: 1 };
    await seed(page, { local: { "tree:1": { id: "a", status: "VERIFIED", ts: Date.now() } }, score });
    await setup(page, "/community");
    await expect(page.locator(".community-rank-points")).toContainText("5 points");
    await expect(page.locator(".community-stats div").first().locator("strong")).toHaveText("4");
  });

  test("once the server's score is newer than the report it is not counted twice", async ({ page }) => {
    const score = { points: 5, verified: 4, confirmed: 0, generatedAt: Date.now() + 60000 };
    await seed(page, { local: { "tree:1": { id: "a", status: "VERIFIED", ts: Date.now() } }, score });
    await setup(page, "/community");
    await expect(page.locator(".community-rank-points")).toContainText("5 points");
    await expect(page.locator(".community-stats div").first().locator("strong")).toHaveText("4");
  });

  test("a correction or a report from too far away adds nothing until the server says so", async ({ page }) => {
    const score = { points: 0, verified: 0, confirmed: 0, generatedAt: 1 };
    await seed(page, { local: {
      "tree:1": { id: "a", status: "NOT_HERE", ts: Date.now() },
      "tree:2": { id: "b", status: "VERIFIED", ts: Date.now(), far: true },
    }, score });
    await setup(page, "/community");
    await expect(page.locator(".community-rank-points")).toContainText("0 points");
  });
});

test.describe("Trees added by walkers", () => {
  test("a tree another walker added is marked on the ordinary map", async ({ page }) => {
    const entries = {
      "new:tree:tag:T-77": { s: "new-confirmed", st: "NEW_TREE", n: 2, tag: "T-77", lat: 51.665, lon: 0.045, t: 1 },
      "tree:1": { s: "verified", n: 1, t: 1 },
    };
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries }) }));
    await setup(page, "/nearby");
    await expect.poll(() => page.evaluate(() => communityOverlayNewTreeMarks().length)).toBe(1);
    expect(await page.evaluate(() => communityOverlayNewTreeMarks()[0].kind)).toBe("added");
    // Drawing with the mark present must not throw
    await page.evaluate(() => draw());
  });
});

test.describe("Add a missing place", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

  test("needs a name and a good fix, then files a place report and logs it", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    const posted = [];
    await page.route("**/.netlify/functions/report-missing-data", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issueUrl: "https://github.com/x/y/issues/1" }) });
    });
    await setup(page, "/community");
    await page.click("[data-action='community-addplace-start']");
    await expect(page.locator("#communityPlaceLocationStatus")).toContainText("accurate to");
    await expect(page.locator("#communityAddPlaceSubmit")).toBeDisabled();
    await page.fill("#communityPlaceName", "The Test Tavern");
    await page.selectOption("#communityPlaceType", "Pub");
    await expect(page.locator("#communityAddPlaceSubmit")).toBeEnabled();
    expect(posted).toHaveLength(0);
    await page.click("#communityAddPlaceSubmit");
    await expect(page.locator(".community-add-place .community-mine")).toContainText("The Test Tavern sent for review");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].placeCheck).toMatchObject({ status: "NEW_PLACE", name: "The Test Tavern", category: "Pub" });
    expect(posted[0].placeCheck.key).toMatch(/^new:51\.665\d*,0\.045\d*$/);
    await expect(page.locator(".community-log-item").filter({ hasText: "The Test Tavern" })).toContainText("Reported a missing place");
  });
});

test.describe("Badges and streaks", () => {
  test("show earned badges and the day streak from reports on this device", async ({ page }) => {
    const now = Date.now();
    const day = 86400000;
    const local = {
      "tree:1": { id: "a", status: "VERIFIED", ts: now },
      "tree:2": { id: "b", status: "VERIFIED", ts: now - day },
      "new:T": { id: "c", status: "NEW_TREE", ts: now - 2 * day },
    };
    await page.addInitScript((local) => {
      if (localStorage.getItem("seeded")) return;
      localStorage.setItem("seeded", "1");
      localStorage.setItem("ff-community-local-v1", JSON.stringify(local));
    }, local);
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await setup(page, "/community");
    await expect(page.locator(".community-streak")).toContainText("3-day streak");
    await expect(page.locator(".community-badge-item.is-earned")).toContainText(["First check", "Tree finder"]);
    await expect(page.locator(".community-badge-item:not(.is-earned)").first()).toBeVisible();
  });

  test("with nothing reported it invites the first check", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
    await setup(page, "/community");
    await expect(page.locator(".community-streak")).toContainText("Check something today to start a streak");
    await expect(page.locator(".community-badge-item.is-earned")).toHaveCount(0);
  });
});

test.describe("Trees added by walkers: tap for details", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 8 }, permissions: ["geolocation"] });

  test("tapping a walker-added tree opens its page, with a way to add your own sighting", async ({ page }) => {
    const entries = { "new:tree:tag:T-77": { s: "new-confirmed", st: "NEW_TREE", n: 2, tag: "T-77", lat: 51.6651, lon: 0.0451, t: 1 } };
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries }) }));
    await setup(page, "/nearby");
    await expect.poll(() => page.evaluate(() => communityOverlayNewTreeMarks().length)).toBe(1);
    expect(await page.evaluate(() => Boolean(communityFindAddedTree("t-77")))).toBe(true);
    // Cluster badges sit over the same ground; this test is about the added-tree hit itself.
    await page.evaluate(() => { window.findClusterHit = () => null; });
    const spot = await page.evaluate(() => {
      const mark = communityOverlayNewTreeMarks()[0];
      const p = worldToScreen(projectLonLat(mark.lon, mark.lat));
      const r = (document.querySelector(".map-stage") || document.getElementById("mapCanvas")).getBoundingClientRect();
      return { x: r.left + (p.x - state.canvasInsetX) / pixelRatio(), y: r.top + (p.y - state.canvasInsetY) / pixelRatio() };
    });
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator("#inspectorTitle")).toHaveText("Tree T-77");
    await expect(page.locator("#inspectorType")).toHaveText("Added by walkers");
    await expect(page.locator("#inspectorBody")).toContainText("Confirmed by a second walker");
    await expect(page.locator("#inspectorBody")).toContainText("Not on the City of London register yet");
    expect(await page.evaluate(() => window.location.hash)).toBe("#addedtree=T-77");
    await page.click("[data-action='community-confirm-added']");
    await expect(page.locator(".community-intro")).toBeVisible();
    await expect(page.locator("#communityTagInput")).toHaveValue("T-77");
  });
});

test.describe("Community log links to places", () => {
  test("a reported place in the contributions log links to its own /find/ page", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ff-community-local-v1", JSON.stringify({
        "place:id:manual/onest": { id: "onestreport01", status: "DETAILS_CHANGED", ts: Date.now(), kind: "place", name: "Onest", lat: 51.6552041, lon: 0.0657308, slug: "onest" },
      }));
    });
    await setup(page, "/community");
    await expect(page.locator(".community-log-item a", { hasText: "Onest" })).toHaveAttribute("href", "/find/onest/");
  });

  test("an older place entry without a slug links to the place on the map", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ff-community-local-v1", JSON.stringify({
        "place:id:manual/onest": { id: "onestreport02", status: "DETAILS_CHANGED", ts: Date.now(), kind: "place", name: "Onest", lat: 51.6552041, lon: 0.0657308 },
      }));
    });
    await setup(page, "/community");
    await expect(page.locator(".community-log-item a", { hasText: "Onest" })).toHaveAttribute("href", "/nearby#place=id:manual/onest");
  });
});
