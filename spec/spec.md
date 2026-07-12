# Epping Forest Finds PWA Specification

Build a static, offline-capable PWA for exploring veteran trees, nearby places, transport links, and live cow positions around Epping Forest.

The app is lightweight, dependency-free on the client, and runnable directly from this folder via a local static/proxy server.

## Detailed Specs

This top-level spec provides the product overview. Implementation details are split into two focused specs with a clearly defined data interface between them:

- **[spec-data-fetching.md](spec-data-fetching.md)** — Fetching, loading, normalizing, and caching all data sources. Defines the `AppData` output interface.
- **[spec-data-rendering.md](spec-data-rendering.md)** — Drawing, interaction, and UI. Consumes the `AppData` interface from the fetching layer.

All specs live in the `spec/` folder at the project root.

All three specs should be kept in sync with every change.

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
- On desktop (>760px) selecting a location keeps the inspector expanded. On mobile (≤760px) selecting a location collapses the inspector so the map is visible.
- Tapping the Nearby button always calls `goToInitialView()` (clears selection, refits camera) rather than `selectOverview()` alone.

### URL hash / navigation state

- All hash changes use `history.replaceState` (never `pushState`) so no in-app history entries are created and browser back/swipe gestures take the user out of the app rather than undoing in-app navigation.
- `hashchange` with an empty hash only triggers `goToInitialView()` when the filter screen is not open.

### Camera behavior

- With selected target + expanded inspector: camera fits user + target in the visible area above the inspector (not behind the modal). Zoom adjusts so both fill the available viewport.
- Navigation mode GPS follow: smooth 800 ms animation that only triggers when the user or destination drifts near the edge of the visible area (14% margin). Sub-threshold GPS noise is ignored so the camera glides rather than jumps.
- In overview mode, GPS updates keep the user location and nearest items within the visible map area.
  - the first successful location fix triggers a 1200ms cinematic zoom to the user's 5-minute walking radius
  - if location is obtained before map data finishes loading (user clicks the gate early), the zoom is re-triggered once data and `fitToBounds()` are ready — ensuring the animation is never permanently cancelled by the data-load sequence
  - the zoom level adjusts as the user moves so nearest items always fill the available viewport; items that drift off-screen trigger an immediate refit regardless of movement distance
  - fast movement (walking, train) never causes the user or their nearest items to disappear from the map
- In nearby heading-up mode, compass and filter changes keep the active highlighted items visible; when every highlighted item is ahead of the user, the camera shifts the user toward the lower part of the map to leave more space in front.
- Nearby ↔ selected-location transitions use a single eased ~500 ms camera move; both directions wait for the inspector layout transition to settle before measuring the visible map area, and heading-up rotation/pan/zoom start together so the map never snaps through an intermediate framing.
- With minimized inspector: auto-reposition is paused.
  - user can pan/zoom freely
  - GPS updates/drag/zoom/resize must not force recenter
- On expand from minimized: recenter once to user + selected target while preserving current zoom intent.
- View transitions should animate.

## Zoom and Input Constraints

- Disable browser/page pinch zoom and ctrl+wheel zoom.
- Map zoom is controlled only by map interactions and map controls.
- Home/fit button restores full data framing.

## Nearest and Filter Behavior

- Overview lists nearest items across active types.
- If nothing is found within the selected walking-radius range, the nearest list shows the closest available item for each active type and displays a notice explaining that no matches were found within the selected walking time.
- **Onboarding (first visit):** On first visit (`forest-finds-onboarding-v1` not in localStorage), a full-screen onboarding overlay is shown while map data loads in the background. Steps: Welcome → one step per filter group (Nature, Food, Transport, History, Locations, Stories) → Location opt-in → Compass guidance opt-in. Each category step shows all subfilters as toggle chips (all on by default); the user deselects anything unwanted. A skip option is available on every step. The location step replaces the normal location gate for first-time users. If compass access is supported, it is requested during setup before the map is revealed. Once granted, the permission is remembered so later nearby/location entry does not reprompt. If it is unavailable or declined, the app shows a notice and continues with the best available experience. On completion (or skip), selected filters are saved and onboarding is marked done. Implemented in `js/onboarding.js` + `css/onboarding.css`.
- **Proactive location + compass on every load:** On every visit (first-time and returning), `getCurrentPosition` is called immediately when the app starts, running in parallel with map data loading so the browser's native permission dialog appears during the loading screen rather than after a tap. By the time data finishes loading the location is usually already resolved and the map opens centred on the user. If location is denied or times out, the location gate is shown after the map reveals. Immediately after a successful location fix at boot, compass permission is also requested: non-iOS browsers auto-grant; iOS shows the gate so the user can tap from a real gesture context (required by iOS for `DeviceOrientationEvent.requestPermission`).
- **Compass permission — iOS per-session requirement:** On iOS, `DeviceOrientationEvent.requestPermission()` must be called from a synchronous user-gesture handler every page load before orientation events are fired — even when the user has previously granted permission. The stored `forest-finds-compass-permission-v1` value of `"granted"` is therefore treated as `"unknown"` at boot on iOS-like browsers (those where `DeviceOrientationEvent.requestPermission` is a function), so the compass gate is shown and the per-session call happens from the gate button click (a real user gesture). On non-iOS browsers no user gesture is required and the stored value is used as-is.
- **Default filters:** On first visit (no saved state from onboarding), filters default to all subfilters selected. If onboarding is skipped without changes, all filters remain active.
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
- Contains a **Walking radius** control: a dropdown to choose how far to walk when listing nearby places (1, 2, 5, 10, 15, 20, 30 min options).
- Contains an **About** section displaying the current app version (e.g. `v80`).
- Changing the walking radius stays on the settings screen, immediately animates the map to fit the new radius, updates the nearby list and nearest tree selection, and keeps the walking radius ring visible.

## Feedback / Report Screen

- Accessible via the generated feedback icon button in the inspector header.
- Allows users to report missing data or request features; submissions are tracked as GitHub issues.
- The current app version is displayed in the form so the user can see which version will be reported.
- The app version, user agent, page URL, and optional geolocation are included in every submission payload.

## Compass and Direction Guidance

- Use device orientation when available.
- Smooth heading updates for:
  - selected-location title-row compass arrow
  - nearest-list directional arrows
- In selected-location navigation, the map becomes heading-up whenever compass heading is available, regardless of whether the inspector is expanded or minimized: the device-facing direction is always toward the top of the screen, the user stays anchored slightly below center (62% down the visible area), and the map rotates as the user turns. The selected location must stay inside the visible map area; heading-up navigation reduces zoom when needed to keep it visible.
- In nearby (overview) mode, the map also becomes heading-up whenever user location and compass heading are available: the device-facing direction is always toward the top of the screen, the user stays anchored at the vertical center (50%), and the map rotates in real-time as the user turns. Map icons always point from top to bottom of screen. The nearby button is in the active state during this mode.
- While heading-up mode is active (either nearby or selected-navigation), compass-only rotation updates should rotate the existing map canvas around the user point and redraw only the lightweight user/radar overlay rather than redrawing all map layers every animation frame.
- Show route lines:
  - selected mode: user → selected target
  - overview mode: user → nearest overview targets
- The selected-location compass arrow appears only when user location and a selected navigation target exist. It lives in the inspector title row, aligned to the far right edge of the modal and roughly three times the normal title-row arrow size; no separate top-of-screen title/distance box is shown.
- The user radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom.

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

- Service worker caches app shell + offline datasets.
- Cache name is versioned and bumped with behavior/data wiring changes.
- Cow proxy endpoint bypasses service-worker caching.
- Cow data is cached in browser storage and refreshed on interval (every 5 minutes).

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
- **Location pings** — lat/lng, heading, current nav target — sent every 60 seconds while location is active
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

## GitHub Issue Agent Workflow

- `.github/workflows/codex-issue-agent.yml` runs a Codex attempt when an issue is opened, edited, or labelled while carrying the `codex` label, or when manually dispatched with an issue number.
- The workflow uses GitHub Actions' built-in `GITHUB_TOKEN` for branch, PR, and issue comments; no personal GitHub token is required.
- Codex authentication is provided by either a `CODEX_ACCESS_TOKEN` repository secret or an `OPENAI_API_KEY` repository secret. `OPEN_API_KEY` is also accepted as a compatibility alias, but `OPENAI_API_KEY` is the preferred name.
- The agent receives the issue title/body as requirements, makes focused repository changes, updates specs when behaviour changes, and leaves branch/PR creation to the workflow.
- If changes are produced, the workflow pushes a `codex/issue-<number>-<run>` branch, opens a PR against the default branch, links it to the issue, includes the Codex summary and `npm test` output, and comments the PR URL back on the issue.
- Netlify deploy previews are expected to be posted by the Netlify GitHub integration on the generated PR.

## Technical Constraints

- No client build step.
- Keep implementation in static HTML/CSS/JS and minimal local Node server for static/proxy hosting.
- Favor robust/simple logic over framework complexity.
- Preserve performance on mobile devices.
