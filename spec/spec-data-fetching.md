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
- Computing nearest items or distances (runtime concern)

---

## Data Sources

### Offline Static Files

| Dataset | URL(s) | Format |
|---------|--------|--------|
| Trees (enriched) | `Veteran_Tree_Register.enriched.with_named_trees.json` | Custom JSON |
| Trees (fallback) | `Veteran_Tree_Register.json` | Custom JSON |
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

- **Trees:** Try enriched URL first; fall back to base URL on failure.
- **Landmarks:** Each category file fetches independently; failed files return empty features.
- **Roads:** Race against an 8-second timeout to prevent indefinite hang.
- **Cows:** On localhost, use cached localStorage data; otherwise fetch with 7-second timeout.

### Batched Processing

- Roads are processed in batches of **500 features** with browser yield (`setTimeout(0)`) between batches to prevent UI freezing.

### Lazy Loading

- **Buildings** are loaded on-demand (not at boot) when first needed by the renderer.

---

## Normalization Rules

### Trees

Source: `{ trees: [...], historicalNamedTreeEnrichment: {...} }`

Each tree record is kept as-is from source, with added computed fields:

```
tree.latitude  = Number(tree.location.wgs84.latitude)
tree.longitude = Number(tree.location.wgs84.longitude)
tree.point     = projectLonLat(longitude, latitude)
```

Filter: Discard any tree missing `tree.location.wgs84`.

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
