# 3D Rendering Fixes - Radar Cone & Canvas Clipping

## Issues Fixed

### Issue 1: Radar Cone Disappearing (Race Condition)
**File:** `js/renderer.js` line 1365
**Problem:** Overly strict compass heading check prevented radar from rendering during initial compass calibration
**Fix:** Removed `if (!Number.isFinite(state.compassHeading)) return;`
**Details:** The radar cone doesn't use the compass heading value (it always points forward), so this guard clause was unnecessary and blocked rendering during calibration

### Issue 2: Map Objects Disappearing During Tilt (Canvas Clipping)
**Files:** `css/base.css` lines 149-156 and 172
**Problem:** Canvas elements were being clipped by the `.map-stage` container during 3D rotation
**Causes:**
- No 3D perspective context on the parent container
- CSS `inset: 0` shorthand conflicted with inline positioning styles
- When canvas rotates with `rotateX()` up to 75°, parts extended beyond visible bounds
- `.map-stage { overflow: hidden }` clipped those parts away

**Fixes Applied:**

1. **Added 3D perspective context to `.map-stage`:**
```css
.map-stage {
  perspective: 1200px;
  perspective-origin: center 30%;
  /* existing properties... */
}
```

2. **Fixed overlayCanvas CSS positioning:**
```css
#overlayCanvas {
  position: absolute;
  top: 0;
  left: 0;
  /* Changed from `inset: 0` to explicit top/left for better inline style override */
  pointer-events: none;
  z-index: 1;
  cursor: default;
}
```

## How These Fix the Problem

### Radar Cone Fix
- **Before:** At certain tilt angles, compass heading might not be calibrated yet (is `null`)
  - Guard clause returns early
  - Radar doesn't render
  - Radar appears to vanish mid-tilt
- **After:** Radar renders regardless of compass heading status
  - The compass heading value isn't used for radar drawing anyway
  - Radar stays visible from first tilt to maximum tilt

### Canvas Clipping Fix
- **Before:** 
  - Canvas rotates with `rotateX()` in 3D space
  - Perspective only set on canvas itself, not on parent
  - Parent has `overflow: hidden` which clips rotated content
  - Result: Radar cone, buildings, streets gradually disappear as tilt increases
- **After:**
  - Parent `.map-stage` now has proper 3D perspective context
  - Canvas rotates within a proper 3D space defined by parent's perspective
  - Perspective-origin positioned at center-30% (above center point)
  - Clipping still occurs at extreme angles, but much less severe
  - Visual rendering is more consistent across tilt range

## Testing

Test the following scenarios:

1. **Radar disappearance (Issue 1):**
   - Open app
   - Quickly tilt before compass calibration completes
   - Radar should stay visible (previously would sometimes vanish)

2. **Canvas clipping (Issue 2):**
   - Open app with a destination selected
   - Slowly tilt to 3D mode
   - Watch for gradual visibility of:
     - Radar cone (should stay visible throughout)
     - Destination pointer (should stay visible)
     - Path line (should stay visible)
     - Buildings (should fade gracefully, not pop in/out)
     - Streets/boundaries (should remain visible)

3. **Extreme tilt:**
   - Tilt phone all the way (85°+)
   - Some clipping is expected at extreme angles, but core UI should remain visible

## Technical Details

### Perspective-Origin Choice
The `perspective-origin: center 30%` places the vanishing point at:
- Horizontal: center of screen
- Vertical: 30% from top (upper portion of screen)

This is tuned for a user looking at a phone tilted forward - the perspective is positioned so the horizon line appears natural as the map tilts away.

### Transform Chain
The canvas receives transforms in this order:
1. `perspective(1200px)` - Camera distance
2. `rotateX(angle)` - 3D tilt
3. `rotate(heading)` - Compass rotation

The parent perspective from `.map-stage` provides the 3D context that makes these transforms render correctly.

### Remaining Limitations
- At extreme tilt angles (70°+), some clipping may still occur due to canvas overscan limits
- This is acceptable - core functionality (radar, destination pointer) stays visible
- Full freedom from clipping would require dynamic canvas resizing that could impact performance

## Files Changed
- `js/renderer.js` - Line 1365: Removed compass heading guard clause
- `css/base.css` - Lines 149-156: Added perspective to .map-stage
- `css/base.css` - Lines 172: Changed `inset: 0` to explicit `top: 0; left: 0;`
