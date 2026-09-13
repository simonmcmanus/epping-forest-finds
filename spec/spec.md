# Epping Forest Finds PWA Specification

Build a static, offline-capable PWA for exploring veteran trees, nearby places, transport links, and live cow positions around Epping Forest.

The app is lightweight, dependency-free on the client, and runnable directly from this folder via a local static/proxy server.

## Detailed Specs

This top-level spec provides the product overview. Implementation details are split into focused specs with a clearly defined data interface between them:

- **[spec-data-fetching.md](spec-data-fetching.md)** — Fetching, loading, normalizing, and caching all data sources. Defines the `AppData` output interface.
- **[spec-data-rendering.md](spec-data-rendering.md)** — Drawing, interaction, and UI. Consumes the `AppData` interface from the fetching layer.
- **[spec-native.md](spec-native.md)** — iOS/Android native wrapper: the Capacitor shell, the `js/native.js` capability layer, native heading and permissions, bundled data and delta updates, store submission requirements.

All specs live in the `spec/` folder at the project root.

All specs should be kept in sync with every change.

## Product Goal

Provide a fast, mobile-first field map that still works in poor signal conditions:

- Show offline veteran tree, boundary, and local POI data.
- Overlay live cows and pastures.
- Guide users to selected targets with heading-aware arrows and route lines.
- Keep navigation fluid and user-controlled when the inspector is minimized.

## Data Sources

### Local offline files

- `data/trees/index.json` and `data/trees/chunk-*.json` (preferred chunked veteran tree register)
- `Veteran_Tree_Register.json` (full-file fallback)
- `Veteran_Tree_Register.enriched.with_named_trees.json` (legacy enriched fallback)
- `data/epping-forest-land.geojson`
- `data/epping-buffer-land.geojson`
- **Landmarks (split into category files for GitHub size limits):**
  - `data/local-landmarks-food.geojson` - food & drink (~500 features)
  - `data/local-landmarks-transport.geojson` - transport stops (~520 features)
  - `data/local-landmarks-gates.geojson` - gates & barriers (~1,600 features)
  - `data/local-landmarks-facilities.geojson` - parking, benches, toilets (~1,100 features)
  - `data/local-landmarks-historic.geojson` - historic sites (~60 features)
  - `data/local-landmarks-tourism.geojson` - tourism info (~90 features)
  - `data/local-landmarks-misc.geojson` - misc landmarks (~45 features)
- `data/local-paths.geojson`
- `data/local-roads.geojson`
- `data/local-environment.geojson`
- `data/epping_forest_folklore_locations_v14_external_links.json` (enriched historical/cultural data)

### Local landmarks extraction (OpenStreetMap via Overpass)

Query file: `data/local-landmarks.overpassql`

Includes:

- **Food & Drink:**
  - pubs/bars
  - cafés/tea huts
  - restaurants (named)
  - shops: convenience stores, supermarkets, groceries, greengrocers, butchers, bakeries, delis, farm shops, pastry shops, confectioneries, kiosks
- **Transport:** train-related points, bus stations, bus stops, taxi points
- **Access infrastructure:** gates, entrances, parking, toilets, benches, cycle parking, drinking water
- **Tourism & Historic:** named tourism/historic places (including monuments, attractions, viewpoints, museums, picnic sites)
- **Heritage:** historic sites, archaeological sites, memorials, ruins, castles

**Distance filtering:** Features are filtered to within an 8-minute walk (467m) of the Epping Forest boundary at walking speed of 3.5 km/h.

### Paths and bridleways extraction (OpenStreetMap via Overpass)

Query file: `data/local-paths.overpassql`

Includes:

- paths and footways
- bridleways
- byways and permissive paths
- waymarked trails where OSM tags are present
- cycleways and tracks
- named trails/paths where OSM has names/refs

### Roads extraction (OpenStreetMap via Overpass)

Query file: `data/local-roads.overpassql`

Includes:

- Major roads only (motorways, trunk, primary, secondary)
- Filtered for performance to prevent browser freezing
- Distance-filtered to within walking distance of forest

**Performance optimizations:**
- Roads data is filtered to major types only during load
- Processing happens in batches of 500 roads to prevent UI blocking
- Rendering limited to 2,000 roads per frame
- Roads are not drawn when zoomed out too far (< -0.5 zoom level)
- 8-second timeout on loading to prevent indefinite hangs

### Environment extraction (OpenStreetMap via Overpass)

Query file: `data/local-environment.overpassql`

Includes:

- hydrology lines and water/wetland areas
- nature designations and protected areas

### Live data

- Nofence open data API (same-origin proxy): `/api/cows?center=<lon>,<lat>`
- Upstream source pattern: `https://account.nofence.no/api/open/data/?center=<lon>,<lat>`

Cow requests use a fixed center coordinate (not user location) and refresh every 5 minutes.

## Core UX

- First screen is the map.
- App title: `Forest Finds`.
- Inspector supports overview mode and selected-detail mode.
- Install button appears when `beforeinstallprompt` is available.
- Tree number search is available from map UI.
- Mobile layout keeps controls compact and avoids overflow.
- On mobile, the modal navigation controls sit below the drag-to-resize bar with a clear gap so the resize handle remains visually distinct and easy to touch.

## Loading Experience

- A blocking loading overlay is shown at startup.
- Overlay displays step-by-step load states (`pending`/`loading`/`done`/`error`) for:
  - tree records
  - local places
  - roads & streets
  - forest/buffer boundaries
  - live cows
- Once loading completes, the map is rendered first, then the overlay fades out (0.32s opacity transition) so the map is revealed beneath the dissolving card.
- A small version badge (`#sw-version`, `.version` class) is shown at the bottom-right of the loading overlay, populated via `caches.keys()` once the service worker is active. Displays the cache version (e.g. `v120`). Hidden until the SW is ready.
- A ~500ms pause after all steps complete lets the user see the finished state before the fade begins.
- The location gate (shown when geolocation permission is not pre-granted) also fades out on dismissal.
- The distance warning dismisses with the same fade.
- A `hideWithFade(el, onDone?)` utility handles all fade-out transitions: adds `.fading-out` class, waits for `transitionend` (420ms fallback), then sets `hidden = true`.

**Performance optimizations:**
- Roads data is filtered and processed in batches to prevent browser freezing
- Loading has timeout protection (8 seconds for roads)
- Tree records load from small geographic chunks first, with full-file register fallback; chunks and legacy tree JSON are cached at runtime after successful page fetches
- Large datasets are processed incrementally with browser yield points

## Map Layers and Markers

Rendered layers/features:

- Epping Forest polygons
- Buffer land polygons
- Veteran trees
- Local places/landmarks
- **Base layers (always visible):**
  - Paths, trails, and bridleways
  - Hydrology and nature designations
  - Buildings
- Cows and pasture polygons
- User location marker

Marker rules:

- Trees are solid circles (no white ring in base state).
- Tree opacity behavior:
  - default: ~50%
  - selected tree: 100%
  - when a non-tree location is selected: trees fade to ~10%
- Pub/café/transport/cow markers use emoji with pulsing radial backgrounds.
- Local places should use a specific emoji for their location type where possible; ambiguous places use the location pointer emoji (`📍`) on both the map and nearest list.
- Transport filter is generic, but map icons differ by type:
  - train-like: 🚆
  - bus-like/stops: 🚌
- Selected marker gets a clear highlight ring.
- Background ornamental grid scales in world space with zoom.

## Selection, Inspector, and Camera Behavior

### Selection

- Click tree/cow/place to open details.
- Details include live distance + walking time (when user location is available).
- Selection is reflected in URL hash for restore/share behavior.

### Inspector modes

- Overview mode: nearest list + filter controls.
- Filter screen mode: `state.filterScreenOpen = true`; stays open until the user explicitly navigates away. GPS updates, cow refreshes, locate-button taps, and empty canvas taps must not close it.
- Selected-detail mode: filter button hidden, filter panel closed (not relevant when viewing specific location).
- Minimized mode: collapsed header only.
- The inspector is always expanded after a map-tap selection, on both desktop and mobile, so the detail panel opens immediately. This also applies to a selection made via a hash/deep link (`applySelectionFromHash`) — including a `hashchange` to a new linked location while the inspector was already minimized, which forces it back open. It is only auto-minimized when selecting from the overview/nearby list (`focusOverviewItem`).
- Tapping the Nearby button always calls `goToInitialView()` (clears selection, refits camera) rather than `selectOverview()` alone.
- Re-tapping an already-active nav button (one with `screen-active` while the inspector is not minimized) plays a spring bounce animation (`.nav-reselect`) on the button instead of re-entering the screen. This gives tactile confirmation that the user is already on that screen.

### URL hash / navigation state

- All hash changes use `history.replaceState` (never `pushState`) so no in-app history entries are created and browser back/swipe gestures take the user out of the app rather than undoing in-app navigation.
- `hashchange` with an empty hash only triggers `goToInitialView()` when the filter screen is not open.

### Camera behavior

- With selected target + expanded inspector: camera fits user + target in the visible area above the inspector (not behind the modal). Zoom adjusts so both fill the available viewport.
- Navigation mode GPS follow: smooth 800 ms animation that only triggers when the user or destination drifts near the edge of the visible area (14% margin). Sub-threshold GPS noise is ignored so the camera glides rather than jumps.
- In overview mode, GPS updates keep the user location and nearest items within the visible map area.
  - the first successful location fix triggers a 700ms cinematic zoom to the user's 5-minute walking radius
  - if location is obtained before map data finishes loading (user clicks the gate early), the zoom is re-triggered once data and `fitToBounds()` are ready — ensuring the animation is never permanently cancelled by the data-load sequence
  - the zoom frames the walking-radius circle and only that: it is what the Nearby screen is about, it is centred on you, and it is a circle — so the camera holds still as you turn, and only moves when the circle does (you move, the radius changes, the tilt angle changes, or the map area resizes)
  - fast movement (walking, train) never causes the user or their nearest items to disappear from the map
- In nearby heading-up mode, flat (2D) puts you dead centre with the whole walking-radius circle on screen and the four corners falling outside it; as the phone tilts into 3D the camera shifts you toward the lower part of the map to leave more space in front, and frames the half of the circle ahead of you — the half 3D actually draws.
- Nearby ↔ selected-location transitions use a single eased ~500 ms camera move; both directions wait for the inspector layout transition to settle before measuring the visible map area, and heading-up rotation/pan/zoom start together so the map never snaps through an intermediate framing.
- With minimized inspector: auto-reposition is paused.
  - user can pan/zoom freely
  - GPS updates/drag/zoom/resize must not force recenter
- On expand from minimized: recenter once to user + selected target while preserving current zoom intent.
- View transitions should animate.

## Zoom and Input Constraints

- Disable browser/page pinch zoom and ctrl+wheel zoom.
- Map zoom is controlled only by map interactions (wheel/drag) — there is no on-screen zoom or "home/fit" button in the main map UI.
- On the plain Nearby screen, a two-finger pinch instead resizes the walking radius continuously (spread to shrink it, pinch together to grow it, no fixed stops); the map then re-fits to show the radius/nearby items. The radius cannot be pinched smaller than the distance to the nearest real item (plus a buffer) — pinning there shows a transient "nothing closer to show" notice instead of shrinking to an empty view. See "Browsing another spot" below and "Pinch-to-resize the radius" in `spec-data-rendering.md`.

## Nearest and Filter Behavior

- Overview lists nearest items across active types.
- If nothing is found within the selected walking-radius range, the nearest list shows the closest available item for each active type and displays a notice explaining that no matches were found within the selected walking time.
- **Onboarding (first visit):** On first visit (`forest-finds-onboarding-v1` not in localStorage), a full-screen onboarding overlay shows a single location + compass opt-in step while map data loads in the background. The "Allow compass and location" button is the only button the user needs to press — it fires `getCurrentPosition` (browser dialog) and (on iOS) `DeviceOrientationEvent.requestPermission()` in the same synchronous gesture context, then calls `finish()` to mark onboarding complete and reveal the map. "Skip for now" also calls `finish()` without granting. No welcome or filter-group steps are shown during onboarding; filters default to `["trees", "cows"]` and can be adjusted via the filter button in the inspector. If location is denied or times out after the onboarding button tap, the map is revealed without a second blocking prompt — the "Use my location" button in the inspector is available if they change their mind. Implemented in `js/onboarding.js` + `css/onboarding.css`.
- **Proactive location + compass on every load:** On returning visits, `getCurrentPosition` is called immediately when the app starts, running in parallel with map data loading so the browser's native permission dialog appears during the loading screen rather than after a tap. By the time data finishes loading the location is usually already resolved and the map opens centred on the user. If the auto-request is denied or times out, the location gate is shown after the map reveals so the user can retry. Immediately after a successful location fix at boot, compass permission is also requested: non-iOS browsers auto-grant; iOS shows the gate so the user can tap from a real gesture context (required by iOS for `DeviceOrientationEvent.requestPermission`).
- **Compass permission — iOS per-session requirement:** On iOS, `DeviceOrientationEvent.requestPermission()` must be called from a synchronous user-gesture handler every page load before orientation events are fired — even when the user has previously granted permission. The stored `forest-finds-compass-permission-v1` value of `"granted"` is therefore treated as `"unknown"` at boot on iOS-like browsers (those where `DeviceOrientationEvent.requestPermission` is a function), so the compass gate is shown and the per-session call happens from the gate button click (a real user gesture). On non-iOS browsers no user gesture is required and the stored value is used as-is.
- **Default filters:** On first visit, only **Trees** and **Cows** are pre-selected in the onboarding chip screens. All other subfilters start deselected. If onboarding is skipped without changes, only Trees and Cows are active.
- **Filter persistence:** Active filters and expanded groups are saved to `localStorage` under `forest-finds-filter-state-v1` and restored on next visit.
- Supported overview filter groups and subfilters:
  - **Nature:** trees, cows, waymarked trails, ponds & streams
  - **Food:** pubs & bars, restaurants, cafés, shops
  - **Transport:** bus stops, underground stations, national rail stations, car parks
  - **History:** historic places, royal history, WWII sites, social history, plaques, blue plaques
  - **Locations:** celebrity associations, science, education, medicine, literature, theatre, politics, art, churches
  - **Stories:** legends, film/TV locations
- **Note:** Paths, hydrology, nature designations, and buildings are always visible as base layers and not included in filters.
- Filters are multi-select within and across groups.
- Selecting a top-level group enables all subfilters within that group.
- Deselecting all filters shows all content.
- Nearest list entries show icon/type, distance, and directional cue; the nearby header uses generated nearby/walking PNG icons from `data/icons/`, and bus entries use the generated bus icon.
- **Browsing another spot:** on the plain Nearby screen, tapping empty map space outside the walking radius previews that spot instead of resetting to overview — the walking-radius circle, nearest list, and camera all pivot there, marked on the map with a small amber ring distinct from the real "You" dot, which never moves. A "Use my location" control in the nearby list returns to the real location. Tapping inside the radius, or on Filter/Settings/Report, behaves as before (untouched by this).

### Nearest count control

- A nearest-items dropdown select is shown below the nearest list.
- Options: 3, 5, 10, 15, 20, 25 items.
- Default: 10.
- Changing the selection updates all of the following in sync:
  - number of nearest items listed
  - number of highlighted targets on map
  - route lines to overview targets
  - camera fit to keep all overview targets visible

### Nearby list footer

- The nearby list shows only the nearest items and the walking-radius summary header.
- The walking distance selector and app version are **not** shown in the nearby list.

## Settings Screen

- Accessible via the generated settings icon button in the inspector header.
- Contains a **Walking radius** control: a slider (1–30 min, half-minute steps, with tick marks at the old preset stops) choosing how far to walk when listing nearby places. Its lower bound tracks the distance to the nearest real item so it can't be dragged down to a radius with nothing in it; sitting at that floor shows a "nothing closer to show nearby" note.
- Contains an **About** section displaying the current app version (e.g. `v80`; `dev-v80` when served by the local dev server — see "Local dev flag" in `spec/glossary.md`) and a **Force refresh** button.
- **Force refresh**: unregisters every service worker registration and deletes every `forest-finds-*` cache (both app and data caches) before reloading, so a stuck/stale cached version is guaranteed to clear on the next load — sidesteps the normal update flow, where the open tab's version display can otherwise lag a reload or two behind a service worker that already updated silently in the background. Disabled (with an inline note) while offline, since it briefly leaves the app with no offline fallback until the fresh install completes.
- Changing the walking radius stays on the settings screen, immediately animates the map to fit the new radius, updates the nearby list and nearest tree selection, and keeps the walking radius ring visible.
- Opening Settings shows the same map view as the Filter and Feedback screens (see below).

## Feedback / Report Screen

- Accessible via the generated feedback icon button in the inspector header.
- Allows users to report missing data or request features; submissions are tracked as GitHub issues.
- The current app version is displayed in the form so the user can see which version will be reported.
- The app version, user agent, page URL, and optional geolocation are included in every submission payload.
- **Duplicate-submission prevention:** the Submit button is disabled and re-entrant submits are ignored for the duration of a request, so a double-tap cannot fire two GitHub issue creations. Each report also carries a `requestId` generated once and persisted (`localStorage`) until the report succeeds, so a retry after a dropped/failed response (e.g. flaky connection) reuses the same ID instead of minting a new one. The `report-missing-data` Netlify function searches existing GitHub issues for that ID before creating a new one and returns the existing issue if found, rather than filing a duplicate.
- On iOS Safari, the on-screen keyboard opening over the report textarea does not obscure it — the inspector sheet repositions using the `VisualViewport` API to keep the focused field visible above the keyboard, in both portrait and landscape (see "Keyboard avoidance" under Inspector Panel in `spec-data-rendering.md`).
- Opening Feedback shows the same map view as the Filter and Settings screens (see below).

## Secondary Screen Map Consistency

The Filter, Settings, and Feedback screens all display the same fixed map view in the background, so switching between them never changes what's shown:

- The camera zooms out past the walking radius far enough to reach the nearest match of every selected filter — even when each one is a long walk outside the radius — so the screen where you pick what to look for actually shows that it exists and which way it lies (survey mode — see `spec-data-rendering.md`). With no filters selected there is nothing extra to reach for and the view is the plain walking-radius framing.
- The walking-radius ring is always visible on all three screens.
- The view keeps updating live with GPS movement and heading-up compass rotation — including full 3D tilt — while any of the three screens is open, exactly as on the nearby overview screen. "Identical view across the three screens" refers to pan/zoom framing only; the live tilt angle (driven by phone orientation) is not part of that invariant and can differ moment-to-moment like it does everywhere else tilt is active.
- Any change to the view (opening a screen, GPS movement, resize) animates smoothly rather than snapping.

## Compass and Direction Guidance

- Use device orientation when available.
- **Compass calibration gate:** The first raw headings after load (or after a heading is cleared by the staleness recovery below) are buffered rather than trusted — a magnetometer that has not settled reports headings that snap the map to a wrong rotation. Readings are trusted, and rotation begins, once at least `COMPASS_CALIBRATION_MIN_SAMPLES` (4) readings within a 900 ms trailing window agree to within `COMPASS_CALIBRATION_STABLE_SPREAD_DEG` (6°). A "move your phone" prompt appears after 1.5 s of instability, and `COMPASS_CALIBRATION_MAX_WAIT_MS` (6 s) is a safety valve so a device that never settles is not blocked from heading-up forever. While calibration runs, the zoom/anchor fit still tracks the user (`startCalibrationViewportSync`); only rotation waits.
- **Compass staleness recovery:** iOS stops delivering `deviceorientation` while the screen is off or the tab is backgrounded and does not reliably resume when it comes back, so a compass that has gone quiet is treated as a recoverable fault rather than a permanent state. Recovery is a single shared routine (`recoverStalledCompass`) driven from three places: `visibilitychange` → visible, `pageshow` **with `event.persisted`** (a bfcache restore never fires `visibilitychange`; the unguarded event also fires on every ordinary load, which would start a GPS watch before boot's own flow asked for one), and a foreground watchdog interval (`SENSOR_WATCHDOG_INTERVAL_MS`, 10 s) that also re-runs the GPS watch check. It must be repeatable, not one-shot: driving it only from `visibilitychange` gave the sensor exactly one chance to come back per return to the foreground, and a sensor that came back later (or not at all) left the map frozen on a stale heading — or stuck north-up with no tilt, since `tiltActive()` is gated on `headingUpActive()` — until the page was reloaded. When no heading-bearing event has arrived for `COMPASS_STALE_MS` (15 s), the trusted heading is dropped (so the map falls back to north-up rather than rendering a frozen rotation as if it were live), calibration is reset so new readings are re-gated, and the orientation listeners are removed and re-added — the remove-then-add is what nudges the iOS sensor back into firing; a bare `addEventListener` would be a no-op for an already-registered handler. `state.orientationLastEventAt` (set for *every* orientation event, and written by nothing but `onDeviceOrientation`) is tracked separately from `state.compassLastEventAt` (heading-bearing events only) so the two failure modes are distinguished: if orientation events are still arriving but carry no heading, the sensor is alive and its magnetometer needs physical movement, so the calibration prompt is shown and the listeners are left alone rather than thrashed. Recovery never runs while the page is hidden, never runs on a device whose compass has never fired (desktop, permission not granted), and never runs when heading state was set directly without any event firing — which also keeps the watchdog from waking mid-assertion in the e2e specs that diff two consecutive canvas draws. Window `focus` was tried as a fourth trigger and removed: it fires on every tab focus, so the resume work ran constantly instead of on an actual resume.
- Smooth heading updates for:
  - selected-location title-row compass arrow
  - nearest-list directional arrows
- In selected-location navigation, the map becomes heading-up whenever compass heading is available, regardless of whether the inspector is expanded or minimized: the device-facing direction is always toward the top of the screen, and the map rotates as the user turns. The user's vertical anchor is no longer fixed at 62% down the visible area (88% at max tilt) -- `headingUpAnchorFraction(true)` (selected-navigation only; nearby's anchor is unaffected) mirrors that base anchor around the screen's vertical centre based on `selectedNavigationTargetBearingOffsetRadians()`, the destination's bearing relative to straight ahead: dead-ahead keeps the plain anchor (user low, most of the screen shows the room ahead of them), dead-behind mirrors it to `1 - anchor` (user high, most of the screen now shows the room behind them, where the destination actually is), and a destination directly to a side settles at the screen's vertical centre -- so the fixed anchor no longer wastes most of the screen on empty space ahead when the route is actually behind the user. Separately, the zoom fit itself (`maxHeadingUpNavigationScale` / `maxScaleForHeadingUpPoints`) no longer excludes the selected destination from its fit calculation just because it's currently behind the user during 3D tilt (nearby mode's fit is unaffected and still excludes behind-the-user points) -- `maxScaleForHeadingUpPoints` takes an `excludeBehindDuringTilt` option, and selected-navigation now passes `false`, so the origin, route, and destination are all fit onto the available map space together rather than the destination being invisible off the bottom edge. The selected location must stay inside the visible map area; heading-up navigation reduces zoom when needed to keep it visible. Expanding the inspector panel while heading-up navigation is active re-runs this real scale fit (`alignHeadingUpNavigationViewport`) against the inspector's newly-expanded footprint, rather than just recentring at whatever scale was already in effect (`setInspectorMinimized`, `js/nav.js`) -- without this, a fit computed while the inspector was minimized (a bigger available area) was never corrected once the inspector grew back to its full size, so a destination positioned low on screen (especially likely now that a behind-the-user destination can occupy most of the screen below the anchor) could end up rendered behind the now-larger panel. North-up selected navigation (no compass heading yet) is unaffected and keeps the plain recentre-at-current-scale behaviour.
- In nearby (overview) mode, the map also becomes heading-up whenever user location and compass heading are available: the device-facing direction is always toward the top of the screen, the user stays anchored at the vertical center (50%), and the map rotates in real-time as the user turns. Map icons always point from top to bottom of screen. The nearby button is in the active state during this mode.
- While heading-up mode is active (either nearby or selected-navigation), compass-only rotation updates should rotate the existing map canvas around the user point and redraw only the lightweight user/radar overlay rather than redrawing all map layers every animation frame.
- The CSS rotation transform must always be re-applied after `alignHeadingUpNavigationViewport()` (which clears it for clean layout measurement) and after every full canvas redraw via a `postDraw()` hook — preventing the one-frame flash where the map appears un-rotated.
- The tilt-threshold `resizeCanvas()` call happens inside `prepareCanvasForDraw()` (not the compass tick), so the canvas resize and redraw are atomic within the same rAF callback and no blank-canvas frame is ever composited.
- **3D tilt mode:** Available on every screen — the plain nearby overview, actively navigating to a selected item, and the filter panel, settings, and feedback screens all allow full 3D tilt (see `tiltAllowedForCurrentScreen()` in `spec-data-rendering.md`), with no exceptions — returning to the nearby overview from any screen (including a tilted navigation view or cluster-detail) no longer flattens tilt first; the camera re-fit animates while tilt continues to track live phone orientation. When heading-up is active, tilt allowed, and `DeviceOrientationEvent.beta` exceeds 12° (phone tilted from flat), the ground plane is projected in perspective around the user's on-screen position, so the area ahead recedes into the distance. The projection is applied in JS, per point, as the map is drawn (`worldToScreen()` -> `tiltProjectOffsets()`), not as a CSS transform on the finished bitmap — see "3D tilt projection" in `spec-data-rendering.md` for why that distinction is what makes the 3D view hold together at every angle. The tilt angle is proportional to beta: 12° = 0° rotateX, 85° = 75° rotateX (`TILT_ROTATEX_MAX`). The perspective (camera) distance is no longer a fixed constant — `tiltPerspectivePx()` derives it from the screen space actually available above the tilt pivot (`tiltAvailableAheadCssPx()`), so the ground-plane horizon reaches a consistent fraction of the visible map (`TILT_HORIZON_GROUND_RATIO`, 62%) regardless of device height, once at max tilt — instead of leaving a fixed-size CSS-px gap that read as proportionally more empty sky on taller screens. Critically, this is calibrated against the fixed `TILT_ROTATEX_MAX` reference angle (`TILT_HORIZON_REFERENCE_TAN`), not the live, ever-changing `tiltRotateXDeg()`: calibrating against the live angle instead shrinks the camera distance sharply at low/mid tilt (an early version of this fix did exactly that), which pulls in the perspective-divide singularity behind the user — pins, the radar, and road/path lines that far behind the pivot get a blown-up projected `scale`. The divide can no longer go negative or infinite in any case — `tiltProjectOffsets()` clips just short of the camera plane (`TILT_NEAR_PLANE_RATIO`) — but keeping the camera distance generous is still what stops content ballooning before that clip. Calibrating against the fixed reference angle keeps that safety margin at least as generous as the old fixed-900px system had, at every active tilt angle, while the ground-fraction target itself only applies exactly at max tilt (at lower tilt angles the ground fraction is naturally larger — more of the screen is ground, less is sky — matching how the geometry already behaved before this whole fix). The result is clamped to a sane range (`TILT_PERSPECTIVE_MIN_PX`–`TILT_PERSPECTIVE_MAX_PX`) for extreme viewport sizes. `tiltAvailableAheadCssPx()` uses `max(anchor, 1 - anchor)`, not the raw anchor fraction: for selected navigation, the anchor can itself be mirrored toward the top of the screen when the destination is behind the user (see the anchor-mirroring note above), and feeding that now-small mirrored anchor straight in would shrink the camera distance right along with it -- reintroducing the exact singularity-margin regression described above, via bearing this time instead of tilt angle. Using whichever side of the pivot is actually larger keeps the camera distance sized for the bigger reach regardless of which side of the pivot it's on, so mirroring the on-screen anchor position never on its own shrinks the safety margin. That alone still dips as low as 0.5 exactly when the destination is directly to a side (the mirrored anchor passes through the screen's 50% centre there), which is lower than the historically-safe `tiltRampedAnchor()` floor (the plain, pre-mirror ramped anchor, always >= 0.5) this calculation always used before bearing-based mirroring existed -- an ordinary, frequent case in real walking navigation, not just the dead-behind extreme. `tiltAvailableAheadCssPx()` therefore takes the max of the mirrored anchor, its complement, and `tiltRampedAnchor()`, restoring that safety margin across the whole bearing range. Beta is smoothed with an exponential filter (τ ≈ 1/4 s, slower than the compass heading filter) in the same animation loop as compass heading, so the pin/pointer collapse this drives (see `tiltInfluence()` below) eases in over time rather than snapping as the phone lifts through the flat dead-zone. Tilt never resizes the canvas: with the projection applied per point rather than to the bitmap, there is no canvas edge for perspective to expose, and the ground is drawn all the way to the horizon. The overlay canvas is kept flat (no CSS tilt); pin positions are projected mathematically via `worldToScreenForOverlayTilted` so pins appear upright (billboard) at the correct perspective depth. The user radar cone is also perspective-projected using `projectCanvasPoint` so its rings and direction line appear in the same 3D space as the terrain. When tilt is inactive, no projection is applied and plain 2D rotation resumes.
- Show route lines:
  - selected mode: user → selected target
  - overview mode: user → nearest overview targets
- The selected-location compass arrow appears only when user location and a selected navigation target exist. It lives in the inspector title row, aligned to the far right edge of the modal and roughly three times the normal title-row arrow size; no separate top-of-screen title/distance box is shown.
- The user radar cone is drawn on the **main canvas** in non-tilt heading-up mode so the CSS `rotate` transform keeps it aligned. The cone's centre line always points in the direction the user is facing — straight up on screen in heading-up mode (any target selected or not), or at the absolute compass heading in flat/north-up mode; it never swings to point at the selected destination (that bearing is shown by the dotted route line instead). **In 3D tilt mode** (`tiltActive()` true), the radar moves to `#overlayCanvas` and each arc point is explicitly projected through `projectCanvasPoint` (the same shared projection as overlay pins and the terrain), drawing the cone as 24 line-segment steps so it appears to lie flat on the tilted ground plane instead of as a vertical fin.
- The user radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom.
- In heading-up mode (nearby or selected), all overlay pins are drawn using a **depth-sorted painter's algorithm**: clusters from all types (trees, landmarks, cows, paths, water) are collected into a single list, sorted ascending by screen Y (distant items at the top of the screen first), then drawn in that order so nearer items always paint over farther ones. The selected item is drawn last via `drawSelectedOverlay` and is always on top.

## Details Content Requirements

### Tree details

Show register fields where present (IDs, taxonomy, status, girth, metadata, comments, grid refs).

If enriched named-tree data exists, include:

- match metadata
- folklore/historical notes
- source links

### Place details

Show place name/category/address/contact/source and appropriate emoji by type.

### Cow details

Show serial/type/coordinates/last update/source.

## Legend / Key

Legend reflects active marker semantics:

- Trees
- Cows
- Pubs & bars
- Restaurants
- Cafés & tea huts
- Shops (convenience, supermarkets, bakeries, etc.)
- Train stations (Underground & National Rail)
- Bus stops
- Historic sites & landmarks
- Plaques & memorials
- Generic locations

## Attribution Rules

- OpenStreetMap attribution note is shown only when viewing details for OSM-sourced places.
- No global attribution note in overview or non-OSM contexts.
- Attribution target: `https://www.openstreetmap.org/copyright`

## Offline, Caching, and Refresh

- Service worker caches app shell and offline datasets in two separate caches as of 2026-09-04: `forest-finds-app-vN` (app code) and `forest-finds-data-vN` (data). This allows weekly data updates without re-downloading app code.
- App cache is bumped on code changes via `.github/workflows/sw-bump.yml` and `sw-release.yml`; data cache is bumped on data changes via `.github/workflows/data-bump.yml` (path-triggered on `data/**`).
- Cow proxy endpoint bypasses service-worker caching.
- Cow data is cached in browser storage and refreshed on interval (every 5 minutes).

### Service Worker Update Flow

1. When a new SW version is detected (`updatefound` → `statechange: installed`), the new SW waits — it does **not** auto-activate via `skipWaiting()` in the install handler.
2. A red dot badge appears on the settings toggle button (always visible, not just inside the settings panel).
3. Inside the settings panel, the app version turns red with a "— tap to update" label.
4. Clicking either indicator triggers `SKIP_WAITING` (posted to the waiting SW), the SW activates, and the page reloads automatically on `controllerchange`.
5. `skipWaiting()` in the SW is triggered only via the `message` event (`event.data.type === "SKIP_WAITING"`), never automatically on install.

## Data Statistics (as of May 2026)

Approximate feature counts in offline datasets:

- **Trees:** ~400 veteran trees
- **Landmarks:** ~3,900+ features including:
  - ~210 shops (convenience stores, supermarkets, bakeries, etc.)
  - ~100+ pubs & bars
  - ~150+ cafés & restaurants
  - ~200+ transport stops/stations
  - ~500+ historic sites
  - ~1,000+ access points (gates, entrances, etc.)
- **Roads:** ~3,000-5,000 major road segments (filtered for performance)
- **Paths:** ~1,000+ footpaths, bridleways, and trails
- **Environment:** ~500+ water features and nature designations

## Local Regeneration Workflow

### Landmarks regeneration

Preferred regeneration script: `scripts/regenerate_local_landmarks.py`

- Fetches Overpass payload (with endpoint fallback)
- Writes `data/local-landmarks.overpass.json`
- Filters features to within 8-minute walk (467m) of forest boundary
- Rebuilds `data/local-landmarks.geojson`
- Prints category counts

**After regeneration, split the large file:**

```bash
python3 scripts/split_landmarks.py
python3 scripts/split_access.py
```

This splits the landmarks into smaller category-based files to avoid GitHub's file size limits:
- Food & drink
- Transport
- Gates & barriers
- Facilities (parking, benches, toilets)
- Historic sites
- Tourism info
- Miscellaneous

Alternative: `scripts/regenerate-local-landmarks.js` (Node.js version)

### Paths regeneration

- `scripts/regenerate_local_paths.py`  
- `scripts/regenerate-local-paths.js`

### Roads regeneration

- `scripts/regenerate_local_roads.py`

### Environment regeneration

- `scripts/regenerate_local_environment.py`

### Quick updates

- `scripts/add_missing_shops.py` - adds new shops from existing Overpass data
- `scripts/quick_add_shops.py` - patches shop properties in existing data
- `scripts/split_landmarks.py` - splits landmarks into category files
- `scripts/split_access.py` - further splits access/facilities file

## User Tracking & Analytics

### Consent
Users are shown a privacy/consent modal before location is enabled. Consent is stored in `localStorage` under key `ff-track-v1`. Users can withdraw via Settings → Privacy.

Full terms are at `/terms.html`. The modal links to this page.

### Data collected (with consent)
- **Location pings** — lat/lng, heading, current nav target — sent every 60 seconds while location is active. Paused while the tab/screen is hidden (`document.visibilitychange`) along with the GPS watch, and resumed on return to foreground, to avoid draining battery in the background.
- **Click events** — item type, item ID, item name, user position — sent on every map-item selection
- Each event is tagged with a random anonymous user ID (`ff-uid` in `localStorage`) and ISO timestamp

### Event types
All events POST to `POST /api/track` as `{ events: [...] }`.

**Location event:**
```json
{ "type": "location", "uid": "...", "ts": "ISO", "lat": 51.65, "lng": 0.04, "heading": 180, "navTarget": { "id": "...", "name": "...", "type": "tree" } }
```

**Click event:**
```json
{ "type": "click", "uid": "...", "ts": "ISO", "userLat": 51.65, "userLng": 0.04, "itemType": "tree", "itemId": "T123", "itemName": "Ancient Oak" }
```

### Offline queue
Events are stored in `localStorage` (`ff-track-queue`) when offline and flushed as a batch when connectivity is restored (via `window online` event).

### Storage
- **Local server:** appended to `data/tracking/location.ndjson` and `data/tracking/click.ndjson`
- **Netlify:** stored as blobs in the `tracking` store via `@netlify/blobs`

### Admin interface
- URL: `/admin` — password-protected (env var `ADMIN_PASSWORD`)
- Canvas map of Epping Forest showing user positions and tracks
- Sidebar with user list; click to isolate an individual user's route
- Toggle between **Tracks view** (coloured route lines + direction arrows) and **Heatmap view** (density grid)
- Yellow dots show click/tap events; coloured dots show last known user position
- Auto-refreshes every 5 minutes; manual refresh button available
- Data served from `GET /api/admin/tracks?pw=...`

## GitHub Issue Clarification Workflow

See `spec/spec-issue-workflow.md`.

## Technical Constraints

- No client build step.
- Keep implementation in static HTML/CSS/JS and minimal local Node server for static/proxy hosting.
- Favor robust/simple logic over framework complexity.
- Preserve performance on mobile devices.
