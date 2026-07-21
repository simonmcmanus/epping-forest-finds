## UI Structure

**Modal / Inspector**
The panel that sits above the map. Called "modal" in user-facing language and "inspector" in code. Contains the nearby list, filter controls, and selected-item detail views.

**Map view**
The map canvas in the background, visible in the area not covered by the inspector.

**Navigation buttons**
The icon buttons at the top right of the inspector (Nearby, Filters, Settings, Feedback).

---

## Inspector Modes

**Nearby mode / Overview mode**
The default inspector state: shows the nearest items list and filter controls. "Nearby mode" is the user-facing term; "overview mode" is the code term (`isOverviewScreenActive()`).

**Selected-detail mode**
Inspector state when a specific tree, landmark, cow, or path is selected. Shows full item detail and hides the filter panel.

**Filter screen / Filters screen**
Inspector state when the filter toggle panel is open (`state.filterScreenOpen = true`). Shows filter group chips. GPS updates, cow refreshes, and back-button presses do not close it — only explicit navigation away does.

**Minimized mode**
Inspector collapsed to a header strip only. Auto-reposition is paused; user can pan and zoom freely. Tapping the header restores the previous mode.

**Navigation mode**
When a user has selected a location and is being shown directions to it. A route line is drawn and the compass arrow appears in the inspector title row.

---

## Map Modes

**North-up mode**
Default map orientation: north is always toward the top of the screen.

**Heading-up mode**
Compass-driven map orientation: the direction the device is facing is always toward the top of the screen. The map rotates in real-time as the user turns. Active in both navigation mode (selected target) and nearby mode (when location and compass are available).

**Foraging mode**
Zoom behaviour when the filter panel is closed: the viewport anchors to the nearest 3–5 active trees, giving a tight in-forest view where individual tree positions are distinguishable. Falls back to nearest items of any active type if trees are filtered off.

**Survey mode**
Zoom behaviour when the filter panel is open: both the zoom calculation and the map pin rendering use `overviewItemsUnlimited()` — the nearest `nearestItemsCount` items per active type, ignoring the walking radius — so pins are always visible wherever the camera zooms. Allows the user to see how far away transport, food, or other points of interest are without leaving the filter screen. Snaps back to foraging zoom on close.

---

## Data & Features

**Veteran tree**
A tree in the Epping Forest Veteran Tree Register. Displayed as a teardrop pin with a species leaf icon on the map.

**Landmark**
A point of interest from OpenStreetMap or the folklore dataset. Includes pubs, cafés, bus stops, historic sites, blue plaques, etc.

**Cow**
A live animal position from the Nofence open data API. Refreshed every 5 minutes.

**Walking radius**
The configurable distance (in minutes of walking time) used to filter nearby items in the overview list. Shown as a dashed circle on the map. Configurable via Settings (1–30 min; default 5 min).

**Out of radius / radius fallback**
When no items of a given type exist within the walking radius, the nearest item of that type is shown in the list with an out-of-radius style. A notice explains no results were found within the selected walking time.

---

## Map Elements

**Route line**
A dashed line from the user's position to a navigation target. Orange in selected-detail mode; category-coloured in nearby mode (one line per cluster).

**Walking radius ring**
The dashed circle drawn on the map centred on the user, showing the walking radius boundary.

**Radar cone**
The directional indicator around the user dot. Points in the direction the device is facing. The outer edge represents roughly 60 metres in front of the user at the current zoom level.

**Cluster**
Multiple nearby pins of the same type grouped into a single pin at their screen centroid. Shows a count badge when more than one item. Tapping zooms in until items separate.

**Cluster badge**
The small count label (e.g. "4" or "9+") drawn in the top-right of a cluster pin.

---

## Technical

**AppData**
The data interface produced by the fetching layer and consumed by the renderer. Contains trees, landmarks, paths, roads, environment features, forest boundaries, cows, and pastures.

**Service worker**
The background script (`sw.js`) that pre-caches the app shell and offline datasets so the app works without a network connection. Cache version (`CACHE_NAME`) must be bumped with every client-side change.

**Hash / deep link**
The URL fragment (`#...`) that encodes the current selection. Uses `history.replaceState` so no in-app history entries are created.
