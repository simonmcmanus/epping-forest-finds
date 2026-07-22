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
3. Switches the inspector to **cluster detail mode** via `showClusterDetail(cluster)`: shows the back button, a title (e.g. "4 Trees"), and a nearest-item list of all items in the cluster (icon, name, walk time, direction arrow). Items are tappable to open full detail via the existing `focusOverviewItem` path.

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

- **Selected mode:** Dashed line from user → selected target
  - Color: `rgba(179, 79, 49, 0.9)` with white halo
  - Line width: 3px + 3px halo
  - Dash: 10px on, 8px off

- **Overview mode:** Dashed lines from user → each nearest overview target
  - Color: per-category color with white halo
  - Line width: 2.2px + 2.6px halo
  - Dash: 8px on, 7px off
  - Only drawn for items with a valid `.point` (paths without a label anchor are excluded)

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
2. **Cluster detail mode** — list of items in a tapped cluster (`state.clusterExpanded` set, `state.selected` null); shows back button, item count title, and nearest-item rows for each cluster member; back button or empty-space map tap returns to overview
3. **Selected-detail mode** — details for selected tree/landmark/cow/path/road
4. **Minimized mode** — collapsed header only, click to expand

### Overview Content

- List of nearest items across active filter types
- If no active type has a result within the selected walking radius, show the closest available item for each active type and display a notice naming the selected walking-time radius.
- The walking-time chip in the overview heading doubles as a **radius filter toggle** (`data-action="toggle-radius"`). When active (green, `aria-pressed="true"`), only items within the walking radius are shown (`state.showAllOutsideRadius = false`). When inactive (grey, `aria-pressed="false"`), items across all distances are shown (up to 10 nearest per type) with no fallback notice. Clicking toggles `state.showAllOutsideRadius` and triggers a full `selectOverview()` re-render.
- Each entry shows: emoji icon, name, distance, directional arrow
- Nearby bus-stop entries progressively append live stop-direction context to the stop name when available, so opposite-direction stops can be distinguished from the overview list before opening the detail view.
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
- Inspector title icon: `tree.png`
- Live distance + walking time

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

Filter, Settings, and Report share identical navigation behaviour:

- **Map canvas tap on empty space does not dismiss the screen.** Only the Nearby button returns to overview. This is enforced in `handleMapClick` (the `else`/no-hit branch checks `state.filterScreenOpen || state.selected?.type === "settings" || state.selected?.type === "report"` before calling `goToInitialView`) and in the `hashchange` handler (same guard).
- **Map icon set:** all three screens use `overviewItemsUnlimited()` to build the nearby icon lookup, showing all items regardless of walking radius. The walking-radius filter only applies in the standard Nearby/overview view.

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

- **Expanded inspector + selected target:** camera fits user + target in the area not covered by the inspector. The inspector is always expanded after a map tap selection (on both mobile and desktop) so the detail panel opens immediately; it is only auto-minimized when selecting from the overview/nearby list (`focusOverviewItem`).
- **Navigation mode GPS follow:** on each GPS update, the camera checks whether both the user and the selected destination are comfortably inside the visible area (14% edge margin). If both are visible, no animation is triggered. If either drifts toward the edge or off-screen, `fitToPoints` runs with an 800 ms animation — long enough that consecutive GPS ticks blend smoothly rather than producing visible jumps. The fit never zooms out beyond the initial forest-level scale (`baseFitScale` floor).
- **Heading-up selected navigation:** when a selected navigation target is active, the user location exists, and compass heading is available, the map switches from north-up to heading-up regardless of whether the inspector is expanded or minimized. The user is anchored slightly below the vertical center of the visible map (62%) and the map rotates around the user as `state.compassHeading` changes, so the direction the device is facing is always toward the top of the screen. The map/overlay canvases are rendered with an overscan bitmap area (150% of viewport, centered) while heading-up is active so CSS delta rotation can run through full compass turns without exposing clipped canvas edges; in north-up mode the canvas uses an exact-fit allocation to avoid unnecessary GPU fill-rate overhead. On mode change `prepareCanvasForDraw()` detects the transition and calls `resizeCanvas()` to expand or shrink the allocation immediately. On very large/high-DPR screens, overscan resize logic caps bitmap allocation to a conservative budget (max dimension 3072 px, max area 9,437,184 px) and lowers effective DPR as needed. During normal heading updates, `updateHeadingUpCanvasRotationTransform()` applies a CSS rotation delta around the user point and avoids full redraw churn; on heading entry animation frames the rotation is still baked into redraws. Heading-up fits in this mode keep the same scale stabilisation as nearby mode: a 4% fit buffer (extra off-screen render room), deferred non-essential zoom updates while compass sensor events are active, and a small strict-fit tolerance so tiny corrections do not trigger redraw churn. The selected destination must remain inside the visible map area while heading-up mode is active; if heading, resize, drag, or zoom would push the destination out of view, the viewport zoom is set to the exact scale that places the destination at the edge of the visible area — `Math.min` is not used here, so the viewport always zooms to the correct level even when coming from a wider zoom such as the walking-radius overview. When this mode is inactive, the map remains north-up. On entering heading-up mode for the first time (transition from north-up), `state.renderedNavigationHeading` is interpolated from 0° toward `state.compassHeading` over the same duration as the viewport animation using `state.headingUpEntryAnim` (from/to/startTime/duration). `prepareCanvasForDraw()` advances the interpolation each frame and calls `requestDraw()` while in progress, so every canvas draw already reflects the correct intermediate heading — pins always point downward throughout the transition.
- **Heading-up nearby mode:** when there is no real navigation target (`selectedCompassTarget()` returns null) but user location and compass heading are available, `nearbyHeadingUpActive()` returns true and the map switches to heading-up. This covers the overview/nearby screen, the filter panel, and pseudo-selection screens (settings, report) — all of which show the map in the background and should continue rotating with the device heading. The user is anchored at 55% of the visible map height (slightly below centre) — this gives balanced space for items in all compass directions, keeping the scale close to what `fitToPoints` would produce even for items behind or beside the user. Heading-up fits keep a 4% zoom buffer so highlighted points stay comfortably inside the visible area with extra draw room when the device rotates; while compass sensor events are still actively arriving, non-essential zoom changes are deferred and then applied once the heading settles, with a small strict-fit tolerance to ignore micro corrections. Explicit navigation events (e.g. `goToInitialView()` returning from the filter screen) pass `force: true` through `ensureOverviewTargetsVisible` → `alignHeadingUpNavigationViewport` → `resolveHeadingUpTargetScale` to bypass this deferral and update the zoom immediately. On first activation an entry animation rotates from north-up to the current heading over 500 ms, driven by the same `headingUpEntryAnim` mechanism. Drag, zoom, resize, compass changes, and nearby filter changes all re-fit the overview targets via `alignHeadingUpNavigationViewport()` / `ensureOverviewTargetsVisible()`. The `headingUpActive()` helper returns true for either selected-navigation or nearby heading-up and is the single check used in the compass smoothing tick and CSS delta rotation path. The user radar cone points toward the top of the screen in both heading-up modes. Tree, landmark, and cow pins are drawn on `#overlayCanvas` (not `#mapCanvas`) so they remain at their correct geographic positions on screen.
- **Initial selection zoom:** waits for the inspector CSS transition to settle, then runs a single 600 ms `animateToHeadingUpNavigationViewport` (when compass is active) or `ensureUserAndSelectionVisible` (without compass) — never double-stepping. There is no secondary viewport snap after the animation.
- **Overview mode GPS follow (all cases):** `ensureOverviewTargetsVisible` is called whenever the user moves ≥ 24 px on screen or any target point goes off-screen. It fits the viewport to user + all highlighted in-radius items so their geographic bounding box fills the visible map area above the inspector, using a tighter `padding: 28` (CSS px) vs the default 54 to reduce wasted space at the screen edges. Animation fires only on large movements (≥ 200 px on screen); sub-threshold updates are instant to avoid visual jitter. The fit never zooms out beyond `baseFitScale` (initial forest-level scale). If there are no nearby items, the camera pans to keep the user centred without changing zoom.
- **Resize events in overview mode:** when the viewport resizes (keyboard, orientation, inspector animation) and user location is available, `ensureOverviewTargetsVisible` is called with `animate: false` so the fit is recalculated for the new canvas size without snapping to `fitToBounds` (full-forest zoom).
- **First location fix / loading reveal:** the map snaps to the current overview bounding box while the overlay is still visible, then after the 320 ms pause runs the animated reveal. If a URL hash selected an item, `applySelectionFromHash()` fires first and the animation uses `ensureUserAndSelectionVisible` (user + item fill screen). Otherwise the animation uses `ensureOverviewTargetsVisible` with fresh GPS points (not the pre-pause snapshot) so a mid-pause GPS update never causes a visible zoom-out during the reveal.
- **Camera fit target (`overviewTargetPoints`):** two zoom modes depending on UI state:
  - **Foraging mode (filter panel closed):** anchors to the nearest 5 active trees so the viewport stays tight and in-forest. If trees are not in the active filters or fewer than 2 trees are nearby, falls back to the nearest 5 active items of any type. User location is prepended when fewer than 2 anchor points exist.
  - **Survey mode (filter panel open, filters active):** zoom uses `overviewItemsUnlimited()` for the active filters only — the nearest `nearestItemsCount` items per active filter type, ignoring the walking radius. The camera zooms to fit only the highlighted (filtered) items, not all locations. Rendering still shows all item types on the map regardless of filter. The user location is always included in the fit. Filter toggles within the filter panel update the survey zoom immediately (with `force: true` to allow zoom-in even when compass events are active). Opening the filter panel triggers an animated zoom to this view; closing it (via the Nearby button or back navigation) snaps back to foraging zoom. If no filters are active when the panel is open, falls through to foraging mode zoom.
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
- **3D tilt mode radar:** When tilt is active (`tiltActive()` true), the radar is moved from `#mapCanvas` to `#overlayCanvas` and each arc point is explicitly projected through `projectCanvasPoint` (the same perspective math used for overlay pins). The arc is drawn as a series of 24 line-segment steps rather than `ctx.arc()` so the foreshortening is geometrically correct. This makes the cone appear to lie flat on the tilted ground plane — a `ctx.arc()` circle on the CSS-tilted main canvas is visually ambiguous and reads as a vertical fin. In non-tilted heading-up mode the radar remains on `#mapCanvas` as before.
- Selected tree, landmark, and cow markers do not force a continuous full-canvas redraw just to animate marker pulse; selected road and path overlays may redraw because their highlighted line animation is intentionally time-based.

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
  - If no orientation event has arrived in >15 s, `state.compassHeading` (and `compassHeadingTarget`, `renderedNavigationHeading`, `headingUpEntryAnim`) is cleared so the map goes north-up rather than showing a frozen direction. New events restart heading-up automatically. (Compass stale detection is only done on visibility return, not on the periodic tick.)
  - Orientation listeners are removed and re-added to coax iOS back into firing `deviceorientation` events. (Only on visibility return.)
  - `restartStaleGpsWatch()` — if the GPS watch has not delivered a position in >20 s, the watch is cleared and `ensureLocationWatch()` is called to start a fresh one. Called on both visibility return and every 10-second tick so iOS GPS stalls are caught even when the tab stays in the foreground.
- **Return-to-overview compass stale check** — `goToInitialView()` checks if no orientation event has arrived in >5 s. If so, `compassHeading` is cleared before rebuilding the overview, preventing the map from snapping to a stale heading-up direction.
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
