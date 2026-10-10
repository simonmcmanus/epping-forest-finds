const { test, expect } = require('@playwright/test');
const { setup, tapCanvasPoint } = require('./helpers');

test.describe('Cluster badges and geographic footprints', () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ['geolocation'] });

  test('both group types show exact counts and a short pointer attached to their badge', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const labels = [];
      ctx.fillText = text => labels.push(text);
      drawGroupBadge(ctx, 100, 100, 12, [iconPath('tree')], false, 1);
      drawGroupBadge(ctx, 100, 100, 12, [iconPath('tree'), iconPath('cafe')], true, 1);
      drawGroupBadge(ctx, 100, 100, 124, [iconPath('tree')], false, 1);
      const a = clusterBadgeGeometry(100, 100, 12, false, 1);
      const b = clusterBadgeGeometry(100, 100, 12, true, 1);
      return { labels, gaps: [100 - a.bottom, 100 - b.bottom], widths: [a.width, b.width] };
    });
    expect(result.labels).toEqual(['12', '12', '99+']);
    expect(result.gaps).toEqual([7, 7]);
    expect(Math.max(...result.widths)).toBeLessThanOrEqual(84);
  });

  test('all clusters share one silhouette, colour and count position', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const fills = [], textPositions = [];
      ctx.fill = () => fills.push(ctx.fillStyle);
      ctx.stroke = () => {};
      ctx.fillText = (text, x, y) => textPositions.push({ x, y });
      drawGroupBadge(ctx, 100, 100, 12, [], false, 1);
      drawGroupBadge(ctx, 100, 100, 12, [], true, 1);
      return { fills, textPositions, same: clusterBadgeGeometry(100, 100, 12, false, 1), mixed: clusterBadgeGeometry(100, 100, 12, true, 1) };
    });
    expect(result.same).toEqual(result.mixed);
    expect(result.fills[0]).toBe(result.fills[1]);
    expect(result.fills[0]).toBe('#ffffff');
    expect(result.textPositions[0]).toEqual(result.textPositions[1]);
  });

  test('cluster areas have a contrasting outline and visible fill on the map', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      stopViewportAnimation();
      const ctx = document.createElement('canvas').getContext('2d');
      const strokes = [], fills = [];
      ctx.stroke = () => strokes.push({ colour: ctx.strokeStyle, width: ctx.lineWidth / pixelRatio() });
      ctx.fill = () => fills.push(ctx.fillStyle);
      const items = Array.from(activeIconLookup().tree).slice(0, 2);
      drawClusterFootprints(ctx, [{ items }], []);
      return { strokes, fills };
    });
    expect(result.strokes).toHaveLength(2);
    expect(result.strokes[0].width).toBeGreaterThanOrEqual(4);
    expect(result.strokes[1].width).toBeGreaterThanOrEqual(2);
    expect(result.strokes[0].colour).not.toBe(result.strokes[1].colour);
    expect(result.fills).toHaveLength(1);
  });

  test('individual and grouped pins use rounded rectangular faces with attached pointers', async ({ page }) => {
    await setup(page);
    const shapes = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const capture = drawPin => {
        const corners = [], tips = [];
        ctx.arc = (x, y, radius) => corners.push({ x, y, radius });
        ctx.lineTo = (x, y) => tips.push({ x, y });
        drawPin();
        return { corners, tips };
      };
      return [capture(() => drawMapPinShape(ctx, 100, 100, 60)),
        capture(() => drawGroupBadge(ctx, 100, 100, 5, [], true, 1))];
    });
    for (const shape of shapes) {
      expect(shape.corners).toHaveLength(4);
      expect(shape.tips).toContainEqual({ x: 100, y: 100 });
      expect(new Set(shape.corners.map(p => p.x)).size).toBe(2);
      expect(new Set(shape.corners.map(p => p.y)).size).toBe(2);
    }
    const width = shape => Math.max(...shape.corners.map(p => p.x + p.radius)) - Math.min(...shape.corners.map(p => p.x - p.radius));
    expect(width(shapes[0])).toBeLessThan(width(shapes[1]) * 0.7);
    expect(100 - Math.max(...shapes[0].corners.map(p => p.y + p.radius))).toBeLessThanOrEqual(7);
  });

  test('tree clusters preview their distinct species, most common first', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const oak = { commonName: 'English oak', latinName: 'Quercus robur' };
      const beech = { commonName: 'Common beech', latinName: 'Fagus sylvatica' };
      const hornbeam = { commonName: 'Hornbeam', latinName: 'Carpinus betulus' };
      const cluster = { items: [hornbeam, beech, oak, oak, beech, oak], screenPt: { x: 100, y: 100 }, worldPt: { x: 0, y: 0 } };
      const ctx = document.createElement('canvas').getContext('2d');
      const drawChip = drawMegaClusterIconChip;
      const sources = [];
      drawMegaClusterIconChip = (ctx, x, y, src) => sources.push(src);
      try { drawSameCategoryCluster(ctx, cluster, 'tree', 1); }
      finally { drawMegaClusterIconChip = drawChip; }
      return { sources, expected: [oak, beech, hornbeam].map(t => treeSpeciesIconPath(t.commonName, t.latinName)) };
    });
    expect(result.sources).toEqual(result.expected);
  });

  test('one-artwork groups put a tappable count at the top right of a compact location pin', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const labels = [], chips = [];
      const original = drawMegaClusterIconChip;
      ctx.fillText = (text, x, y) => labels.push({ text, x, y });
      drawMegaClusterIconChip = (ctx, x, y) => chips.push({ x, y });
      try { drawGroupBadge(ctx, 100, 100, 12, [iconPath('shop')], false, 1); }
      finally { drawMegaClusterIconChip = original; }
      const box = clusterBadgeGeometry(100, 100, 12, false, 1, 1, true);
      return { labels, chips, width: box.width, hit: clusterBadgeContains(labels[0], 100, 100, 12, false, 1, 1, true) };
    });
    expect(result.width).toBeLessThan(60);
    expect(result.labels[0].text).toBe('12');
    expect(result.labels[0].x).toBeGreaterThan(result.chips[0].x);
    expect(result.labels[0].y).toBeLessThan(result.chips[0].y);
    expect(result.hit).toBe(true);
  });

  test('mixed groups preserve species previews and coalesce duplicate species artwork', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const oak = { commonName: 'English oak', latinName: 'Quercus robur' };
      const beech = { commonName: 'Common beech', latinName: 'Fagus sylvatica' };
      const ctx = document.createElement('canvas').getContext('2d');
      const group = [{ itemType: 'tree', cluster: { items: [oak, oak, beech], screenPt: { x: 100, y: 100 } } },
        { itemType: 'tree', cluster: { items: [beech], screenPt: { x: 101, y: 100 } } },
        { itemType: 'landmark', cluster: { items: [{ category: 'cafe' }], screenPt: { x: 102, y: 100 } } }];
      const drawChip = drawMegaClusterIconChip;
      const sources = [], labels = [];
      ctx.fillText = text => labels.push(text);
      drawMegaClusterIconChip = (ctx, x, y, src) => sources.push(src);
      try { drawMegaClusters(ctx, [group]); }
      finally { drawMegaClusterIconChip = drawChip; }
      return { sources, labels, expected: [treeSpeciesIconPath(oak.commonName, oak.latinName), treeSpeciesIconPath(beech.commonName, beech.latinName), iconPath('cafe')] };
    });
    expect(result.sources).toEqual(result.expected);
    expect(result.labels).toEqual(['5']);
  });

  test('station groups retain their Underground and National Rail symbols', async ({ page }) => {
    await setup(page);
    const glyphs = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const underground = drawUndergroundGlyph, rail = drawNationalRailGlyph;
      const calls = [];
      drawUndergroundGlyph = () => calls.push('underground');
      drawNationalRailGlyph = () => calls.push('rail');
      try {
        for (const name of ['Underground station', 'Railway station']) {
          const item = { name, category: 'station' };
          const cluster = { items: [item, item], screenPt: { x: 100, y: 100 } };
          drawSameCategoryCluster(ctx, cluster, 'landmark', 1);
        }
      } finally {
        drawUndergroundGlyph = underground;
        drawNationalRailGlyph = rail;
      }
      return calls;
    });
    expect(glyphs).toEqual(['underground', 'rail']);
  });

  test('the shaded area follows member locations rather than the count', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const p = (x, y) => ({ point: { x, y } });
      const small = [p(100, 100), p(105, 100)];
      const spread = [p(100, 100), p(180, 100), p(140, 145)];
      const hull = items => clusterFootprintPoints(items, p => p, p => p, 10);
      const bounds = points => ({ left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) });
      return { small: bounds(hull(small)), spread: bounds(hull(spread)), duplicates: bounds(hull([...small, ...small])), coincident: hull([p(100, 100), p(100, 100)]).length };
    });
    expect(result.spread.left).toBeLessThan(100);
    expect(result.spread.right).toBeGreaterThan(180);
    expect(result.spread.bottom).toBeGreaterThan(145);
    expect(result.duplicates).toEqual(result.small);
    expect(result.spread.right - result.spread.left).toBeGreaterThan(result.small.right - result.small.left);
    expect(result.coincident).toBeGreaterThan(6);
  });

  test('a cluster badge opens its members when tapped on either side of the count', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    const target = await page.evaluate(() => {
      stopViewportAnimation();
      const lookup = activeIconLookup();
      const trees = buildTypeClusters(lookup.tree, worldToScreen);
      for (const cluster of trees) {
        if (cluster.items.length < 2) continue;
        const box = clusterBadgeGeometry(cluster.screenPt.x, cluster.screenPt.y, cluster.items.length, false, pixelRatio(), 1, clusterPreviewEntries('tree', cluster).length === 1);
        const point = { x: box.left + 8 * pixelRatio(), y: box.top + box.height / 2 };
        const hit = findClusterHit(point);
        const countHit = findClusterHit({ x: box.left + box.width - 8 * pixelRatio(), y: point.y });
        if (hit && countHit && hit.items.includes(cluster.items[0]) && hit.items.length === countHit.items.length) return { point, count: hit.items.length };
      }
      return null;
    });
    expect(target).not.toBeNull();
    await tapCanvasPoint(page, target.point);
    await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(target.count);
  });

  test('expanding a cluster keeps its members visible throughout the camera flight, instead of hiding them until it snaps into place', async ({ page }) => {
    // Field report: "going from nearby to a cluster does not have a smooth transition, it
    // seems to animate to the position and then suddenly snap afterwards". focusNearbyOnClusterGroup
    // starts a browse-origin slide (startNearbyOriginTransition) *and* a real camera zoom/pan
    // tween (refreshNearbyRadiusView's animateViewportTo) together, but nearbyRevealOpacity --
    // built for a plain anchor move where the camera does *not* animate and only the ring's own
    // render position slides -- held the group's own member pins at opacity 0 for the entire
    // ~500ms flight, then faded them in only once both tweens happened to finish. The camera
    // motion was smooth; what "snapped" was the destination's own pins popping into existence
    // after it had already stopped.
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    const target = await page.evaluate(() => {
      stopViewportAnimation();
      const lookup = activeIconLookup();
      const trees = buildTypeClusters(lookup.tree, worldToScreen);
      for (const cluster of trees) {
        if (cluster.items.length < 2) continue;
        const box = clusterBadgeGeometry(cluster.screenPt.x, cluster.screenPt.y, cluster.items.length, false, pixelRatio(), 1, clusterPreviewEntries('tree', cluster).length === 1);
        const point = { x: box.left + 8 * pixelRatio(), y: box.top + box.height / 2 };
        const hit = findClusterHit(point);
        if (hit && hit.items.includes(cluster.items[0])) return { point, count: hit.items.length };
      }
      return null;
    });
    expect(target).not.toBeNull();

    const samples = await page.evaluate(async (point) => {
      const canvas = els.canvas;
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      const rect = (els.mapStage || canvas).getBoundingClientRect();
      const dpr = pixelRatio();
      const clientX = rect.left + (point.x - state.canvasInsetX) / dpr;
      const clientY = rect.top + (point.y - state.canvasInsetY) / dpr;
      const fire = (type) => canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 2001, clientX, clientY, bubbles: true, cancelable: true, pointerType: "touch",
      }));
      fire("pointerdown");
      fire("pointerup");

      const collected = [];
      const start = performance.now();
      while (performance.now() - start < 700) {
        collected.push({ opacity: nearbyRevealOpacity(), animating: state.viewportAnimationTo != null });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return collected;
    }, target.point);

    const whileAnimating = samples.filter((s) => s.animating);
    expect(whileAnimating.length, "sanity: the camera should actually have been animating for part of this").toBeGreaterThan(2);
    expect(whileAnimating.every((s) => s.opacity === 1), "the cluster's own members must stay visible for the whole camera flight").toBe(true);
  });

  test('a cluster tap in 3D solves the camera tween against the slide\'s actual destination, not a stale snapshot of it', async ({ page }) => {
    // Field report: "clicking on a cluster ... it seems to zoom past the location and then
    // snap back to it", and the matching "back" report ("the camera angle seems to go down
    // and then snap"). alignHeadingUpNavigationViewport's animate:true path (the one
    // focusNearbyOnClusterGroup/refreshNearbyRadiusView/restoreNearbyAnchorFromHistory all
    // use) fed maxNearbyHeadingUpScale and nearbyNavigationFocusPoint straight into
    // animateViewportTo as a *fixed* target -- but both of those functions blend across the
    // browse-origin slide via nearbyOriginTransitionEasedProgress(), which is still ~0 the
    // instant the slide starts. Sampled once at that instant, the "fixed" target the tween
    // eased toward was close to the slide's *starting* framing, not its destination --
    // invisible without tilt (where the two framings barely differ) but, with tilt engaged,
    // the ahead-only first-person fit is dramatically tighter than the full-ring "browsing"
    // fit the slide actually lands on. The next un-animated per-frame call
    // (prepareCanvasForDraw, unblocked the instant the tween's own viewportAnimationTo
    // cleared) then recomputed the real, un-blended destination and snapped straight to it --
    // "animate to the wrong place, then pop to the right one".
    //
    // Fixed with a useFinalBrowseState flag threaded through both functions: an animate:true
    // caller now gets the slide's settled destination throughout, exactly what calling them
    // again once the slide has actually finished (no transition in flight) already returns --
    // asserted directly below rather than by timing a real animation, which is exactly the
    // kind of frame-timing race this bug itself depended on.
    await setup(page);
    await page.evaluate(() => {
      // tiltActive() requires headingUpActive() (a finite compass heading), not just beta.
      state.compassHeadingTarget = 0;
      state.compassHeading = 0;
      state.renderedNavigationHeading = 0;
      state.tiltBetaTarget = 50;
      state.tiltBetaSmoothed = 50;
    });

    const result = await page.evaluate(() => {
      stopViewportAnimation();
      // state.nearbyAnchor starts null (plain GPS-centred browsing) -- tapping a cluster is
      // exactly the "not browsing -> browsing" crossing that makes the old and new pivot
      // rules (and so the fromScale/toScale blend) disagree.
      const lookup = activeIconLookup();
      const trees = buildTypeClusters(lookup.tree, worldToScreen);
      let cluster = null;
      for (const candidate of trees) {
        if (candidate.items.length >= 2) { cluster = candidate; break; }
      }
      if (!cluster) return null;

      const { centerPoint, center, targetMinutes } = clusterFocusTarget(cluster.items);
      const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });

      // Right at the instant the slide starts: nearbyOriginTransitionEasedProgress() is ~0.
      // clusterExpanded mirrors focusNearbyOnClusterGroup's own order -- it is what makes
      // nearbyCameraFitPoints() read the tapped group's own members directly rather than the
      // (still mid-slide) walking-radius ring, so this isolates the scale/anchor blend bug
      // from the ring's own origin-interpolation.
      startNearbyOriginTransition(nearbyRenderOriginPoint());
      state.nearbyAnchor = { latitude: center.latitude, longitude: center.longitude, point: centerPoint };
      state.walkingDistanceMinutes = targetMinutes;
      state.clusterExpanded = cluster;

      const blendedFocus = nearbyNavigationFocusPoint(focusRect, false);
      const blendedScale = maxNearbyHeadingUpScale(blendedFocus, focusRect, false);

      // What an animate:true caller should solve for instead -- the slide's own destination,
      // asked for right now while the slide is still live.
      const finalFocus = nearbyNavigationFocusPoint(focusRect, true);
      const finalScale = maxNearbyHeadingUpScale(finalFocus, focusRect, true);

      // Let the slide actually finish, then ask the plain (now un-blended, since
      // nearbyOriginTransitionEasedProgress() returns null with no transition in flight)
      // question again -- this is the real, settled destination the tween must land on.
      // nearbyRenderOriginPoint's own cache is keyed on the anchor object's identity and is
      // normally invalidated every frame (prepareCanvasForDraw); re-pointing state.nearbyAnchor
      // at a fresh object with the same coordinates forces that same real-frame invalidation
      // here, without which the cache would keep serving the mid-slide value measured above.
      state.nearbyOriginTransition = null;
      state.nearbyAnchor = { ...state.nearbyAnchor };
      const settledFocus = nearbyNavigationFocusPoint(focusRect, false);
      const settledScale = maxNearbyHeadingUpScale(settledFocus, focusRect, false);

      return { blendedScale, finalScale, settledScale, finalFocusY: finalFocus.y, settledFocusY: settledFocus.y };
    });

    expect(result, "sanity: a real multi-member tree cluster must exist in the fixture data").not.toBeNull();
    // Sanity: under tilt, the stale progress~0 snapshot really does diverge sharply from the
    // settled fit -- confirming this scenario actually exercises the bug this test guards.
    expect(Math.abs(result.blendedScale - result.settledScale) / result.settledScale).toBeGreaterThan(0.2);

    // The fix: useFinalBrowseState:true must already equal the settled destination, in both
    // scale and vertical anchor, so a tween built from it has nothing left to correct.
    expect(Math.abs(result.finalScale - result.settledScale) / result.settledScale).toBeLessThan(0.001);
    expect(Math.abs(result.finalFocusY - result.settledFocusY)).toBeLessThan(0.5);
  });

  test('going back from a browsed spot in 3D solves the same way, for the opposite crossing', async ({ page }) => {
    // The matching "back" half of the field report ("the camera angle seems to go down and
    // then snap"): restoreNearbyAnchorFromHistory clears state.nearbyAnchor through the same
    // refreshNearbyRadiusView({animate:true}) path focusNearbyOnClusterGroup uses, just with
    // the crossing reversed (browsing -> not browsing instead of not browsing -> browsing).
    await setup(page);
    await page.evaluate(() => {
      state.compassHeadingTarget = 0;
      state.compassHeading = 0;
      state.renderedNavigationHeading = 0;
      state.tiltBetaTarget = 50;
      state.tiltBetaSmoothed = 50;
    });

    const result = await page.evaluate(() => {
      stopViewportAnimation();
      // Start already browsing a spot (the state a "back" press is leaving), mirroring
      // focusNearbyOnClusterGroup's own end state but without clusterExpanded, so the fit
      // reads the plain walking-radius ring -- what restoreNearbyAnchorFromHistory actually
      // falls back to once no anchor remains.
      state.nearbyAnchor = { latitude: 51.666, longitude: 0.046, point: projectLonLat(0.046, 51.666) };
      state.walkingDistanceMinutes = 10;
      const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });

      startNearbyOriginTransition(nearbyRenderOriginPoint());
      state.nearbyAnchor = null; // what "back" to plain GPS browsing actually does

      const blendedFocus = nearbyNavigationFocusPoint(focusRect, false);
      const blendedScale = maxNearbyHeadingUpScale(blendedFocus, focusRect, false);

      const finalFocus = nearbyNavigationFocusPoint(focusRect, true);
      const finalScale = maxNearbyHeadingUpScale(finalFocus, focusRect, true);

      state.nearbyOriginTransition = null;
      // No anchor object to re-point this time (it is null, the whole point of "back" here) --
      // nearbyRenderOriginPoint's cache key still changes (object -> null), which is enough to
      // force the same real-frame invalidation the forward test needed a clone for.
      const settledFocus = nearbyNavigationFocusPoint(focusRect, false);
      const settledScale = maxNearbyHeadingUpScale(settledFocus, focusRect, false);

      return { blendedScale, finalScale, settledScale, finalFocusY: finalFocus.y, settledFocusY: settledFocus.y };
    });

    expect(Math.abs(result.blendedScale - result.settledScale) / result.settledScale).toBeGreaterThan(0.2);
    expect(Math.abs(result.finalScale - result.settledScale) / result.settledScale).toBeLessThan(0.001);
    expect(Math.abs(result.finalFocusY - result.settledFocusY)).toBeLessThan(0.5);
  });

  test('flat and tilted scenes paint geographic footprints beneath their badges', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      stopViewportAnimation();
      const footprint = drawClusterFootprints, badge = drawGroupBadge;
      const events = [];
      drawClusterFootprints = (...args) => { events.push('footprint'); return footprint(...args); };
      drawGroupBadge = (...args) => { events.push('badge'); return badge(...args); };
      try {
        draw();
        const flat = events.slice();
        events.length = 0;
        state.compassHeading = state.compassHeadingTarget = state.renderedNavigationHeading = 0;
        state.compassLastEventAt = performance.now();
        state.tiltBetaSmoothed = state.tiltBetaTarget = 65;
        alignHeadingUpNavigationViewport({ force: true });
        draw();
        return { flat, tilted: events.slice() };
      } finally {
        drawClusterFootprints = footprint;
        drawGroupBadge = badge;
      }
    });
    for (const events of [result.flat, result.tilted]) {
      expect(events[0]).toBe('footprint');
      expect(events.slice(1)).toContain('badge');
    }
  });

  test('tilt projects the footprint onto the ground while the badge remains upright', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      stopViewportAnimation();
      state.compassHeading = state.compassHeadingTarget = state.renderedNavigationHeading = 0;
      state.compassLastEventAt = performance.now();
      state.tiltBetaSmoothed = state.tiltBetaTarget = 65;
      alignHeadingUpNavigationViewport({ force: true });
      const centre = worldToScreenForOverlay(state.userLocation.point);
      const items = [{ point: { x: centre.x - 20, y: centre.y - 100 } }, { point: { x: centre.x + 20, y: centre.y - 80 } }];
      const flat = clusterFootprintPoints(items, p => p, p => p, 10);
      const tilted = clusterFootprintPoints(items, p => p, tiltProjectScreenPoint, 10);
      const projected = flat.map(tiltProjectScreenPoint);
      const pin = tiltProjectScreenPoint(items[0].point);
      const badge = clusterBadgeGeometry(pin.x, pin.y, 12, true, 1);
      return { active: tiltActive(), flat, tilted, projected, height: badge.height, pointer: pin.y - badge.bottom };
    });
    expect(result.active).toBe(true);
    expect(result.tilted).toEqual(result.projected);
    expect(result.tilted).not.toEqual(result.flat);
    expect(result.height).toBe(52);
    expect(result.pointer).toBe(7);
  });
});
