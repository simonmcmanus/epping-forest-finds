// Epping Forest Finds — GPS smoothing: fix ingestion, the glide that eases the You marker toward the newest fix, and the camera that follows it while travelling.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

// Whether the person is travelling faster than walking pace: the device's own speed reading
// (coords.speed, from the GPS itself) when it gives one, or the distance covered over the last
// LOCATION_SPEED_BASELINE_MIN_MS or more of fixes.
function recordFixAndDetectFastTravel(latitude, longitude, now, speed, point) {
  const history = (state.locationFixHistory || []).filter((fix) => fix.at <= now && now - fix.at <= LOCATION_SPEED_HISTORY_MS);
  history.push({ at: now, latitude, longitude, point });
  state.locationFixHistory = history;
  if (Number.isFinite(speed) && speed >= LOCATION_FAST_TRAVEL_MPS) return true;
  const baseline = history.find((fix) => now - fix.at >= LOCATION_SPEED_BASELINE_MIN_MS);
  if (!baseline) return false;
  const metresPerSecond = distanceMetres(baseline.latitude, baseline.longitude, latitude, longitude) / ((now - baseline.at) / 1000);
  return metresPerSecond >= LOCATION_FAST_TRAVEL_MPS;
}

// Turns one raw fix into the position the app should use. The smoothing itself is done by
// advanceLocationGlide() every frame; this only records where to head for.
function ingestLocationFix(latitude, longitude, accuracy, now = performance.now(), speed = null) {
  const rawPoint = projectLonLat(longitude, latitude);
  // receivedAt is wall-clock time, so analytics can tell how old the fix it would repeat is (js/tracker.js).
  const raw = { latitude, longitude, accuracy, point: rawPoint, receivedAt: Date.now() };
  const priorFix = (state.locationFixHistory || []).at(-1) || null;
  state.rawUserLocation = raw;
  const travellingFast = recordFixAndDetectFastTravel(latitude, longitude, now, speed, rawPoint);

  const previous = state.userLocation;
  // A fix that lands raw starts a new journey: the fixes before it describe where the walker was
  // before the app moved on (the stand-in, a coarse first fix), so they must not feed the speed or
  // the travel track. The history is what the next few seconds are judged from.
  const landRaw = () => {
    state.locationGlide = null;
    state.locationSmoothedAt = now;
    state.locationFixHistory = (state.locationFixHistory || []).slice(-1);
    return raw;
  };
  if (!previous || !previous.point) return landRaw();

  if (travellingFast) {
    // Carried, not stepped: between fixes the position moves along the track the recent fixes
    // describe, so a train at 15 m/s moves every frame instead of holding still for a second and
    // then jumping. Until there are enough fixes to fit a track (the first few seconds of a
    // journey) the fix is eased as walking would be, rather than landed raw: raw GPS noise is
    // exactly what this must not show.
    const gapMetres = priorFix ? distanceMetres(priorFix.latitude, priorFix.longitude, latitude, longitude) : Infinity;
    if (!Number.isFinite(gapMetres) || gapMetres >= LOCATION_FAST_SNAP_METRES) {
      // Lost fixes: the track from before the gap no longer describes the train, so start again from this one.
      return landRaw();
    }
    const track = fitTravelTrack(state.locationFixHistory, now);
    if (track) return startLocationGlide(previous, raw, now, track);
    // No track yet: ease toward the fix at travelling speed, so the position does not trail the train.
    return startLocationGlide(previous, raw, now, null, true);
  }

  const movedMetres = distanceMetres(previous.latitude, previous.longitude, latitude, longitude);
  // Not wander: a first fix after a gap, coming out of a tunnel, a genuine teleport. Easing
  // across that reads as the map sliding away on its own.
  const sinceLastFixMs = priorFix ? now - priorFix.at : Infinity;
  if (!Number.isFinite(movedMetres) || movedMetres >= walkingSnapMetres(accuracy, sinceLastFixMs)) return landRaw();
  return startLocationGlide(previous, raw, now, null, false);
}

// How far a fix may land from the marker and still be eased to as wander. Fixed at 30m, a
// cold-start fix at 20-30m accuracy (the first minute after load, or under trees) lands past that
// on most fixes, so the marker jumped a few tens of metres a frame and the camera followed. Between
// consecutive fixes the threshold is scaled to the fix's own accuracy, so the same wander is eased;
// after a gap it stays at the plain floor, and a teleport is far beyond either.
function walkingSnapMetres(accuracy, sinceLastFixMs) {
  if (!Number.isFinite(accuracy) || !(sinceLastFixMs <= LOCATION_WANDER_GAP_MS)) return LOCATION_SMOOTHING_SNAP_METRES;
  return clamp(LOCATION_SNAP_ACCURACY_MULTIPLE * accuracy, LOCATION_SMOOTHING_SNAP_METRES, LOCATION_SNAP_MAX_METRES);
}

// The straight line the recent fixes describe while travelling: a least-squares fit of x and y
// against time over the fixes of the last LOCATION_TRACK_WINDOW_MS. Returns the fit's time
// reference (atMs), its position there (x, y), its velocity (vx, vy, projected units per ms) and
// the newest fix's time (fixAt), or null when there are too few fixes, or they span too short a
// time, to give a direction.
function fitTravelTrack(history, now) {
  const fixes = (history || []).filter((fix) => fix.point && fix.at <= now && now - fix.at <= LOCATION_TRACK_WINDOW_MS);
  if (fixes.length < 3) return null;
  const spanMs = fixes[fixes.length - 1].at - fixes[0].at;
  if (!(spanMs >= LOCATION_TRACK_MIN_SPAN_MS)) return null;
  const count = fixes.length;
  const meanAt = fixes.reduce((sum, fix) => sum + fix.at, 0) / count;
  const meanX = fixes.reduce((sum, fix) => sum + fix.point.x, 0) / count;
  const meanY = fixes.reduce((sum, fix) => sum + fix.point.y, 0) / count;
  let sxx = 0;
  let sxt = 0;
  let syt = 0;
  for (const fix of fixes) {
    const dt = fix.at - meanAt;
    sxx += dt * dt;
    sxt += dt * (fix.point.x - meanX);
    syt += dt * (fix.point.y - meanY);
  }
  if (!(sxx > 0)) return null;
  return {
    atMs: meanAt,
    x: meanX,
    y: meanY,
    vx: sxt / sxx,
    vy: syt / sxx,
    fixAt: fixes[fixes.length - 1].at,
  };
}

// Records where the position should head for. While travelling, `track` is the line the target
// is carried along between fixes (see glideTargetAt); walking passes null.
function startLocationGlide(previous, raw, now, track, travelling = false) {
  state.locationGlide = {
    to: raw.point,
    // The filter's time constant, from this fix's own reported accuracy: a 5m fix is
    // followed almost as given, a 25m one is leaned on hard. Travelling uses the quickest
    // one, because a slow ease trails a moving target by its speed times this constant.
    tau: track || travelling
      ? LOCATION_SMOOTHING_MIN_TAU_S
      : clamp(
        (Number.isFinite(raw.accuracy) ? raw.accuracy : 10) / LOCATION_SMOOTHING_ACCURACY_DIVISOR,
        LOCATION_SMOOTHING_MIN_TAU_S,
        LOCATION_SMOOTHING_MAX_TAU_S
      ),
    accuracy: raw.accuracy,
    track,
  };
  // Start the ease clock at this fix, so the first frame after it integrates ~one frame
  // rather than the whole gap since the previous fix (which the staleness guard would then
  // treat as a dead clock and land outright).
  state.locationSmoothedAt = now;
  ensureLocationGlideLoop();
  return previous;
}

// Where the glide is heading at `now`. A walking glide heads for its fix and stays there. A
// travelling one heads for the point on its track at `now`, carried at most LOCATION_DRIFT_MAX_MS
// past the newest fix: the target moves continuously between fixes, and a new fix only shifts
// the line slightly rather than moving the target.
function glideTargetAt(glide, now) {
  if (!glide.track) return glide.to;
  const { track } = glide;
  const at = Math.min(now, track.fixAt + LOCATION_DRIFT_MAX_MS);
  return {
    x: track.x + track.vx * (at - track.atMs),
    y: track.y + track.vy * (at - track.atMs),
  };
}

// The location object for a projected point, with lat/lon kept consistent with it so
// nothing downstream can read a position and a coordinate that disagree.
function locationAtPoint(point, accuracy) {
  const lonLat = unprojectPoint(point);
  return { latitude: lonLat.latitude, longitude: lonLat.longitude, accuracy, point: { x: point.x, y: point.y } };
}

// Eases state.userLocation toward the latest fix, a frame at a time. Called from
// prepareCanvasForDraw, and it requests the next frame itself while it still has ground to
// cover, so the motion continues whether or not anything else is redrawing.
//
// One continuous filter rather than a per-fix low-pass feeding a fixed-length glide, which
// is what this was first written as. That version only recomputed its target when a fix
// arrived, so a single fix followed by silence left the position permanently short of the
// last thing the device actually told us -- fine while watchPosition keeps firing, wrong
// the moment it stops, and caught by the settings spec waiting for state.userLocation to
// reach a position it had set once. Easing toward the newest raw fix on every frame instead
// smooths exactly the same way while fixes keep arriving (each new one moves the target
// before the last has been reached, so the wander averages out) and always converges on the
// truth when they stop.
// Drives advanceLocationGlide on its own animation frames for as long as a glide is
// pending, rather than relying on the draw loop.
//
// prepareCanvasForDraw advances it too, so the position is always current at paint time,
// but that cannot be the only driver: the map stops painting whenever a secondary screen
// is open, and the position would then freeze part-way to the last fix until something
// else happened to request a draw. Caught in CI by the settings spec, which opens Settings
// and then waits for state.userLocation to reach a position it set -- it waited out the
// whole 60s test timeout. A walker checking their settings must still be where they are
// when they close the screen.
function ensureLocationGlideLoop() {
  if (state.locationGlideFrame != null) return;
  if (typeof requestAnimationFrame !== "function") return;
  const tick = () => {
    state.locationGlideFrame = null;
    if (!state.locationGlide) return;
    if (advanceLocationGlide()) requestDraw();
    if (state.locationGlide) {
      state.locationGlideFrame = requestAnimationFrame(tick);
    }
  };
  state.locationGlideFrame = requestAnimationFrame(tick);
}

function advanceLocationGlide(now = performance.now()) {
  const glide = state.locationGlide;
  if (!glide || !state.userLocation || !state.userLocation.point) return false;
  const from = state.userLocation.point;
  const to = glideTargetAt(glide, now);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const lastAt = state.locationSmoothedAt;
  const gapMs = Number.isFinite(lastAt) ? (now - lastAt) : null;
  state.locationSmoothedAt = now;
  // A duplicate call within the same tick has no time to integrate, so it does nothing --
  // it must not land, or two callers in one frame would skip the ease entirely.
  if (gapMs != null && gapMs <= 0) return false;
  // Arrived, or the clock is unusable (no previous timestamp, or a stale one from a
  // backgrounded tab). Land it: the last fix is the best information there is, and stopping
  // short of it is the failure this exists to avoid.
  const arrived = Math.abs(dx) < LOCATION_GLIDE_EPSILON && Math.abs(dy) < LOCATION_GLIDE_EPSILON;
  if (arrived || gapMs == null || gapMs > HEADING_UP_SCALE_EASE_STALE_MS) {
    state.locationGlide = null;
    if (arrived && from.x === to.x && from.y === to.y) return false;
    state.userLocation = locationAtPoint(to, glide.accuracy);
    state.userInMapArea = pointInsideBounds(state.userLocation.point, state.bounds);
    return true;
  }

  const dt = Math.min(gapMs, HEADING_UP_SCALE_EASE_MAX_DT * 1000) / 1000;
  const alpha = 1 - Math.exp(-dt / glide.tau);
  const next = { x: from.x + dx * alpha, y: from.y + dy * alpha };
  state.userLocation = locationAtPoint(next, glide.accuracy);
  state.userInMapArea = pointInsideBounds(state.userLocation.point, state.bounds);
  if (glide.track) panViewportWithUser(from, next);
  return true;
}

// Whether the camera is the overview that follows the user: the north-up Nearby framing, not a
// selected place, a secondary screen, a cluster zoom or a heading-up anchor. keepOverviewCenteredOnUser
// uses the same test before it re-fits anything.
function overviewFollowsUser() {
  if (!state.dataLoaded) return false;
  if (!state.userLocation) return false;
  if (state.selected && !secondaryScreenActive()) return false;
  if (state.clusterZoomed) return false;
  if (els.inspector.classList.contains("minimized")) return false;
  if (nearbyNavigationAnchorActive()) return false;
  if (communityFramesOwnMarksOnly()) return false;
  return true;
}

// While travelling, the map moves with the You marker frame by frame: the marker keeps its
// place on screen and the map slides under it. The alternative -- re-easing the camera once a
// second, behind a marker that has already moved on -- is the same sit-then-jump as the marker
// used to have. Skipped while a camera tween is in flight (it would be overwritten), and in
// heading-up or 3D views, which re-fit from the live position on every compass frame instead.
function panViewportWithUser(fromPoint, toPoint) {
  if (state.viewportAnimationFrame != null) return;
  if (headingUpActive() || tiltActive() || !overviewFollowsUser()) return;
  const scale = state.viewport.scale;
  state.viewport.tx -= (toPoint.x - fromPoint.x) * scale;
  state.viewport.ty -= (toPoint.y - fromPoint.y) * scale;
  requestDraw();
}
