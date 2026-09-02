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

**Cluster detail mode**
Inspector state after tapping a multi-item cluster pin (`state.clusterExpanded` set, `state.selected` null). Shows a back button, an item-count title (e.g. "4 Trees"), and a nearest-item list of the cluster's members. Tapping a member opens full selected-detail via `focusOverviewItem`; tapping back or empty map space returns to nearby mode.

**Feedback / Report screen**
One of the three secondary screens (alongside Filter and Settings). "Feedback" is the user-facing nav button label; "report" is the code term (`state.selected?.type === "report"`, `openReportModal()`, the Report form). Shares `secondaryScreenActive()` navigation behaviour with Filter and Settings.

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
The background script (`sw.js`) that pre-caches the app shell and offline datasets so the app works without a network connection. Cache version (`CACHE_NAME`) must be bumped with every client-side change; CI does this automatically (`.github/workflows/sw-bump.yml`, `sw-release.yml`), so it never happens on an uncommitted local change. `self.__DEV__`, injected into the served `sw.js` response only by the local dev server (`node server.js` / `npm run dev`), switches the fetch handler to network-first so local edits show up without needing a version bump — see the **Local dev flag** entry below.

**Local dev flag** (`self.__DEV__`)
A flag `server.js` inserts into the `sw.js` response it serves (via `injectDevFlag()`), never present in the file on disk or in the production build Netlify serves untouched. `sw.js` reads it into `IS_DEV` and, when true, fetches everything from the network first (cache as an offline-only fallback) instead of the production cache-first strategy — this is what makes local testing reflect the latest files on every refresh. `injectDevFlag()` also prefixes `CACHE_NAME` with `dev-` (e.g. `forest-finds-dev-v274`), mirroring the branch prefix `sw-bump.yml` applies for preview builds, so the About screen's app-version display and any bug report's `appVersion` read as local rather than a stuck release number.

**Hash / deep link**
The URL fragment (`#...`) that encodes the current selection. Uses `history.replaceState` so no in-app history entries are created.

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
