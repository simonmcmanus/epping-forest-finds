# Detailed Changes for All Fixes

## File: js/renderer.js

### Lines 1-12: Add Constants and Animation State
```javascript
// ADD after existing constants:
const SELECTED_OVERLAY_PULSE_PERIOD_MS = 380;  // Shared pulse period for smooth animation
const LANDMARK_CULL_MARGIN_PX = 24;  // Consistent culling margin for all landmark types

// ADD new animation state variable:
let _animationStartTime = null;
```

### Lines 66-73: Add getSelectedOverlayPulse() Helper Function
```javascript
// ADD this new function before draw():
// Get smooth pulsing value for selected overlay animations (0-1, smooth sine wave)
// Uses elapsed time from animation start rather than Date.now() to avoid jitter
function getSelectedOverlayPulse() {
  if (_animationStartTime === null) _animationStartTime = performance.now();
  const elapsed = performance.now() - _animationStartTime;
  const cyclePosition = (elapsed % SELECTED_OVERLAY_PULSE_PERIOD_MS) / SELECTED_OVERLAY_PULSE_PERIOD_MS;
  return Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
}
```

### Lines 75-78: Initialize Animation Timing in draw()
```javascript
function draw() {
  state.animationFrame = null;
  // ADD these lines:
  // Initialize animation timing on first draw
  if (_animationStartTime === null) _animationStartTime = performance.now();
```

### Line 1159: Update Landmark Culling Margin
**CHANGE:**
```javascript
// FROM:
if (!isNearCanvas(screenPt, 16 * dpr * uScale)) continue;

// TO:
if (!isNearCanvas(screenPt, LANDMARK_CULL_MARGIN_PX * dpr)) continue;
```

### Lines 1546-1577: Update drawUser() Function
**REPLACE the entire function with:**
```javascript
function drawUser(ctx, toScreen, isTilted) {
  if (!state.userLocation || !state.userInMapArea) return;
  const dpr = pixelRatio();
  // Use provided toScreen function (handles tilt projection), fallback to worldToScreen
  if (!toScreen) toScreen = worldToScreen;

  const point = toScreen(state.userLocation.point);

  // Validate projection produced valid coordinates
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

  // Sync opacity with landmark/pin opacity when out of walking radius
  const nearbyIconLookup = buildNearbyIconLookup();
  const isOutOfRadius = nearbyIconLookup.outOfRadius && nearbyIconLookup.outOfRadius.has(state.userLocation);
  ctx.globalAlpha = isOutOfRadius ? 0.4 : 1;
  
  // In tilt mode, apply tiltPinScale if available.
  // Note: unlike landmarks/pins, the user location marker should always be visible
  // (no isNearCanvas culling) since it's critical UI that must show the user's position.
  let pinScale = 1;
  if (isTilted && typeof tiltPinScale === "function") {
    // Apply tilt-based scale if available, but ensure it's positive and finite
    const scale = tiltPinScale(state.userLocation.point);
    // Clamp scale to valid range; avoid zero, negative, or NaN scales
    pinScale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 5) : 1;
  }

  // Scale proportionally with actual zoom (not mapEmojiScale which has a high floor).
  // Use baseFitScale if set, otherwise fitScale, with a minimum of 1
  const baseScale = state.baseFitScale > 0 ? state.baseFitScale : (state.fitScale > 0 ? state.fitScale : 1);
  const dotScale = clamp(state.viewport.scale / baseScale, 0.1, 1.5) * pinScale;
  const radius = Math.max(2 * dpr, 4 * dpr * dotScale);
  // ... rest of drawUser function continues as-is
}
```

### Line 1713: Update drawSelectedRoadOverlay() Pulse
**CHANGE:**
```javascript
// FROM:
const now = Date.now();
const pulse = (Math.sin(now / 400) * 0.5 + 0.5);

// TO:
const pulse = getSelectedOverlayPulse();
```

### Line 1749: Update drawSelectedPathOverlay() Pulse
**CHANGE:**
```javascript
// FROM:
const now = Date.now();
const pulse = (Math.sin(now / 350) * 0.5 + 0.5);

// TO:
const pulse = getSelectedOverlayPulse();
```

---

## File: js/nav.js

### Line 590: Add Animation Cancellation
**CHANGE in recentMapForInspectorChange():**
```javascript
function recentMapForInspectorChange(options = {}) {
  // ADD this line at the very beginning:
  // Stop any existing viewport animation before starting a new one to prevent conflicts
  stopViewportAnimation();

  const animate = Boolean(options.animate);
  const durationMs = options.durationMs || (animate ? 220 : 0);
  // ... rest of function continues as-is
}
```

---

## File: index.html

### Lines 243-244: Add Padding Constants
**ADD after existing animation timing constants:**
```javascript
const DEFAULT_FIT_PADDING_PX = 54; // default screen-space padding for fitToPoints (around content bounds)
const OVERVIEW_FIT_PADDING_PX = 28; // tighter padding for overview targets fit
```

### Line 954: Update applyBoundsToViewport()
**CHANGE:**
```javascript
// FROM:
const padding = (options.padding != null ? options.padding : 54) * pixelRatio();

// TO:
const padding = (options.padding != null ? options.padding : DEFAULT_FIT_PADDING_PX) * pixelRatio();
```

### Line 1083-1087: Update bestVisibleCanvasRect() Fallback Logic
**CHANGE:**
```javascript
// FROM:
.filter((rect) => rect.width >= 80 && rect.height >= 80);

if (!candidates.length) return full;
return candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

// TO:
// Prefer candidates >= 80x80; if none exist, use the largest available region
const candidates = allRegions.filter((rect) => rect.width >= 80 && rect.height >= 80);
const selected = candidates.length > 0 ? candidates : allRegions;
return selected.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || full;
```

### Lines 3596-3605: Update ensureUserAndSelectionVisible() Logic
**REPLACE the early return check with:**
```javascript
// On GPS-triggered calls (no force flag), check if animation is needed.
// Only animate if ANY point is near the visible area edge, preventing jarring
// invisible viewport jumps when points are already comfortably visible.
// Uses the ACTUAL inspector state (not assumeInspectorOpen) so mobile
// navigation — where the inspector is collapsed — fills the larger available area.
if (!options.force && shouldAnimate) {
  const focusRect = bestVisibleCanvasRect();
  const edgeMargin = Math.min(focusRect.width, focusRect.height) * 0.14;

  // Check if ANY point is near the edge (needs animation) vs ALL points are safe
  const anyNearEdge = pointsToFit.some((pt) => {
    const s = worldToScreen(pt);
    const nearLeft = s.x < focusRect.x + edgeMargin;
    const nearRight = s.x > focusRect.x + focusRect.width - edgeMargin;
    const nearTop = s.y < focusRect.y + edgeMargin;
    const nearBottom = s.y > focusRect.y + focusRect.height - edgeMargin;
    return nearLeft || nearRight || nearTop || nearBottom;
  });

  if (!anyNearEdge) return;  // All points safely visible, no animation needed
}
```

### Line 3810: Update ensureOverviewTargetsVisible() Padding
**CHANGE:**
```javascript
// FROM:
padding: 28,

// TO:
padding: OVERVIEW_FIT_PADDING_PX,
```

### Lines 4775-4780: Replace screenToWorld() with Tilt Support
**REPLACE the entire function with:**
```javascript
function screenToWorld(x, y) {
  // Handle tilt projection first (if active), then rotation
  let screenX = x, screenY = y;

  if (tiltActive() && state.userLocation) {
    const tiltDeg = tiltRotateXDeg();
    if (tiltDeg > 0) {
      const origin = rawWorldToScreen(state.userLocation.point);
      const dpr = pixelRatio();
      const perspective = tiltPerspectivePx();
      const T = tiltDeg * Math.PI / 180;
      const c = Math.cos(T);
      const s = Math.sin(T);

      // Convert screen offset to CSS pixels
      const x_rel = (screenX - origin.x) / dpr;
      const y_rel = (screenY - origin.y) / dpr;

      // Reverse the perspective projection
      // From forward: y' = dy * cos(T) * perspective / (perspective - dy * sin(T))
      // Solving for dy: dy = y_rel * perspective / (c * perspective + y_rel * s)
      const dy = y_rel * perspective / (c * perspective + y_rel * s);
      const dz = dy * s;
      const scale = perspective / (perspective - dz);
      const dx = x_rel / scale;

      // Convert back to screen pixels, accounting for the un-projected values
      screenX = origin.x + dx * dpr;
      screenY = origin.y + dy * dpr;
    }
  }

  // Handle rotation (heading-up mode)
  const rotation = navigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return rawScreenToWorld(screenX, screenY);
  const unrotated = rotateScreenPoint({ x: screenX, y: screenY }, rawWorldToScreen(state.userLocation.point), -rotation);
  return rawScreenToWorld(unrotated.x, unrotated.y);
}
```

---

## Summary of Line Changes

| File | Lines | Change |
|------|-------|--------|
| renderer.js | 1-12 | Add constants and animation state |
| renderer.js | 66-73 | Add getSelectedOverlayPulse() helper |
| renderer.js | 75-78 | Initialize animation timing |
| renderer.js | 1159 | Use LANDMARK_CULL_MARGIN_PX |
| renderer.js | 1546-1577 | Rewrite drawUser() with improvements |
| renderer.js | 1713 | Replace pulse calculation |
| renderer.js | 1749 | Replace pulse calculation |
| nav.js | 590 | Add stopViewportAnimation() call |
| index.html | 243-244 | Add padding constants |
| index.html | 954 | Use DEFAULT_FIT_PADDING_PX |
| index.html | 1083-1087 | Improve fallback logic |
| index.html | 3596-3605 | Rewrite edge detection |
| index.html | 3810 | Use OVERVIEW_FIT_PADDING_PX |
| index.html | 4775-4780 | Rewrite screenToWorld() |

---

## Service Worker Cache Busting

After applying these fixes, increment the service worker version in `index.html` to force cache refresh:

```javascript
// Find the service worker registration (usually at the end of index.html):
// CHANGE from:
navigator.serviceWorker.register('sw.js?v=X');

// TO (increment the version number):
navigator.serviceWorker.register('sw.js?v=Y');
```

This ensures users get the latest fixes immediately.
