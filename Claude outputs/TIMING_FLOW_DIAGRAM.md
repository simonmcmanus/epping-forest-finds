# Timing Flow Diagram - Why the Viewport Fix Failed

## The Core Problem: Timing Mismatch

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CURRENT BROKEN FLOW                                                      │
└─────────────────────────────────────────────────────────────────────────┘

TIME    EVENT                                          VIEWPORT STATE
────────────────────────────────────────────────────────────────────────
  0ms   User clicks tree in list
        → state.selected = tree
        → zoomToSelection() called
        → ensureUserAndSelectionVisible() called
        
  1ms   ensureUserAndSelectionVisible() runs:
        ❌ Tries to call selectedRoutePoints(target)
        ❌ selectedRoutePoints not in scope! 
           (It's in js/renderer.js, not index.html)
        ❌ Falls back to [userLocation, destination] only
        
  2ms   fitToPoints() calculates bounds:
        ❌ Bounds = bounding box of user + destination
        ❌ Does NOT include route waypoints
        ❌ Does NOT know route will be 548m detour
        
  3ms   animateViewportTo() starts
        → Begins 800ms animation
        → scale, tx, ty animating toward calculated value
        
 100ms  Inspector modal slides in from bottom
        → Modal size not fully known yet
        → bestVisibleCanvasRect() might be inaccurate
        → Viewport animation still running
        
 150ms  CSS transition settles
        → Modal is now fully visible
        → Its overlap area is now definitive
        
 250ms  First render of route
        → drawSelectedRoute() called
        → selectedRoutePoints(target) called NOW
        → Route calculated via Dijkstra
        → Route extends 548m with multiple waypoints
        → BUT VIEWPORT ALREADY ANIMATED! ❌
        
 800ms  Viewport animation completes
        → Final viewport position set
        → Route partially off-screen
        → Route hidden behind modal
        → ❌ PROBLEM VISIBLE TO USER


┌─────────────────────────────────────────────────────────────────────────┐
│ WHY THE ATTEMPTED FIX FAILED                                            │
└─────────────────────────────────────────────────────────────────────────┘

The code change tried to call selectedRoutePoints() in ensureUserAndSelectionVisible():

  ❌ PROBLEM 1: Function Scope
     ensureUserAndSelectionVisible() is in index.html global scope
     selectedRoutePoints() is defined in js/renderer.js scope
     typeof selectedRoutePoints === "undefined" 
     → Condition fails, falls back to destination-only fit

  ❌ PROBLEM 2: Routing Graph Not Ready
     state.routingGraphReady might be false at selection time
     → selectedRoutePoints() checks this and returns straight line
     → Still doesn't include all route waypoints

  ❌ PROBLEM 3: Route Calculation Timing
     Even if selectedRoutePoints() was accessible and graph was ready:
     → First call recalculates fresh route (expensive Dijkstra)
     → May not be the final routed path
     → Route might differ on next render after location changes


┌─────────────────────────────────────────────────────────────────────────┐
│ WHAT NEEDS TO HAPPEN                                                    │
└─────────────────────────────────────────────────────────────────────────┘

SOLUTION APPROACH: Get Route Points BEFORE Viewport Animation

TIME    EVENT
────────────────────────────────────────────────────────────────────────
  0ms   User clicks tree
        → state.selected = tree

  1ms   NEW: Check routing graph availability
        → Is state.routingGraphReady === true?
        → If no → wait for it to be ready
        → If yes → continue

  2ms   NEW: Calculate route BEFORE viewport fit
        → Call findRoutePoints() directly
        → Get actual route waypoints
        → Include in bounds calculation

  3ms   fitToPoints() with COMPLETE route
        → Bounds now include: user + destination + ALL route waypoints
        → Properly sized viewport calculated
        → bestVisibleCanvasRect() accounts for incoming modal

  4ms   animateViewportTo() with correct bounds
        → Animation starts with correct scale/position
        → Includes entire route path

 100ms  Modal slides in
        → Viewport already sized to fit route + modal overlap

 800ms  Animation completes
        → ✅ ENTIRE ROUTE VISIBLE
        → ✅ MODAL DOESN'T HIDE ROUTE
        → ✅ USER LOCATION POSITIONED OPTIMALLY
```

## Specific Code Scope Issues

```javascript
// ❌ IN index.html (ensureUserAndSelectionVisible location)
function ensureUserAndSelectionVisible(options = {}) {
  // selectedRoutePoints is NOT accessible here!
  // typeof selectedRoutePoints === "undefined"
  
  // It's defined in js/renderer.js:670
  // Only accessible in that file's scope
  
  if (target.point && typeof selectedRoutePoints === "function") {
    // This condition will ALWAYS BE FALSE
    // selectedRoutePoints not in this scope
    const routePoints = selectedRoutePoints(target); // ReferenceError!
  }
}

// ✅ IN js/renderer.js (where selectedRoutePoints is defined)
function selectedRoutePoints(target) {
  const from = state.userLocation.point;
  const to = target.point;
  const straightLine = [from, to];

  ensureRoutingGraph(); // Makes sure graph is building
  if (!state.routingGraphReady || !state.routingGraph) 
    return straightLine; // Falls back if graph not ready!

  const routed = findRoutePoints(state.routingGraph, from, to, {
    toLatLon: unprojectPoint,
    distanceMetresFn: distanceMetres,
  });
  return routed || straightLine;
}
```

## Modal Timing Issues

```javascript
// Modal animation happens AFTER viewport is calculated
TIMELINE:
  0ms ──────────────── ensureUserAndSelectionVisible()
  1ms ────────────────┌─ fitToPoints() calculates bounds
  3ms ───────────────┌┴─ animateViewportTo() starts 800ms animation
  100ms ────────────┌┴─ Inspector modal CSS transition BEGINS
  150ms ───────────┌┴─ Modal CSS transition completes
  
  Problem: Viewport fit used bestVisibleCanvasRect() at t=1ms
           but modal wasn't visible until t=150ms!
           Calculated bounds don't match final reality.

// The modal overlap rect may not be accurate when calculated too early
inspectorCanvasOverlapRect({ assumeInspectorOpen: false })
  // assumeInspectorOpen = false means:
  // "Use current actual state, not predicted future state"
  // But modal hasn't animated in yet!
  // Returns bounds of CURRENT visible modal (maybe nothing)
  // Not the bounds of FINAL modal
```

## Route Calculation Timing

```javascript
// Route is calculated AFTER viewport animation in render loop
RENDER FLOW:
  frame1:
    - bestVisibleCanvasRect() called
    - viewport bounds calculated
    - viewport animation starts
    
  frames 2-56:
    - viewport animating
    - but route not yet drawn
    
  frame 57:
    - drawSelectedRoute() called
    - selectedRoutePoints(target) called FOR FIRST TIME
    - Dijkstra algorithm runs (expensive!)
    - Route calculated
    - BUG: Viewport already animated, doesn't fit new route!

// The route calculation is expensive and deferred
// So viewport must either:
// A) Wait for it to complete before animating
// B) Include it in initial bounds somehow
// C) Recalculate viewport after route is determined
```

## The Real Issues in Order of Severity

### CRITICAL: Function Scope
- **Location**: ensureUserAndSelectionVisible() tries to use selectedRoutePoints()
- **Problem**: selectedRoutePoints not accessible in that scope
- **Impact**: Route points never included in fit calculation
- **Fix Required**: Either expose selectedRoutePoints globally OR calculate route in place

### HIGH: Routing Graph May Not Be Ready
- **Location**: selectedRoutePoints() checks state.routingGraphReady
- **Problem**: Graph building is async, may not be done when tree selected
- **Impact**: Falls back to straight line even if route was attempted
- **Fix Required**: Wait for graph to be ready before fitting viewport

### HIGH: Modal Timing
- **Location**: bestVisibleCanvasRect() called before modal animates in
- **Problem**: Modal bounds calculated when modal not yet visible
- **Impact**: Viewport fit doesn't account for modal properly
- **Fix Required**: Delay viewport fit until modal is visible or use conservative margins

### MEDIUM: Route Calculation Timing
- **Location**: Route only calculated during first render of drawSelectedRoute()
- **Problem**: Viewport already animated before route extent is known
- **Impact**: Viewport calculated for straight line, not actual path
- **Fix Required**: Pre-calculate route before viewport animation

### MEDIUM: User Location Centering
- **Location**: fitToPoints() centers user location in viewport
- **Problem**: When modal is open, center is wasteful
- **Impact**: Could see less of the route
- **Fix Required**: Offset user location away from modal area

---

## Recommended Investigation Steps for Higher Model

1. **Check if selectedRoutePoints is exposed globally**
   - Search for `window.selectedRoutePoints = ...`
   - Search for exports/imports of selectedRoutePoints
   - Current status: Appears to be js/renderer.js local scope only

2. **Trace routing graph readiness**
   - When is `state.routingGraphReady` set to true?
   - How long after tree selection does it become true?
   - Can we hook into the graph-ready event?

3. **Find where inspector modal transition completes**
   - What event fires when modal is fully visible?
   - Current code listens to transitionend in some places
   - Can we hook viewport fit to this?

4. **Understand bestVisibleCanvasRect behavior**
   - When called from fitToPoints with focusVisibleArea=true
   - Does it check current modal state or predict future?
   - What assumptions does it make about modal animation?

5. **Check if viewport needs adjustment after route render**
   - After selectedRoutePoints first renders, does viewport adjust?
   - Should second viewport fit happen after route is known?
   - Would a two-stage fit work better?
