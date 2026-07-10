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
- When a tree, landmark, cow, or path is selected (navigation mode), `shouldDrawMapIcon` returns `false` for **all** items — the selected item is rendered exclusively by `drawSelectedOverlay`. This clears the map of all other pins while navigating.
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

All map marker icons (emoji and transport glyphs) are rendered at **2x** the previous baseline size for improved readability.

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
| Parking | 🅿️ | Standard |
| Cycle parking | 🚲 | Standard |
| Benches | 🪑 | Standard |
| Toilets | 🚻 | Standard |
| Drinking water | 🚰 | Standard |
| Information | ℹ️ | Standard |
| Gates / entrances | 🚪 | Standard |
| Barriers | 🚧 | Standard |
| Campsites | ⛺ | Standard |
| Memorials | 🕯️ | Standard |
| Monuments | 🗿 | Standard |
| Ambiguous locations | 📍 | Standard |
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

- Shown in overview mode and settings screen (no selection, or settings selection)
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
- If no active type has a result within the selected walking radius, show the closest available item for each active type and display a notice naming the selected walking-time radius.
- The walking-time chip in the overview heading doubles as a **radius filter toggle** (`data-action="toggle-radius"`). When active (green, `aria-pressed="true"`), only items within the walking radius are shown (`state.showAllOutsideRadius = false`). When inactive (grey, `aria-pressed="false"`), items across all distances are shown (up to 10 nearest per type) with no fallback notice. Clicking toggles `state.showAllOutsideRadius` and triggers a full `selectOverview()` re-render.
- Each entry shows: emoji icon, name, distance, directional arrow
- The directional arrow element stores the item's fixed coordinates (`data-item-lat`, `data-item-lon`); bearing is computed live in `updateOverviewDirectionArrows()` from `state.userLocation` — never baked into the HTML template. This keeps the `listKey` stable across GPS updates, preventing unnecessary full re-renders and icon flash.
- Overview chrome uses generated PNG assets from `data/icons/` for the nearby title, walking-time chip, bus entries, and inspector header nav buttons; these generated UI icons render at enlarged sizes after tight-cropping.
- All icon paths are declared in a single `ICON_PATHS` registry in `js/categories.js`. Adding an icon requires one line there; no other file needs editing. Tree species leaf icons use `treeSpeciesIconHtml(commonName, latinName)` for fuzzy name-to-icon matching.
- All `<img>` icons in the inspector panel use `loading="eager" decoding="sync"` so they render immediately on DOM insertion without a visible flash.
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

- **Expanded inspector + selected target:** camera fits user + target in the area not covered by the inspector. Uses the actual current inspector state (minimised on mobile after selection, expanded on desktop) so the route fills the full available canvas rather than a conservatively smaller area.
- **Navigation mode GPS follow:** on each GPS update, the camera checks whether both the user and the selected destination are comfortably inside the visible area (14% edge margin). If both are visible, no animation is triggered. If either drifts toward the edge or off-screen, `fitToPoints` runs with an 800 ms animation — long enough that consecutive GPS ticks blend smoothly rather than producing visible jumps.
- **Heading-up selected navigation:** when a selected navigation target is active, the user location exists, and compass heading is available, the map switches from north-up to heading-up regardless of whether the inspector is expanded or minimized. The user is anchored slightly below the vertical center of the visible map and the map rotates around the user as `state.compassHeading` changes, so the direction the device is facing is always toward the top of the screen. Compass-only heading changes should rotate the already-rendered `#mapCanvas` around the user point and redraw only `#overlayCanvas` for the user/radar, rather than redrawing all map layers every frame. The selected destination must remain inside the visible map area while heading-up mode is active; if heading, resize, drag, or zoom would push the destination out of view, the viewport is realigned and zoom is reduced just enough to keep it visible, and a full redraw is allowed. When this mode is inactive, the map remains north-up.
- **Initial selection zoom:** always refits immediately (800 ms, `force: true`), ignoring the edge-margin guard.
- **Overview mode GPS follow — no filters:** on each GPS tick the user's screen position is checked. Repositioning fires if the user has moved ≥ 42 px on screen *or* if the user dot is within the 12% edge margin. Zoom is capped via `capScaleForUserCenteredOverview` so all overview items remain visible.
- **Overview mode GPS follow — filters active:** `ensureOverviewTargetsVisible` (fitToPoints to all item points) fires when movement ≥ 42 px, *or* if any overview item has drifted fully outside the visible canvas. This ensures fast-moving users (walking, train) never lose sight of nearest items. Animation only runs on significant movement.
- **First location fix:** nearby map markers are visible immediately without requiring a manual zoom
- **Minimized inspector:** auto-reposition paused — free pan/zoom
- **Expand from minimized:** recenter once to user + selected target, preserve zoom intent

### Animations

- GPS-triggered navigation follow uses 800 ms cubic ease-in-out so consecutive position updates blend without visible restarts.
- Overview repositioning uses 360–620 ms depending on distance moved.
- View transitions animate with configurable duration
- Smooth interpolation between viewport states

---

## Zoom & Input

- Browser/page pinch zoom disabled
- Ctrl+wheel zoom disabled at document level
- Map zoom via: map interactions + zoom buttons only
- Touch double-tap zoom prevented

---

## Selected Direction Arrow

- Appears in the inspector title row when: user location exists AND selected navigation target exists
- Aligns to the far right edge of the inspector modal title row and is roughly three times larger than the default title-row arrow size, with title text padding reserved so the arrow and name do not collide
- Shows only the directional arrow; the previous top-of-screen compass card with title/distance text is not shown during selected-location navigation
- Shows directional arrow smoothed with device heading
- Updates continuously via `requestAnimationFrame`
- In heading-up selected navigation mode, the radar cone around the user is drawn on `#overlayCanvas` and points straight ahead on screen while the map rotates underneath it. Outside heading-up mode, the radar cone is drawn at the absolute compass heading on the north-up map. The radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom, so it naturally grows when zooming in and shrinks when zooming out.
- Selected tree, landmark, and cow markers do not force a continuous full-canvas redraw just to animate marker pulse; selected road and path overlays may redraw because their highlighted line animation is intentionally time-based.

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
- Mobile inspector navigation controls sit below the drag-to-resize bar with a clear gap so the resize handle remains visually distinct and easy to touch.
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
