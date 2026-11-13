const { test, expect } = require('@playwright/test');
const { setup, tapCanvasPoint, waitForUiToSettle } = require('./helpers');

// A group marker's tappable face, found from the renderer's own marker pass and geometry.
const FIND_GROUP = `(() => {
  const dpr = pixelRatio();
  for (const marker of buildMapMarkers(activeIconLookup(), worldToScreen)) {
    if (marker.items.length < 2) continue;
    const box = clusterBadgeGeometry(marker.screenPt.x, marker.screenPt.y, marker.items.length, dpr);
    const point = { x: box.left + 8 * dpr, y: box.top + box.height / 2 };
    const hit = findClusterHit(point);
    if (hit && hit.items.length === marker.items.length && hit.items[0] === marker.items[0]) return { marker, box, point };
  }
  return null;
})()`;

test.describe('Map markers: one compact pin per group, never overlapping', () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ['geolocation'] });

  test('group markers show the exact count, capped at 99+, on a compact pin with a short pointer', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const labels = [];
      ctx.fillText = text => labels.push(text);
      drawClusterMarker(ctx, 100, 100, 12, [iconPath('tree')], 1);
      drawClusterMarker(ctx, 100, 100, 12, [iconPath('tree'), iconPath('cafe')], 1);
      drawClusterMarker(ctx, 100, 100, 124, [iconPath('tree')], 1);
      const box = clusterBadgeGeometry(100, 100, 12, 1);
      return { labels, gap: 100 - box.bottom, width: box.width };
    });
    expect(result.labels).toEqual(['12', '12', '99+']);
    expect(result.gap).toBeLessThanOrEqual(7);
    expect(result.width).toBeLessThan(60);
  });

  test('one-artwork and mixed groups share one silhouette, colour and count position', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      const draw = sources => {
        const ctx = document.createElement('canvas').getContext('2d');
        const fills = [], texts = [];
        ctx.fill = () => fills.push(ctx.fillStyle);
        ctx.stroke = () => {};
        ctx.fillText = (text, x, y) => texts.push({ x, y });
        drawClusterMarker(ctx, 100, 100, 12, sources, 1);
        return { fills, texts };
      };
      return { one: draw([iconPath('tree')]), two: draw([iconPath('tree'), iconPath('cafe')]) };
    });
    expect(result.one.fills).toEqual(result.two.fills);
    expect(result.one.fills[0]).toBe('#ffffff');
    expect(result.one.texts).toEqual(result.two.texts);
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
        capture(() => drawClusterMarker(ctx, 100, 100, 5, [], 1))];
    });
    for (const shape of shapes) {
      expect(shape.tips).toContainEqual({ x: 100, y: 100 });
      expect(new Set(shape.corners.slice(0, 4).map(p => p.x)).size).toBe(2);
      expect(new Set(shape.corners.slice(0, 4).map(p => p.y)).size).toBe(2);
    }
    // A group's face is the same pin silhouette, just at the full 1x size.
    const width = shape => Math.max(...shape.corners.slice(0, 4).map(p => p.x + p.radius)) - Math.min(...shape.corners.slice(0, 4).map(p => p.x - p.radius));
    expect(width(shapes[0])).toBeLessThan(width(shapes[1]));
    expect(100 - Math.max(...shapes[1].corners.slice(0, 4).map(p => p.y + p.radius))).toBeLessThanOrEqual(7);
  });

  test('a group previews one chip per category, biggest category first, and counts every member', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => {
      stopViewportAnimation();
      const oak = { commonName: 'English oak', latinName: 'Quercus robur' };
      const beech = { commonName: 'Common beech', latinName: 'Fagus sylvatica' };
      const hornbeam = { commonName: 'Hornbeam', latinName: 'Carpinus betulus' };
      const at = item => ({ ...item, point: { x: 100, y: 100 } });
      const lookup = { tree: new Set([hornbeam, beech, oak, oak, beech, oak, { ...oak }].map(at)), landmark: new Set([at({ category: 'cafe' })]),
        cow: new Set(), path: new Set(), water: new Set() };
      const markers = buildMapMarkers(lookup, p => p);
      const ctx = document.createElement('canvas').getContext('2d');
      const chip = drawClusterIconChip, labels = [], sources = [];
      ctx.fillText = text => labels.push(text);
      drawClusterIconChip = (ctx, x, y, src) => sources.push(src);
      try { drawMapMarkers(ctx, markers, p => p); }
      finally { drawClusterIconChip = chip; }
      return { markers: markers.length, sources, labels, entries: clusterPreviewEntries(markers[0]).length,
        expected: [treeSpeciesIconPath(oak.commonName, oak.latinName), iconPath('cafe')] };
    });
    expect(result.markers).toBe(1);
    expect(result.sources).toEqual(result.expected);
    expect(result.entries).toBe(2);
    expect(result.labels).toEqual(['8']);
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
        const landmark = new Set();
        ['Underground station', 'Railway station'].forEach((name, row) => {
          for (let i = 0; i < 2; i++) landmark.add({ name, category: 'station', point: { x: 100, y: 100 + row * 200 } });
        });
        const markers = buildMapMarkers({ landmark }, p => p);
        drawMapMarkers(ctx, markers, p => p);
      } finally {
        drawUndergroundGlyph = underground;
        drawNationalRailGlyph = rail;
      }
      return calls;
    });
    expect(glyphs).toEqual(['underground', 'rail']);
  });

  // Records what draw() really paints on a settled frame and derives each rectangle from the
  // renderer's own geometry.
  const MEASURE_OVERLAPS = `(() => {
    settleClusterJoinAnimations();
    const dpr = pixelRatio();
    const drawnGroup = drawClusterMarker, drawnPin = drawItemPin;
    const drawn = [];
    drawClusterMarker = (ctx, x, y, count, sources, d, scale = 1) => {
      drawn.push({ ...clusterMarkerRect(x, y, count, dpr, scale), count });
      return drawnGroup(ctx, x, y, count, sources, d, scale);
    };
    drawItemPin = (ctx, type, item, x, y, size) => {
      drawn.push({ ...clusterMarkerRect(x, y, 1, dpr, size / (MAP_PNG_ICON_SIZE * MAP_ICON_SCALE_UNSELECTED * dpr)), count: 1 });
      return drawnPin(ctx, type, item, x, y, size);
    };
    try { draw(); } finally { drawClusterMarker = drawnGroup; drawItemPin = drawnPin; }
    let overlaps = 0;
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const a = drawn[i], b = drawn[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps++;
      }
    }
    return { markers: drawn.length, groups: drawn.filter(m => m.count > 1).length, overlaps };
  })()`;

  test('no two drawn markers overlap, at the default view and after zooming in and out', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    await waitForUiToSettle(page);
    const seen = [];
    for (const factor of [1, 0.45, 2.2]) {
      const view = await page.evaluate(`((factor) => {
        stopViewportAnimation();
        const centre = { x: state.canvasLogicalWidth / 2, y: state.canvasLogicalHeight / 2 };
        const world = screenToWorld(centre.x, centre.y);
        state.viewport.scale *= factor;
        for (let i = 0; i < 2; i++) {
          const now = worldToScreen(world);
          state.viewport.tx += centre.x - now.x;
          state.viewport.ty += centre.y - now.y;
        }
        state.emojiScaleAnimated = zoomEmojiScaleTarget();
        return ${MEASURE_OVERLAPS};
      })(${factor})`);
      seen.push(view);
      expect(view.overlaps, `zoom x${factor}: drawn markers overlapping`).toBe(0);
      expect(view.markers, `zoom x${factor}: something is drawn`).toBeGreaterThan(0);
    }
    expect(seen.some(view => view.groups > 0), 'the busy views do group things').toBe(true);
  });

  test('no two drawn markers overlap in the heading-up 3D view', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    const view = await page.evaluate(`(() => {
      stopViewportAnimation();
      state.compassHeading = state.compassHeadingTarget = state.renderedNavigationHeading = 0;
      state.compassLastEventAt = performance.now();
      state.map3dEnabled = true;
      state.tiltBetaSmoothed = state.tiltBetaTarget = 65;
      alignHeadingUpNavigationViewport({ force: true });
      const result = ${MEASURE_OVERLAPS};
      return { ...result, tilted: tiltActive() };
    })()`);
    expect(view.tilted).toBe(true);
    expect(view.markers, 'something is drawn').toBeGreaterThan(0);
    expect(view.overlaps, 'drawn markers overlapping').toBe(0);
  });

  // Paints one flat frame, recording every marker rectangle and the real extent of the "You" text.
  const MEASURE_YOU_LABEL = `(() => {
    settleClusterJoinAnimations();
    const dpr = pixelRatio();
    const drawnGroup = drawClusterMarker, drawnPin = drawItemPin;
    const rects = [];
    drawClusterMarker = (ctx, x, y, count, sources, d, scale = 1) => {
      rects.push(clusterMarkerRect(x, y, count, dpr, scale));
      return drawnGroup(ctx, x, y, count, sources, d, scale);
    };
    drawItemPin = (ctx, type, item, x, y, size) => {
      rects.push(clusterMarkerRect(x, y, 1, dpr, size / (MAP_PNG_ICON_SIZE * MAP_ICON_SCALE_UNSELECTED * dpr)));
      return drawnPin(ctx, type, item, x, y, size);
    };
    const overlay = els.overlayCanvas.getContext('2d');
    let label = null;
    overlay.fillText = function (text, x, y) {
      if (text === 'You') {
        const m = this.measureText(text);
        label = { left: x - m.actualBoundingBoxLeft, right: x + m.actualBoundingBoxRight, top: y - m.actualBoundingBoxAscent, bottom: y + m.actualBoundingBoxDescent };
      }
      return CanvasRenderingContext2D.prototype.fillText.apply(this, arguments);
    };
    try { draw(); } finally { drawClusterMarker = drawnGroup; drawItemPin = drawnPin; delete overlay.fillText; }
    const covered = label ? rects.filter(r => label.left < r.right && r.left < label.right && label.top < r.bottom && r.top < label.bottom).length : -1;
    return { markers: rects.length, labelDrawn: Boolean(label), covered, side: _userLabelSide };
  })()`;

  test('the You label never sits under or over a marker, at the default view and after zooming', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    await waitForUiToSettle(page);
    for (const factor of [1, 0.45, 2.2]) {
      const view = await page.evaluate(`((factor) => {
        stopViewportAnimation();
        const centre = { x: state.canvasLogicalWidth / 2, y: state.canvasLogicalHeight / 2 };
        const world = screenToWorld(centre.x, centre.y);
        state.viewport.scale *= factor;
        for (let i = 0; i < 2; i++) {
          const now = worldToScreen(world);
          state.viewport.tx += centre.x - now.x;
          state.viewport.ty += centre.y - now.y;
        }
        state.emojiScaleAnimated = zoomEmojiScaleTarget();
        return ${MEASURE_YOU_LABEL};
      })(${factor})`);
      expect(view.labelDrawn, `zoom x${factor}: the You label is drawn`).toBe(true);
      expect(view.covered, `zoom x${factor}: markers over the You label`).toBe(0);
    }
  });

  test('the You label steps aside when a marker stands right beside the user', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    await waitForUiToSettle(page);
    const view = await page.evaluate(`(() => {
      stopViewportAnimation();
      const dpr = pixelRatio();
      const marker = buildMapMarkers(activeIconLookup(), worldToScreen)[0];
      // The user stands just left of the marker's face, level with it: the default right-hand label
      // would land on the marker, while the other three sides are clear.
      const face = clusterMarkerRect(marker.screenPt.x, marker.screenPt.y, marker.items.length, dpr, marker.items.length > 1 ? 1 : mapEmojiScale());
      const dot = { x: face.left - 15 * dpr, y: (face.top + face.bottom) / 2 };
      state.userLocation = { ...state.userLocation, point: screenToWorld(dot.x, dot.y) };
      return ${MEASURE_YOU_LABEL};
    })()`);
    expect(view.labelDrawn).toBe(true);
    expect(view.covered, 'markers over the You label').toBe(0);
    expect(view.side, 'the label moved off the covered right side').not.toBe('right');
  });

  test('the user dot and its label are painted after every pin, flat and heading-up', async ({ page }) => {
    await setup(page);
    const order = await page.evaluate(() => {
      stopViewportAnimation();
      const markers = drawMapMarkers, user = drawUser;
      const events = [];
      drawMapMarkers = (...args) => { events.push('pins'); return markers(...args); };
      drawUser = (...args) => { events.push('user'); return user(...args); };
      try {
        draw();
        const flat = events.splice(0);
        state.compassHeading = state.compassHeadingTarget = state.renderedNavigationHeading = 0;
        state.compassLastEventAt = performance.now();
        state.map3dEnabled = true;
        state.tiltBetaSmoothed = state.tiltBetaTarget = 65;
        alignHeadingUpNavigationViewport({ force: true });
        draw();
        return { flat, tilted: events.splice(0), tiltActive: tiltActive() };
      } finally {
        drawMapMarkers = markers;
        drawUser = user;
      }
    });
    expect(order.tiltActive).toBe(true);
    expect(order.flat).toEqual(['pins', 'user']);
    expect(order.tilted).toEqual(['pins', 'user']);
  });

  test('tapping a mixed group opens exactly its members, and the badge count matches the list and map', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    await waitForUiToSettle(page);
    const target = await page.evaluate(() => {
      stopViewportAnimation();
      const dpr = pixelRatio();
      for (const marker of buildMapMarkers(activeIconLookup(), worldToScreen)) {
        if (marker.itemType !== '_mega') continue;
        const box = clusterBadgeGeometry(marker.screenPt.x, marker.screenPt.y, marker.items.length, dpr);
        const point = { x: box.left + 8 * dpr, y: box.top + box.height / 2 };
        const hit = findClusterHit(point);
        if (hit && hit.items.length === marker.items.length && hit.items[0] === marker.items[0]) {
          return { point, count: marker.items.length, categories: Object.keys(marker.itemsByType).length };
        }
      }
      return null;
    });
    expect(target, 'a mixed-category group is on screen at the default view').not.toBeNull();
    expect(target.categories).toBeGreaterThan(1);
    await tapCanvasPoint(page, target.point);
    await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(target.count);
    await waitForUiToSettle(page);
    const shown = await page.evaluate(() => {
      const lookup = activeIconLookup();
      return {
        onMap: ['tree', 'landmark', 'cow', 'path', 'water'].reduce((n, type) => n + lookup[type].size, 0),
        inList: document.querySelectorAll('#inspectorBody .nearest-item').length,
        listCap: state.nearestItemsCount,
      };
    });
    expect(shown.onMap, 'the map shows exactly the badge count').toBe(target.count);
    // The Nearby list always stops at the nearest-N cap, so a group bigger than that lists the cap.
    expect(shown.inList, 'the list shows the group, up to its usual cap').toBe(Math.min(target.count, shown.listCap));
  });

  test('a group marker opens its members when tapped on either side of the count', async ({ page }) => {
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    const target = await page.evaluate(`(() => {
      stopViewportAnimation();
      const found = ${FIND_GROUP};
      if (!found) return null;
      const dpr = pixelRatio();
      const other = { x: found.box.left + found.box.width - 8 * dpr, y: found.point.y };
      const countHit = findClusterHit(other);
      return countHit && countHit.items.length === found.marker.items.length ? { point: found.point, count: countHit.items.length } : null;
    })()`);
    expect(target).not.toBeNull();
    await tapCanvasPoint(page, target.point);
    await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(target.count);
  });

  test('expanding a cluster keeps its members visible throughout the camera flight, instead of hiding them until it snaps into place', async ({ page }) => {
    // Field report: "going from nearby to a cluster does not have a smooth transition, it
    // seems to animate to the position and then suddenly snap afterwards". focusNearbyOnClusterGroup
    // starts a browse-origin slide (startNearbyOriginTransition) *and* a real camera zoom/pan
    // tween (refreshNearbyRadiusView's moveCamera) together, but nearbyRevealOpacity --
    // built for a plain anchor move where the camera does *not* animate and only the ring's own
    // render position slides -- held the group's own member pins at opacity 0 for the entire
    // ~500ms flight, then faded them in only once both tweens happened to finish. The camera
    // motion was smooth; what "snapped" was the destination's own pins popping into existence
    // after it had already stopped.
    await setup(page);
    await expect(page.locator('#inspectorBody .nearest-item').first()).toBeVisible();
    const target = await page.evaluate(`(() => {
      stopViewportAnimation();
      const found = ${FIND_GROUP};
      return found ? { point: found.point, count: found.marker.items.length } : null;
    })()`);
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
    // moveCamera as a *fixed* target -- but both of those functions blend across the
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
      state.map3dEnabled = true;
      state.tiltBetaTarget = 50;
      state.tiltBetaSmoothed = 50;
    });

    const result = await page.evaluate(() => {
      stopViewportAnimation();
      // state.nearbyAnchor starts null (plain GPS-centred browsing) -- tapping a cluster is
      // exactly the "not browsing -> browsing" crossing that makes the old and new pivot
      // rules (and so the fromScale/toScale blend) disagree.
      const cluster = buildMapMarkers(activeIconLookup(), worldToScreen).find(candidate => candidate.items.length >= 2) || null;
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

    expect(result, "sanity: a real multi-member group marker must exist in the fixture data").not.toBeNull();
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
      state.map3dEnabled = true;
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
});
