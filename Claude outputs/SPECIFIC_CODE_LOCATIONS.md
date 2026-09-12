# Specific Code Locations & Fixes Needed

## Critical Code Locations Requiring Investigation

### 1. SCOPE ISSUE: selectedRoutePoints Not Accessible

**File**: `index.html`  
**Function**: `ensureUserAndSelectionVisible()` at line ~3581

**Current Code** (BROKEN):
```javascript
if (target.point && typeof selectedRoutePoints === "function") {
  // This always fails because selectedRoutePoints is not in this scope
  const routePoints = selectedRoutePoints(target);
  if (routePoints && routePoints.length > 0) {
    pointsToFit.push(...routePoints);
  }
}
```

**Why It Fails**:
- `selectedRoutePoints()` is defined in `js/renderer.js` line 670
- It's not exported or made global
- `typeof selectedRoutePoints === "undefined"` in index.html scope
- Condition never true, route points never added

**Required Fix**:
Option A: Make selectedRoutePoints accessible globally
```javascript
// In js/renderer.js, after function definition:
window.selectedRoutePoints = selectedRoutePoints;
```

Option B: Replicate route calculation in index.html scope
```javascript
// Move route calculation logic into ensureUserAndSelectionVisible
// or call a wrapper that works in global scope
```

Option C: Create a global helper function in index.html
```javascript
function getRoutePointsForTarget(target) {
  // Duplicate or wrap the logic from selectedRoutePoints
  // Make sure it handles:
  // - Routing graph not ready (state.routingGraphReady === false)
  // - No route found (return straight line)
  // - Graph available (return actual route)
}
```

---

### 2. TIMING ISSUE: Routing Graph May Not Be Ready

**File**: `js/renderer.js`  
**Function**: `selectedRoutePoints()` at line 670

**Current Code**:
```javascript
function selectedRoutePoints(target) {
  const from = state.userLocation.point;
  const to = target.point;
  const straightLine = [from, to];

  ensureRoutingGraph();  // Starts async build but doesn't wait
  if (!state.routingGraphReady || !state.routingGraph) 
    return straightLine;  // ❌ RETURNS STRAIGHT LINE IF NOT READY!

  const routed = findRoutePoints(state.routingGraph, from, to, {
    toLatLon: unprojectPoint,
    distanceMetresFn: distanceMetres,
  });
  return routed || straightLine;
}
```

**The Problem**:
- `ensureRoutingGraph()` starts async graph building via `buildRoutingGraphAsync()`
- But `selectedRoutePoints()` immediately checks if graph is ready
- If graph still building → returns straight line
- Route waypoints never included in fit

**Where Graph Becomes Ready**:
- File: `js/loader.js` (look for `ensureRoutingGraph`)
- Graph building is async: `buildRoutingGraphAsync()` from `js/routing.js`
- After graph built, `state.routingGraphReady` set to true

**Required Fix - Option 1: Wait for Graph**
```javascript
function ensureUserAndSelectionVisible(options = {}) {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) return;
  
  // NEW: Wait for routing graph if needed
  if (!state.routingGraphReady) {
    // Instead of proceeding with incomplete data:
    // Schedule retry after graph is ready
    const checkInterval = setInterval(() => {
      if (state.routingGraphReady) {
        clearInterval(checkInterval);
        ensureUserAndSelectionVisible(options); // Retry with ready graph
      }
    }, 50);
    return; // Don't proceed yet
  }
  
  // NOW routing graph is guaranteed ready
  // Can safely call selectedRoutePoints
}
```

**Required Fix - Option 2: Force Graph Build**
```javascript
// In ensureUserAndSelectionVisible:
if (target.point) {
  // Ensure routing graph exists and is built
  ensureRoutingGraph();
  
  // Instead of checking readiness, assume it's being built
  // and use a conservative estimate for initial fit
  // Then adjust after route is calculated
}
```

---

### 3. MODAL TIMING ISSUE: Bounds Calculated Before Modal Visible

**File**: `index.html`  
**Function**: `applyBoundsToViewport()` at line ~955

**Current Code**:
```javascript
function applyBoundsToViewport(bounds, options = {}) {
  const padding = (options.padding != null ? options.padding : DEFAULT_FIT_PADDING_PX) * pixelRatio();
  const defaultRect = visibleCanvasRect();
  
  const focusRect = options.customFocusRect
    || (options.focusVisibleArea
      ? bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) })
      : defaultRect);
  // ❌ bestVisibleCanvasRect() called here
  // But modal might not be fully visible yet!
  
  const viewportWidth = Math.max(1, focusRect.width);
  const viewportHeight = Math.max(1, focusRect.height);
  const rangeX = Math.max(0.0001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.0001, bounds.maxY - bounds.minY);
  state.fitScale = Math.min((viewportWidth - padding * 2) / rangeX, (viewportHeight - padding * 2) / rangeY);
  // ❌ fitScale calculated based on potentially wrong focusRect
}
```

**The Problem**:
- When tree selected, modal starts CSS transition animation (180ms)
- `applyBoundsToViewport()` called at t=0ms
- Calls `bestVisibleCanvasRect()` at t=0ms
- Modal not fully visible until t=150ms
- Viewport fitted for incomplete modal bounds

**Where Modal Animation Tracked**:
- File: `css/inspector.css` - modal has `transition: max-height 180ms`
- File: `js/inspector.js` line ~930 - `zoomToSelection()` waits for transition

**Current Modal Timing Code** (in zoomToSelection):
```javascript
function zoomToSelection() {
  const doZoom = () => {
    // ... zoom code ...
  };

  if (!els.inspector.classList.contains("minimized")) {
    doZoom();
    return;  // Inspector already open, don't wait
  }
  
  state.selectionViewportTransitionPending = true;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    doZoom();
  };
  
  els.inspector.addEventListener("transitionend", fire, { once: true });
  // Mirrors the 180ms `.inspector` max-height transition in css/inspector.css
  // plus a ~40ms buffer so the camera measures after the minimized layout settles.
  setTimeout(fire, INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS);
}
```

**Required Fix - Option 1: Use Same Timing Pattern in ensureUserAndSelectionVisible**
```javascript
function ensureUserAndSelectionVisible(options = {}) {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) return;
  
  const shouldAnimate = options.animate !== false;
  
  // Check if modal is animating
  if (els.inspector.classList.contains("minimized")) {
    // Modal is animating in, wait for it
    const doFit = () => {
      // Now modal is fully visible
      // Call fitToPoints with accurate focusRect
      fitToPointsWithRoute(pointsToFit, shouldAnimate);
    };
    
    els.inspector.addEventListener("transitionend", doFit, { once: true });
    setTimeout(doFit, INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS);
    return;
  }
  
  // Modal already open, proceed immediately
  fitToPointsWithRoute(pointsToFit, shouldAnimate);
}
```

**Required Fix - Option 2: Use Conservative Modal Margin**
```javascript
function applyBoundsToViewport(bounds, options = {}) {
  // Add extra padding to account for modal that might be animating in
  const padding = (options.padding != null ? options.padding : DEFAULT_FIT_PADDING_PX) * pixelRatio();
  
  // If a selection is active (modal likely to appear), add buffer
  let extraMargin = 0;
  if (state.selected && els.inspector.classList.contains("minimized")) {
    // Modal animating in, add conservative extra space
    extraMargin = 200; // pixels
  }
  
  const focusRect = ...;
  const adjustedHeight = Math.max(1, focusRect.height - extraMargin);
  
  const state.fitScale = Math.min(
    (focusRect.width - padding * 2) / rangeX,
    (adjustedHeight - padding * 2) / rangeY  // Use adjusted height
  );
}
```

---

### 4. ROUTE EXTENT UNKNOWN UNTIL FIRST RENDER

**File**: `js/renderer.js`  
**Function**: `drawSelectedRoute()` at line 719 and `selectedRoutePoints()` at line 670

**Current Flow**:
```
Viewport Animation:  0────200────400────600────800ms [COMPLETES]
                       ↓
Route Calculation:              250ms [First drawSelectedRoute call]
                                    ↓
                          Dijkstra runs, route calculated
                          [But viewport already set!]
```

**The Problem**:
- Viewport animation completes at 800ms
- Route first calculated at ~250ms during render
- But route calculation result never updates viewport
- Viewport calculated for straight line (100m)
- Actual route might be 548m

**Where Route First Calculated**:
- File: `js/renderer.js` line 724
- Function: `drawSelectedRoute()` calls `selectedRoutePoints()`
- Returns points to draw but doesn't update viewport

**Current Code**:
```javascript
function drawSelectedRoute(ctx) {
  const target = selectedCompassTarget();
  if (!state.userLocation || !target) return;

  const dpr = pixelRatio();
  const points = selectedRoutePoints(target).map(worldToScreen);
  // ✅ Route points calculated here FOR FIRST TIME
  // ❌ But viewport already animated, no adjustment happens
  
  const routeLineWidth = 3 * dpr;
  const haloLineWidth = routeLineWidth + 3 * dpr;
  
  ctx.save();
  // ... draw the route ...
  ctx.restore();
}
```

**Required Fix - Option 1: Recalculate Viewport After Route**
```javascript
function drawSelectedRoute(ctx) {
  const target = selectedCompassTarget();
  if (!state.userLocation || !target) return;

  const dpr = pixelRatio();
  const points = selectedRoutePoints(target);
  
  // NEW: Check if this is first time route was calculated
  if (state.selectedRouteCache.points !== points && points.length > 2) {
    // Route changed or newly calculated
    // Recalculate viewport to fit full route
    fitToPoints(points, false, {
      focusVisibleArea: true,
      animate: true,  // Smooth adjustment
      durationMs: 300,
    });
  }
  
  const screenPoints = points.map(worldToScreen);
  // ... draw the route ...
}
```

**Required Fix - Option 2: Pre-Calculate Route Before Viewport Animation**
```javascript
function ensureUserAndSelectionVisible(options = {}) {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) return;

  let pointsToFit = [state.userLocation.point];
  
  // NEW: Calculate route before viewport animation
  if (target.point && state.routingGraphReady) {
    try {
      // Directly call findRoutePoints from routing.js
      const routed = findRoutePoints(state.routingGraph, state.userLocation.point, target.point, {
        toLatLon: unprojectPoint,
        distanceMetresFn: distanceMetres,
      });
      if (routed) {
        pointsToFit.push(...routed);
      } else {
        pointsToFit.push(target.point);
      }
    } catch (e) {
      pointsToFit.push(target.point);
    }
  } else {
    pointsToFit.push(target.point);
  }
  
  fitToPoints(pointsToFit, false, {
    focusVisibleArea: true,
    animate: shouldAnimate,
    durationMs: options.durationMs || 800,
  });
}
```

---

### 5. USER LOCATION CENTERING WASTES SPACE WITH MODAL

**File**: `index.html`  
**Function**: `fitToPoints()` and `applyBoundsToViewport()` at line ~942-970

**Current Code**:
```javascript
function applyBoundsToViewport(bounds, options = {}) {
  // ...
  const focusRect = options.customFocusRect
    || (options.focusVisibleArea
      ? bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) })
      : defaultRect);
  
  // Viewport fitted to center on bounds within focusRect
  const targetTx = focusRect.x + (viewportWidth - rangeX * targetScale) / 2 - bounds.minX * targetScale;
  const targetTy = focusRect.y + (viewportHeight - rangeY * targetScale) / 2 - bounds.minY * targetScale;
  
  // ❌ Centers based on focusRect
  // But focusRect might be narrow due to modal
  // User location centered in narrow space = wasted map area
}
```

**The Problem**:
- When modal open and taking 30-40% of screen
- focusRect is remainder area
- Centers user location within that remainder
- User location might be at screen center, modal blocks opposite side
- Inefficient space usage

**Required Fix - Option 1: Offset User Location**
```javascript
function applyBoundsToViewport(bounds, options = {}) {
  const focusRect = options.focusVisibleArea
    ? bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) })
    : defaultRect;

  // If modal is open, offset center point away from modal
  let centerPoint = {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height / 2,
  };
  
  // NEW: If modal is open, move center upward/away from modal
  if (els.inspector && !els.inspector.classList.contains("minimized")) {
    const modalOverlap = inspectorCanvasOverlapRect();
    if (modalOverlap) {
      // Shift center away from modal area
      centerPoint.y -= (modalOverlap.height / 4);
      // Or bias toward top of screen where modal isn't
    }
  }
  
  // Use offset center point instead of focusRect center
  const targetTx = centerPoint.x - (rangeX * targetScale) / 2 - bounds.minX * targetScale;
  const targetTy = centerPoint.y - (rangeY * targetScale) / 2 - bounds.minY * targetScale;
}
```

---

## Testing Checklist After Fixes

```javascript
// Each of these should result in COMPLETE route visibility:

TEST 1: Short Nearby Tree
  Tree: 100m away, direct route
  Expected: User + destination + straight line all visible
  Pass: ✅ if all visible, ❌ if any cropped

TEST 2: Long Winding Route  
  Tree: 500m+ away through forest, likely detours
  Expected: Every waypoint visible, modal doesn't overlap route
  Pass: ✅ if route fully visible, ❌ if route cropped

TEST 3: Maximum Distance Tree
  Tree: At edge of forest, opposite direction
  Expected: Route might zigzag, all still visible
  Pass: ✅ if zoom out enough to fit, ❌ if zoomed in too far

TEST 4: Graph Building Race Condition
  Immediately select tree after app loads (before graph ready)
  Expected: Viewport still fits when graph becomes ready
  Pass: ✅ if viewport adjusts, ❌ if stuck with bad bounds

TEST 5: Modal Animation Sync
  Select tree while modal is minimized/animating
  Expected: Viewport accounts for modal even during animation
  Pass: ✅ if no overlap, ❌ if modal hides route during animation

TEST 6: Multiple Quick Selections
  Select tree → select different tree before first fit completes
  Expected: Viewport updates to second tree's route
  Pass: ✅ if correct tree shown, ❌ if viewport confused

TEST 7: Phone vs Desktop Width
  Test 375px phone width, then 1920px desktop
  Expected: Route visible at both sizes
  Pass: ✅ if works at both, ❌ if fails at one size

TEST 8: Different Screen Orientations
  Portrait (400x800), then Landscape (800x400)
  Expected: Route fits in both orientations
  Pass: ✅ if route always visible, ❌ if orientation breaks fit
```

---

## Summary for Higher Model

**The attempted fix failed because**:
1. `selectedRoutePoints()` not accessible in ensureUserAndSelectionVisible() scope
2. Routing graph may not be ready when viewport calculated
3. Modal animation timing not coordinated with viewport fit
4. Route calculated AFTER viewport animation already complete
5. User location centering doesn't account for modal

**Required fixes involve**:
- Making route calculation available in viewport fit scope
- Waiting for/detecting routing graph readiness
- Coordinating modal animation with viewport timing
- Pre-calculating route before viewport animation
- Offsetting user location away from modal

**Key files to modify**:
- `index.html` - ensureUserAndSelectionVisible(), fitToPoints(), applyBoundsToViewport()
- `js/renderer.js` - selectedRoutePoints(), drawSelectedRoute()
- `js/routing.js` - Make findRoutePoints accessible

**Recommended approach**: Implement pre-route-calculation with graph readiness check before viewport animation starts.
