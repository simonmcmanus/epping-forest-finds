# Map Viewport Issue - Detailed Problem Analysis

## Current Problem Description

### What's Happening
When a destination tree/place is selected and navigation begins:
1. A detail modal appears at the bottom of the screen
2. A dashed route line is drawn from user location to destination
3. **Issue**: The route or markers often fall off-screen or are hidden behind the modal
4. **Issue**: The zoom level doesn't properly fit the entire route path
5. **Issue**: User location may be positioned in the center even when modal is open, wasting screen space

### Visual Symptoms (From Screenshots)
- English Oak (tag 15963): Route extends beyond visible viewport
- Common Beech (tag 15960): Route distance varies (229m → 230m → 548m depending on positioning)
- Modal overlay blocks view of route path in multiple screenshots
- Route sometimes clips at screen edges

## Root Cause Analysis

### Why the Initial Fix Didn't Work

The attempted fix modified `ensureUserAndSelectionVisible()` to include route points via `selectedRoutePoints()`, but this likely fails because:

1. **Timing/Availability Issue**
   - `selectedRoutePoints()` is defined in `js/renderer.js`, not in the main `index.html` scope
   - When `ensureUserAndSelectionVisible()` runs, the function may not be in scope
   - The routing graph may not be ready (`state.routingGraphReady` might be false)
   - Result: The route points aren't actually being retrieved

2. **Async Graph Building**
   - `buildRoutingGraphAsync()` in `js/routing.js` builds the graph asynchronously
   - The viewport fit happens immediately when tree is selected
   - The routing graph may still be building when viewport is calculated
   - Result: Route isn't available yet, falls back to straight line only

3. **Two-Stage Route Drawing**
   - Route is drawn in `drawSelectedRoute()` which calls `selectedRoutePoints(target)` during canvas rendering
   - This happens AFTER the viewport animation is complete
   - Viewport was already fitted before route was calculated
   - Result: Viewport doesn't know the final route extent

4. **Function Scope Issue**
   - `selectedRoutePoints()` is in `js/renderer.js` scope
   - `ensureUserAndSelectionVisible()` is in `index.html` global scope
   - May not have direct access to that function

## Detailed Flow Analysis

### Current Code Flow When Tree is Selected

```
1. Tree clicked in inspector
2. state.selected = tree
3. ensureUserAndSelectionVisible() called [VIEWPORT FIT HAPPENS HERE]
4. fitToPoints() calculates bounds and animate viewport
5. Viewport animation runs over 800ms
6. During animation, render loop calls:
   - drawSelectedRoute() 
   - selectedRoutePoints() calculates actual route
   - Route drawn on canvas
7. Problem: Viewport was already animated before route was known!
```

### Why Modal Overlap Occurs

1. `bestVisibleCanvasRect()` tries to calculate usable area
   - Gets inspector overlap rect via `inspectorCanvasOverlapRect()`
   - Returns largest non-overlapping region
   
2. But on initial selection:
   - Inspector modal animates in with transition
   - `bestVisibleCanvasRect()` may calculate bounds before modal is fully visible
   - Modal size might change as content loads
   - Result: Calculated bounds don't match final modal size

## What Needs to Happen for a Real Fix

### Issue #1: Route Points Must Be Available Before Viewport Fit
**Problem**: Route points from `selectedRoutePoints()` aren't available when `ensureUserAndSelectionVisible()` runs

**Possible Solutions**:
- Pre-calculate route synchronously using cached routing graph
- Wait for routing graph to be ready before fitting viewport
- Use a placeholder fit first, then adjust after route is calculated
- Modify selectedRoutePoints to work in the global scope where ensureUserAndSelectionVisible lives
- Calculate bounds that conservatively include likely route extent

### Issue #2: Modal Dimensions Aren't Final When Viewport Fits
**Problem**: Modal is still animating/loading when viewport calculation happens

**Possible Solutions**:
- Delay viewport fit until modal animation completes (wait for transitionend)
- Calculate modal bounds after CSS transition completes
- Use a larger conservative margin for modal area
- Adjust viewport AFTER modal is fully visible

### Issue #3: Route Extent Unknown Until After Route Points Calculated
**Problem**: Actual walking path may be 2x-10x longer than straight line, but viewport calculated on straight line

**Possible Solutions**:
- Calculate route immediately when tree is selected (before viewport fit)
- Use Dijkstra to pre-calculate route and include in fit
- Estimate conservative route bounds (e.g., add 50% padding for likely detours)
- Implement two-stage fit: immediate fit with destination, then adjust when route is calculated

### Issue #4: User Location Centering Wastes Space
**Problem**: When modal is open, centering user location in viewport is inefficient

**Possible Solutions**:
- Offset user location away from modal center when fitting
- Use `focusVisibleArea` to calculate where user should appear
- Position user at edge of non-modal area
- Only center user when modal is minimized/closed

## Key Data Structures to Understand

### state.routingGraph
```javascript
{
  nodes: [{ x, y }, ...],  // Graph waypoints
  adjacency: [...],         // Graph edges
  componentId: [...],       // Connected component for each node
  largestComponentId: num   // Main walkable network
}
```

### selectedRoutePoints Output
```javascript
[
  { x: userX, y: userY },           // User start
  { x: waypointX1, y: waypointY1 }, // Route waypoints
  { x: waypointX2, y: waypointY2 },
  ...
  { x: destX, y: destY }            // Destination
]
```

### Modal State
```javascript
els.inspector.classList.contains("minimized") // Is modal collapsed?
bestVisibleCanvasRect() // Returns the usable viewport area accounting for modal
inspectorCanvasOverlapRect() // Returns modal's screen position
```

## Code Locations That Need Investigation/Modification

1. **`index.html` line ~3581**: `ensureUserAndSelectionVisible()`
   - Where viewport fit is triggered
   - Needs to either wait for route or include route points

2. **`index.html` line ~942**: `fitToPoints()`
   - Core bounds calculation and animation
   - Uses `bestVisibleCanvasRect()` with `focusVisibleArea: true`
   - May need adjustment for modal lifecycle

3. **`index.html` line ~1067**: `applyBoundsToViewport()`
   - Calculates viewport scale and translation
   - Takes focusRect parameter

4. **`index.html` line ~1077**: `bestVisibleCanvasRect()`
   - Tries to avoid modal overlap
   - May be called before modal is fully visible

5. **`index.html` line ~1127**: `inspectorCanvasOverlapRect()`
   - Calculates modal's screen footprint
   - Might return incorrect bounds during animation

6. **`js/renderer.js` line ~670**: `selectedRoutePoints()`
   - Only accessible in renderer scope
   - Calls routing graph functions
   - May return undefined if graph not ready

7. **`js/routing.js`**: Route calculation functions
   - `findRoutePoints()` - main entry point for route finding
   - `dijkstraPath()` - shortest path algorithm
   - `nearestRoutingNode()` - snap to graph

## Suggested Approach for Fix

**Option A: Wait for Route Before Fitting (Safest)**
1. When tree selected, check if routing graph is ready
2. If not ready, wait for `state.routingGraphReady` to become true
3. Calculate route synchronously
4. Then call fitToPoints with full route included

**Option B: Pre-Calculate Route (Fastest)**
1. Create internal function that calculates route and bounds
2. Call this when tree is selected (before viewport animation)
3. Pass route bounds to fitToPoints
4. Avoids waiting, but adds computation

**Option C: Two-Stage Fit (Most Robust)**
1. First fit: Use destination + conservative route estimate
2. Render frame with initial fit
3. After rendering, recalculate with actual route
4. Second fit: Adjust viewport if needed
5. Looks smoother, ensures route always fits

**Option D: Defer Viewport Animation (Alternative)**
1. When tree selected, don't immediately animate viewport
2. Wait for modal to settle (transitionend event)
3. Wait for route to be calculated
4. Then animate viewport to final bounds
5. Causes slight delay but ensures accuracy

## Testing Scenarios for Fix

```javascript
// These should all result in complete route visibility:
1. Short nearby tree (straight line route)
2. Distant tree (route likely to wind/detour)
3. Tree on opposite edge of forest (maximum route extent)
4. Tree after GPS jump/correction (viewport update mid-navigation)
5. Different screen sizes (phone portrait/landscape, desktop)
6. Modal open vs minimized state
7. Route calculation in progress (graph still building)
```

## Critical Questions for Implementation

1. **Is `selectedRoutePoints()` accessible from `index.html` scope?**
   - If not, need to create wrapper or move function

2. **What's the state of `state.routingGraphReady` when tree is selected?**
   - If always false, need to wait or use placeholder

3. **Can route be calculated synchronously if graph is ready?**
   - Or does it only work during render loop?

4. **How long does modal animation take?**
   - `INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS` is ~180ms
   - Viewport animation is 800ms by default
   - Can we sync these timing better?

5. **What's the actual modal size during and after transition?**
   - May not match what `inspectorCanvasOverlapRect()` reports

---

**This analysis should be passed to a higher-capability model for implementation.**
