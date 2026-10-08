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
