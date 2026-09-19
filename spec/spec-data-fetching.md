# Data Fetching Specification

This spec covers **fetching, loading, and normalizing** all data sources into the application state. The output of this step is a fully populated `AppData` object (defined in the Interface section below) that the rendering layer consumes.

## Responsibility Boundary

Data fetching is responsible for:

- Fetching raw data from local files and remote APIs
- Parsing JSON/GeoJSON responses
- Filtering invalid/incomplete records
- Normalizing heterogeneous sources into uniform structures
- Projecting geographic coordinates to map-space points
- Batched processing of large datasets to avoid UI blocking
- Error handling and fallback strategies
- Caching and periodic refresh of live data
- Reporting loading progress via step callbacks

Data fetching is **not** responsible for:

- Drawing anything to screen
- Managing viewport/camera state
- Handling user interactions
- Computing nearest items, walking-radius fallback results, or distances (runtime concern)

---

## Data Sources

### Offline Static Files

| Dataset | URL(s) | Format |
|---------|--------|--------|
| Trees (chunk index) | `data/trees/index.json` | Custom JSON |
| Trees (chunks) | `data/trees/chunk-*.json` | Custom JSON |
| Trees (full fallback) | `Veteran_Tree_Register.json` | Custom JSON |
| Trees (legacy enriched fallback) | `Veteran_Tree_Register.enriched.with_named_trees.json` | Custom JSON |
| Landmarks – food | `data/local-landmarks-food.geojson` | GeoJSON |
| Landmarks – transport | `data/local-landmarks-transport.geojson` | GeoJSON |
| Landmarks – gates | `data/local-landmarks-gates.geojson` | GeoJSON |
| Landmarks – facilities | `data/local-landmarks-facilities.geojson` | GeoJSON |
| Landmarks – historic | `data/local-landmarks-historic.geojson` | GeoJSON |
| Landmarks – tourism | `data/local-landmarks-tourism.geojson` | GeoJSON |
| Landmarks – misc | `data/local-landmarks-misc.geojson` | GeoJSON |
| Folklore | `data/epping_forest_folklore_locations_v14_external_links.json` | Custom JSON |
| Paths | `data/local-paths.geojson` | GeoJSON |
| Roads | `data/local-roads.geojson` | GeoJSON |
| Environment | `data/local-environment.geojson` | GeoJSON |
| Buildings | `data/local-environment-buildings.geojson` | GeoJSON (lazy) |
| Forest boundary | `data/epping-forest-land.geojson` | GeoJSON |
| Buffer land | `data/epping-buffer-land.geojson` | GeoJSON |

### Live Remote Data

| Dataset | Endpoint | Refresh |
|---------|----------|---------|
| Cows & pastures | `/api/cows?center=<lon>,<lat>` (proxy) | Every 5 minutes |
| Cows (upstream) | `https://account.nofence.no/api/open/data/?center=<lon>,<lat>` | — |

---

## Loading Strategy

### Parallel Fetch

All static datasets are fetched in parallel at boot time. Loading progress is reported per-step:

Steps: `trees`, `places`, `paths`, `roads`, `environment`, `forest`, `cows`

Each step transitions through states: `pending` → `loading` → `done` | `error`

### Fallback Strategy

- **Trees:** Try `data/trees/index.json` first, then load all listed chunk files with a concurrency limit of 6 and one retry per failed chunk. If chunk loading fails, fall back to the full register. On mobile/touch devices and constrained connections, full-file fallback tries the smaller base URL before the legacy enriched URL; other devices try the legacy enriched URL after the base retry.
- **Landmarks:** Each category file fetches independently; failed files return empty features.
- **Roads:** Race against an 8-second timeout to prevent indefinite hang.
- **Cows:** On localhost, use cached localStorage data; otherwise fetch with 7-second timeout.

### Service Worker Caching

- The service worker pre-caches the app shell, smaller static datasets, and `data/trees/index.json` during install.
- **All CSS files referenced by `index.html` must be in `APP_SHELL`**, including `css/tracking.css`. Without it, the tracking-consent modal has no positioning styles when offline, causing it to be clipped invisible inside `.map-stage`'s `overflow: hidden` — making the location gate button appear unresponsive.
- Tree chunks and large legacy veteran tree JSON files are not install pre-cache entries; they are cached opportunistically by the runtime fetch handler after the page successfully downloads them. This avoids duplicate first-load tree downloads on mobile.
- API routes (`/api/`, `/.netlify/functions/`) are never cached; they are forwarded directly to the network. Callers handle offline failures gracefully (e.g. cow fetch returns `false`, report submit checks `navigator.onLine`).

### Return Visits: Instant Load, Background Refresh

A return visit must paint from cache and never wait on the network; new data arrives afterwards, out of band.

- **Navigation is cache-first.** A full page load is answered from the cached `./index.html` immediately, and the network copy refreshes that cache entry in the background. Previously navigation was network-first, so every reload blocked on a full round trip before anything appeared -- at the time a ~290 KB `index.html`, since the whole app script was inline in it. The script now lives in `js/app.js` (cached as part of `APP_SHELL`) and `index.html` is ~14 KB of markup, but the ordering guarantee is what matters here, not the size. Staleness is bounded by the browser's own `sw.js` update check on each navigation: a release bumps `APP_CACHE_NAME`, the new worker installs, caches the new shell and claims the page, and `setupPwa` surfaces the update. Under the local dev flag navigation stays network-first so edits show up on refresh.
- **Install never re-fetches what is already cached.** `APP_SHELL`, `DATA_SHELL` and the opportunistic list are each filtered through `missingFromCache()` first. Every release bumps `APP_CACHE_NAME` and therefore re-runs install; a blanket `addAll` re-downloaded the whole ~67 MB dataset each time, which is what made a returning user's reload look like a fresh install.
- **A data cache version bump migrates rather than re-downloads.** `adoptPreviousDataCache()` copies the previous `forest-finds-(dev-)data-*` cache's bodies into the new one during install, so the user keeps a working offline map throughout the upgrade and pays no download for it. The adopted cache is stamped `staleSince`, which forces the next background sync to run regardless of its throttle.
- **Background data sync (`syncData` in `sw.js`).** The client posts `{ type: "SYNC_DATA" }` to the controlling worker via `requestBackgroundDataSync()` (`js/nav.js`), called from `boot()` only *after* the map is interactive, so the freshness pass never competes with the first render. The worker revalidates every cached data entry with `fetch(url, { cache: "no-cache" })` at a concurrency of 6: an unchanged file costs a 304 and no bytes, and only entries whose `ETag`/`Last-Modified`/`Content-Length` actually moved are written back. Throttled to once per 6 hours via a `lastSyncAt` stamp held in the synthetic `./__data-sync-state` cache entry (skipped by the sync itself and excluded from migration); `force: true` and a `staleSince` stamp both bypass the throttle. Concurrent requests share one in-flight pass.
- **Update signalling.** If the sync replaced at least one entry the worker posts `{ type: "DATA_UPDATED", changed }` to all clients; `js/nav.js` sets `state.dataUpdateAvailable`, marks the settings icon, and shows the reload note in Settings. The newer data is applied on the next load — the running session is never disturbed mid-walk.
- **Scoped manual refresh.** The Settings refresh buttons (`refreshCachedState` in `js/nav.js`) clear app caches, data caches, or both — see "Settings Screen" in `spec/spec.md`.

### Batched Processing

- Roads are processed in batches of **500 features** with browser yield (`setTimeout(0)`) between batches to prevent UI freezing.

### Lazy Loading

- **Buildings** are loaded on-demand (not at boot) when first needed by the renderer.

---

## Normalization Rules

### Trees

Primary source: `data/trees/index.json` with `chunks: [{ url, count, bounds }]`, then each chunk file as `{ trees: [...] }`.

Fallback source: `{ trees: [...], historicalNamedTreeEnrichment: {...} }`

Each tree record is kept as-is from source, with added computed fields:

```
tree.latitude  = Number(tree.location.wgs84.latitude)
tree.longitude = Number(tree.location.wgs84.longitude)
tree.point     = projectLonLat(longitude, latitude)
```

Filter: Discard any tree missing `tree.location.wgs84`, **and any tree whose coordinates do not
survive that conversion** — non-finite, or the `(0, 0)` that `Number(null)` produces. A handful of
Veteran Tree Register records carry no survey position at all (`latitude` and `longitude` both
`null`, gathered into `data/trees/chunk-lat0_lon0.json`); mapping them straight through put those
trees on Null Island as real entries in `state.trees` that every nearest/within-radius scan then
had to measure against. A tree with no coordinate cannot be shown on the map or walked to, so it
has nothing to contribute.

This also fixes `state.bounds`. `calculateBounds()` (js/app.js) spans every tree point, and
Epping Forest sits at Mercator y ≈ −60.36 … −60.65 while lat 0 projects to y = 0 — so ten junk
records stretched the world bounds to a vertical span of 60.65 instead of 0.29, **209× taller
than the forest**. Everything derived from those bounds was off with it: `fitToBounds()` and the
`state.fitScale`/`baseFitScale` it sets (used as the `minScale` floor in `fitToPoints`),
`pointInsideBounds()` behind `state.userInMapArea` (true for anyone between the equator and the
forest), and the background grid in `drawBase`. The mobile snapshot baselines for every screen
that draws the map moved as a result, and were regenerated on CI.

**Tree identity (`treeHashKey`, js/app.js).** Derived from `recordNumber` and nothing else — the
one field the register guarantees unique (verified: 24,906 records, 24,906 distinct
`recordNumber`s). It is what the `#tree=` deep link carries, what the Nearby list de-duplicates on
(`overviewEntryKey` → `uniqueSortedOverviewEntries`) and what resolves a tapped list row back to a
tree (`findTreeByHashKey`). It previously preferred `tree.id`, which is the string `"0"` on all
6,504 untagged records, so every one of them hashed to the same key: the list collapsed them to a
single row (hiding every untagged tree closer than the one that survived the de-dupe) and tapping
that row opened whichever `"0"` tree happened to sit first in the dataset — a tree nowhere near the
user. Reported as "Tree 0 is listed as the closest tree when it's nowhere nearby". The key is **prefixed** (`r20306`) so it cannot be confused with the old one: record numbers and
tag numbers are separate numbering spaces that overlap (11383 is both a real tag and a real,
different, record), so an unprefixed key would leave every link ambiguous about which scheme it
was written in. `findTreeByHashKey` still accepts the old unprefixed id/tag-based keys for links
shared before the change, but only once no record-number key has matched, and never for a key that
was ambiguous under the old scheme (`"0"` matched 6,504 trees) — those resolve to nothing rather
than to an arbitrary one of them. A tree with no `recordNumber` at all (never true of the real
register, but possible for a future source) falls back to a positional key derived from its
coordinates.

**Tree display name (`treeDisplayName`/`treeTagLabel`, js/app.js).** `commonName`, else the tag
number, else "Veteran tree". A tag of `"0"` (or `0`, or empty) is the register's placeholder for
*untagged*, not a tag: it is treated as absent everywhere a tag is shown, so an untagged tree with
no recorded species is not called "0" and carries no `· #0` chip in the Nearby list, the cluster
detail rows or the tree detail table.

### Named Tree Stories

Built from `historicalNamedTreeEnrichment.namedTreeStories` array. Indexed by normalized name (lowercase, non-alphanumeric removed).

### OSM Landmarks

Source: GeoJSON FeatureCollections (7 category files merged).

Filter: Only `Point` geometry features.

Each feature is normalized to:

```
{
  ...feature.properties,
  categoryTags: buildOsmCategoryTags(feature.properties),
  latitude: Number(feature.geometry.coordinates[1]),
  longitude: Number(feature.geometry.coordinates[0]),
  point: projectLonLat(longitude, latitude)
}
```

`buildOsmCategoryTags` extracts tags from: `category`, `categoryLabel`, `amenity`, `shop`, `tourism`, `historic`, `railway` properties.

### Folklore Landmarks

Source: `{ locations: [...] }` from folklore JSON.

Filter: Discard generic/imprecise locations.

#### Blue Plaque coordinate quality

All 62 blue plaque entries have been verified against authoritative sources and re-geocoded:

- 15 entries carry **GPS-precise** coordinates sourced from [openplaques.org](https://openplaques.org)
- 33 entries carry **geocoded_address** coordinates from Nominatim (OpenStreetMap)
- 14 entries carry **postcode_centroid** coordinates from postcodes.io (accurate to ~100 m)

Three entries were removed as unverifiable: `William Morris birthplace site` (coordinate was 12 km off, plaque is in Walthamstow E17), `Old Watch House or Cage` (no address, wrong duplicate coordinate), and `Buckhurst Hill Heritage Locations` (vague summary, not a single physical plaque).

Each item is normalized to:

```
{
  id: item.id || "folklore-{index}",
  name: item.name || "Folklore location",
  category: classifyFolkloreCategory(item),
  categoryTags: buildFolkloreCategoryTags(item),
  folkloreCategory,
  folkloreTopics: classifyFolkloreTopics(item),
  categoryLabel: "Folklore · {Category}",
  type, area, confidence, address,
  latitude, longitude,
  point: projectLonLat(longitude, latitude),
  folkloreSummary,
  sourceLinks: [],
  externalLinks: [],
  source: "Folklore dataset",
  dataSource: "folklore"
}
```

Folklore topic classification detects: `blue_plaque`, `film_tv`, `ww2`, `royal`, `social_history` from text content.

### Combined Landmarks

`state.landmarks = [...osmLandmarks, ...folkloreLandmarks]`

Both share the same interface fields: `name`, `latitude`, `longitude`, `point`, `categoryTags`.

### Paths

Source: GeoJSON FeatureCollection.

Each feature is normalized via `toPathFeature()`:

```
{
  name: tags.name || tags.ref || null,
  ref: tags.ref || null,
  key: computed hash,
  pathType: "bridleway" | "byway" | "permissive" | "waymarked_trail" | "trail",
  highway, foot, horse, access,
  segments: Array<Array<{x, y}>>,  // projected line segments
  bbox: { minX, minY, maxX, maxY },
  totalLength: number,
  point: anchor point (projected),
  latitude, longitude
}
```

Filter: Discard features with no valid geometry or no segments with ≥2 points.

Path type classification priority:
1. `bridleway` — highway=bridleway, designation includes "bridleway", or horse=designated
2. `byway` — designation includes "byway" or highway=byway
3. `permissive` — access/foot/horse = permissive
4. `waymarked_trail` — has osmcSymbol or trailVisibility tags
5. `trail` — default

### Roads

Source: GeoJSON FeatureCollection.

Each feature is normalized via `toRoadFeature()` (same segment/bbox pattern as paths).

Processing: Batched in groups of 500 with browser yield between batches.

### Environment

Source: GeoJSON FeatureCollection.

Filter: Features must have both `geometry` and `properties` present.

Stored as raw GeoJSON features (no further normalization at fetch time).

### Feature Layers (Forest/Buffer boundaries)

```
[
  { key: "forest", label: "Epping Forest land", url: "data/epping-forest-land.geojson", data: <GeoJSON> },
  { key: "buffer", label: "Buffer land", url: "data/epping-buffer-land.geojson", data: <GeoJSON> }
]
```

### Cows & Pastures

Source: Nofence API response (via same-origin proxy).

Normalized via `normalizeCowApiData(payload)` into:
- `cows`: Array of cow objects with `latitude`, `longitude`, `point`, `serial`, `type`, etc.
- `pastures`: Array of pasture polygon definitions.

Caching:
- Persisted to `localStorage` under key `forest-finds-cow-data-v1`
- On boot (localhost mode): attempt to restore from cache before live fetch
- Live refresh every 5 minutes via `scheduleCowRefresh()`

### Buildings (Lazy)

Source: `data/local-environment-buildings.geojson`

Loaded on first demand (not at boot). Stored as raw GeoJSON features.

### Routing Graph (Lazy, Derived)

Not fetched -- built in-memory from `state.roads`/`state.paths` (already loaded and normalized) by `ensureRoutingGraph()`, the same lazy-guarded shape as the buildings loader above (`state.routingGraphReady`/`state.routingGraphBuilding` mirror `buildingsLoaded`/`buildingsLoading`). Triggered from the rendering layer (`drawSelectedRoute` in `js/renderer.js`) the first time a real selection needs it, so a session that never selects a specific tree/landmark never builds it. Built via `buildRoutingGraphAsync` (`js/routing.js`), which processes roads+paths in 500-feature batches yielding to the main thread between them (matching `loadMapData`'s own road-processing batch size), so the ~120k-node regional graph never blocks a frame. Used only for the selected/highlighted target's route line, and the routed distance/walk-time figure derived from it -- see "Route Lines" and "Selected Detail Content" in spec-data-rendering.md. Once the graph finishes building, `ensureRoutingGraph()` also calls `updateSelectedDetailFields()` directly (not just `requestDraw()`), so a distance/walk-time chip already on screen corrects itself immediately rather than waiting for the next GPS fix.

---

## Loading Progress Callback

The data-fetching layer reports progress via:

```
setLoadStep(key: string, status: "pending"|"loading"|"done"|"error", count?: number)
```

Steps and their count meanings:
- `trees` — number of valid tree records
- `places` — final combined landmark count (OSM + folklore)
- `paths` — number of path features
- `roads` — number of road features
- `environment` — number of environment features
- `forest` — total features across boundary layers
- `cows` — number of cow locations

---

## Output: AppData Interface

The data-fetching step produces the following populated state, which is the **contract** consumed by the rendering layer:

```typescript
interface AppData {
  trees: Tree[];
  namedTreeStoriesByName: Map<string, NamedTreeStory>;
  landmarks: Landmark[];           // OSM + folklore combined
  paths: PathFeature[];
  roads: RoadFeature[];
  environmentFeatures: GeoJSONFeature[];
  buildingFeatures: GeoJSONFeature[];  // lazy-loaded
  layers: FeatureLayer[];              // forest + buffer boundaries
  cows: Cow[];
  cowPastures: Pasture[];
  cowLastUpdatedAt: number | null;
  bounds: Bounds | null;               // calculated from all data
}

interface Tree {
  // All original register fields preserved
  latitude: number;
  longitude: number;
  point: { x: number; y: number };
  location: { wgs84: { latitude: string; longitude: string } };
  // IDs, taxonomy, status, girth, metadata, comments, grid refs...
}

interface NamedTreeStory {
  name: string;
  // folklore/historical notes, match metadata, source links
}

interface Landmark {
  name: string;
  category?: string;
  categoryTags: string[];
  categoryLabel?: string;
  latitude: number;
  longitude: number;
  point: { x: number; y: number };
  // OSM-sourced fields: amenity, shop, tourism, historic, railway, address, etc.
  // Folklore-sourced fields: folkloreCategory, folkloreTopics, folkloreSummary, sourceLinks, externalLinks, dataSource
}

interface PathFeature {
  name: string | null;
  ref: string | null;
  key: string;
  pathType: "bridleway" | "byway" | "permissive" | "waymarked_trail" | "trail";
  highway: string | null;
  foot: string | null;
  horse: string | null;
  access: string | null;
  segments: Array<Array<{ x: number; y: number }>>;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  totalLength: number;
  point?: { x: number; y: number };
  latitude?: number;
  longitude?: number;
}

interface RoadFeature {
  name: string | null;
  ref: string | null;
  key: string;
  highway: string;
  segments: Array<Array<{ x: number; y: number }>>;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  totalLength: number;
}

interface FeatureLayer {
  key: string;        // "forest" | "buffer"
  label: string;
  url: string;
  data: GeoJSON.FeatureCollection;
}

interface Cow {
  serial: string;
  type: string;
  latitude: number;
  longitude: number;
  point: { x: number; y: number };
  lastUpdated?: string;
}

interface Pasture {
  // Polygon coordinates for pasture boundaries
  coordinates: number[][][];
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}
```

---

## Error Handling

- Each dataset loads independently; one failure does not block others.
- Failed datasets populate with empty arrays/collections.
- The overall boot only throws if a catastrophic error occurs outside individual fetches.
- Roads have a timeout (8s) to prevent indefinite blocking.
- Cow fetch has a timeout (7s) with graceful degradation to cached data.

---

## Constants

```javascript
const COW_REFRESH_MS = 5 * 60 * 1000;           // 5 minutes
const COW_DATA_CACHE_KEY = "forest-finds-cow-data-v1";
const DEFAULT_COW_CENTER = { longitude: 0.06371428, latitude: 51.65602252 };
const ROAD_BATCH_SIZE = 500;
const ROAD_TIMEOUT_MS = 8000;
const COW_TIMEOUT_MS = 7000;
```
