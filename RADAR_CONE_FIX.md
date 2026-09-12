# Radar Cone Intermittent Disappearance - Root Cause & Fix

## The Problem

You reported that the radar cone "SOMETIMES" disappears when tilting into 3D mode. This is a **race condition** between tilt mode activation and compass heading calibration.

## Root Cause Analysis

### The Guard Clause Issue
In `js/renderer.js` at line 1365, the `drawUserRadarOverlayTilted()` function had this guard clause:

```javascript
if (!Number.isFinite(state.compassHeading)) return;
```

This check was **too strict** for several reasons:

1. **Compass Calibration Timing**: When your app starts or compass recalibrates, `state.compassHeading` starts as `null`. The calibration process takes a moment while the magnetometer settles.

2. **User Can Tilt During Calibration**: Users can physically tilt their phone into 3D mode (>60° beta angle) before compass calibration completes.

3. **Guard Clause Blocks Rendering**: When the strict check fails (compass heading is `null`), the entire radar cone rendering is skipped - resulting in the cone mysteriously vanishing.

4. **The Radar Doesn't Need the Compass Value**: The radar cone is drawn pointing "up" (forward in heading-up mode) using a fixed angle:
   ```javascript
   const headingRad = toRadians(-90); // up = forward in heading-up overlay
   ```
   The actual compass heading value is **not used** in angle calculations.

### Why It's "SOMETIMES"

The disappearance is intermittent because it depends on timing:
- **Fast tilters** who tilt before compass settles: radar vanishes
- **Slow tilters** who tilt after compass calibrates: radar appears normally
- **Repeated tilts** on the same calibrated compass: radar works fine

## The Fix

**Removed the unnecessary guard clause** at line 1365 in `js/renderer.js`:

```diff
function drawUserRadarOverlayTilted(ctx) {
  if (!state.userLocation || !state.userInMapArea) return;
- if (!Number.isFinite(state.compassHeading)) return;
  if (typeof tiltActive !== "function" || !tiltActive()) return;
  if (typeof projectCanvasPoint !== "function") return;
```

### Remaining Safety Checks

The function still maintains all essential safety checks:
1. ✅ User location is valid (`state.userLocation`)
2. ✅ User is within map bounds (`state.userInMapArea`)
3. ✅ Tilt mode is actually active (`tiltActive()`)
4. ✅ Projection function is available (`projectCanvasPoint`)
5. ✅ Projected coordinates are valid (lines ~1391)

## Why This Fix Is Safe

- The compass heading guard was a **conservative safety measure** that wasn't necessary
- The radar cone doesn't use the compass heading value - it always points forward
- All other validation checks remain in place
- The radar now renders consistently in 3D mode, even during initial compass calibration
- No performance impact

## Files Changed

- `js/renderer.js` - Line 1365: Removed compass heading guard clause

## Testing

To verify the fix works:
1. Open the app
2. Don't wait for compass calibration to complete
3. Immediately tilt into 3D mode
4. **Expected**: Radar cone appears and stays visible (previously would sometimes vanish)
5. Test multiple times - the fix eliminates the race condition

## Related Code Patterns

The codebase uses compass heading similarly in other places:
```javascript
// In index.html - alternative pattern that uses a fallback
const heading = Number.isFinite(state.renderedNavigationHeading)
  ? state.renderedNavigationHeading
  : state.compassHeading;
```

The radar cone doesn't even need this fallback since it uses a fixed angle.
