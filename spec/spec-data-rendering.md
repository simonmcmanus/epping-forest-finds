# Data Rendering Specification

This spec covers **displaying, drawing, and presenting** the data on screen. It consumes the `AppData` interface produced by the data-fetching layer (see `spec-data-fetching.md`) and handles all visual output, interactions, and UI state.

## Responsibility Boundary

Data rendering is responsible for:

- Drawing all map layers to canvas
- Managing viewport/camera transforms (pan, zoom, fit)
- Marker rendering with styles, opacity, and animation
- Route lines and distance overlays
- Inspector panel content and state
- Filter panel UI and filter logic
- Nearest-item computation and display
- Compass/heading overlay
- Loading overlay display
- User location marker
- Selection highlighting
- Legend rendering

Data rendering is **not** responsible for:

- Fetching data from network or files
- Parsing or normalizing raw data formats
- Caching data to storage
- Periodic refresh scheduling

---

## Input: AppData Contract

The rendering layer consumes the `AppData` interface defined in `spec-data-fetching.md`. Key fields used:

```typescript
interface AppData {
  trees: Tree[];
  namedTreeStoriesByName: Map<string, NamedTreeStory>;
  landmarks: Landmark[];
  paths: PathFeature[];
  roads: RoadFeature[];
  environmentFeatures: GeoJSONFeature[];
  buildingFeatures: GeoJSONFeature[];
  layers: FeatureLayer[];    // forest + buffer
  cows: Cow[];
  cowPastures: Pasture[];
  cowLastUpdatedAt: number | null;
  bounds: Bounds | null;
}
```

---

## Runtime UI State

Beyond `AppData`, the renderer manages its own state:

```typescript
interface RenderState {
  viewport: { scale: number; tx: number; ty: number };
  fitScale: number;
  baseFitScale: number;
  selected: { type: string; item: any } | null;
  userLocation: { latitude: number; longitude: number; point: {x,y} } | null;
  userInMapArea: boolean;
  overviewFilters: string[];
  overviewExpandedGroups: string[];
  filterPanelCollapsed: boolean;
  nearestItemsCount: number;       // 3|5|10|15|20|25, default 10
  walkingDistanceMinutes: number;   // default 5
  compassHeading: number | null;
  compassPermission: string;
  dragging: boolean;
  inspectorHeightPercent: number | null;
  showAllOutsideRadius: boolean;
  // Animation state
  emojiScaleAnimated: { value: number; target: number } | null;
  viewportAnimationFrame: number | null;
  viewportAnimationFrom: object | null;
  viewportAnimationTo: object | null;
  viewportAnimationStartTime: number | null;
  viewportAnimationDuration: number;
}
```

---

## Draw Loop

The main `draw()` function is called via `requestAnimationFrame`. Draw order (back to front):

1. **Base** — gradient background + ornamental world-space grid
2. **Feature layers** — Forest boundary polygons, Buffer land polygons
3. **Cow pastures** — semi-transparent pasture polygons
4. **Environment** — hydrology lines/areas, nature designations, buildings
5. **Roads** — major road segments (performance-gated by zoom level)
6. **Paths** — footpaths, bridleways, trails
7. **Walking radius** — dashed circle around user (overview mode only)
8. **Overview route lines** — dashed lines from user to nearest items
9. **Selected route line** — dashed line from user to selected target
10. **Trees** — emoji markers
11. **Landmarks** — emoji markers with category-specific rendering
12. **Cows** — emoji markers
13. **User location** — pulsing blue dot
14. **Selected overlay** — highlight ring on selected item
15. **Selected road/path overlay** — highlighted road/path segments

### Performance Rules

- Roads are **not drawn** when zoomed out beyond scale threshold (< -0.5 zoom level)
- Roads rendering limited to **2,000 segments per frame**
- Only markers within canvas bounds (+ padding) are drawn (`isNearCanvas` check)
- Only markers in the active overview set are drawn on map (`shouldDrawMapIcon`)
- Emoji scale animation uses `requestAnimationFrame` scheduling

---

## Map Layers

### Forest & Buffer Polygons

| Layer | Fill | Stroke | Line Width |
|-------|------|--------|------------|
| Forest | `rgba(79, 139, 98, 0.29)` | `rgba(21, 96, 56, 0.9)` | 2.1px |
| Buffer | `rgba(85, 167, 160, 0.24)` | `rgba(20, 110, 105, 0.82)` | 1.8px |

### Environment

Rendered from `environmentFeatures`:

- **Hydrology lines** (rivers, streams) — blue-tinted strokes
- **Water/wetland polygons** — blue-tinted fills
- **Nature designation polygons** — green-tinted fills
- **Railway lines** — dashed dark strokes with specific styling
- **Buildings** (lazy-loaded) — gray fills

### Paths

Styles by `pathType`:

| Type | Color | Dash Pattern |
|------|-------|-------------|
| trail | `rgba(139, 90, 43, 0.6)` | solid |
| bridleway | `rgba(90, 64, 35, 0.7)` | dashed |
| byway | `rgba(120, 85, 40, 0.65)` | long-dash |
| permissive | `rgba(100, 120, 60, 0.55)` | dotted |
| waymarked_trail | `rgba(109, 68, 140, 0.75)` | solid, wider |

### Roads

Filtered to major types only. Style varies by `roadType` (motorway thicker/darker, residential thinner).

---

## Marker Rendering

### Trees

- Rendered as 🌳 emoji at map scale
- No background circle in default state
- Only drawn when in active overview set (`shouldDrawMapIcon`)
- Selected tree: full opacity, highlight ring
- When non-tree selected: trees not drawn (filtered out by `shouldDrawMapIcon`)

### Landmarks

Category-specific rendering:

| Category | Emoji | Background |
|----------|-------|------------|
| Pubs & bars | 🍺 | Pulsing radial purple gradient |
| Cafés | ☕ | Pulsing radial brown gradient |
| Restaurants | 🍽️ | Standard |
| Shops | 🛒 | Standard |
| Bus stops | 🚌 | Pulsing radial orange gradient |
| Underground | SVG roundel | Custom SVG rendering |
| National Rail | SVG logo | Custom SVG rendering |
| Historic | 📜 | Standard |
| Plaques | 🪧 | Standard |
| Blue plaques | 🔵 | Standard |
| Film/TV | 🎬 | Standard |
| WWII | 🪖 | Standard |
| Royal | 👑 | Standard |
| Celebrity | ⭐ | Standard |
| Science | 🔭 | Standard |
| Education | 🎓 | Standard |
| Medicine | ⚕️ | Standard |
| Literature | 📚 | Standard |
| Theatre | 🎭 | Standard |
| Politics | 🏛️ | Standard |
| Art | 🎨 | Standard |
| Churches | ⛪ | Standard |
| Legends | ✨ | Standard |
| Default | 📍 | Standard |

**Pulsing radial background:** 2-second cycle sine wave oscillating between 0.3–0.8 opacity.

### Cows

- Rendered as 🐄 emoji at map scale
- Pulsing radial brown gradient background

### User Location

- Blue pulsing circle at user's projected position
- Heading indicator when compass data available

---

## Selection & Highlight

### Selection Ring

When an item is selected, it gets a pulsing highlight overlay:

- Scale oscillates between 1.05× and 1.17× over 1.2-second cycle
- Adjusted for zoom level (reduced pulse when zoomed out)

### Route Lines

- **Selected mode:** Dashed line from user → selected target
  - Color: `rgba(179, 79, 49, 0.9)` with white halo
  - Line width: 3px + 3px halo
  - Dash: 10px on, 8px off

- **Overview mode:** Dashed lines from user → each nearest overview target
  - Color: per-category color with white halo
  - Line width: 2.2px + 2.6px halo
  - Dash: 8px on, 7px off

### Walking Radius Circle

- Shown in overview mode only (no selection)
- Dashed circle centered on user
- Radius = walking distance in minutes × walking speed
- Fill: `rgba(47, 114, 178, 0.07)`
- Stroke: `rgba(47, 114, 178, 0.45)`, dashed

---

## Inspector Panel

### Modes

1. **Overview mode** — nearest list + filter controls
2. **Selected-detail mode** — details for selected tree/landmark/cow/path/road
3. **Minimized mode** — collapsed header only, click to expand

### Overview Content

- List of nearest items across active filter types
- Each entry shows: emoji icon, name, distance, directional arrow
- Count controlled by `nearestItemsCount` dropdown (3/5/10/15/20/25)
- Filter panel toggle visible in overview mode

### Selected Detail Content

#### Tree Details

- Register fields: IDs, taxonomy, status, girth, metadata, comments, grid refs
- Enriched named-tree data: match metadata, folklore/historical notes, source links
- Live distance + walking time

#### Place Details

- Name, category, address, contact, source
- Appropriate emoji by type
- OSM attribution (only for OSM-sourced places)
- Live distance + walking time

#### Cow Details

- Serial number, type, coordinates
- Last update timestamp
- Source attribution
- Live distance + walking time

### Filter Panel (Overview mode only)

- Hidden when in selected-detail mode
- Toggle button shows active filter count badge

Filter groups:

| Group | Subfilters |
|-------|-----------|
| 🌿 Nature | Trees, Cows, Waymarked trails |
| 🍽️ Food | Pubs & bars, Restaurants, Cafés, Shops |
| 🚌 Transport | Bus stops, Underground, National Rail |
| 📜 History | Historic places, Royal, WWII, Social history, Plaques, Blue plaques |
| 📍 Locations | Celebrity, Science, Education, Medicine, Literature, Theatre, Politics, Art, Churches |
| ✨ Stories | Legends, Film/TV |

Behavior:
- Multi-select within and across groups
- Group header click enables/disables all subfilters in group
- Deselecting all filters shows all content
- Subfilter pills horizontally scroll with fade edges

### Nearest Count Control

- Dropdown below nearest list
- Options: 3, 5, 10, 15, 20, 25
- Default: 10
- Changing updates: list count, highlighted markers, route lines, camera fit

---

## Camera Behavior

### Fit to Bounds

- On load: fit all data in view
- Home button: restore full data framing

### Selection Camera

- **Expanded inspector + selected target:** camera fits user + target in view
- **Minimized inspector:** auto-reposition paused — free pan/zoom
- **Expand from minimized:** recenter once to user + selected target, preserve zoom intent

### Animations

- View transitions animate with configurable duration
- Smooth interpolation between viewport states

---

## Zoom & Input

- Browser/page pinch zoom disabled
- Ctrl+wheel zoom disabled at document level
- Map zoom via: map interactions + zoom buttons only
- Touch double-tap zoom prevented

---

## Compass Overlay

- Appears when: user location exists AND selected navigation target exists
- Shows directional arrow smoothed with device heading
- Updates continuously via `requestAnimationFrame`

---

## Loading Overlay

- Blocking overlay at startup
- Shows step-by-step progress for each data source
- Each step renders: icon (spinner/checkmark/error), label, count
- Dismisses ~600ms after all steps complete
- Subscribes to `setLoadStep` callbacks from data-fetching layer

---

## Legend / Key

Always visible, shows active marker semantics:

- 🌳 Trees
- 🐄 Cows
- 🍺 Pubs & bars
- 🍽️ Restaurants
- ☕ Cafés & tea huts
- 🛒 Shops
- 🚆/🔴 Underground stations
- 🚌 Bus stops
- ⇄ National Rail
- 📜 Historic sites & landmarks
- 🪧 Plaques & memorials
- 📍 Generic locations

---

## URL Hash / Deep Linking

- Selection reflected in URL hash for restore/share
- On load, `applySelectionFromHash()` restores prior selection
- Hash updates suppressed during programmatic navigation

---

## Attribution

- OpenStreetMap attribution shown **only** when viewing details for OSM-sourced places
- No global attribution overlay
- Link target: `https://www.openstreetmap.org/copyright`

---

## Responsive Layout

- Mobile-first: controls compact, avoid overflow
- Inspector drag-to-resize on mobile
- Filter panel adapts to screen width with auto-fit grid
- Subfilter rows scroll horizontally with scroll indicator
- Map controls repositioned based on viewport

---

## Color Tokens

```css
--ink: #17221e
--muted: #5d6a62
--line: #d7ded8
--paper: #eef2ea
--panel: rgba(255, 255, 255, 0.94)
--forest: #4f8b62
--buffer: #55a7a0
--tree: #2f6f4e
--selected: #b34f31
--place: #7f4f9f
--landmark: #76702f
```

---

## Performance Constraints

- No client build step — all rendering in vanilla JS/Canvas
- Mobile performance priority
- Only draw visible markers (canvas bounds check)
- Only draw overview-active markers
- Batch emoji draws
- Roads gated by zoom threshold
- Animation uses `requestAnimationFrame` scheduling (not timers)
