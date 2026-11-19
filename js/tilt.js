// Epping Forest Finds — Tilt: the tilt camera's state and geometry, and the 3D projection that places points on the tilted ground plane.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

// 3D perspective (tiltActive()) is available on every screen — nearby overview,
// selected navigation, and the filter/settings/feedback screens all allow full tilt,
// with no exceptions, including when returning to the nearby overview.
function tiltAllowedForCurrentScreen() {
  return true;
}

function tiltActive() {
  // Pitch is an independent motion axis. A browser may provide beta while its compass is
  // still waiting for iOS permission or magnetometer calibration, and the map can safely stay
  // north-up while still responding to the phone being lifted. Once a heading is available the
  // same path becomes the full heading-up radar view.
  return Boolean(hasRealLocation()) && state.tiltBetaSmoothed > TILT_BETA_THRESHOLD;
}

function tiltBetaMaxDeg() {
  return state.map3dEnabled ? TILT_BETA_MAX : TILT_GENTLE_BETA_MAX;
}

// The phone pitch (0-1 across the active range) mapped to a 0-1 share of the cap. Linear up to
// TILT_LIMIT_EASE_START, then a cubic that meets the linear part with the same slope and
// arrives at the cap with zero slope: the plane decelerates into its limit rather than being
// clamped flat at it, which read as the tilt suddenly stopping.
function tiltEaseIntoLimit(t) {
  if (t <= TILT_LIMIT_EASE_START) return t;
  const s = (t - TILT_LIMIT_EASE_START) / (1 - TILT_LIMIT_EASE_START);
  const eased = s + s * s - s * s * s; // slope 1 at s=0, slope 0 at s=1
  return TILT_LIMIT_EASE_START + (1 - TILT_LIMIT_EASE_START) * eased;
}

// The bounce after the phone reaches its limit: a damped sine that starts moving on past the cap,
// dips a touch back under it and settles. Zero when no bounce is running.
function tiltLimitBounceDeg() {
  const elapsed = state.tiltLimitBounceSeconds;
  if (elapsed == null) return 0;
  return TILT_LIMIT_BOUNCE_DEG
    * Math.exp(-TILT_LIMIT_BOUNCE_RATE * elapsed)
    * Math.sin(TILT_LIMIT_BOUNCE_OMEGA * elapsed);
}

// Called once per smoothing frame with beta before and after that frame's easing step. The
// bounce starts only when the smoothed pitch crosses the limit from below, and runs to its end
// even if the phone is lowered meanwhile, so the plane never jumps mid-bounce.
function tiltAdvanceLimitBounce(previousBeta, nextBeta, dt) {
  if (state.tiltLimitBounceSeconds != null) {
    state.tiltLimitBounceSeconds += dt;
    if (state.tiltLimitBounceSeconds >= TILT_LIMIT_BOUNCE_SECONDS) state.tiltLimitBounceSeconds = null;
  } else if (previousBeta < tiltBetaMaxDeg() && nextBeta >= tiltBetaMaxDeg()) {
    state.tiltLimitBounceSeconds = 0;
  }
}

function tiltRotateXDeg() {
  if (!tiltActive()) return 0;
  const betaMax = tiltBetaMaxDeg();
  const t = Math.min(1, (state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (betaMax - TILT_BETA_THRESHOLD));
  return (state.map3dEnabled ? TILT_ROTATEX_MAX : TILT_GENTLE_ROTATEX_MAX) * tiltEaseIntoLimit(t)
    + tiltLimitBounceDeg();
}

// True when the tilt angle the main canvas was last drawn at no longer matches the current
// one. The compass smoothing loop only repaints the main canvas when the viewport or the
// heading moved, so pitching the phone up or down without turning it used to redraw the
// overlay alone: pins, the radar cone and the "You" dot were re-projected at the new tilt
// over terrain still drawn at the old one. Overlay items far from the pivot sit near the
// horizon, where a fraction of a degree of rotateX moves them tens of pixels -- so the "You"
// marker slid up and down the screen while the map under it stood still, reading as a
// marker detached from the map rather than a camera moving. Callers use this to pick a full
// redraw over an overlay-only one, keeping both canvases on the same camera every frame.
function tiltRenderStale() {
  const rendered = Number.isFinite(state.renderedTiltRotateXDeg) ? state.renderedTiltRotateXDeg : 0;
  return Math.abs(tiltRotateXDeg() - rendered) > TILT_RENDER_STALE_DEG;
}

// Follow the rendered angle so gentle tilt only moves the anchor a little.
function tiltAnchorFraction() {
  return tiltRotateXDeg() / TILT_ROTATEX_MAX;
}

// The vertical anchor fraction the heading-up pivot sits at within the visible map
// rect, ramping from the flat anchor to the max-tilt anchor as tiltAnchorFraction()
// goes 0 -> 1. Shared by navigationFocusPoint/nearbyHeadingUpFocusY (where the pivot
// is actually placed on screen) and tiltAvailableAheadCssPx (which needs the same
// value to size the tilt perspective distance -- see tiltPerspectivePx()).
//
// For selected navigation only, this fixed ahead-favouring anchor is then mirrored
// around the screen's vertical centre (0.5) based on where the destination actually
// is (selectedNavigationTargetBearingOffsetRadians()) -- dead ahead leaves it
// untouched (matching the previous fixed-anchor behaviour exactly), dead behind
// flips it to `1 - anchor` (as much room below the user as the old anchor gave
// above), and a target to the side lands near the centre -- but only in proportion to
// how long the user-to-averaged-target-point vector is (the same vector the bearing is taken from; for a straight line to a destination that is half the distance to it): within a few metres the bearing is GPS noise, so the
// mirroring fades in linearly up to HEADING_UP_MIRROR_FULL_DISTANCE_METRES. The result is also floored at HEADING_UP_MIRRORED_ANCHOR_FLOOR (the flat anchor mirrored), so tilt never lifts the user toward the horizon (for the routed-line balanced position the floor is ramped in with the tilt rotation, normalised by the largest tilt offered, so it is exactly absent at the tilt threshold). Without this, a
// destination behind the user got squeezed into the small margin below a pivot
// fixed near the bottom of the screen, forcing a needlessly wide zoom-out instead of
// making use of the screen space that's actually available in the destination's own
// direction. Nearby mode has no single destination to adapt toward (items are
// scattered in every direction by design), so its anchor stays exactly as before.
// Pre-mirror ramped anchor: the plain ahead-favouring anchor before any bearing-based
// mirroring is applied (see headingUpAnchorFraction below). Always >= 0.5 by
// construction (HEADING_UP_ANCHOR_* constants). Factored out so tiltAvailableAheadCssPx
// can use it as a safety floor -- see that function's comment for why.
// useFinalBrowseState: true when the caller is computing the *destination* of a camera move
// it is about to hand to moveCamera (alignHeadingUpNavigationViewport's animate:true
// path) rather than this frame's instantaneous value. The progress blend below exists for
// per-frame tracking -- sampled once at the instant a browse-origin transition starts (when
// nearbyOriginTransitionEasedProgress() is still ~0), it reports almost exactly the *from*
// end, not the slide's actual destination. moveCamera then eased smoothly toward that
// wrong, stale target, and the next un-animated per-frame call (prepareCanvasForDraw, or a
// live compass tick once the tween's own selectionCameraTransitionActive() guard lifts)
// snapped straight to the real one the instant the tween finished -- the camera "zooms past
// the real framing and then snaps back to it" field report. Skipping the blend here means the
// tween itself eases to the correct destination, so there is nothing left to correct.
function tiltRampedAnchor(isSelected, useFinalBrowseState = false) {
  // The forward ramp exists to give the screen to what is ahead of *you* as the phone
  // tilts up: it pushes the pivot toward the bottom edge so the ground you are walking
  // into fills the view. Browsing a spot away from yourself has no "ahead" -- the pivot is
  // a place on the map being looked at, and its whole nearest area has to fit on screen
  // (see tiltHidesWhatIsBehind). Pinned at the untilted
  // centre for that case, so the ring gets equal room above and below the pivot and can be
  // framed at a useful size rather than squeezed into the sliver below a bottom anchor.
  const t = tiltAnchorFraction();
  if (isSelected) {
    return HEADING_UP_ANCHOR_SELECTED + (HEADING_UP_ANCHOR_SELECTED_TILT - HEADING_UP_ANCHOR_SELECTED) * t;
  }
  // Crossing between the two nearby pivots -- the forward ramp above and the centred browse
  // pivot -- is eased along with the origin slide, or entering (and leaving) a browsed spot
  // in 3D would jerk the whole view up or down the screen on a single frame. Hopping between
  // two browsed spots stays put: both ends are the centred pivot.
  const to = nearbyPivotAnchorFraction(!tiltHidesWhatIsBehind());
  if (useFinalBrowseState) return to;
  const progress = nearbyOriginTransitionEasedProgress();
  if (progress == null) return to;
  const slide = state.nearbyOriginTransition;
  const from = slide.fromPivot != null ? slide.fromPivot : nearbyPivotAnchorFraction(slide.fromBrowsing);
  return from + (to - from) * progress;
}

// Space (CSS px) available on the *larger* side of the tilt pivot within the
// currently visible map area -- normally the "ahead" band the tilted ground plane
// has to fill before its horizon, but see the note on the mirrored-anchor case
// below. Feeds tiltPerspectivePx() so the perspective camera distance scales with
// the actual screen instead of leaving a fixed-size "sky" gap that grows on taller
// viewports (see tiltPerspectivePx() for why that matters).
//
// Deliberately uses max(anchor, 1 - anchor), not the raw anchor: for selected
// navigation, headingUpAnchorFraction() mirrors the anchor toward the top of the
// screen when the destination is behind the user, so most of the *reach* that needs
// covering is now on the far side of the pivot from where this "ahead" name
// originally meant. Feeding the raw (now small) mirrored anchor in here would shrink
// tiltPerspectivePx() right along with it -- reintroducing, via bearing this time
// instead of tilt angle, the exact singularity-margin regression documented above
// (P collapses, so a destination/pins now rendered on the far, larger side of the
// pivot blow up or disappear near the perspective-divide singularity). Using
// whichever side is actually larger keeps the camera distance sized for the bigger
// reach regardless of which side of the pivot that is, so mirroring the on-screen
// anchor position never on its own shrinks the safety margin. In the normal
// (dead-ahead or nearby) case the anchor is already >= 0.5, so this is a no-op.
// useFinalBrowseState: see cameraOriginPoint's comment. headingUpFitTiltCamera (the one
// animate:true-fit caller, via maxScaleForHeadingUpPoints) passes it through so the camera
// distance the fit solves against already matches the browse-origin slide's destination; the
// renderer's own tiltProjection() call leaves it at the default, live-tracking value, since
// what it draws each frame has to match that frame's own (still-blending) anchor, not where
// the anchor will eventually land.
function tiltAvailableAheadCssPx(useFinalBrowseState = false) {
  const focusRect = bestVisibleCanvasRect();
  const isSelected = selectedNavigationHeadingUpActive();
  const anchor = headingUpAnchorFraction(isSelected, useFinalBrowseState);
  // max(anchor, 1 - anchor) alone still dips as low as 0.5 for a destination
  // directly to a side (offset ~= +-pi/2, where headingUpAnchorFraction's
  // cos(offset) mirroring passes through the screen's exact 50% centre) -- lower
  // than the historically-safe floor (tiltRampedAnchor(), always >= 0.5 by
  // construction, e.g. 0.62-0.88 for selected navigation) that this calculation
  // always used before bearing-based mirroring existed. That dip shrank the camera
  // distance (and so the singularity-margin safety net) for any destination whose
  // bearing passes near perpendicular to the current heading -- an ordinary,
  // frequent case during real walking navigation, not just the dead-behind extreme
  // already covered by max(anchor, 1 - anchor). Including tiltRampedAnchor() as a
  // third floor restores that pre-mirroring safety margin across the whole bearing
  // range: at the dead-ahead/dead-behind extremes max(anchor, 1-anchor) already
  // equals tiltRampedAnchor() exactly (so this is a no-op there), and it now also
  // holds at every bearing in between.
  const reach = Math.max(anchor, 1 - anchor, tiltRampedAnchor(isSelected, useFinalBrowseState));
  return Math.max(1, (focusRect.height * reach) / pixelRatio());
}

// TILT_PERSPECTIVE_PX used to be a fixed CSS-px camera distance. A rotateX-tilted
// ground plane's horizon sits at (perspective / tan(rotateX)) CSS px above the
// pivot -- a fixed distance, independent of screen size -- so a flat constant left
// the "sky" gap above the horizon covering a bigger or smaller fraction of the
// screen depending on device height, rather than a consistent fraction of it (a
// taller visible map area got proportionally *more* empty sky, not less). This
// derives the camera distance from the space actually available above the pivot
// instead, so the horizon lands at roughly the same fraction of the visible map
// (TILT_HORIZON_GROUND_RATIO) on any device -- calibrated at TILT_ROTATEX_MAX, not
// at whatever the *current* tilt angle happens to be. That distinction matters: an
// earlier version scaled the camera distance by tan(the live tiltRotateXDeg()), which
// shrinks sharply at low/mid tilt angles -- collapsing the safe "behind the user"
// distance before the perspective-divide singularity (scale = P/(P-dz), where dz
// grows with distance behind the pivot) from ~900-1500 CSS px down to as little as
// ~450 CSS px at an ordinary mid-range tilt. That regression made pins, the radar,
// and road/path lines behind the user intermittently disappear or fly off to wild
// coordinates during everyday (non-max) tilt -- see [[nearby-view-zoom]] project
// memory / the 2026-09-03 tilt-perspective incident. Using the fixed reference angle
// instead keeps that safety margin roughly constant (and no smaller than before)
// across the whole active-tilt range, while still fixing the original device-height
// bug at max tilt, where the ground-fraction target actually applies exactly.
// Used identically by the CSS canvas transform
// (updateHeadingUpCanvasRotationTransform) and by the overlay's manual perspective
// projection (worldToScreenForOverlayTilted, projectCanvasPoint) -- all three must
// agree or pins drift away from the tilted terrain beneath them.
function tiltPerspectivePx(useFinalBrowseState = false) {
  if (tiltRotateXDeg() <= 0) return TILT_PERSPECTIVE_MIN_PX;
  const desired = tiltAvailableAheadCssPx(useFinalBrowseState) * TILT_HORIZON_GROUND_RATIO * TILT_HORIZON_REFERENCE_TAN;
  return clamp(desired, TILT_PERSPECTIVE_MIN_PX, TILT_PERSPECTIVE_MAX_PX);
}

// In full 3D (tilt active), map/landmark/cow/path pins and road/path lines behind the
// user's heading are not drawn at all — full 3D is a "look ahead" view, and anything
// behind is meant to be revealed by physically turning around rather than staying
// visible in a squashed/ballooned state at the bottom of the tilted view. Returns false
// (nothing hidden) whenever tilt is not active, so this only changes rendering in 3D mode.
// Whether 3D should hide what is behind the camera at all. The cull models a first-person
// view: you are standing at the pivot facing forward, and content behind you is revealed by
// physically turning around rather than by keeping a squashed copy of it on screen. Browsing
// a spot away from yourself is not first-person -- the pivot is a place on the map being
// looked at, and its whole nearest area is deliberately framed on screen (see
// maxNearbyHeadingUpScale) -- so culling half of it would leave the framed circle empty of
// roads, paths and full-size pins. Shared by the cull, the pin collapse and the camera fit
// so the three cannot disagree about which half of the view exists.
function tiltHidesWhatIsBehind() {
  return Boolean(state.map3dEnabled) && !state.nearbyAnchor;
}

function isBehindTiltHeading(worldPoint) {
  if (!tiltActive() || !state.userLocation || !worldPoint) return false;
  if (!tiltHidesWhatIsBehind()) return false;
  return tiltRotatedHeadingOffset(worldPoint) > 0;
}

// Signed distance (world units) of a point from the ahead/behind boundary used by
// isBehindTiltHeading: negative is ahead, positive is behind, zero is the boundary itself.
function tiltRotatedHeadingOffset(worldPoint) {
  const rotation = currentNavigationMapRotationDegrees();
  const radians = toRadians(rotation);
  // Measured from the camera pivot, not the GPS fix: "behind" here means behind the point
  // the perspective divide is solved around (cameraOriginPoint), which is what actually
  // determines whether the projection compresses a point toward the horizon or blows it up.
  const origin = cameraOriginPoint() || state.userLocation.point;
  const dx = worldPoint.x - origin.x;
  const dy = worldPoint.y - origin.y;
  return dx * Math.sin(radians) + dy * Math.cos(radians);
}

// Continuous companion to isBehindTiltHeading for pins: rather than a hard cutoff, this
// shrinks smoothly toward TILT_PIN_COLLAPSE_MIN_SCALE across a band straddling the same
// boundary, so turning the heading reads as pins growing/shrinking from their own point
// instead of popping in and out. The band is sized in screen px via viewport.scale so it
// covers a consistent visual width regardless of zoom level.
//
// Gated on headingUpActive() rather than tiltActive(), and blended in by tiltInfluence()
// (0 at TILT_BETA_THRESHOLD, ramping to 1 by TILT_BETA_MAX — the same active-tilt range
// as tiltRotateXDeg/tiltAnchorFraction) rather than switched on at the tiltActive()
// threshold itself: this keeps pins close to full size as tilt begins and only collapses
// them toward minimum size near max tilt, instead of hitting minimum collapse the instant
// tilt engages and sitting there for nearly the whole active-tilt range. Because the ramp's
// lower bound is exactly TILT_BETA_THRESHOLD (where tiltActive() itself flips), influence
// is already 0 right as tilt deactivates, so leaving 3D still eases smoothly with no jump.
function tiltInfluence() {
  if (!state.map3dEnabled || !headingUpActive()) return 0;
  return clamp((state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD), 0, 1);
}

function tiltPinScale(worldPoint) {
  const influence = tiltInfluence();
  if (influence <= 0 || !state.userLocation || !worldPoint) return 1;
  if (!tiltHidesWhatIsBehind()) return 1;
  const bandWorld = TILT_PIN_COLLAPSE_BAND_PX / state.viewport.scale;
  const raw = clamp(0.5 - tiltRotatedHeadingOffset(worldPoint) / bandWorld, 0, 1);
  const eased = raw * raw * (3 - 2 * raw);
  const collapsedScale = TILT_PIN_COLLAPSE_MIN_SCALE + (1 - TILT_PIN_COLLAPSE_MIN_SCALE) * eased;
  return influence >= 1 ? collapsedScale : 1 + (collapsedScale - 1) * influence;
}

// ------------------------------------------------------------------------------
// Tilt projection
//
// The ground plane is rotated by tiltRotateXDeg() about a horizontal axis through the
// user's position (the pivot) and viewed from tiltPerspectivePx() away. For a point
// dy CSS px from the pivot down the screen's vertical axis:
//
//   z     = dy * sin(T)     (+z is towards the camera)
//   scale = P / (P - z)
//
// Ahead of the pivot (dy < 0) z is negative, so scale falls smoothly towards 0 and the
// projected y converges on a *finite* horizon at -P/tan(T). That finite limit is the
// whole reason this is done in JS rather than as a CSS perspective()/rotateX() on the
// finished bitmap: a rotated bitmap runs out of pixels somewhere short of the horizon,
// leaving a band at the top of the screen with no map in it that grows with tilt angle
// and cannot be closed by any amount of overscan. Projecting per point instead lets the
// ground be drawn all the way to the horizon.
//
// Behind the pivot (dy > 0) z grows towards P, where the perspective divide is singular and
// past which points sit behind the camera (scale flips negative and coordinates mirror to
// nonsense). Rather than clamp at a near plane -- which stacked every far-behind point onto
// one row and flung it ~50x sideways -- tiltDepthScale eases the depth onto a ceiling so the
// magnification stays bounded (TILT_BEHIND_MAX_SCALE) and order down the screen is kept.
function tiltProjectOffsets(dxCss, dyCss, tiltDeg, perspectivePx) {
  const rad = toRadians(tiltDeg);
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const scale = tiltDepthScale(dyCss, sin, perspectivePx);
  return { dx: dxCss * scale, dy: dyCss * cos * scale, scale, clipped: false };
}

// The perspective scale for a point dyCss px from the pivot (positive is behind it). Ahead of
// the pivot and up to a modest distance behind it this is exactly P / (P - dy * sin). Further
// behind, the camera depth z = dy * sin is eased onto a ceiling (TILT_BEHIND_MAX_SCALE) with a
// tanh shoulder that joins the true curve smoothly, so the scale rises monotonically and never
// exceeds the ceiling. One rule for every caller: things behind the camera keep their order down
// the screen and a bounded sideways spread, instead of being clamped onto one near-plane row
// and magnified ~50x sideways (which flung them to the screen edges).
function tiltDepthScale(dyCss, sin, perspectivePx) {
  const z = dyCss * sin;
  if (!(z > 0)) return perspectivePx / (perspectivePx - z);
  const zMax = perspectivePx * (1 - 1 / TILT_BEHIND_MAX_SCALE);
  const zKnee = zMax * TILT_BEHIND_KNEE_RATIO;
  const eased = z <= zKnee ? z : zKnee + (zMax - zKnee) * Math.tanh((z - zKnee) / (zMax - zKnee));
  return perspectivePx / (perspectivePx - eased);
}

// Inverse of the forward projection's vertical axis: the flat dy (CSS px) whose projected row is
// yRel (CSS px from the pivot). Closed form ahead of the pivot; behind it the eased scale has no
// closed form, so it bisects on the monotone forward map (scale >= 1 there, so dy <= yRel / cos).
function tiltUnprojectDy(yRel, sin, cos, perspectivePx) {
  if (yRel <= 0) return yRel * perspectivePx / (cos * perspectivePx + yRel * sin);
  let lo = 0;
  let hi = yRel / cos;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    const row = mid * cos * tiltDepthScale(mid, sin, perspectivePx);
    if (row < yRel) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Per-frame snapshot of everything the tilt projection needs. This must be cached:
// tiltPerspectivePx() reaches bestVisibleCanvasRect() and the navigation target points,
// and pixelRatio() reads a DOM dataset attribute — all far too expensive to repeat for
// every one of the hundreds of thousands of points a single draw projects. Invalidated
// wherever _overlapRectCache is (declaration above).
function tiltProjection() {
  if (_tiltProjectionCache !== undefined) return _tiltProjectionCache;
  const tiltDeg = tiltRotateXDeg();
  if (tiltDeg <= 0 || !state.userLocation) {
    _tiltProjectionCache = null;
    return _tiltProjectionCache;
  }
  const rad = toRadians(tiltDeg);
  const sin = Math.sin(rad);
  const perspectivePx = tiltPerspectivePx();
  const originWorld = cameraOriginPoint();
  if (!originWorld) {
    _tiltProjectionCache = null;
    return _tiltProjectionCache;
  }
  const origin = rawWorldToScreen(originWorld);
  _tiltProjectionCache = {
    sin,
    cos: Math.cos(rad),
    perspectivePx,
    originX: origin.x,
    originY: origin.y,
    dpr: pixelRatio(),
  };
  return _tiltProjectionCache;
}

// Projects an already-flat (raw + heading-rotated) canvas-pixel position through the
// active tilt. Shared by the main canvas (worldToScreen), the flat overlay
// (worldToScreenForOverlayTilted) and raw canvas positions (projectCanvasPoint) so all
// three agree by construction rather than by three copies of the same arithmetic.
function tiltProjectScreenPoint(flat) {
  const cam = tiltProjection();
  if (!cam) return { x: flat.x, y: flat.y, scale: 1, clipped: false };
  const dxCss = (flat.x - cam.originX) / cam.dpr;
  const dyCss = (flat.y - cam.originY) / cam.dpr;
  const scale = tiltDepthScale(dyCss, cam.sin, cam.perspectivePx);
  return {
    x: cam.originX + dxCss * scale * cam.dpr,
    y: cam.originY + dyCss * cam.cos * scale * cam.dpr,
    scale,
    clipped: false,
  };
}

// Canvas-pixel y of the horizon: the row the ground plane converges on infinitely far
// ahead. Returns null when not tilted (a flat map has no horizon on screen).
function tiltHorizonCanvasY() {
  const cam = tiltProjection();
  if (!cam) return null;
  return cam.originY - (cam.perspectivePx * (cam.cos / cam.sin)) * cam.dpr;
}

// How far ahead of the pivot (CSS px, flat/untilted) is still worth drawing: past this
// the perspective scale has fallen below TILT_FAR_FADE_RATIO, where the distance fade
// has already erased the ground completely. Bounds the geometry the draw loop walks so
// "draw to the horizon" doesn't mean "walk every road in the dataset".
function tiltFarClipCssPx() {
  const cam = tiltProjection();
  if (!cam || cam.sin <= 0) return Infinity;
  return (cam.perspectivePx * (1 / TILT_FAR_FADE_RATIO - 1)) / cam.sin;
}
