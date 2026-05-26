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

- `Veteran_Tree_Register.enriched.with_named_trees.json` (preferred)
- `Veteran_Tree_Register.json` (fallback)
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

## Loading Experience

- A blocking loading overlay is shown at startup.
- Overlay displays step-by-step load states (`pending`/`loading`/`done`/`error`) for:
  - tree records
  - local places
  - roads & streets
  - forest/buffer boundaries
  - live cows
- Overlay dismisses once load completes.

**Performance optimizations:**
- Roads data is filtered and processed in batches to prevent browser freezing
- Loading has timeout protection (8 seconds for roads)
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
- Selected-detail mode: filter button hidden, filter panel closed (not relevant when viewing specific location).
- Minimized mode: collapsed header only.

### Camera behavior

- With selected target + expanded inspector: camera fits user + target.
- In overview mode, GPS updates keep the user location centered on the map.
  - the first successful location fix must immediately show nearby map markers without requiring a manual zoom
  - small movements recenter immediately
  - large movements animate smoothly between positions
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
- Supported overview filter groups and subfilters:
  - **Nature:** trees, cows
  - **Food:** pubs & bars, restaurants, cafés, shops
  - **Transport:** bus stops, underground stations, national rail stations
  - **History:** historic places, royal history, WWII sites, social history, plaques, blue plaques
  - **Locations:** celebrity associations, science, education, medicine, literature, theatre, politics, art, churches
  - **Stories:** legends, film/TV locations
- **Note:** Paths, hydrology, nature designations, and buildings are always visible as base layers and not included in filters.
- Filters are multi-select within and across groups.
- Selecting a top-level group enables all subfilters within that group.
- Deselecting all filters shows all content.
- Nearest list entries show icon/type, distance, and directional cue.

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

- Accessible via the ⚙️ button in the inspector header.
- Contains a **Walking radius** control: a dropdown to choose how far to walk when listing nearby places (5, 10, 15, 20, 30, 60 min options).
- Contains an **About** section displaying the current app version (e.g. `v80`).
- Changing the walking radius immediately updates the nearby list, map circle, and nearest tree selection.

## Feedback / Report Screen

- Accessible via the ✍️ button in the inspector header.
- Allows users to report missing data or request features; submissions are tracked as GitHub issues.
- The current app version is displayed in the form so the user can see which version will be reported.
- The app version, user agent, page URL, and optional geolocation are included in every submission payload.

## Compass and Direction Guidance

- Use device orientation when available.
- Smooth heading updates for:
  - compass overlay arrow
  - nearest-list directional arrows
- Show route lines:
  - selected mode: user → selected target
  - overview mode: user → nearest overview targets
- Compass overlay appears only when user location and a selected navigation target exist.

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

## Technical Constraints

- No client build step.
- Keep implementation in static HTML/CSS/JS and minimal local Node server for static/proxy hosting.
- Favor robust/simple logic over framework complexity.
- Preserve performance on mobile devices.
