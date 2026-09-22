## UI Structure

**Modal / Inspector**
The panel that sits above the map. Called "modal" in user-facing language and "inspector" in code. Contains the nearby list, filter controls, and selected-item detail views.

**Map view**
The map canvas in the background, visible in the area not covered by the inspector.

**Navigation buttons**
The icon buttons at the top right of the inspector, in left-to-right order: Nearby, Filters, Search, Feedback, Settings.

---

## Inspector Modes

**Nearby mode / Overview mode**
The default inspector state: shows the nearest items list and filter controls. "Nearby mode" is the user-facing term; "overview mode" is the code term (`isOverviewScreenActive()`).

**Selected-detail mode**
Inspector state when a specific tree, landmark, cow, path, street, or railway is selected. Shows full item detail and hides the filter panel.

**Search screen**
Inspector state when the search magnifier is open (`state.searchScreenOpen = true`). A query field over the whole dataset — trees by species or tag, places, roads, trails, water, railway lines and cows — listing matches as Nearby-style rows that open the location when chosen (`openSearchScreen()`, `searchMapFeatures()`, `openSearchResult()`). One of the four secondary screens; shares `secondaryScreenActive()` navigation behaviour with Filter, Settings and Feedback.

**Filter screen / Filters screen**
Inspector state when the filter toggle panel is open (`state.filterScreenOpen = true`). Shows filter group chips. GPS updates, cow refreshes, and back-button presses do not close it — only explicit navigation away does.

**Minimized mode**
Inspector collapsed to a header strip only. Auto-reposition is paused; user can pan and zoom freely. Tapping the header restores the previous mode.

**Navigation mode**
When a user has selected a location and is being shown directions to it. A route line is drawn and the compass arrow appears in the inspector title row.

**Cluster detail mode**
Inspector state after tapping a multi-item cluster pin (`state.clusterExpanded` set, `state.selected` null). Shows a back button, an item-count title (e.g. "4 Trees"), and a nearest-item list of the cluster's members. While it is open the map shows only that group's items — every other highlighted location is hidden. Tapping a member opens full selected-detail via `focusOverviewItem`; tapping back returns to nearby mode, and tapping open map ground returns to nearby mode focused on the tapped spot.

**Feedback / Report screen**
One of the four secondary screens (alongside Search, Filter and Settings). "Feedback" is the user-facing nav button label; "report" is the code term (`state.selected?.type === "report"`, `openReportModal()`, the Report form). Shares `secondaryScreenActive()` navigation behaviour with Search, Filter and Settings.

---

## Map Modes

**North-up mode**
Default map orientation: north is always toward the top of the screen.

**Heading-up mode**
Compass-driven map orientation: the direction the device is facing is always toward the top of the screen. The map rotates in real-time as the user turns. Active in both navigation mode (selected target) and nearby mode (when location and compass are available).

**Foraging mode**
Zoom behaviour when the filter panel is closed: the viewport anchors to the nearest 3–5 active trees, giving a tight in-forest view where individual tree positions are distinguishable. Falls back to nearest items of any active type if trees are filtered off.

**Survey mode**
Zoom behaviour on the Filter, Search, Settings and Report screens: the camera frames the walking-radius ring *plus* the nearest single match of each active filter, however far outside the ring that is (`nearestSelectedFilterPoints()`), and the map highlights those same out-of-ring matches alongside the ring's own contents. Allows the user to see how far away transport, food, or other points of interest are without leaving the screen. Everything else highlighted is the in-radius set the Nearby screen shows, so resizing the radius from these screens changes what is on the map. Snaps back to foraging zoom on close.

**Tilt mode / Full 3D**
Map orientation where the canvas is rendered with a `rotateX` CSS perspective so it appears to lie flat on the ground ahead of the user, active whenever `tiltActive()` is true (device pitched beyond `TILT_BETA_THRESHOLD`, 12°). "Full 3D" is the term used in spec prose; `tiltActive()`/`tiltBetaSmoothed`/`tiltInfluence()` are the code terms. Available on every screen (nearby, navigation, filter, settings, feedback). Pins and route/road lines behind the user's heading shrink or are culled entirely — see "Full 3D — hiding what's behind" in spec-data-rendering.md.

---

## Data & Features

**Veteran tree**
A tree in the Epping Forest Veteran Tree Register. Displayed as a teardrop pin with a species leaf icon on the map.

**Landmark**
A point of interest from OpenStreetMap or the folklore dataset. Includes pubs, cafés, bus stops, historic sites, blue plaques, etc.

**Cow**
A live animal position from the Nofence open data API. Refreshed every 5 minutes.

**Walking radius**
The configurable distance (in minutes of walking time) used to filter nearby items in the overview list. Shown as a dashed circle on the map. Configurable via a continuous Settings slider (its floor–30 min; half-minute steps, quarter-minute below a minute; default 5 min). On the Nearby screen it can also be pinch-resized continuously and directly on the map, and on a laptop by the scroll wheel or a trackpad pinch (see "Wheel and trackpad resize the ring" in spec-data-rendering.md). Neither control lets the radius shrink below the distance to the nearest real item — but that floor follows finds closer than a minute's walk down to 15 seconds (~21 m), so a find underfoot can be zoomed right in on. Sub-minute radii are shown in seconds ("15 sec"). See "Walking-radius floor" and "Automatic grow-back" in spec-data-rendering.md.

**Out of radius / radius fallback**
When no items of a given type exist within the walking radius, the nearest item of that type is shown in the list with an out-of-radius style. A notice explains no results were found within the selected walking time.

**Browse anchor / nearby anchor**
A map point (`state.nearbyAnchor`) the user has tapped on open map ground, previewing that spot's nearby items and radius without moving the real GPS "You" dot. Any open-ground tap sets it, at any distance, from any screen that draws the walking-radius ring — Nearby, Filters, Settings and Report alike. Cleared via the "Use my location" control in `#nearbyAnchorBar`, which is inspector chrome and so stays reachable from all four. Code term: `nearbyOrigin()` resolves to this when set, otherwise the real location.

---

## Map Elements

**Route line**
A dashed line from the user's position to a navigation target. Orange in selected-detail mode; category-coloured in nearby mode (one line per cluster). In selected-detail mode the line follows the mapped road/path network when a walkable route can be found (see "Route Lines" in spec-data-rendering.md), falling back to a straight line when it can't; nearby-mode lines are always straight.

**Walking radius ring**
The dashed circle drawn on the map centred on the user, showing the walking radius boundary.

**Radar cone**
The directional indicator around the user dot. Points in the direction the device is facing. The outer edge represents roughly 60 metres in front of the user at the current zoom level.

**Cluster**
Multiple nearby pins of the same type grouped into a single pin at their screen centroid. Shows a count badge when more than one item. Tapping zooms in until items separate.

**Cluster badge**
The small count label (e.g. "4" or "9+") drawn in the top-right of a cluster pin.

**Nearest area**
The walking-radius ring on the Nearby screen, and everything inside it — the nearby list and the highlighted locations. On the Nearby screen a tap beyond it moves the nearest area to the tapped spot whatever it landed on (`isOutsideNearestArea`); inside it, taps select as normal.

**Open ground**
Any map tap that resolves to neither a highlighted location nor a street. Background polygons (forest, nature designations, water bodies) are not hit-tested, so a tap inside the forest counts as open ground. An open-ground tap moves the browse anchor rather than selecting anything.

**Off-ring user pointer**
The off-black ground-plane triangle and `You · {distance}` label drawn on the walking-radius ring's edge, on the bearing from the browse anchor to the real GPS position, while browsing has taken the "You" dot off screen (`drawUserDirectionFromAnchor`). Drawn only while the dot itself is not visible — outside the ring *and* outside `bestVisibleCanvasRect()`, so a dot hidden behind the inspector still counts as off screen. Tapping it clears the browse anchor and returns to the real location.

**User cone**
The wedge drawn from the "You" dot out to the walking-radius ring while browsing a spot the user is standing outside of (`nearbyUserCone`). Its edges are the tangents from the user to the ring, so it lands exactly on the circle. Shaded as a third tier of the walking-radius wash — the circle clear, the cone lightly dimmed, everything else fully dimmed — so where you are and what the circle is around read as one shape. Not the same thing as the **Radar cone** above, which is the small facing-direction indicator on the dot itself.

**Browse-origin slide**
The animation between two Nearby origins (`state.nearbyOriginTransition`): the origin is interpolated over ~520ms while the camera keeps it pinned at the focus, so the walking-radius circle holds still on screen and the map moves behind it. Rendering follows the interpolated origin; the nearby list and hit testing use the destination immediately.

**Camera origin** (`cameraOriginPoint()`)
The single world point the camera anchors at its focus — and therefore the point the scale fit measures from, the heading-up rotation pivots about, and the 3D perspective projects around. The real GPS fix while navigating to a selected destination; `nearbyOrigin()` otherwise, so a browse anchor moves framing, fit and perspective together.

**Street navigation target**
The pseudo-item (`roadNavTarget`) a selected street navigates to: the point on that street's own geometry nearest the user when it was selected. A street has no single position of its own, so this is what the compass arrow, route line, and camera fit aim at.

---

## Technical

**AppData**
The data interface produced by the fetching layer and consumed by the renderer. Contains trees, landmarks, paths, roads, environment features, forest boundaries, cows, and pastures.

**Service worker**
The background script (`sw.js`) that pre-caches the app shell and offline datasets so the app works without a network connection. Uses two separate caches as of 2026-09-04: `forest-finds-app-vN` for app code (HTML, CSS, JS) and `forest-finds-data-vN` for data (GeoJSON, tree chunks, icons). App cache is bumped by CI on code changes (`.github/workflows/sw-bump.yml`, `sw-release.yml`); data cache is bumped independently on data updates (`data-bump.yml`). This split means weekly data updates dont force re-downloads of the entire app. `self.__DEV__`, injected into the served `sw.js` response only by the local dev server (`node server.js` / `npm run dev`), switches both fetch handlers to network-first so local edits show up without needing a version bump — see the **Local dev flag** entry below.

**Local dev flag** (`self.__DEV__`)
A flag `server.js` inserts into the `sw.js` response it serves (via `injectDevFlag()`), never present in the file on disk or in the production build Netlify serves untouched. `sw.js` reads it into `IS_DEV` and, when true, fetches everything from the network first (cache as an offline-only fallback) instead of the production cache-first strategy — this is what makes local testing reflect the latest files on every refresh. `injectDevFlag()` also prefixes both `APP_CACHE_NAME` and `DATA_CACHE_NAME` with `dev-` (e.g. `forest-finds-app-dev-v1`), mirroring the branch prefix `sw-bump.yml` applies for preview builds, so the About screen's app-version display and any bug report's `appVersion` read as local rather than a stuck release number.

**Hash / deep link**
The URL fragment (`#...`) that names the screen the app is on — a selection, or Filters / Settings / Report. It is navigation state, not a label: the router (`js/app.js`) pushes a history entry per screen change and applies whatever the URL says on `popstate` / `hashchange`, so back and forward retrace the trail and a shared link opens the screen it names. See spec.md § "URL hash / navigation state".

**Route**
The canonical hash payload for a screen, without the leading `#`: `""` (Nearby), `"filters"`, `"settings"`, `"report"`, or `"<kind>=<key>"` for a selection. `currentScreenRoute()` writes one from state and `applyRoute()` reads one back into state.

---

## Admin & Tracking

**Blob store / tracking store**
The Netlify Blobs store holding tracking events for one deploy context, named `tracking` (production) or `tracking-<branch>` (deploy preview / branch deploy). Falls back to local NDJSON files (`data/tracking/`) when no Netlify Blobs context is available (e.g. plain `node server.js`).

**Environment isolation**
The rule that the tracking store name is derived entirely from the Netlify `CONTEXT`/`BRANCH` env vars, never from a client- or user-controlled value, so preview/branch traffic can never read or write the production store (and vice versa).

**Explicit click / derived navigation-click**
The two sources of click-detail records in admin. An explicit click is a `click` event sent directly by the client. A derived navigation-click is synthesised by admin from a `location` event's `navTarget` field. Admin suppresses a derived event when a matching explicit click exists for the same user/target near the same time.

**Target key**
The aggregation key for click-detail records in admin: `<itemType>:<itemId or itemName>`.
