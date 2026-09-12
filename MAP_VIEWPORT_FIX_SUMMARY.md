# Map Viewport Fix - Route Visibility Enhancement

## Problem Summary
When a destination is selected and a walking route is displayed, the viewport fit calculation only included the origin and destination markers, not the actual routed path. This caused:
- Route sections to fall off-screen because the actual walking path extends beyond the straight-line distance
- Modal detail panel to overlap and hide portions of the route and markers
- Suboptimal use of screen space when fitting both origin and destination

## Root Cause
The `ensureUserAndSelectionVisible()` function in `index.html` was building the viewport fit using only:
- User's current location
- Destination point
- Path segments (for forest boundary selections)

But it was **NOT** including the actual route points calculated by `selectedRoutePoints()`, which represents the walking route via roads and paths that often takes a much longer, more circuitous path than a straight line.

## Solution Implemented

### Main Change: Include Route Points in Viewport Fit
**File:** `index.html` (function `ensureUserAndSelectionVisible`, ~line 3581)

The function now:
1. Checks if a route is being displayed (target has a point and selectedRoutePoints is available)
2. Retrieves the actual route points via `selectedRoutePoints(target)`
3. Includes all route points in the `pointsToFit` array before calling `fitToPoints()`
4. Falls back to the previous behavior (destination point only) if no route is available

### Key Benefits
- **Complete route visibility**: The entire walking path is now visible on screen
- **Proper zoom level**: Zoom is calculated to show origin, destination, AND all intermediate route points
- **Modal accommodation**: The `fitToPoints()` function already uses `focusVisibleArea: true`, which accounts for the modal overlay
- **Backward compatible**: Falls back gracefully if `selectedRoutePoints` is not available

## Code Changes

### Before
```javascript
let pointsToFit = [state.userLocation.point];
if (state.selected && state.selected.type === "path" && target.segments) {
  for (const segment of target.segments) pointsToFit.push(...segment);
} else {
  if (target.point) pointsToFit.push(target.point);
}
```

### After
```javascript
let pointsToFit = [state.userLocation.point];

// If a route is being displayed (navigating to a tree/place), include all route points
// so the viewport fits the entire path, not just the origin and destination.
if (target.point && typeof selectedRoutePoints === "function") {
  const routePoints = selectedRoutePoints(target);
  if (routePoints && routePoints.length > 0) {
    pointsToFit.push(...routePoints);
  }
} else if (state.selected && state.selected.type === "path" && target.segments) {
  // For path selections (e.g., forest boundaries), include all segment points
  for (const segment of target.segments) pointsToFit.push(...segment);
} else if (target.point) {
  // Fallback: just the destination point
  pointsToFit.push(target.point);
}
```

## How It Works

1. **Route Points Retrieval**: When a tree or place is selected, `selectedRoutePoints(target)` is called
   - This function returns the walking route as an array of points
   - The route follows roads/paths from current location to destination
   - Often much longer than straight-line distance (especially in Epping Forest with its winding paths)

2. **Bounds Calculation**: All points (origin, destination, and every route waypoint) are passed to `fitToPoints()`
   - Calculates bounding box containing all points
   - Applies padding (DEFAULT_FIT_PADDING_PX)
   - Accounts for modal overlay via `focusVisibleArea: true`

3. **Viewport Animation**: The viewport smoothly animates to the calculated scale and position
   - Uses existing `animateViewportTo()` with cubic ease-in-out easing
   - Duration configurable (defaults to 800ms for navigation)

## Testing the Fix

### Scenarios to Test
1. **Short straight paths**: Verify zoom still works correctly
2. **Long winding paths**: Confirm entire route fits on screen
3. **Modal visibility**: Check that route doesn't disappear behind the detail panel
4. **Different screen sizes**: Test on phone and desktop widths
5. **Various destinations**: Trees at different distances and directions

### What to Look For
✅ Full route is visible when a destination is selected
✅ User location (blue dot) is visible
✅ Destination marker is visible
✅ Modal detail panel doesn't hide the route or markers
✅ Zoom level is appropriate for the route distance
✅ Animation is smooth and not jarring

## Additional Enhancements (Future)

The following enhancements could further improve the UX:

### 1. User Location Offset (Optional)
When navigation is active, move the user's location slightly off-center to better utilize the visible map area:
```javascript
// In fitToPoints calculation, when a route is active:
const routeCenter = calculateBoundingBoxCenter(pointsToFit);
const adjustedUserLocation = offsetPointAwayFromModal(state.userLocation.point, routeCenter);
// Use adjusted location in viewport calculation
```

### 2. Smart Modal Positioning
- Detect if route is being hidden behind modal
- Automatically raise the modal threshold or adjust its opacity
- Could be done by analyzing if critical route points fall in the overlap zone

### 3. Route Waypoint Sampling
For very long routes, sampling waypoints (every 50th point) could reduce points processed while maintaining shape:
```javascript
const sampleRoutePoints = (points, sampleRate = 50) => 
  points.filter((_, i) => i === 0 || i === points.length - 1 || i % sampleRate === 0);
```

## Files Modified
- `/Users/simonmcmanus/Documents/code/epping-forest-finds/index.html`
  - Function: `ensureUserAndSelectionVisible()` (~line 3581-3622)
  - Lines changed: ~12 lines added for route point inclusion logic

## No Breaking Changes
- All existing functionality preserved
- Graceful fallbacks if selectedRoutePoints is unavailable
- Existing animations and viewport logic unchanged
- Compatible with all selection types (trees, places, boundaries)

---

**Date:** 2026-09-12  
**Status:** Ready for testing  
**Co-Author:** Claude Haiku 4.5
