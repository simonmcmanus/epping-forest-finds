# Code Review: Viewport Framing & Animation Smoothness

## Executive Summary
Reviewed the trees codebase focusing on viewport/destination framing and animation smoothness. Found **5 critical issues**, **3 high-priority concerns**, and **4 inconsistencies** that could cause elements to go off-screen or animations to jitter.

---

## 🔴 CRITICAL ISSUES

### 1. **Animation Pulse Uses Date.now() Instead of Animation Frame Time**
**Location:** `renderer.js`, lines 1691-1693 and 1728-1730 (drawSelectedRoadOverlay/drawSelectedPathOverlay)

**Problem:**
```javascript
const now = Date.now();
const pulse = (Math.sin(now / 400) * 0.5 + 0.5);
```

This uses wall-clock time instead of the animation frame timestamp. On frames that take longer to render, `now` jumps forward, causing the sine wave to suddenly skip ahead. This manifests as visible **jitter in the pulsing animation**.

**Impact:** Every frame call computes a fresh `Date.now()`, which isn't tied to the actual render timing. If frame N renders at 100ms and frame N+1 at 135ms, the pulse jumps as if 35ms of animation elapsed in one frame—even if the user is idle.

**Fix:**
```javascript
// Add to state initialization
state.animationStartTime = null;

// In draw()
if (state.animationStartTime === null) {
  state.animationStartTime = performance.now();
}

// In the draw functions
const elapsed = performance.now() - state.animationStartTime;
const pulse = Math.sin((elapsed % 400) / 400 * Math.PI * 2) * 0.5 + 0.5;
```

**Severity:** High – visibly noticeable jitter on slower devices

---

### 2. **drawUser() Missing Bounds Check for tiltPinScale**
**Location:** `renderer.js`, lines 1546-1549

**Problem:**
```javascript
if (typeof tiltPinScale === "function") {
  const scale = tiltPinScale(state.userLocation.point);
  // Clamp scale to valid range; avoid zero, negative, or NaN scales
  pinScale = Math.max(0.01, Math.min(scale || 1, 5));
}
```

While there's clamping, the fallback `scale || 1` silently converts falsy values (0, undefined, null) to 1. If `tiltPinScale()` returns exactly `0`, it becomes 1 instead. Additionally, if `tiltPinScale()` returns `NaN`, the clamp is applied **after** checking falsy, so `Math.max(0.01, Math.min(NaN || 1, 5))` works, but it's fragile.

**More critically:** Line 1554 uses:
```javascript
const baseScale = state.baseFitScale > 0 ? state.baseFitScale : Math.max(state.fitScale, 1);
```

This can cause `baseScale` to be 1 when neither `baseFitScale` nor `fitScale` are initialized, leading to incorrect dot size calculations when the map first loads.

**Fix:**
```javascript
const baseScale = (state.baseFitScale > 0 ? state.baseFitScale : (state.fitScale || 1));
const dotScale = clamp(state.viewport.scale / baseScale, 0.1, 1.5) * pinScale;
const radius = Math.max(2 * dpr, 4 * dpr * dotScale);  // Enforce minimum radius
```

**Severity:** Medium – user location dot can appear incorrectly sized during initial load or after tilt mode changes

---

### 3. **isNearCanvas() Margin Inconsistency Between Pin Types**
**Location:** `renderer.js`, various draw functions (lines 980, 1142, 1205, 1227, 1249, etc.)

**Problem:**
Different pin types use different culling margins:
- **Trees:** `iconSize * 2` (line 980)
- **Landmarks:** `16 * dpr * uScale` (line 1142) – **hardcoded constant, not based on actual icon size!**
- **Paths:** `iconSize * 2` (line 1205)
- **Water:** `iconSize * 2` (line 1227)
- **Cows:** `iconSize * 2` (line 1249)

The landmark culling margin is **disconnected from the actual landmark icon dimensions**, which vary significantly (beer icon is 1.15× larger, transport icons are 8px, etc.).

**Impact:** Landmarks can appear/disappear erratically at viewport edges, while other pins fade smoothly.

**Fix:**
```javascript
// Standardize all pin types to use consistent culling
const LANDMARK_CULL_MARGIN = 24 * dpr * MAP_ICON_SCALE;

// Then in drawLandmarks:
if (!isNearCanvas(screenPt, LANDMARK_CULL_MARGIN)) continue;
```

**Severity:** High – visual inconsistency and potential off-screen elements

---

### 4. **ensureUserAndSelectionVisible() Has Invisible Snap**
**Location:** `index.html`, lines 3596-3605

**Problem:**
```javascript
if (!options.force && shouldAnimate) {
  const focusRect = bestVisibleCanvasRect();
  const edgeMargin = Math.min(focusRect.width, focusRect.height) * 0.14;
  const allVisible = pointsToFit.every((pt) => {
    const s = worldToScreen(pt);
    return s.x >= focusRect.x + edgeMargin && s.x <= focusRect.x + focusRect.width - edgeMargin
      && s.y >= focusRect.y + edgeMargin && s.y <= focusRect.y + focusRect.height - edgeMargin;
  });
  if (allVisible) return;  // Early exit, no animation!
}
```

When the user moves slightly and both user + destination are within the `14%` margin, the function returns early **without animating**. This can cause a sudden invisible "snap" when the animation stops and resumes at a new position. The margin calculation is also based on `focusRect` but the `worldToScreen()` calls use the unmodified viewport—these can be inconsistent if the inspector changes size during animation.

**Fix:**
```javascript
// Separate detection from animation
if (!options.force && shouldAnimate) {
  const focusRect = bestVisibleCanvasRect();
  const edgeMargin = Math.min(focusRect.width, focusRect.height) * 0.14;
  
  // Check if movement is significant enough to warrant animation
  const anyNearEdge = pointsToFit.some((pt) => {
    const s = worldToScreen(pt);
    const nearLeft = s.x < focusRect.x + edgeMargin;
    const nearRight = s.x > focusRect.x + focusRect.width - edgeMargin;
    const nearTop = s.y < focusRect.y + edgeMargin;
    const nearBottom = s.y > focusRect.y + focusRect.height - edgeMargin;
    return nearLeft || nearRight || nearTop || nearBottom;
  });
  
  if (!anyNearEdge) return;  // Smooth return when safe
}
```

**Severity:** Critical – causes jarring invisible viewport movements

---

### 5. **Inspector Height Changes Mid-Animation Can Break Viewport**
**Location:** `index.html`, lines 590-601 (recentMapForInspectorChange) and `nav.js` line 624-629

**Problem:**
When the user drags the inspector's resize handle while an animation is running, `recentMapForInspectorChange()` is called on every `requestAnimationFrame` without canceling the ongoing viewport animation. This causes **two competing animations** to run simultaneously:

1. Existing `animateViewportTo()` trying to reach the old target
2. New viewport animation from the inspector resize

Since the viewport animation system doesn't detect conflicts, both animate toward conflicting endpoints, causing visible jitter and erratic panning.

**Fix:**
```javascript
function recentMapForInspectorChange(options = {}) {
  const animate = Boolean(options.animate);
  const durationMs = options.durationMs || (animate ? 220 : 0);
  
  // Stop any existing animation before starting a new one
  stopViewportAnimation();
  
  if (!state.userLocation) return;
  if (state.selected && selectedCompassTarget()) {
    centerViewportOnPointsKeepScale(
      [state.userLocation.point, selectedCompassTarget().point],
      { animate, durationMs, focusVisibleArea: true, assumeInspectorOpen: true }
    );
  } else if (isOverviewScreenActive()) {
    ensureOverviewTargetsVisible({ animate, durationMs });
  }
}
```

**Severity:** Critical – causes visible jitter during inspector resize on mobile

---

## 🟡 HIGH-PRIORITY CONCERNS

### 6. **bestVisibleCanvasRect() Can Return Invalid Dimensions**
**Location:** `index.html`, lines 1058-1087

**Problem:**
```javascript
.filter((rect) => rect.width >= 80 && rect.height >= 80);

if (!candidates.length) return full;
```

If all candidates are <80×80 (possible on very small screens or during window resize), it returns the full canvas, which includes the inspector. This defeats the purpose of calculating available space, potentially causing destinations to be positioned **behind the inspector**.

**Fix:**
```javascript
// Use the largest available region, even if below threshold
if (!candidates.length) {
  return candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || full;
}
```

**Severity:** Medium – UX degradation on small screens

---

### 7. **Animation Keyframes Can Have Precision Loss**
**Location:** `index.html`, lines 1038-1040 (animateViewportTo)

**Problem:**
```javascript
state.viewport.scale = state.viewportAnimationFrom.scale + (state.viewportAnimationTo.scale - state.viewportAnimationFrom.scale) * eased;
state.viewport.tx = state.viewportAnimationFrom.tx + (state.viewportAnimationTo.tx - state.viewportAnimationFrom.tx) * eased;
state.viewport.ty = state.viewportAnimationFrom.ty + (state.viewportAnimationTo.ty - state.viewportAnimationFrom.ty) * eased;
```

On very long animations (>2s) or when animating from very large tx/ty values, floating-point precision loss can cause the animation to "overshoot" or "undershoot" the target by a few pixels. This is especially noticeable when combined with repeated animations.

**Mitigation:**
```javascript
if (progress >= 1) {
  // Force exact end values to prevent accumulation of rounding errors
  state.viewport.scale = state.viewportAnimationTo.scale;
  state.viewport.tx = state.viewportAnimationTo.tx;
  state.viewport.ty = state.viewportAnimationTo.ty;
  stopViewportAnimation();
  requestDraw();
  return;
}
```

(This is already present but good to document.)

**Severity:** Low – rare edge case

---

### 8. **screenToWorld() Doesn't Account for Tilt in Some Paths**
**Location:** `index.html`, lines 4775-4780

**Problem:**
```javascript
function screenToWorld(x, y) {
  const rotation = navigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return rawScreenToWorld(x, y);
  // ... handles rotation but NOT tilt
}
```

When tilt mode is active, screen-to-world conversions (used for click handling) don't account for the perspective projection. This means:
- Clicking on a landmark in tilt mode may select the wrong element
- Drag-to-pan calculations are incorrect in tilt mode (though the code has a separate guard at line 508-511 that works around this)

**Fix:**
```javascript
function screenToWorld(x, y) {
  // If tilted, reverse the perspective projection first
  if (typeof tiltActive === "function" && tiltActive() && state.userLocation) {
    const origin = rawWorldToScreen(state.userLocation.point);
    const dpr = pixelRatio();
    const tiltDeg = tiltRotateXDeg();
    if (tiltDeg > 0) {
      const dxCss = (x - origin.x) / dpr;
      const dyCss = (y - origin.y) / dpr;
      const T = tiltDeg * Math.PI / 180;
      const perspectivePx = tiltPerspectivePx();
      
      // Reverse: y = y' / cos(T), and scale factor from original projection
      // This is complex; consider adding a dedicated `screenToWorldTilted()` function
    }
  }
  
  const rotation = navigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return rawScreenToWorld(x, y);
  const unrotated = rotateScreenPoint({ x, y }, rawWorldToScreen(state.userLocation.point), -rotation);
  return rawScreenToWorld(unrotated.x, unrotated.y);
}
```

**Severity:** Medium – affects tilt-mode interaction accuracy

---

## 🟠 INCONSISTENCIES

### 9. **Cluster Expansion Uses Different Tolerances for Different Types**
**Location:** `renderer.js`, lines 868-885 and 887-917

The cluster expansion logic in `applySingletonExpansion()` splits clusters when they contain an expanded item, then `buildTypeClusters()` re-clusters with a hardcoded 30px radius.

**Problem:** If an item is expanded and moves, it will be in its own 1-item cluster, but nearby items at >30px away won't be re-clustered with it, creating visual inconsistency. The clustering threshold should be considered when determining when to expand.

---

### 10. **fitToPoints Padding Varies by Caller**
**Location:** `index.html` and `renderer.js`

Different callers pass different padding values:
- `ensureOverviewTargetsVisible()`: `padding: 28` (line 3801)
- `fitToPoints()` default: `54` (line 954)
- `ensureUserAndSelectionVisible()`: default (54)

This means the same content can be framed differently depending on which function triggered the fit, causing the viewport to jump when switching between overview and selection modes.

**Fix:**
```javascript
const OVERVIEW_FIT_PADDING = 28 * pixelRatio();
const DEFAULT_FIT_PADDING = 54 * pixelRatio();

// Use consistently throughout
```

---

### 11. **Location Marker Opacity Not Synchronized with Cluster Opacity**
**Location:** `renderer.js`, lines 1529-1570 (drawUser) vs. lines 969-992 (drawTrees, etc.)

`drawUser()` doesn't apply `globalAlpha` for out-of-radius markers, but all the landmark/tree drawing functions do (lines 983, 1147, 1207, 1252, etc.). This means the user location marker can appear at full opacity while nearby landmarks fade, breaking visual coherence.

**Fix:**
```javascript
function drawUser(ctx, toScreen, isTilted) {
  if (!state.userLocation || !state.userInMapArea) return;
  // ... existing code ...
  
  // Apply out-of-radius opacity if available
  const isOutOfRadius = state.userLocation && nearbyIconLookup?.outOfRadius?.has(state.userLocation);
  ctx.globalAlpha = isOutOfRadius ? 0.4 : 1;
  
  // ... draw user dot ...
  ctx.globalAlpha = 1;
}
```

**Severity:** Low – minor visual inconsistency

---

### 12. **drawSelectedRoadOverlay Pulse Uses Different Period Than drawSelectedPathOverlay**
**Location:** `renderer.js`, lines 1691 vs 1729

```javascript
// Roads: 400ms period
const pulse = (Math.sin(now / 400) * 0.5 + 0.5);

// Paths: 350ms period  
const pulse = (Math.sin(now / 350) * 0.5 + 0.5);
```

Roads and paths pulse at different rates, creating visual dissonance when both are on screen. They should pulse in sync.

**Fix:**
```javascript
const SELECTED_OVERLAY_PULSE_PERIOD_MS = 380;  // Shared constant
const pulse = Math.sin((now % SELECTED_OVERLAY_PULSE_PERIOD_MS) / SELECTED_OVERLAY_PULSE_PERIOD_MS * Math.PI * 2) * 0.5 + 0.5;
```

---

## 📋 SUMMARY TABLE

| Issue | Type | Location | Impact | Fix Complexity |
|-------|------|----------|--------|-----------------|
| Date.now() jitter in pulse | Critical | renderer.js:1691,1729 | Visible jitter | Medium |
| tiltPinScale bounds check | Critical | renderer.js:1546 | Wrong dot size | Low |
| Landmark culling margin | Critical | renderer.js:1142 | Off-screen landmarks | Low |
| Invisible snap in ensureVisible | Critical | index.html:3596 | Jarring viewport jump | Medium |
| Inspector resize conflict | Critical | index.html:590 | Jitter during drag | Low |
| bestVisibleCanvasRect fallback | High | index.html:1083 | Behind inspector | Low |
| screenToWorld tilt | High | index.html:4775 | Wrong click targets in tilt | High |
| Animation precision | Medium | index.html:1038 | Rare overshoot | Low |
| Cluster expansion consistency | Medium | renderer.js:868 | Visual pop-in | Medium |
| fitToPoints padding variance | Medium | Multiple | Viewport jump | Low |
| User marker opacity | Low | renderer.js:1529 | Visual inconsistency | Low |
| Road/Path pulse mismatch | Low | renderer.js:1691 | Dissonant animation | Low |

---

## ✅ RECOMMENDATIONS

### Phase 1 (Critical - Ship ASAP)
1. Fix `Date.now()` → animation frame time in pulse animations
2. Add `stopViewportAnimation()` before starting new animations (inspector resize)
3. Fix landmark culling margin inconsistency
4. Add bounds validation for `tiltPinScale`

### Phase 2 (High - Next Sprint)
1. Implement proper `screenToWorld()` for tilt mode
2. Fix `ensureUserAndSelectionVisible()` invisible snap
3. Improve `bestVisibleCanvasRect()` fallback logic

### Phase 3 (Polish - Later)
1. Standardize padding constants across fit functions
2. Sync road/path pulse periods
3. Add out-of-radius opacity to user marker
4. Improve cluster expansion UX

---

## 🧪 Testing Recommendations

1. **Animation smoothness test:** Record 60fps video of viewport animations on slow device; look for frame skips
2. **Inspector resize test:** Open inspector, select item, drag resize handle; watch for jitter
3. **Tilt interaction test:** Enable tilt, click landmarks near screen edges; verify correct element selected
4. **Edge margin test:** Pan viewport slowly; observe landmark appearance/disappearance smoothness
5. **Load state test:** Reload page with location permission; verify user dot size matches expectations
