# Epping Forest Finds PWA Specification

Build a static, offline-capable PWA for exploring veteran trees, nearby places, transport links, and live cow positions around Epping Forest.

The app is lightweight, dependency-free on the client, and runnable directly from this folder via a local static/proxy server.

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
- `data/local-landmarks.geojson`

### Local landmarks extraction (OpenStreetMap via Overpass)

Query file: `data/local-landmarks.overpassql`

Includes:

- pubs/bars
- cafés/tea huts
- transport links: train-related points, bus stations, bus stops, taxi points
- named tourism/historic places

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
  - forest/buffer boundaries
  - live cows
- Overlay dismisses once load completes.

## Map Layers and Markers

Rendered layers/features:

- Epping Forest polygons
- Buffer land polygons
- Veteran trees
- Local places/landmarks
- Cows and pasture polygons
- User location marker

Marker rules:

- Trees are solid circles (no white ring in base state).
- Tree opacity behavior:
  - default: ~50%
  - selected tree: 100%
  - when a non-tree location is selected: trees fade to ~10%
- Pub/café/transport/cow markers use emoji with pulsing radial backgrounds.
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
- Selected-detail mode: filter controls hidden.
- Minimized mode: collapsed header only.

### Camera behavior

- With selected target + expanded inspector: camera fits user + target.
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
- Supported overview filters:
  - `all`
  - `trees`
  - `cows`
  - `pubs`
  - `cafes`
  - `transport`
  - `locations`
- Filters are multi-select; `all` resets.
- Nearest list entries show icon/type, distance, and directional cue.

### Nearest count control

- A nearest-items slider is shown below the nearest list.
- Range: 1–10.
- Default: 3.
- Changing the slider updates all of the following in sync:
  - number of nearest items listed
  - number of highlighted targets on map
  - route lines to overview targets
  - camera fit to keep all overview targets visible

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
- Cafés & tea huts
- Train links
- Bus links & stops
- Generic locations

## Attribution Rules

- OpenStreetMap attribution note is shown only when viewing details for OSM-sourced places.
- No global attribution note in overview or non-OSM contexts.
- Attribution target: `https://www.openstreetmap.org/copyright`

## Offline, Caching, and Refresh

- Service worker caches app shell + offline datasets.
- Cache name is versioned and bumped with behavior/data wiring changes.
- Cow proxy endpoint bypasses service-worker caching.
- Cow data is cached in browser storage and refreshed on interval.

## Local Regeneration Workflow

- Preferred regeneration script: `scripts/regenerate_local_landmarks.py`
  - fetches Overpass payload (with endpoint fallback)
  - writes `data/local-landmarks.overpass.json`
  - rebuilds `data/local-landmarks.geojson`
  - prints category counts

## Technical Constraints

- No client build step.
- Keep implementation in static HTML/CSS/JS and minimal local Node server for static/proxy hosting.
- Favor robust/simple logic over framework complexity.
- Preserve performance on mobile devices.