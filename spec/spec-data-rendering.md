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
- `drawSelectedOverlay` runs on `#overlayCanvas` (not `#mapCanvas`) and uses `worldToScreenForOverlay()` so the selected pin stays locked to its geographic location while heading-up uses CSS delta rotation between redraws.
- When `nearbyHeadingUpActive()` is true **or** `tiltActive()` is true, tree/landmark/cow pins are moved from `#mapCanvas` to `#overlayCanvas` (drawn in `drawOverlay()` before the user dot). In tilt mode the projected `worldToScreenForOverlayTilted` function is used so pins appear to lie flat on the tilted ground plane rather than being CSS-rotated as if they were flat objects leaning back. This makes 3D behaviour consistent across all screens — nearby overview, selected navigation (location detail), filter panel, and settings.
- While `tiltActive()` is true (full 3D), pins and road/path lines behind the user's current heading are not drawn at all — see "Full 3D — hiding what's behind" under Camera Behavior.
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
- **Buildings** (lazy-loaded) — opaque light-gray fills in 2D footprints; in full 3D tilt, roofs keep that same opaque fill while walls use subtle opaque side shading (fixed light-from-upper-left look) so buildings read as solid blocks without transparency and still transition cleanly when flattening to 2D.

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

### Pin geometry (`drawPngMapIcon`)

The teardrop pin uses a compact layout with a large icon:
- Circle radius: `size × 0.4`; tail height: `R × 0.6`; icon fills `R × 1.75`
- Circle centre is `R × 1.6` = `size × 0.64` above the tip point
- Border opacity: `rgba(0,0,0,0.25)`
- Unselected scale: `MAP_ICON_SCALE_UNSELECTED = 2.2`; selected scale: `MAP_ICON_SCALE = 2` (plus animated pulse ×1.05–1.17)
- Hit detection (`findHit`, `findClusterHit`) is derived from `MAP_ICON_SCALE_UNSELECTED`: `pinR = iconSize × 0.52` (×1.3 visual R), `pinYOffset = iconSize × 0.64` (exact circle centre), giving an accurately-centred tap target slightly larger than the visual pin

### Clustering

All point-type overview items are clustered in screen space (30 CSS-pixel radius, greedy nearest-first) before drawing. `buildTypeClusters(itemSet, toScreen)` is the generic function used for trees, cows, paths, and water features. Landmarks are first grouped by rendered icon type (`landmarkClusterKey`) then clustered within each group via `buildLandmarkClusters`.

Each cluster draws **one pin** at the screen centroid of its members. When a cluster contains more than one item, a small count badge is drawn in the top-right of the pin by `drawClusterBadge`. Badges only appear on PNG teardrop pins (not SVG roundels or emoji). Route lines use the world-space centroid of each cluster (one line per cluster for trees; individual items for other types).

**Cluster tap interaction:** tapping a multi-item cluster pin (in overview mode, i.e. no current selection) triggers `findClusterHit` — which rebuilds clusters for all types at the current viewport and tags each cluster with its `itemType` (`"tree"`, `"landmark"`, `"cow"`, `"path"`, or `"water"`) — and, if hit:
1. Sets `state.clusterZoomed = true` and `state.clusterExpanded = cluster`.
2. Animates the viewport to centre on the user's location and scale so the farthest cluster item fills to the edge of the visible focus rect (area above the inspector), using `bestVisibleCanvasRect({ assumeInspectorOpen: true })` with 40 CSS-pixel padding. This keeps the user at the centre of the view and scales to show all cluster items at the edges, matching the "nearby view centred on my location" intent. `state.fitScale` is not modified by this zoom. When user location is unavailable it falls back to `fitToPoints` on cluster item points only.
3. Switches the inspector to **cluster detail mode** via `showClusterDetail(cluster)`: shows the back button, a title (e.g. "4 Trees"), and a nearest-item list of all items in the cluster (icon, name, combined distance + walk-time chip, direction arrow). Items are tappable to open full detail via the existing `focusOverviewItem` path.

While `state.clusterZoomed` is true, `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `alignHeadingUpNavigationViewport` all skip their GPS/compass-driven refits so the zoom-in view is not immediately overridden. `selectOverview` also skips its re-render while `state.clusterExpanded` is set, preventing GPS updates from replacing the cluster detail list.

`state.clusterZoomed` and `state.clusterExpanded` are both cleared when: the user taps an item (via `focusOverviewItem`), taps empty space or presses the back button (via `goToInitialView`), drags the map, scrolls/pinches to zoom, or taps any non-cluster target (the `handleMapClick` fall-through path clears both before proceeding to `findHit`). Single-item clusters fall through to the normal `findHit` individual-item selection path.

**Singleton expansion (`applySingletonExpansion`):** when `state.clusterExpanded` is set, this post-processing step runs on all cluster lists in both `draw()` and `drawOverlay()`. Any cluster containing an expanded item is split into individual 1-item clusters so that every member is always rendered as a separate tappable pin regardless of screen proximity. This guarantees the individual items are visible on the map even when they are geographically close enough to fall within the normal 30 CSS-pixel clustering radius.

### Trees

- Overview trees are **clustered in screen space** (30 CSS-pixel radius, greedy nearest-first) by `buildTreeClusters()`. One teardrop PNG pin is drawn per cluster at the cluster's screen centroid using the species leaf icon (or generic tree icon) at `MAP_ICON_SCALE_UNSELECTED` size.
- When a cluster contains more than one tree, a small green count badge (e.g. "4" or "9+") is drawn in the top-right of the pin.
- Only clusters whose members are all in the active overview set are drawn; `shouldDrawMapIcon` selection check applies at the function level (all tree pins hidden when any location is selected).
- Out-of-radius clusters render at 0.4 opacity.
- Selected tree: full-size teardrop PNG pin rendered by `drawSelectedOverlay` (species leaf icon or generic tree icon).
- Route lines go to the **world-space centroid** of each cluster (one line per cluster, not per tree).

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

- Rendered as cow PNG icon at map scale

### Waymarked Trails (path pins)

- When a waymarked trail appears in the overview list, a `waymarked` PNG icon pin is drawn at `path.point` (the path's label anchor, computed by `pathLabelAnchor`).
- Only drawn when the path has a valid `.point` and is in the active overview set.
- Paths without a `.point` are excluded from route lines and icons.
- When any location is selected, all path pins are hidden (`shouldDrawMapIcon` returns `false`).

### Water Features (water pins)

- When a water feature (pond, stream) appears in the overview list, a `ponds` PNG icon pin is drawn at `water.point` (centroid of polygon or midpoint of line).
- Only drawn when the water feature is in the active overview set.
- When any location is selected, all water pins are hidden (`shouldDrawMapIcon` returns `false`).

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

- **Selected mode:** Dashed line from user → selected target, following the walkable road/path network when possible rather than cutting straight through whatever lies between them (buildings, fences, the lakes and fenced grazing areas inside the forest). `selectedRoutePoints(target)` (js/renderer.js) asks `findRoutePoints` (js/routing.js) for a route across the lazily-built routing graph (see "Routing Graph (Lazy, Derived)" in spec-data-fetching.md) and draws the returned point sequence as a single multi-segment dashed line; it falls straight back to the previous plain 2-point line -- unchanged -- whenever the graph isn't built yet, either endpoint is too far from any mapped road/path (`maxSnapMetres`, 250m default), the two points aren't on the same connected part of the network, or the only route found is a pathological detour (`maxDetourRatio`, 4x the straight-line distance by default) -- so the line is never left broken or absent, only ever straighter than ideal. The route is memoized per selected target and only recomputed after ~20m of user movement (`SELECTED_ROUTE_RECOMPUTE_MIN_METRES`), not on every GPS fix or animation frame.
  - Color: `rgba(179, 79, 49, 0.9)` with white halo
  - Line width: 3px + 3px halo
  - Dash: 10px on, 8px off

- **Overview mode:** Dashed lines from user → each nearest overview target. Deliberately still a plain straight line, not routed -- these ambient lines exist to show rough direction/distance to everything nearby at a glance, and routing every visible pin would multiply pathfinding cost by however many items are on screen for little benefit; only the single selected/highlighted target (above) is worth a real route to.
  - Color: per-category color with white halo
  - Line width: 2.2px + 2.6px halo
  - Dash: 8px on, 7px off
  - Only drawn for items with a valid `.point` (paths without a label anchor are excluded)

### Walking Radius Circle

- Shown in overview mode and on all three secondary screens — filter, settings, and feedback/report (no selection, or a settings/report pseudo-selection)
- Dashed circle centered on user
- Radius = walking distance in minutes × walking speed
- Fill: `rgba(47, 114, 178, 0.07)`
- Stroke: `rgba(47, 114, 178, 0.45)`, dashed

---

## Inspector Panel

### Modes

1. **Overview mode** — nearest list + filter controls
2. **Cluster detail mode** — list of items in a tapped cluster (`state.clusterExpanded` set, `state.selected` null); shows back button, item count title, and nearest-item rows for each cluster member. Each row includes an always-visible combined distance + walk-time chip (`{distance} · {walk time}` with the walking icon) and, for trees, the tag number (`#<tagNumber>`). Back button or empty-space map tap returns to overview.
3. **Selected-detail mode** — details for selected tree/landmark/cow/path/road
4. **Minimized mode** — collapsed header only, click to expand

### Overview Content

- List of nearest items across active filter types
- If no active type has a result within the selected walking radius, show the closest available item for each active type and display a notice naming the selected walking-time radius.
- The walking-time chip in the overview heading doubles as a **radius filter toggle** (`data-action="toggle-radius"`). When active (green, `aria-pressed="true"`), only items within the walking radius are shown (`state.showAllOutsideRadius = false`). When inactive (grey, `aria-pressed="false"`), items across all distances are shown (up to 10 nearest per type) with no fallback notice. Clicking toggles `state.showAllOutsideRadius` and triggers a full `selectOverview()` re-render.
- Each entry shows: emoji icon, name, type label, and directional arrow.
- Each entry includes an always-visible combined distance + walk-time chip (`{distance} · {walk time}`) using the existing walking icon (`appIconHtml("walking", ...)`).
- Tree entries additionally show the physical **tag number** (`#<tagNumber>`) in the footer meta line. The footer meta line order is: **walk chip first** (`🚶 {distance} · {walk time}`), then the type label and tag number (`Tree · #15961`), so that all distance pills align to the left across all item types. The tag chip is omitted when the tree has no `tagNumber`.
- `{distance}` is formatted by `formatDistance()`: whole metres below 1km (`850 m`); above 1km, kilometres to 1 decimal place below 10km and to a whole number at 10km+, with a trailing `.0` trimmed (`1.5 km`, `5 km`, `12 km`) — this keeps the unit and precision human-readable at both close and far range.
- Nearby bus-stop entries progressively append live stop-direction context to the stop name when available, so opposite-direction stops can be distinguished from the overview list before opening the detail view.
- The directional arrow element stores the item's fixed coordinates (`data-item-lat`, `data-item-lon`); bearing is computed live in `updateOverviewDirectionArrows()` from `state.userLocation` — never baked into the HTML template. This keeps the `listKey` stable across GPS updates, preventing unnecessary full re-renders and icon flash.
- Overview chrome uses generated PNG assets from `data/icons/` for the nearby title, walking-time chip, bus entries, and inspector header nav buttons; these generated UI icons render at enlarged sizes after tight-cropping.
- All icon paths are declared in a single `ICON_PATHS` registry in `js/categories.js`. Adding an icon requires one line there; no other file needs editing. Tree species leaf icons use `treeSpeciesIconHtml(commonName, latinName)` for fuzzy name-to-icon matching.
- All `<img>` icons in the inspector panel use `loading="eager" decoding="sync"` so they render immediately on DOM insertion without a visible flash.
- Count controlled by `nearestItemsCount` dropdown (3/5/10/15/20/25)
- Filter panel toggle visible in overview mode

### Selected Detail Content

All selected detail screens with a distance pill (trees, places, cows, and paths) show an always-visible combined distance + walk-time chip (`{distance} · {walk time}`) using the walking icon. This chip is not expandable/tap-to-reveal and follows the same readable unit formatting (`formatDistance()`: metres below 1km, kilometres above 1km with trimmed precision).

The figure itself is the real road/path-following distance (and the walk time derived from it), matching the routed line described under "Route Lines" above, whenever that route is available -- not the straight-line/crow-flies distance. `selectedRouteMetres(target)` (js/renderer.js) sums the segment lengths of whatever `selectedRoutePoints(target)` currently returns, so it shares that function's memoization and its same fallback conditions; `updateSelectedDetailFields()` (index.html) uses this routed figure when it's available and falls back to the plain straight-line distance otherwise (graph still building, no route found, etc.), so the chip is never blank and never regresses below the previous behaviour. The chip is refreshed both on every GPS fix and the moment the routing graph finishes its lazy background build, so a selection made before the graph is ready still self-corrects from the straight-line figure to the routed one shortly after, without waiting for the next GPS fix.

#### Tree Details

- **Tag number** (physical forest tag) is shown as the **first** always-visible field, before Estimated age and Common name. This is the number printed on the physical tag nailed to the tree, making it easy to confirm you're looking at the right record without extra taps.
- Register fields: IDs, taxonomy, status, girth, metadata, comments, grid refs
- Enriched named-tree data: match metadata, folklore/historical notes, source links
- Inspector title icon: `tree.png`
- Live distance + walking time
- The **National tag** field stays inside the collapsed "Technical data" accordion (it is often blank or `0` and is distinct from the physical tag number).

#### Place Details

- Name, category, address, contact, source
- Inspector title icon matches the map pin: PNG from `filterKindEmoji`/`landmarkIconSlug` priority, emoji fallback for types with no PNG asset
- OSM attribution (only for OSM-sourced places)
- Live distance + walking time
- Bus stop selections append live departures when online; the departures block also shows a bus-stop direction summary (`Buses towards …`) using TfL stop metadata when available, otherwise a deduplicated summary of upcoming destination names for that stop only.

#### Cow Details

- Serial number, type, coordinates
- Last update timestamp
- Source attribution
- Inspector title icon: `cow.png`
- Live distance + walking time

### Secondary Screens (Filter, Settings, Report)

Filter, Settings, and Report share identical navigation behaviour, gated by the shared `secondaryScreenActive()` helper (`state.filterScreenOpen || state.selected?.type === "settings" || state.selected?.type === "report"`):

- **Map canvas tap on empty space does not dismiss the screen.** Only the Nearby button returns to overview. This is enforced in `handleMapClick` (the `else`/no-hit branch checks `secondaryScreenActive()` before calling `goToInitialView`) and in the `hashchange` handler (same guard).
- **Map icon set:** all three screens use `overviewItemsUnlimited()` to build the nearby icon lookup, showing all items regardless of walking radius. The walking-radius filter only applies in the standard Nearby/overview view.
- **Camera fit is identical across all three screens.** All three use the same "survey mode" camera fit (see Survey mode under Camera Behavior below) — zoomed out to fit every item matching the active filters, plus the user location, with the walking-radius ring always visible. Opening any of the three screens (`openFiltersScreen`, `openSettings`, `openReportModal`) triggers this fit with a 420ms animation; GPS updates, resizes (e.g. the on-screen keyboard opening on the Report form), and heading-up compass rotation all keep re-fitting to the same target while any of the three screens is open, so switching between them never changes the view. `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `centerOverviewOnUserLocation` all treat `secondaryScreenActive()` the same as plain overview mode rather than bailing out for the settings/report pseudo-selection. Because `overviewItemsUnlimited()` ignores the walking radius, this fit already frames filtered items beyond the radius, not just items within it.
- **Full 3D tilt is available on all three screens**, exactly as on the nearby overview (see "3D tilt available on every screen" under Camera Behavior below) — the "identical view" invariant above covers pan/zoom framing only; the live tilt angle tracks phone orientation the same way it does everywhere else and is not held fixed across screen switches.

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

### Selection Camera

- **Expanded inspector + selected target:** camera fits user + target in the area not covered by the inspector. The inspector is always expanded after a map tap selection (on both mobile and desktop) so the detail panel opens immediately; it is only auto-minimized when selecting from the overview/nearby list (`focusOverviewItem`).
- **Navigation mode GPS follow:** on each GPS update, the camera checks whether both the user and the selected destination are comfortably inside the visible area (14% edge margin). If both are visible, no animation is triggered. If either drifts toward the edge or off-screen, `fitToPoints` runs with an 800 ms animation — long enough that consecutive GPS ticks blend smoothly rather than producing visible jumps. The fit never zooms out beyond the initial forest-level scale (`baseFitScale` floor).
- **Heading-up selected navigation:** when a selected navigation target is active, the user location exists, and compass heading is available, the map switches from north-up to heading-up regardless of whether the inspector is expanded or minimized. The user anchor ramps from a base of 62% (no tilt) to 88% (max tilt, full 3D) via `tiltAnchorFraction()`, then `headingUpAnchorFraction(true)` mirrors that ramped anchor around the screen's 50% centre based on `selectedNavigationTargetBearingOffsetRadians()` -- the destination's bearing relative to straight ahead, computed by rotating the vector from the user to the destination (averaged across `selectedNavigationTargetPoints()`, which includes any waypoints along the route, not just the final destination) into heading-up space the same way pin rotation does, then `Math.atan2`: a destination dead ahead (offset 0) keeps the plain ramped anchor unchanged, a destination dead behind (offset ±π) mirrors it to `1 - anchor` (user anchored high, most of the screen given to what's behind them since that's where the route actually is), and a destination directly to either side (offset ±π/2) settles exactly at the 50% centre -- interpolated by `cos(offset)` so the transition across all bearings is smooth, not a snap at some threshold. This only applies to selected navigation; nearby mode's anchor (`headingUpAnchorFraction(false)`) is unaffected and still just the plain `tiltAnchorFraction()` ramp, since nearby has no single destination bearing to mirror around. The map rotates around the user as `state.compassHeading` changes, so the direction the device is facing is always toward the top of the screen. The map/overlay canvases are rendered with an overscan bitmap area (150% of viewport, centered) while heading-up is active so CSS delta rotation can run through full compass turns without exposing clipped canvas edges; in north-up mode the canvas uses an exact-fit allocation to avoid unnecessary GPU fill-rate overhead. While tilted (full 3D), overscan grows further to 200% so `rotateX` perspective doesn't expose the canvas top edge. On mode change `prepareCanvasForDraw()` detects the transition and calls `resizeCanvas()` to expand or shrink the allocation immediately. The 150%/200% switch is latched with hysteresis rather than tied directly to `tiltActive()`: it grows at `state.tiltBetaSmoothed > 8°` (`TILT_OVERSCAN_GROW_BETA`) — comfortably before `TILT_BETA_THRESHOLD` (12°) where `rotateX` itself starts ramping — and only shrinks back once beta falls below 4° (`TILT_OVERSCAN_SHRINK_BETA`). Both thresholds sit inside the flat "dead zone" below 12° where the CSS transform hasn't started animating yet, so the resize (an instantaneous bitmap reallocation) always lands while the view is visually flat in both directions of travel, rather than coinciding with the tilt transition and reading as a snap. On very large/high-DPR screens, overscan resize logic caps bitmap allocation to a conservative budget (max dimension 3072 px, max area 9,437,184 px) and lowers effective DPR as needed. During normal heading updates, `updateHeadingUpCanvasRotationTransform()` applies a CSS rotation delta around the user point and avoids full redraw churn; on heading entry animation frames the rotation is still baked into redraws. Heading-up fits in this mode keep the same scale stabilisation as nearby mode: a 4% fit buffer (extra off-screen render room), deferred non-essential zoom updates while compass sensor events are active, and a small strict-fit tolerance so tiny corrections do not trigger redraw churn. Unlike nearby mode (below), the scale fit for selected navigation no longer excludes points that fall behind the user's heading (`rotatedY > 0` after rotating into heading-up space) while tilt is active: `maxScaleForHeadingUpPoints` takes an `excludeBehindDuringTilt` option (default `true`, matching the old behaviour), and `maxHeadingUpNavigationScale` passes `false`, so the origin, route waypoints, and destination are all fit onto the available map space together even when the destination is currently behind the user during full 3D tilt -- previously such a destination was excluded from the fit entirely (only its rendering was affected by "Full 3D — hiding what's behind" below, but the *zoom* stayed anchored on wherever the last-visible-ahead fit had left it, wasting the screen space freed up by the destination no longer constraining anything). The points themselves are still culled from being drawn while behind the heading and tilt is active, per "Full 3D — hiding what's behind" below, except the selected navigation target and its route line, which are exempted from that cull for exactly this reason (see the exemption noted there) — so a destination behind the user during tilt now correctly pulls the fit in to include it, and stays visible, rather than sitting off-screen at a stale zoom. Because a destination behind the user can now occupy most of the screen below a mirrored-toward-top anchor, `setInspectorMinimized` (`js/nav.js`) re-runs the real heading-up scale fit (`alignHeadingUpNavigationViewport({ force: true })`) when the inspector expands during heading-up selected navigation, instead of the plain-mode `centerViewportOnPointsKeepScale` recentre (which keeps whatever scale was already in effect) -- otherwise a fit computed against the smaller minimized-inspector footprint would never get corrected once the inspector grows to its full size, letting the destination end up rendered behind the now-larger panel. North-up selected navigation (no compass heading) is unaffected and keeps the plain recentre. The selected destination must remain inside the visible map area while heading-up mode is active; if heading, resize, drag, or zoom would push the destination out of view, the viewport zoom is set to the exact scale that places the destination at the edge of the visible area — `Math.min` is not used here, so the viewport always zooms to the correct level even when coming from a wider zoom such as the walking-radius overview. When this mode is inactive, the map remains north-up. On entering heading-up mode for the first time (transition from north-up), `state.renderedNavigationHeading` is interpolated from 0° toward `state.compassHeading` over the same duration as the viewport animation using `state.headingUpEntryAnim` (from/to/startTime/duration). `prepareCanvasForDraw()` advances the interpolation each frame and calls `requestDraw()` while in progress, so every canvas draw already reflects the correct intermediate heading — pins always point downward throughout the transition.
- **Heading-up nearby mode:** when there is no real navigation target (`selectedCompassTarget()` returns null) but user location and compass heading are available, `nearbyHeadingUpActive()` returns true and the map switches to heading-up. This covers the overview/nearby screen, the filter panel, and pseudo-selection screens (settings, report) — all of which show the map in the background and rotate with the device heading, escalating into full 3D tilt exactly like the plain nearby screen (see "3D tilt available on every screen" below). The user anchor ramps smoothly from 55% (no tilt) to 90% of the visible map height as tilt deepens (via `tiltAnchorFraction()`, the same 0–1 ramp used for `rotateX`), leaving a small gap below the dot at max tilt rather than pinning it flush to the edge. The forward-shifted anchor keeps more geographic content rendered in the ahead direction during deep tilt, reducing the chance of a bare-background horizon; at flat orientations the 55% anchor gives balanced space for items in all compass directions. Highlighted points that sit behind the user's heading (`rotatedY > 0` once rotated into heading-up space, i.e. on the far side of the anchor from the top of the screen) are excluded from `maxNearbyHeadingUpScale`'s fit entirely only while tilt is active — fitting them into the cramped margin below the anchor would drag the zoom out to accommodate a point of little relevance to where the user is heading, and under tilt perspective a point that close behind the camera balloons in size and can loom over the view instead of receding like points ahead do. Outside tilt, behind points are still drawn (they're only culled from the canvas once `isBehindTiltHeading` applies — see "Full 3D — hiding what's behind"), so they still constrain the bottom-edge margin of the fit. The same underlying bounding-box fit math (`maxScaleForHeadingUpPoints`) is shared with `maxHeadingUpNavigationScale` in selected navigation, but the two modes diverge on how tight the zoom is allowed to get: selected navigation has no ceiling at all, since zooming in further as you physically approach your destination is the intended behaviour, not a bug. `alignHeadingUpNavigationViewport()` bails out entirely until `state.dataLoaded` is true, since before that `state.trees`/`state.landmarks`/etc are still empty and there's nothing real to fit against — on devices where compass events arrive before map data finishes loading (observed on iOS), fitting against that empty/placeholder data could otherwise produce a nonsense initial scale.

  `maxNearbyHeadingUpScale`, unlike selected navigation, does cap its zoom: it never zooms in tighter than the user's whole configured walking radius (`walkingDistanceMinutes`) would justify. Rather than fitting a full 360-degree ring around the user (an earlier version of this ceiling, and a design flaw in its own right — see below), each real matching point closer than the walking radius is first extended straight out to that radius distance, preserving its bearing from the user (`pointsExtendedToMinDistance`), and the resulting clamped points are fed through the same `maxScaleForHeadingUpPoints()` bounding-box math used everywhere else (kept consistent with map rotation, the off-centre heading-up anchor, and the tilt behind-heading exclusion, rather than duplicating that geometry with a separate formula). A point already at or beyond the radius is left untouched. If every clamped point ends up excluded from the fit (e.g. all currently behind the user while tilted), the ceiling falls back to a full walking-radius-circle fit (`walkingRadiusCirclePoints()`) rather than the stale current scale. Without any of this, fitting a single very close point (e.g. a tree a few metres ahead — common in a dense forest, and especially likely right after load before the user has walked anywhere) against the focus-rect margin can demand an enormous scale, since a tiny world-distance needs very little zoom change per pixel to reach the edge — the "loads zoomed in so far you can't see any locations" bug. This is a real-world-meaningful, user-controlled bound (bigger walking radius setting → the fit is allowed to zoom in tighter before the radius itself becomes the binding constraint) rather than an arbitrary multiplier — see [[nearby-view-zoom]] project memory for the full history of attempts at this bug: a ratio against `state.fitScale`, then against `state.baseFitScale` (neither had a reliable relationship to what "too tight" should mean here), then capping against the full walking-radius circle (which over-widened the view whenever real matches were clustered in one direction rather than spread all around the user, since it forced every direction to show a full radius's worth of empty space even when nothing was there) — which is why the ceiling now clamps per-point instead.

- **3D tilt available on every screen:** full 3D (`tiltActive()`) is available on every screen — the plain nearby overview, active navigation to a selected item, and the filter panel, settings, and feedback screens all allow it. `tiltAllowedForCurrentScreen()` returns `true` unconditionally, with no exceptions. Returning to the nearby overview (`goToInitialView()`, from any prior screen — a selected-item navigation view, cluster-detail, or Filter/Settings/Feedback) does not force a flatten-to-2D transition first; the camera re-fit runs immediately, while `state.tiltBetaSmoothed` keeps tracking the live physical device tilt through the normal ~1/4s exponential filter (in `startCompassSmoothing`, see below) toward `state.tiltBetaTarget`, so the map stays at whatever angle the phone is currently at throughout the re-fit animation. Every downstream consumer of `tiltBetaSmoothed` (`tiltRotateXDeg`, `tiltAnchorFraction`, `tiltInfluence`, `tiltActive` itself, and the tilt-overscan resize hysteresis — see `TILT_OVERSCAN_GROW_BETA`/`SHRINK_BETA` above) reads this same single smoothed value.

  Pins/roads behind the user's heading cull the same way on every screen (see "Full 3D — hiding what's behind" below) — there is no screen-specific exception. On the filter/settings/feedback screens this means survey-mode zoom (below) frames the filtered items regardless of heading, but items currently behind the user still shrink/vanish from the canvas exactly as they do on the nearby overview and in navigation mode; turning to face them reveals them.
- **Full 3D — hiding what's behind:** once tilt is active (`tiltActive()` true, i.e. full 3D), `isBehindTiltHeading(worldPoint)` tests whether a world point falls behind the user's current heading (`rotatedY > 0` after rotating into heading-up space, the same test used for the scale-fit exclusions above). This is a rendering-level cull, separate from the camera-fit exclusion: even a point close enough that the fit-scale change alone wouldn't push it off-screen is fully excluded from lines while tilt is active. It is applied to road and path lines in `drawRoads`/`drawPaths` via the shared `traceAheadOnlyPath()` helper, which breaks a polyline into a fresh `moveTo` whenever it crosses back into the ahead half rather than drawing a stray connecting stroke across the hidden gap; path name labels are skipped the same way. Tree/landmark/cow/waymarked-trail/water pins use a continuous companion, `tiltPinScale(worldPoint)`, instead of the hard cull: it returns a 0–1 size multiplier that eases from full size (well ahead) down to `TILT_PIN_COLLAPSE_MIN_SCALE` (0.3, well behind) across a `TILT_PIN_COLLAPSE_BAND_PX` (130px, converted to world units via `state.viewport.scale`) band straddling the same boundary, using a smoothstep ease. Pins are never fully removed from the draw call in `drawAllPinsSorted` — each cluster's icon size (and, for the emoji-fallback landmark case, its badge padding/border) is multiplied by this scale — so turning the heading reads as pins continuously growing/shrinking from their own anchor point rather than popping in and out, while collapsed pins stay small enough not to crowd the pins ahead. Unlike `isBehindTiltHeading`, this is gated on `headingUpActive()` and blended by `tiltInfluence()` — `clamp((state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD), 0, 1)` — rather than switched on at the `tiltActive()` threshold itself: gating on `tiltActive()` directly would let a currently-collapsed pin jump straight to full size the instant tilt deactivates while leaving 3D. `tiltInfluence()` instead ramps across the same active-tilt range as `tiltRotateXDeg()`/`tiltAnchorFraction()` — 0 at `TILT_BETA_THRESHOLD` (12°, where tilt itself first engages) to 1 at `TILT_BETA_MAX` (85°, max tilt) — so pins stay close to full size as tilt begins and only collapse toward minimum size near max tilt, rather than sitting at minimum size through nearly the entire active-tilt range and only growing back in the last few degrees before flattening to map mode. Because the ramp's lower bound coincides exactly with `tiltActive()`'s own threshold, a collapsed pin still eases continuously back to full size as beta drops through 12° and tilt deactivates, so leaving 3D never snaps. The selected navigation target (the one item you're actively walking to) and the route line to it are exempt — they must stay visible per the "selected destination must remain inside the visible map area" rule above, since hiding your actual destination when you walk past it would defeat navigation. The intent is that full 3D is a deliberate "look ahead" view: content behind is revealed by physically turning around (which updates `state.compassHeading` and rotates it into view) rather than by keeping a squashed/enlarged version visible at the bottom of the screen. Heading-up fits keep a 4% zoom buffer so highlighted points stay comfortably inside the visible area with extra draw room when the device rotates; while compass sensor events are still actively arriving, non-essential zoom changes are deferred and then applied once the heading settles, with a small strict-fit tolerance to ignore micro corrections. Explicit navigation events (e.g. `goToInitialView()` returning from the filter screen) pass `force: true` through `ensureOverviewTargetsVisible` → `alignHeadingUpNavigationViewport` → `resolveHeadingUpTargetScale` to bypass this deferral and update the zoom immediately. On first activation an entry animation rotates from north-up to the current heading over 500 ms, driven by the same `headingUpEntryAnim` mechanism. Drag, zoom, resize, compass changes, and nearby filter changes all re-fit the overview targets via `alignHeadingUpNavigationViewport()` / `ensureOverviewTargetsVisible()`. The `headingUpActive()` helper returns true for either selected-navigation or nearby heading-up and is the single check used in the compass smoothing tick and CSS delta rotation path. The user radar cone points toward the top of the screen in both heading-up modes. Tree, landmark, and cow pins are drawn on `#overlayCanvas` (not `#mapCanvas`) so they remain at their correct geographic positions on screen.
- **Initial selection zoom:** waits for the inspector CSS transition to settle, then runs a single 600 ms `animateToHeadingUpNavigationViewport` (when compass is active) or `ensureUserAndSelectionVisible` (without compass) — never double-stepping. There is no secondary viewport snap after the animation.
- **Overview mode GPS follow (all cases, including all three secondary screens):** `ensureOverviewTargetsVisible` (via `keepOverviewCenteredOnUser`) is called whenever the user moves ≥ 24 px on screen or any target point goes off-screen. It fits the viewport to user + all highlighted in-radius items so their geographic bounding box fills the visible map area above the inspector, using a tighter `padding: 28` (CSS px) vs the default 54 to reduce wasted space at the screen edges. Animation fires only on large movements (≥ 200 px on screen); sub-threshold updates are instant to avoid visual jitter. The fit never zooms out beyond `baseFitScale` (initial forest-level scale). If there are no nearby items, the camera pans to keep the user centred without changing zoom. `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `centerOverviewOnUserLocation` bail out only for a real tree/landmark/cow/path/water selection — they treat the Filter/Settings/Report pseudo-selections the same as plain overview mode via `secondaryScreenActive()`, so GPS-triggered re-centering keeps running on all three secondary screens rather than freezing the camera at whatever it showed before the screen opened.
- **Resize events in overview mode or any secondary screen:** when the viewport resizes (keyboard, orientation, inspector animation) and user location is available, `ensureOverviewTargetsVisible` is called with `animate: false` so the fit is recalculated for the new canvas size without snapping to `fitToBounds` (full-forest zoom). This also covers the Report screen's on-screen keyboard opening — previously this fell through to a full-forest `fitToBounds` snap because the resize handler only checked `isOverviewScreenActive()`; it now also checks `secondaryScreenActive()`.
- **First location fix / loading reveal:** the map snaps to the current overview bounding box while the overlay is still visible, then after the 320 ms pause runs the animated reveal. If a URL hash selected an item, `applySelectionFromHash()` fires first and the animation uses `ensureUserAndSelectionVisible` (user + item fill screen). Otherwise the animation uses `ensureOverviewTargetsVisible` with fresh GPS points (not the pre-pause snapshot) so a mid-pause GPS update never causes a visible zoom-out during the reveal.
- **Camera fit target (`overviewTargetPoints`):** two zoom modes depending on UI state:
  - **Foraging mode (no secondary screen active, or a secondary screen active with no filters selected):** anchors to the nearest 5 active trees so the viewport stays tight and in-forest. If trees are not in the active filters or fewer than 2 trees are nearby, falls back to the nearest 5 active items of any type. User location is prepended when fewer than 2 anchor points exist.
  - **Survey mode (any of Filter/Settings/Report active, filters active):** zoom uses `overviewItemsUnlimited()` for the active filters only — the nearest **5** items per active filter type, ignoring the walking radius, so the camera zooms out just far enough to reach the closest matches even when every match sits outside the walking-time radius. The camera zooms to fit only the highlighted (filtered) items, not all locations. Rendering still shows all item types on the map regardless of filter (the map icon lookup and the walking-radius "show all outside radius" toggle still use the full `nearestItemsCount` limit — only the camera fit target is capped at 5). The user location is always included in the fit. This is gated by the shared `secondaryScreenActive()` check (not `state.filterScreenOpen` alone), so Settings and Report use exactly the same fit as Filter — previously only the Filter screen used survey mode, which is why the map view used to differ between the three screens. Filter toggles within the filter panel update the survey zoom immediately (with `force: true` to allow zoom-in even when compass events are active). Opening any of the three screens triggers an animated zoom to this view; returning to plain overview (via the Nearby button or back navigation) snaps back to foraging zoom. If no filters are active while a secondary screen is open, falls through to foraging mode zoom.
  - In both modes the viewport fits the geographic bounding box of the anchor points — dense clusters produce a tight zoom, spread-out points produce a wider zoom. The walking-radius distance is never used directly to set the zoom.
- **GPS-triggered refit during animation:** `keepOverviewCenteredOnUser` skips the off-screen check (`anyOffscreen`) while a programmatic viewport animation is in progress (`state.viewportAnimationFrame != null`). This prevents GPS updates from interrupting smooth transitions (e.g. the loading reveal or back-to-overview zoom) by snapping mid-animation.
- **Minimized inspector:** auto-reposition paused — free pan/zoom
- **Expand from minimized:** recenter once to user + selected target, preserve zoom intent

### Animations

- GPS-triggered navigation follow uses 800 ms cubic ease-in-out so consecutive position updates blend without visible restarts.
- Overview repositioning uses 360–620 ms depending on distance moved.
- View transitions animate with configurable duration; all state-change transitions produce exactly one smooth animation with no intermediate jumps.
- Entering heading-up mode: `renderedNavigationHeading` is eased from 0° toward `state.compassHeading` over the same 600 ms duration as the viewport animation. Each canvas draw reflects the intermediate heading, so pins always point downward throughout.
- `animateToHeadingUpNavigationViewport(durationMs)` is the single authoritative function for transitioning to heading-up view — it starts the viewport animation while heading interpolation is redrawn frame-by-frame on canvas.
- `setInspectorMinimized(true)` no longer makes any direct viewport change; the caller (`zoomToSelection`, `goToInitialView`, etc.) is responsible for the camera transition after the inspector settles.

---

## Zoom & Input

- Browser/page pinch zoom disabled
- Ctrl+wheel zoom disabled at document level
- Map zoom via: map interactions only (wheel/drag) — there is no on-screen zoom control in the main map UI
- Touch double-tap zoom prevented

---

## Selected Direction Arrow

- Appears in the inspector title row when: user location exists AND selected navigation target exists
- Aligns to the far right edge of the inspector modal title row and is roughly three times larger than the default title-row arrow size, with title text padding reserved so the arrow and name do not collide
- Shows only the directional arrow; the previous top-of-screen compass card with title/distance text is not shown during selected-location navigation
- Shows directional arrow smoothed with device heading
- Updates continuously via `requestAnimationFrame`
- In heading-up selected navigation mode, the radar cone around the user is drawn on `#overlayCanvas` and points straight ahead on screen while the map rotates underneath it. Outside heading-up mode, the radar cone is drawn at the absolute compass heading on the north-up map. The radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom, so it naturally grows when zooming in and shrinks when zooming out.
- **3D tilt distance fade:** When tilt is active, `drawTiltDistanceFade()` runs on `#mapCanvas` after all terrain/route/pin content. It uses `globalCompositeOperation = "destination-out"` to erase canvas pixels in the top 38% of the canvas, making them transparent so the `.map-stage` background shows through. This guarantees a seamless match — no hardcoded colour needed — because the background visible through the transparent canvas is identical to the background above the canvas edge. The overlay canvas is unaffected since it is a separate DOM element layered above.
- **3D tilt mode radar:** When tilt is active (`tiltActive()` true), the radar is moved from `#mapCanvas` to `#overlayCanvas` and each arc point is explicitly projected through `projectCanvasPoint` (the same perspective math used for overlay pins). The arc is drawn as a series of 24 line-segment steps rather than `ctx.arc()` so the foreshortening is geometrically correct. This makes the cone appear to lie flat on the tilted ground plane — a `ctx.arc()` circle on the CSS-tilted main canvas is visually ambiguous and reads as a vertical fin. In non-tilted heading-up mode the radar remains on `#mapCanvas` as before. Max tilt angle is 75° (`TILT_ROTATEX_MAX`); threshold to activate is 12° (`TILT_BETA_THRESHOLD`); CSS perspective distance is derived per-frame by `tiltPerspectivePx()` (see "3D tilt mode" in `spec.md` for the device-independent horizon math), not a fixed pixel value.
- Selected tree, landmark, and cow markers do not force a continuous full-canvas redraw just to animate marker pulse; selected road and path overlays may redraw because their highlighted line animation is intentionally time-based. That redraw is throttled to a fixed ~50ms interval (`SELECTED_PULSE_REDRAW_INTERVAL_MS` in `js/renderer.js`) via `setTimeout` rather than chaining a `requestAnimationFrame` every frame — the pulse's sine period (~350-400ms) doesn't need full display refresh rate, and throttling avoids unnecessary CPU/GPU work while a road or path stays selected.

---

## Loading Overlay

- Blocking overlay at startup
- Shows step-by-step progress for each data source
- Each step renders: icon (spinner/checkmark/error), label, count
- Dismisses ~600ms after all steps complete
- Subscribes to `setLoadStep` callbacks from data-fetching layer

---

## GPS and Compass Resilience

The app must keep location, compass, and nearest-items always current. Several recovery mechanisms ensure this on iOS where sensors can silently stall:

- **`state.lastLocationUpdateAt`** — set to `performance.now()` on every successful `watchPosition` callback. Used to detect GPS silence.
- **`visibilitychange` recovery + foreground heartbeat (`setupVisibilityRecovery`)** — fires when the tab returns to foreground AND via a 10-second `setInterval` that runs while the app is in the foreground:
  - If no orientation event has arrived in >15 s, `state.compassHeading` (and `compassHeadingTarget`, `renderedNavigationHeading`, `headingUpEntryAnim`) is cleared so the map goes north-up rather than showing a frozen direction, and `resetCompassCalibration()` is called so the next readings go back through the calibration gate below rather than being trusted immediately. New events restart heading-up automatically. (Compass stale detection is only done on visibility return, not on the periodic tick.)
  - Orientation listeners are removed and re-added to coax iOS back into firing `deviceorientation` events. (Only on visibility return.)
  - `restartStaleGpsWatch()` — if the GPS watch has not delivered a position in >20 s, the watch is cleared and `ensureLocationWatch()` is called to start a fresh one. Called on both visibility return and every 10-second tick so iOS GPS stalls are caught even when the tab stays in the foreground.
- **Background battery saving (`pauseBackgroundedTracking`)** — when the tab/screen goes hidden (`visibilitychange` → `document.visibilityState !== "visible"`), the GPS watch (`navigator.geolocation.clearWatch`) and the 60-second location-tracking beacon interval (`stopLocationTracking()` in `js/tracker.js`) are both stopped, since `enableHighAccuracy: true` GPS polling and periodic network beacons are the largest background battery drains. On return to visibility, `ensureLocationWatch()` restarts both (it starts the GPS watch and calls `startLocationTracking()` internally). The 10-second `restartStaleGpsWatch` heartbeat keeps running while hidden but is a no-op since it only acts when a watch is active.
- **Return-to-overview compass stale check** — `goToInitialView()` checks if no orientation event has arrived in >5 s. If so, `compassHeading` is cleared (and `resetCompassCalibration()` called) before rebuilding the overview, preventing the map from snapping to a stale heading-up direction.
- **Compass calibration gate (`registerCompassCalibrationSample`)** — whenever `state.compassHeading` is `null` (cold start, or just after either staleness clear above), `onDeviceOrientation` does not trust the very first raw reading. Phones commonly need a moment of physical movement for a magnetometer/fused-orientation sensor to settle, and rotating the map to whatever the first reading says is the "dodgy" initial-load state this guards against. Instead, raw readings are buffered in `state.compassCalibrationSamples` (trimmed to a trailing `COMPASS_CALIBRATION_WINDOW_MS` = 900 ms window) and `state.compassHeading` is only set once at least `COMPASS_CALIBRATION_MIN_SAMPLES` (4) of them agree within `COMPASS_CALIBRATION_STABLE_SPREAD_DEG` (6°) of each other (`isCompassCalibrationStable`/`compassCalibrationSpreadDegrees`, using the same circular `shortestCompassDelta` used for smoothing). If it's still unstable after `COMPASS_CALIBRATION_PROMPT_DELAY_MS` (1500 ms), a non-blocking "move your phone in a figure-8" banner (`#compassCalibrationBanner`, `showCompassCalibrationPrompt`/`hideCompassCalibrationPrompt` in `index.html`, styled in `css/map-ui.css`) is shown — the map stays fully interactive and north-up-anchored on the user underneath it. The user can dismiss it (`dismissCompassCalibrationPrompt`, wired in `js/nav.js`'s `setupInspectorHandlers`) for the rest of that calibration cycle; `resetCompassCalibration()` clears the dismissal along with the sample buffer so a later re-acquisition can prompt again. `COMPASS_CALIBRATION_MAX_WAIT_MS` (6000 ms) is a safety valve: calibration force-completes with the latest reading once exceeded, so a device whose readings never settle still gets heading-up navigation rather than being blocked indefinitely. Once a heading is trusted, subsequent `onDeviceOrientation` events bypass the gate entirely and update `compassHeadingTarget` directly as before. Rotation is deliberately held back during calibration, but the anchored *zoom* fit is not gated on a heading at all (`nearbyNavigationAnchorActive()` only needs `state.userLocation`) — so `registerCompassCalibrationSample` also drives `startCalibrationViewportSync()`, a `requestAnimationFrame` loop that calls `alignHeadingUpNavigationViewport({ force: true })` every frame (rotation comes out as 0° since `headingUpActive()` is still false) until a heading is trusted. The `force: true` is required, not cosmetic: `resolveHeadingUpTargetScale` defers non-urgent zoom changes whenever `headingUpCompassSensorActive()` is true (compass events arrived in the last `HEADING_UP_SENSOR_ACTIVE_MS` = 350 ms) so zoom doesn't fight an in-progress rotation — but `onDeviceOrientation` sets `compassLastEventAt` on every raw reading regardless of calibration state, so that "sensor active" condition is true throughout the entire calibration window even though there is no rotation for the zoom to fight (`headingUpActive()` stays false). Without forcing, the zoom fit stays deferred until the sensor happens to go quiet for 350 ms, which in practice means "until compass calibration finishes and rotation settles" — i.e. the same "zoom only corrects after it rotates" bug this exists to fix. This mirrors what `startCompassSmoothing`'s own tick already does once heading exists, and exists because that tick previously provided incidental "self-heal on the next frame" zoom correction for races like the `state.dataLoaded` one above — since calibration no longer calls `startCompassSmoothing()` until trusted, without this separate loop the initial zoom could get stuck wrong (e.g. that dataLoaded race, or any other timing gap) until the next GPS fix, which in practice often meant "until the user physically moved". `startCalibrationViewportSync()` stops itself once `compassHeading` becomes finite (handing off to `startCompassSmoothing`'s tick) and carries its own copy of the `COMPASS_CALIBRATION_MAX_WAIT_MS` safety valve so a stalled sensor (no further orientation events to deliver the check inside `registerCompassCalibrationSample`) still force-completes rather than looping forever.
- **Return-to-overview no longer flattens tilt** — `goToInitialView()` re-fits the camera to the nearby overview (`ensureOverviewTargetsVisible`/`fitToBounds`, 500ms animation) immediately and unconditionally, regardless of the current tilt state or prior screen (a selected-item navigation view, cluster-detail, or Filter/Settings/Feedback). There is no flatten-to-2D step: if the phone is tilted when Nearby is opened, the map keeps its current 3D perspective throughout the re-fit animation rather than leveling out first, matching how tilt already behaves during every other screen transition (see "3D tilt available on every screen").
- **`watchPosition` error handler** — on `PERMISSION_DENIED` (code 1, mid-session permission revoke), the watch is cleared and the location gate is shown. Transient `TIMEOUT` and `POSITION_UNAVAILABLE` errors are tolerated; `watchPosition` continues trying automatically.

---

## Location Gate & Tracking Consent (offline-safe)

The location gate (`#locationGate`) and tracking consent modal (`#trackingConsentModal`) must work fully offline:

- **`css/tracking.css` is in `APP_SHELL`** — the consent modal relies on `position: fixed; z-index: 130` from that file; without it the modal has no positioning and is clipped invisible by `.map-stage`'s `overflow: hidden`, making the location gate button appear completely unresponsive.
- **Location gate button gives immediate visual feedback** — the button is disabled as soon as it is tapped (preventing confusion from the geolocation or compass-permission async wait). `setLocationGateVisible(true, ...)` always re-enables the button so it is interactive again whenever the gate re-appears with a new message (error, compass prompt, etc.).
- **Compass permission (iOS)** — `DeviceOrientationEvent.requestPermission()` is a device API that does not require internet. On failure or denial, `showCompassAccessPrompt()` re-shows the gate; the button is re-enabled by `setLocationGateVisible`.
- **Geolocation** — GPS works without internet. The `locateUser` callback (success or error) triggers `setLocationGateVisible` which re-enables the gate button.

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
- `applySelectionFromHash()` is called after the 320 ms loading-overlay pause (after the overview snap, before the animated reveal) so the selection zoom overrides the overview snap rather than being overridden by it
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
- **Portrait lock on mobile:** the inspector is always a bottom sheet on touch devices. Rotating a phone to landscape does not move the inspector to the side. This is enforced by: (1) `"orientation": "portrait"` in the web app manifest (locks installed PWA), and (2) a CSS override — `@media (orientation: landscape) and (pointer: coarse) and (max-height: 500px)` — that re-applies the mobile bottom-sheet layout for any touch device whose height is ≤ 500 px (phone portrait: ~360–430 px; tablets: 768 px+, unaffected). The threshold distinguishes phones in landscape from tablets in landscape.
- **Keyboard avoidance (Feedback/Report screen only):** when the on-screen keyboard opens, `window.visualViewport`'s `resize`/`scroll` events (`setupReportKeyboardAvoidance` / `handleReportViewportChange` in `js/nav.js`) drive the inspector sheet to reposition/resize so the focused textarea stays above the keyboard and visible. iOS Safari's layout viewport does not shrink when the keyboard opens, so the `bottom`-anchored sheet would otherwise stay pinned behind it; instead the handler computes the obscured height (`window.innerHeight - (visualViewport.height + visualViewport.offsetTop)`) and, once it exceeds a small jitter threshold, sets it as a `--keyboard-inset` custom property and adds a `.keyboard-avoiding` class to `#inspector`. Both mobile bottom-sheet media queries (`max-width: 760px` and the landscape `pointer: coarse`/`max-height: 500px` override) add that inset to `bottom` and subtract it from `max-height` (see `css/map-ui.css`), so the sheet shifts up and shrinks to stay above the keyboard in both portrait and the landscape bottom-sheet layout. Scoped to the Report screen only — Settings uses a `<select>` and Filter has no text input, so neither summons a keyboard; the handler checks `state.selected?.type === "report"` and clears the class/property otherwise.

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
