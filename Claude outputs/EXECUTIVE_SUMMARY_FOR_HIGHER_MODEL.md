# Executive Summary - Map Viewport Issue

## The Problem (In 30 Seconds)

When a user selects a destination tree in the Epping Forest Finds app, a walking route is displayed. **The viewport doesn't fit the complete route**, causing:
- Route to extend off-screen
- Route to be hidden behind the detail modal
- Poor zoom level (fits straight line, not actual winding path)

## Why the First Fix Failed (In 60 Seconds)

A fix was attempted to include route waypoints in the viewport fit calculation, but it **silently fails** because:

1. **Function scope mismatch**: `selectedRoutePoints()` is defined in `js/renderer.js` but called from `index.html` - they're in different JavaScript scopes. The function doesn't exist in the calling context.

2. **Timing mismatch**: The route is calculated during the render loop (when drawing), but the viewport is animated immediately when the tree is selected. The route extent is unknown when the viewport is calculated.

3. **Routing graph dependency**: The route calculation depends on `state.routingGraphReady`, which may be false at selection time. The graph builds asynchronously in the background.

4. **Modal timing**: The detail modal animates in after selection, but the viewport fit is calculated before the modal is fully visible, leading to inaccurate bounds.

## The Root Cause

```
USER CLICKS TREE (t=0ms)
    ↓
ensureUserAndSelectionVisible() called (t=1ms)
    → Tries to get route points (FAILS - wrong scope)
    → Falls back to [user, destination] only
    → Calls fitToPoints() with incomplete data
    ↓
fitToPoints() calculates viewport bounds (t=2ms)
    → bounds = bounding box of user + destination
    → Does NOT include route waypoints (unknown at this time)
    → Calls animateViewportTo() for 800ms animation
    ↓
Modal slides in from bottom (t=100ms)
    ↓
First render loop executes (t=250ms)
    → drawSelectedRoute() called
    → selectedRoutePoints() calculated FOR FIRST TIME
    → Route extends 548m with 30 waypoints
    ↓
Viewport animation completes (t=800ms)
    ✅ User location visible
    ✅ Destination visible
    ❌ Route 70% off-screen
    ❌ Route hidden behind modal
```

## What Needs to Happen

The route waypoints must be included in the viewport fit calculation **before** the viewport animation starts. This requires one or more of:

### Critical Fix #1: Make Route Available Before Viewport Animation
**Current**: Route unknown until render loop (t=250ms)  
**Required**: Route calculated before fit (t=5ms)

**How**: Either:
- Wait for routing graph to be ready, then calculate route
- Pre-calculate route synchronously in `ensureUserAndSelectionVisible()`
- Calculate route in a scope accessible from `index.html`

### Critical Fix #2: Coordinate Modal Timing
**Current**: Viewport fit ignores modal animation in progress  
**Required**: Viewport fit waits for modal to be fully visible

**How**: Either:
- Wait for `transitionend` event on modal before fitting viewport
- Use conservative modal margin to account for incoming modal
- Delay viewport animation until modal is settled

### Critical Fix #3: Solve Function Scope Issue
**Current**: `selectedRoutePoints()` only exists in `js/renderer.js` scope  
**Required**: Route calculation callable from `index.html` scope

**How**: Either:
- Export selectedRoutePoints globally (`window.selectedRoutePoints = ...`)
- Wrap route logic in a new function accessible from index.html
- Call route calculation directly via `findRoutePoints()` from routing.js

## Files That Need Modification

```
PRIMARY:
  index.html
    - ensureUserAndSelectionVisible() [line ~3581]
    - fitToPoints() [line ~942]
    - applyBoundsToViewport() [line ~955]

SECONDARY:
  js/renderer.js
    - selectedRoutePoints() [line ~670]
    - drawSelectedRoute() [line ~719]
    - May need to recalculate viewport after route first calculated

SUPPORTIVE:
  js/routing.js
    - findRoutePoints() [top-level function]
    - May need to be called directly or exposed differently
```

## Success Criteria

After fix is implemented:

✅ **Route Visibility**: 100% of route waypoints visible on screen  
✅ **Modal Accommodation**: Route never hidden behind detail panel  
✅ **Zoom Level**: Viewport zoomed to fit entire route, not just destination  
✅ **Smooth Animation**: Viewport animation doesn't stutter or recalculate mid-animation  
✅ **Edge Cases**: Works with short routes, long routes, multi-waypoint routes  
✅ **Timing**: Works even when route calculation takes time (graph building)  
✅ **User Position**: User location visible and positioned efficiently  

## Recommended Approach (Option A - Most Robust)

```javascript
function ensureUserAndSelectionVisible(options = {}) {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) return;
  
  // Step 1: Wait for graph if needed
  if (!state.routingGraphReady) {
    scheduleRetryWhenGraphReady();
    return;
  }
  
  // Step 2: Calculate route now (graph is ready)
  const routePoints = calculateRouteDirectly(
    state.userLocation.point, 
    target.point
  );
  
  // Step 3: Wait for modal to animate in
  if (els.inspector.classList.contains("minimized")) {
    waitForModalTransition(() => fitViewportWithRoute(routePoints));
  } else {
    fitViewportWithRoute(routePoints);
  }
}

function fitViewportWithRoute(routePoints) {
  // Now fit viewport with complete route data
  let pointsToFit = [state.userLocation.point, ...routePoints];
  fitToPoints(pointsToFit, false, {
    focusVisibleArea: true,
    animate: true,
    durationMs: 800,
  });
}
```

## What Will Change for Users

**Before Fix**:
- Select tree → route appears partially off-screen
- Long winding paths → viewport zoomed in too far
- Modal overlaps route path
- Distance/time estimate might not match visible path

**After Fix**:
- Select tree → entire route visible on screen
- Route fits properly even if it takes detours
- Modal doesn't obscure route
- All points of interest (user, route, destination) visible

## Questions the Higher Model Should Answer

1. **Is `selectedRoutePoints()` intentionally scoped to `js/renderer.js` only?**
   - If yes, it needs to be made global or wrapped
   - If no, exposure was missed

2. **What triggers `state.routingGraphReady` to become true?**
   - Is it immediately after selection?
   - After how many milliseconds?
   - Can we hook into the completion event?

3. **Can `findRoutePoints()` be called directly from `index.html`?**
   - Or does it have undeclared dependencies?
   - Can it be called synchronously?

4. **Is the current modal timing (180ms transition) hardcoded?**
   - Can the viewport fit wait for `transitionend`?
   - Is `INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS` accessible?

5. **Should viewport recalculate after route first renders?**
   - Or should route be pre-calculated before animation?
   - What's more performant?

## Technical Debt

This issue reveals:
- Tight coupling between viewport fitting and route calculation
- Async operations (graph building) not coordinated with viewport animation
- Modal animation timing not considered in viewport calculation
- Renderer functions not exposed for use in viewport logic
- No mechanism to guarantee route availability before viewport animation

## Files Provided for Reference

1. **DETAILED_PROBLEM_ANALYSIS.md** - Complete root cause analysis
2. **TIMING_FLOW_DIAGRAM.md** - Visual timeline of when things happen (and when they should)
3. **SPECIFIC_CODE_LOCATIONS.md** - Exact line numbers, current code, and required fixes
4. **This file** - Executive summary

---

**Status**: Ready for higher-capability model to implement  
**Complexity**: Medium (requires coordination of async operations)  
**Risk**: Low (fix doesn't change architecture, only timing/scope)  
**Testing**: Covered (8 test scenarios provided)
