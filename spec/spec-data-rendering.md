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
  nearbyAnchor: { latitude: number; longitude: number; point: {x,y} } | null; // Nearby-view browse override; see "Browsing another spot"
  userInMapArea: boolean;
  overviewFilters: string[];
  overviewExpandedGroups: string[];
  filterPanelCollapsed: boolean;
  nearestItemsCount: number;       // 3|5|10|15|20|25, default 10
  walkingDistanceMinutes: number;   // continuous, half-minute steps; default 5; see walkingRadiusFloorMinutes
  walkingRadiusAtFloor: boolean;    // true only while the pinch gesture is actively pinned at the floor
  compassHeading: number | null;
  compassPermission: string;
  dragging: boolean;
  manualCameraOverrideFor: object | null; // the selection whose camera the user has panned/zoomed by hand
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

The main `draw()` function is called via `requestAnimationFrame`. `requestDraw()` coalesces
requests through `state.animationFrame`, and `draw()` **cancels whatever frame that handle still
holds** before clearing it. Clearing alone is not enough: `draw()` is also called directly (boot,
the location gate, the compass loop), which drops the flag while a queued frame is still pending,
so the next `requestDraw()` queues a second paint for the same frame. Since most draws end by
requesting the next one — `prepareCanvasForDraw()` does exactly that for as long as a
browse-origin slide or its reveal fade is running — each duplicate re-queues itself and the
pile-up persists: measured at four full map paints per animation frame during a browse-origin
slide, around 100ms of redundant work per frame, which ran that animation at a fraction of the
frame rate and made the camera move in visible steps. Cancelling collapses any pile-up back to
one paint per frame; a draw that is already running repaints the current state, so whatever it
displaces would have drawn the same thing.

Draw order (back to front):

1. **Base** — gradient background + ornamental world-space grid
2. **Feature layers** — Forest boundary polygons, Buffer land polygons
3. **Cow pastures** — semi-transparent pasture polygons
4. **Environment** — hydrology lines/areas, nature designations, buildings
5. **Roads** — major road segments (performance-gated by zoom level)
6. **Paths** — footpaths, bridleways, trails
7. **Walking radius** — the area *inside* the walking radius around the Nearby view's
   effective centre (`nearbyOrigin()`: the browse anchor when one is set, otherwise the user
   — see "Browsing another spot" below; overview mode only) is left completely untouched
   ("clear"); everything *outside* it gets a darker, translucent wash (`rgba(18, 28, 23,
   0.4)`) so the walkable circle reads as the highlighted area, not the reverse. Flat and
   tilted maps share one implementation (`drawWalkingRadiusDimming`): fill the whole canvas
   rect minus the walking-radius shape (`evenodd` fill rule) with the dark wash, then apply a
   canvas `filter: blur()` to the whole fill so the cutout's edge is the only soft transition
   — under tilt this uses the same ground-projected polygon path (`traceGroundCirclePath`)
   used elsewhere in this file, since a plain radial gradient can't represent that
   foreshortened ellipse; on a flat map it's a plain `ctx.arc()`. The outer rect is drawn well
   past the canvas edges so the blur only softens the radius cutout, not the screen edges. The
   feather radius is `max(7px, radius * 0.06)`. There is no separate boundary line — an
   earlier version drew a dashed ring on top, but it read as broken against the flat mode's
   soft edge and didn't match the tilted mode's hard one; blurring one shared cutout in both
   modes keeps the transition visually identical regardless of tilt. Centre and radius are
   measured with `worldToScreenFlat()` — measuring them after projection would apply the
   perspective twice. When a browse anchor is active, a small ring-and-dot marker
   (`drawNearbyAnchorMarker`, drawn on `#overlayCanvas` right after the "You" dot) marks it in
   amber (`#c9660c`) so it reads as distinct from the real GPS position, which never moves.

   **User cone.** While a browse anchor is set *and* the user is standing outside the ring,
   the same pass draws a wedge tying the "You" dot to the circle, so the two read as one
   picture rather than as unrelated markers. `nearbyUserCone()` builds it in screen space: the
   apex is the user, the two edges are the tangents from the user to the ring (half-angle
   `acos(r / d)`), and the far edge is sampled along the circle's near arc — so the wedge and
   the circle share an edge and never overlap. Points are sampled on the flat map and
   projected individually (`tiltProjectScreenPoint`), so the wedge lies on the ground plane
   with the ring. It is shaded as a third tier of the same wash: the circle is clear, the cone
   is `rgba(18, 28, 23, 0.13)`, everything else is the full `0.4` dim. Mechanically the cone
   is both a second cutout in the dimming's `evenodd` path and its own fill under the same
   blur, which is why its edges feather exactly like the circle's. Skipped entirely when the
   user is inside the ring or within 4% of its edge — the "You" dot is already in the circle
   there, and a near-180° wedge would flicker on and off as the user hovers on the boundary.
8. **Selected route line** — dashed line from user to selected target. This is the *only*
   route line drawn. An earlier version also drew ambient dashed lines from the user to every
   nearby match on the Nearby/Filters/Settings/Report screens; they were removed because a fan
   of dotted lines to a dozen pins crowded the map and implied a walk nobody had chosen. A
   drawn route now always means "this is the destination you selected".
9. **Trees** — teardrop pins
10. **Landmarks** — teardrop pins with category-specific artwork
11. **Cows** — teardrop pins
12. **User location** — pulsing blue dot
13. **Selected overlay** — highlight ring on selected item
14. **Selected road/path overlay** — highlighted road/path segments

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

### Pin geometry (`drawMapPinShape`, `drawPngMapIcon`, `drawEmojiMapPin`)

`drawMapPinShape` draws the white teardrop every marker sits in and returns
its head centre and radius; `drawPngMapIcon` then paints the artwork inside
it, and `drawEmojiMapPin` paints an emoji glyph there for a place with no
artwork of its own. **Nothing is drawn on the map without the pointer behind
it** — that is what makes the markers read as one family.

The teardrop pin uses a compact layout with a large icon:
- Circle radius: `size × 0.4`; tail height: `R × 0.6`; icon fills `R × 1.75`
- Circle centre is `R × 1.6` = `size × 0.64` above the tip point
- Border opacity: `rgba(0,0,0,0.25)`
- Unselected scale: `MAP_ICON_SCALE_UNSELECTED = 2.2`; selected scale: `MAP_ICON_SCALE = 2` (plus animated pulse ×1.05–1.17)
- Hit detection (`findHit`, `findClusterHit`) is derived from `MAP_ICON_SCALE_UNSELECTED`: `pinR = iconSize × 0.52` (×1.3 visual R), `pinYOffset = iconSize × 0.64` (exact circle centre), giving an accurately-centred tap target slightly larger than the visual pin
- Because the artwork is drawn at `R × 1.75` inside a head of radius `R`, an
  icon whose content reaches past `1/1.75` of its own half-width pokes out of
  the pointer. Every map icon is held to a 0.52 ceiling under that:
  `scripts/generate-map-icons.js` for new artwork, `npm run fit:icons` for the
  original PNGs, and `test/map-icons.test.js` in CI (see `spec-icons.md`).
- `drawEmojiMapPin` sizes the glyph at `R × 1.15`. The generic 📍
  fallback is itself a map pin, and a pin inside a pin reads as a mistake, so
  a place the data says nothing about (OSM `building=yes`, the last seven on
  the map) gets a plain `#76702f` dot in the head instead.
- `findHit` resolves, in order: highlighted locations (places, cows, trees, waymarked trails) then streets (roads, railways), and nothing else. Background polygons are not hit-tested, so every remaining tap is "open ground" and relocates the Nearby browse origin (see "Browsing Another Spot").
- **Only what is drawn is tappable.** Pin hit-testing asks the renderer's own `shouldDrawMapIcon(type, item, buildNearbyIconLookup())` rather than sweeping the raw datasets, so a pin that is not on screen cannot be selected at the position it would occupy. This covers all three cases the renderer already distinguishes: outside the nearby set, hidden by an expanded group, and hidden because a location is selected — in that last case only the selected pin itself is drawn, so it stays tappable and everything around it is open ground. With ~25,000 trees in the register against the ~60 the map draws (`MAX_MAP_TREES`), the old dataset-wide sweep meant a tap "away from the selection" routinely landed on an invisible tree and re-selected it instead of returning to Nearby. Waymarked trails are the exception and are deliberately *not* gated on this: a trail is hit-tested along its whole drawn line, and that line is terrain — drawn whatever the nearby set, group, or selection happens to be, exactly like a street. Only its pin comes and goes.

### Clustering

All point-type overview items are clustered in screen space (30 CSS-pixel radius, greedy nearest-first) before drawing. `buildTypeClusters(itemSet, toScreen)` is the generic function used for trees, cows, paths, and water features. Landmarks are first grouped by rendered icon type (`landmarkClusterKey`) then clustered within each group via `buildLandmarkClusters`.

Each cluster draws **one pin** at the screen centroid of its members. When a cluster contains more than one item, a small count badge is drawn in the top-right of the pin by `drawClusterBadge`. Badges appear on every teardrop pin, artwork and emoji-fallback alike, but not on the SVG station roundels, which have no pointer. Route lines use the world-space centroid of each cluster (one line per cluster for trees; individual items for other types).

**Cluster tap interaction:** tapping a multi-item cluster pin (in overview mode, i.e. no current selection) triggers `findClusterHit` — which rebuilds clusters for all types at the current viewport and tags each cluster with its `itemType` (`"tree"`, `"landmark"`, `"cow"`, `"path"`, or `"water"`) — and, if hit:
1. Sets `state.clusterZoomed = true` and `state.clusterExpanded = cluster`.
2. Animates the viewport to centre on the user's location and scale so the farthest cluster item fills to the edge of the visible focus rect (area above the inspector), using `bestVisibleCanvasRect({ assumeInspectorOpen: true })` with 40 CSS-pixel padding. This keeps the user at the centre of the view and scales to show all cluster items at the edges, matching the "nearby view centred on my location" intent. `state.fitScale` is not modified by this zoom. When user location is unavailable it falls back to `fitToPoints` on cluster item points only.
3. Switches the inspector to **cluster detail mode** via `showClusterDetail(cluster)`: shows the back button, a title (e.g. "4 Trees"), and a nearest-item list of all items in the cluster (icon, name, combined distance + walk-time chip, direction arrow). Items are tappable to open full detail via the existing `focusOverviewItem` path.
4. **Shows the group and nothing else.** While `state.clusterExpanded` is set, `buildNearbyIconLookup` narrows to that group's own items — every other highlighted location from the view the user came from, of every type, is hidden — so it is unambiguous which items the list refers to. `findHit` applies the same restriction, so a pin hidden by the group cannot still be tapped at the spot it used to occupy. The narrowing is memoized on the expanded group's own object identity plus the full lookup it narrows, so it costs nothing per frame. Cleared (back to the full nearby set) as soon as the group is dismissed.

While `state.clusterZoomed` is true, `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `alignHeadingUpNavigationViewport` all skip their GPS/compass-driven refits so the zoom-in view is not immediately overridden. `selectOverview` also skips its re-render while `state.clusterExpanded` is set, preventing GPS updates from replacing the cluster detail list.

`state.clusterZoomed` and `state.clusterExpanded` are both cleared when: the user taps an item (via `focusOverviewItem`), taps empty space or presses the back button (via `goToInitialView`), drags the map, scrolls/pinches to zoom, or taps any non-cluster target (the `handleMapClick` fall-through path clears both before proceeding to `findHit`). Single-item clusters fall through to the normal `findHit` individual-item selection path.

**Singleton expansion (`applySingletonExpansion`):** when `state.clusterExpanded` is set, this post-processing step runs on all cluster lists in both `draw()` and `drawOverlay()`. Any cluster containing an expanded item is split into individual 1-item clusters so that every member is always rendered as a separate tappable pin regardless of screen proximity. This guarantees the individual items are visible on the map even when they are geographically close enough to fall within the normal 30 CSS-pixel clustering radius.

### Trees

- Overview trees are **clustered in screen space** (30 CSS-pixel radius, greedy nearest-first) by `buildTreeClusters()`. One teardrop PNG pin is drawn per cluster at the cluster's screen centroid using the species leaf icon (or generic tree icon) at `MAP_ICON_SCALE_UNSELECTED` size.
- When a cluster contains more than one tree, a small green count badge (e.g. "4" or "9+") is drawn in the top-right of the pin.
- Only clusters whose members are all in the active overview set are drawn; `shouldDrawMapIcon` selection check applies at the function level (all tree pins hidden when any location is selected).
- **Out-of-radius clusters render exactly like in-radius ones — no dimming.** They used to be drawn at 0.4 opacity. The walking-radius wash (see "Walking radius" above) already darkens everything beyond the ring, so a pin out there reads as outside it without being faded as well; the dim was a second signal for a fact the map had already made, and it landed on the pin — the one thing the user is trying to read out there. `buildNearbyIconLookup()` still returns the `outOfRadius` set recording the distinction, but nothing in the draw path reads it. Per-marker opacity from `markerOpacityFor()` (a non-matching place, a stale cow, a selection dimming everything else) is unaffected and still applies.
- Selected tree: full-size teardrop PNG pin rendered by `drawSelectedOverlay` (species leaf icon or generic tree icon).
- Route lines go to the **world-space centroid** of each cluster (one line per cluster, not per tree).

### Landmarks

Category-specific rendering:

| Category | Pin | Background |
|----------|-----|------------|
| Pubs & bars | `beer` | Pulsing radial purple gradient |
| Cafés | `cafe` | Pulsing radial brown gradient |
| Restaurants | `restaurant` | Standard |
| Shops | `shop` | Standard |
| Bus stops | `bus` | Pulsing radial orange gradient |
| Underground | SVG roundel | Custom SVG rendering |
| National Rail | SVG logo | Custom SVG rendering |
| Blue plaques | `blue-plaques` | Standard |
| Plaques | `plaques` | Standard |
| Memorials | `landmark-memorial` | Standard |
| Monuments | `landmark-monument` | Standard |
| WWII | `wwII` | Standard |
| Churches | `church` | Standard |
| Education | `education` | Standard |
| Medicine | `medicine` | Standard |
| Campsites | `landmark-campsite` | Standard |
| Legends | `legends` | Standard |
| Literature | `literature` | Standard |
| Film/TV | `film` | Standard |
| Art | `art` | Standard |
| Gates / entrances / barriers | `gate` | Standard |
| Benches | `landmark-bench` | Standard |
| Cycle parking | `landmark-bicycle-parking` | Standard |
| Parking | `landmark-parking` | Standard |
| Toilets | `landmark-toilets` | Standard |
| Drinking water | `landmark-drinking-water` | Standard |
| Information | `landmark-information` | Standard |
| Archaeological | `landmark-archaeological` | Standard |
| Museums / attractions / follies | `landmark-museum` | Standard |
| Picnic sites | `landmark-picnic` | Standard |
| Viewpoints | `landmark-viewpoint` | Standard |
| Telephones | `landmark-telephone` | Standard |
| Taxis | `landmark-taxi` | Standard |
| Dry cleaning | `landmark-dry-cleaning` | Standard |
| Historic (catch-all) | `historic` | Standard |
| Untyped (`building=yes`) | plain dot in the pointer | Standard |

The table is in resolution order, and `placeIconSlug` (js/categories.js) is
the single definition of it, shared by the renderer, `landmarkClusterKey`,
`scripts/icon-audit.js` and the tests. It sweeps `PLACE_FILTER_PRIORITY`,
then the tag rules in `landmarkIconSlug`, then
`PLACE_FILTER_FALLBACK_PRIORITY`. That last list holds the keys that are
buckets rather than kinds of place: `historic`, which matches anything with a
historic flavour and would otherwise hand an archaeological site or a museum
its generic castle, and `monuments`, which is labelled "monuments and
memorials" and would give all 50 war memorials the standing-stone monument.
Held back, each place keeps its own pin and the chips still cover everything.

**`kind` names a label, `placeIconSlug` names an icon.** An overview entry's
`kind` (`resolvePlaceKind`, js/app.js) is the filter chip it is listed under
and feeds only the type label; it used to restate the classification order
itself and answer `"landmark"` for anything the filter predicates did not
claim, which the list then turned into a bare pushpin glyph. It now delegates
to `placeLabelFilterKey`. That is `placePrimaryFilterKey` mapped onto a chip:
`blue_plaques` leads the icon priority so a blue plaque draws the roundel, but
the only chip is "Plaques", and without the mapping all 62 would be labelled
"Place".

`PLACE_FILTER_TOPIC_PRIORITY` sits between the tag rules and the buckets and
holds the keys that describe what a folklore place is *about* rather than what
it is — `royal`, `celebrity_association`, `science`, `politics`, `theatre`,
`social_history`, in that order, vaguest last. No filter chip offers any of
them, so before this nothing reached `crown`, `celebrities`, `science`,
`politics` or `social-history` and their places all drew the broad bucket's
castle. They cannot go ahead of the tag rules: a viewpoint tagged `science` is
still a viewpoint.

The Nearby list, search results and cluster detail take their icon from the
same `placeIconSlug` (via `landmarkEmoji` in js/app.js), so a place shows the
same pin wherever it appears. `placePrimaryFilterKey` stays on the chip
vocabulary because it feeds the *type label*, and `filterMeta()` has no label
for a topic key — a royal site would read "Place" instead of "Historic sites".

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

- **Selected mode:** Dashed line from user → selected target, following the walkable road/path network when possible rather than cutting straight through whatever lies between them (buildings, fences, the lakes and fenced grazing areas inside the forest). `selectedRoutePoints(target)` (js/renderer.js) asks `findRoutePoints` (js/routing.js) for a route across the lazily-built routing graph (see "Routing Graph (Lazy, Derived)" in spec-data-fetching.md) and draws the returned point sequence as a single multi-segment dashed line.
  - **The straight 2-point line is a fallback, never a placeholder.** It is drawn only once the
    graph is built and the search has genuinely failed: either endpoint too far from any mapped
    road/path (`maxSnapMetres`, 250m default), the two points on different connected parts of the
    network, or the only route found a pathological detour (`maxDetourRatio`, 4x the straight-line
    distance by default). While the graph is still building, `drawSelectedRoute` draws **nothing
    at all** — a crow-flies line that flicks over to a winding route a second later reads as the
    app changing its mind, and points the walker the wrong way in the meantime.
    `selectedRouteIsFallback(target)` is the predicate; `ensureRoutingGraph`'s completion handler
    (js/loader.js) already calls `requestDraw()`, so the line appears as soon as there is one to
    draw. `selectedRoutePoints` itself still *returns* the straight line throughout, because the
    distance chip and the camera fit need a figure to work from before routing resolves.
  - **The line always starts where the walker is standing now.** Only the route's *tail* — the
    junctions between here and the destination — is memoized (`state.selectedRouteCache.tail`);
    the head is re-read from `state.userLocation.point` on every call. Caching the whole point
    list left the line starting at the spot the journey began and trailing further behind the
    walker with every step. The tail is recomputed after ~20m of movement
    (`SELECTED_ROUTE_RECOMPUTE_MIN_METRES`), not on every GPS fix or animation frame.
  - The route line lives on the **main** canvas, which is only repainted when the viewport moves.
    While navigating with the camera settled, the `watchPosition` handler's heading-up branch
    therefore requests a full redraw whenever there is a selected target, not just when the
    viewport changed — otherwise the freshly-live head is computed and never painted.
  - Color: `rgba(179, 79, 49, 0.9)` with white halo
  - Line width: 3px + 3px halo
  - Dash: 10px on, 8px off

- **Overview mode:** no route lines. The Nearby/Filters/Settings/Report screens used to draw an
  ambient dashed line from the user to every nearby match; a fan of dotted lines to a dozen pins
  crowded the map and implied a walk the user had never chosen. A drawn route line now always
  means "this is the destination you selected". Direction and distance to everything nearby are
  carried by the pins themselves, the per-item bearing arrows in the Nearby list, and (while
  browsing a spot) the user cone described under "Walking radius" above.

### No off-ring user direction pointer

While the Nearby view browses a spot away from the real GPS fix, the "You" dot is frequently off
screen. Earlier versions planted a black triangle on the walking-radius ring's edge pointing back
at the user, labelled `You · {distance}` and tappable to return to the real location
(`drawUserDirectionFromAnchor` / `hitUserDirectionPointer`). **It has been removed.** Three other
signals already say the same thing and say it more quietly: the amber browse-anchor marker
(`drawNearbyAnchorMarker`), the cone from the dot to the ring (`nearbyUserCone`, see "Walking
radius" below), and the persistent `#nearbyAnchorBar` with its "Use my location" button, which is
also the way back. A tap out past the ring is now plain open ground again — it re-anchors the
browse point like any other tap outside the nearest area, rather than being swallowed by an
invisible control.

### Walking Radius Circle

- Shown in overview mode and on all four secondary screens — search, filter, settings, and feedback/report (no selection, or a settings/report pseudo-selection)
- Dashed circle centered on user
- Radius = walking distance in minutes × walking speed
- Fill: `rgba(47, 114, 178, 0.07)`
- Stroke: `rgba(47, 114, 178, 0.45)`, dashed

---

## Inspector Panel

### Modes

1. **Overview mode** — nearest list + filter controls
2. **Cluster detail mode** — list of items in a tapped cluster (`state.clusterExpanded` set, `state.selected` null); shows back button, item count title, and nearest-item rows for each cluster member. Slides in with the `"forward"` screen transition like every other drill-down (its back button returns via `goToInitialView()` → `selectOverview(true)`, which slides `"back"`); it previously passed no direction and was the one screen change in the app that swapped its contents instantly while the map animated underneath it. Each row includes an always-visible combined distance + walk-time chip (`{distance} · {walk time}` with the walking icon) and, for trees, the tag number (`#<tagNumber>`). Only the group's own items are drawn on the map while it is open (see "Cluster tap interaction"). The back button returns to overview; a map tap on open ground returns to overview focused on the tapped spot.
3. **Selected-detail mode** — details for selected tree/landmark/cow/path/road/railway
4. **Minimized mode** — collapsed header only, click to expand

### Overview Content

- List of nearest items across active filter types
- `overviewItemsForActiveFilter()` (js/app.js) returns *every* match within the walking radius, memoized on origin/radius/active-filters/cow-refresh so it's only recomputed when one of those actually changes, not on every animation frame (buildNearbyIconLookup in js/renderer.js, which draws the map pins from this same list, is separately memoized the same way). Consumers cap it to what they can usefully show: this text list takes only the nearest `nearestItemsCount` entries; the map pins use the full list, bounded only by their own existing per-type render limits (e.g. `MAX_MAP_TREES`, 60). This split means growing the walking radius (via Settings or the pinch gesture below) reveals every newly-in-range item on the map, without the list turning into an unreadable wall of entries or the per-frame cost scaling with how much area is covered. Trees are dense enough that a plain nearest-60 cut always resolved to the same tight cluster around the user regardless of radius, defeating that "reveals more" promise — `buildNearbyIconLookup` (js/renderer.js) instead collects every in-radius tree candidate and takes an evenly-strided sample of 60 across that distance-sorted list (`sampleSpread`), so the fixed pin budget spreads from near to far instead of bunching at the near end. Every other type (landmarks, cows, paths, water) has no cap and genuinely renders the full in-radius set.
- If no active type has a result within the selected walking radius, show the closest available item for each active type and display a notice naming the selected walking-time radius.
- **The list heading names the radius, not just the filter.** With exactly one point filter active the heading reads `{Filter title} within {radius} walk` ("Trees within 5 min walk") — the question a walker is actually asking is how far the list is reaching, and the older "Nearest trees around you" left them to go and read the walk chip for it. With several filters it is `Nearest selected filters within {radius} walk`, with none `Nearest within {radius} walk`. When the radius toggle below is off (`state.showAllOutsideRadius`) there is no radius being applied, so the heading falls back to the `... around you` wording rather than naming a reach the list is not honouring. Filter titles are stored lower case because they read as a fragment everywhere else, so the heading capitalises the first letter; `.nearby-heading strong` additionally uppercases the whole line visually, but the underlying text is what a screen reader announces.
- The walking-time chip in the overview heading doubles as a **radius filter toggle** (`data-action="toggle-radius"`). When active (green, `aria-pressed="true"`), only items within the walking radius are shown (`state.showAllOutsideRadius = false`). When inactive (grey, `aria-pressed="false"`), items across all distances are shown (up to 10 nearest per type) with no fallback notice. Clicking toggles `state.showAllOutsideRadius` and triggers a full `selectOverview()` re-render.
- **Heads-up ordering.** The list is ordered by a *heads-up score*, not by raw distance: `metres * (1 + HEADS_UP_BEHIND_PENALTY * (1 - cos(delta)) / 2)`, where `delta` is the angle between the compass heading the list is ordered by and the bearing from `nearbyOrigin()` to the item. Something dead ahead keeps its true distance, something dead behind counts as twice as far (`HEADS_UP_BEHIND_PENALTY` is 1), and the sides fall smoothly in between — so of two finds the same walk away, the one you are facing is listed first, while distance still dominates enough that a find at your back never drops below one more than twice as far ahead. `headsUpSortedEntries()` applies this to the *whole* in-radius set before the `nearestItemsCount` cap, so an item you are walking straight at can climb into the visible handful rather than being cut off by closer ones behind your shoulder; it returns a new array and never reorders the memoized `overviewItemsForActiveFilter()` result the map pins are drawn from. Items with no single coordinate (trails, water features) keep their plain distance rank. With no compass heading — desktop, or location without orientation — the list is plain nearest-first exactly as before.
- **The order follows you round, but does not churn.** The list is ordered by `state.nearbyListHeading`, a latched heading rather than the live smoothed one. `refreshNearbyListForHeading()` runs from the compass smoothing loop alongside `updateOverviewDirectionArrows()` (which spins the per-item arrows every frame regardless): it adopts the live heading, and re-renders via `selectOverview()`, only once the two differ by `HEADS_UP_REORDER_DEGREES` (12°). A deliberate turn crosses that in one movement; sensor noise and small sways never do, so the list does not shuffle under the user's thumb. The re-render reuses the existing FLIP reorder animation (`animateNearestItemReorder`, `js/inspector.js`), and `selectOverview()`'s own list-key check drops the re-render entirely when the new heading leaves the order unchanged. Losing the heading (sensor stall, or `goToInitialView` on a stale compass) clears the latch along with `state.compassHeading`.
- Each entry shows: icon, name, type label, and directional arrow. A place's
  icon comes from `placeIconSlug` via `landmarkEmoji`, the same resolver the
  map pin uses, so the two always agree; only the types with no per-place
  artwork (cows, trails, water) are drawn from the entry's `kind`.
- Each entry includes an always-visible combined distance + walk-time chip (`{distance} · {walk time}`) using the existing walking icon (`appIconHtml("walking", ...)`).
- Tree entries additionally show the physical **tag number** (`#<tagNumber>`) in the footer meta line. The footer meta line order is: **walk chip first** (`🚶 {distance} · {walk time}`), then the type label and tag number (`Tree · #15961`), so that all distance pills align to the left across all item types. The tag chip is omitted when the tree has no tag — including the register's `"0"` placeholder, which marks a record as untagged rather than tagged zero (see "Tree display name" in spec-data-fetching.md).
- `{distance}` is formatted by `formatDistance()`: whole metres below 1km (`850 m`); above 1km, kilometres to 1 decimal place below 10km and to a whole number at 10km+, with a trailing `.0` trimmed (`1.5 km`, `5 km`, `12 km`) — this keeps the unit and precision human-readable at both close and far range.
- Nearby bus-stop entries progressively append live stop-direction context to the stop name when available, so opposite-direction stops can be distinguished from the overview list before opening the detail view.
- The directional arrow element stores the item's fixed coordinates (`data-item-lat`, `data-item-lon`); bearing is computed live in `updateOverviewDirectionArrows()` from `state.userLocation` — never baked into the HTML template. This keeps the `listKey` stable across GPS updates, preventing unnecessary full re-renders and icon flash.
- Overview chrome uses generated PNG assets from `data/icons/` for the nearby title, walking-time chip, bus entries, and inspector header nav buttons; these generated UI icons render at enlarged sizes after tight-cropping.
- All icon paths are declared in a single `ICON_PATHS` registry in `js/categories.js`. Adding an icon requires one line there; no other file needs editing. Tree species leaf icons use `treeSpeciesIconHtml(commonName, latinName)` for fuzzy name-to-icon matching.
- All `<img>` icons in the inspector panel use `loading="eager" decoding="sync"` so they render immediately on DOM insertion without a visible flash.
- Count controlled by `nearestItemsCount` dropdown (3/5/10/15/20/25)
- Filter panel toggle visible in overview mode

### Browsing Another Spot

Every screen that draws the walking-radius ring — the plain Nearby/overview screen *and*
Filter/Settings/Report — supports previewing what's near a different point on the map without
moving the real GPS fix:

- **Tap-to-relocate:** tapping open ground anywhere on the map sets `state.nearbyAnchor` to that
  point (`focusNearbyOnMapPoint`/`setNearbyAnchor` in `js/nav.js`), so the walking-radius ring
  and the nearby list move to the tapped spot. This works on Filter/Settings/Report too — they
  draw the same ring, and moving it must stay possible from them; neither this nor any other map
  tap ever dismisses the open screen itself. `state.userLocation` (the real GPS fix) is never
  modified. "Open ground" is any tap `findHit` does not resolve to a highlighted location (tree,
  place, cow, waymarked trail) or a street (road, railway) — background polygons (forest, nature
  designations, water bodies) are deliberately not hit-tested at all, so a tap inside the forest
  is a tap on open ground rather than a selectable "area" (the area detail view no longer
  exists). Distance from the current origin is not considered: a tap *inside* the current radius
  relocates the same way one far outside it does.
- **Outside the nearest area, everything relocates.** The walking-radius ring *is* the nearest
  area: everything the Nearby view is about — the list, the highlighted locations — lives inside
  it, so while the Nearby view is showing (`isOverviewScreenActive()`, which excludes
  Filter/Settings/Report — those deliberately frame the map wider than the ring to show where
  each selected kind lies, so "outside the ring" is most of what is on screen there and this
  rule would make almost any tap relocate), *any* tap beyond the ring relocates, whatever it
  landed on, not just taps on open ground (`isOutsideNearestArea` in `js/nav.js`, measured from
  `nearbyOrigin()` so it follows the browse anchor once one is set). This exists for streets and
  waymarked trails: their lines are terrain, drawn right across the map, so without this rule a
  tap into the out-of-radius corners of the Nearby screen opened a navigation view to whichever
  road ran through there instead of browsing that spot. Inside the ring, taps select as normal —
  a street you could actually walk to now is a destination. The rule also catches out-of-radius
  *pins*, which are only ever drawn when the radius filter is toggled off
  (`state.showAllOutsideRadius`); those items stay reachable from the nearby list, which is
  unaffected. It does not apply once something is selected: from a selected-detail view, a tap
  on a street selects that street at any distance (there is no ring being shown to be outside
  of), and a tap on open ground returns to Nearby focused there, per the rule below.
- **Tap-to-relocate from a selection or an expanded group:** the same tap made while a location
  is selected, or while a group is expanded, also leaves that view — the anchor is set and
  `goToInitialView()` returns to Nearby framed on the tapped spot. The anchor is set *before*
  that call so its single re-fit already frames the new origin instead of fitting the old one
  and then animating a second time. A map tap never dismisses Filter/Settings/Report (see
  "Secondary Screens" below), but an open-ground tap does move their anchor, as above.
- **Pinch-to-resize the radius:** a two-finger pinch on the map canvas while any screen that
  draws the ring is active (Nearby, or Filter/Settings/Report) scales `state.walkingDistanceMinutes` continuously (no fixed stops) — spreading
  fingers apart shrinks the radius (zoom in), pinching together grows it (zoom out), tracking
  the pinch distance ratio from where the gesture started. Values are rounded to the nearest
  half-minute (`roundWalkingMinutes`) before being applied, so pointermove ticks landing in the
  same half-minute bucket cost nothing beyond that arithmetic (`applyWalkingRadiusChange`
  no-ops when the rounded value hasn't moved) — this bounds how often the real per-tick work (a
  nearest-item rescan and list re-render) actually runs. Each real change re-renders the
  nearest list and re-fits the camera via the same path a Settings radius change uses
  (`refreshNearbyRadiusView`, `animate:false` mid-gesture so intermediate fits don't queue an
  animation each tick; the gesture's end re-runs it once more with the default `animate:true`
  for a smooth settle; and `refreshNearbyRadiusView` deliberately skips `selectOverview()` on a
  secondary screen so resizing from Settings doesn't throw that screen's own content away). Pinch
  is ignored over a real selection, which replaces the map view entirely, and cancels/ignores any
  in-progress single-finger drag.
  Releasing either finger of a **multi-touch** gesture never registers as a map tap
  (`state.multiTouchOccurred`, set as soon as a second pointer goes down and cleared only once
  every finger is off the glass) — that holds even where the radius pinch itself is ignored,
  which is what stops a two-finger gesture over a selected location from releasing as a tap on
  open ground and dropping the selection. When a multi-touch gesture drops back to **one**
  finger, the pan is handed to the finger still down (`beginMapDrag`, re-seeded from that
  pointer's current position so the map doesn't jump by however far the two-finger gesture
  travelled). The second pointer going down sets `state.dragging = false` and nothing used to
  set it back, so the map went completely dead under a finger that was still on the glass and
  the user had to lift off entirely and start again.
- **Walking-radius floor:** the radius cannot be pinched (or, on the Settings slider below,
  dragged) below `walkingRadiusFloorMinutes(origin)` (`js/nav.js`) — the distance to the
  nearest real item respecting active filters (`nearestFallbackEntriesForActiveFilter`, same
  priority the "nothing in radius" list fallback uses), plus a 15% buffer
  (`WALKING_RADIUS_FLOOR_BUFFER`) so that item settles clearly inside the ring rather than on
  its edge. Falls back to `WALKING_RADIUS_MIN_MINUTES` (1) with no origin or nothing to measure
  against — that fallback is *not* a limit on zooming in: a real nearest item takes the floor
  all the way down to `WALKING_RADIUS_TIGHT_MIN_MINUTES` (0.25 min, ~21 m), so a find a few
  seconds away can be closed right in on, ring and camera together. The camera follows because
  the Nearby fit frames the ring and nothing else (see "Heading-up nearby mode" below).
  Values snap to a grid: `WALKING_RADIUS_STEP_MINUTES` (0.5) at a minute and above,
  `WALKING_RADIUS_FINE_STEP_MINUTES` (0.25) below it, where half-minute steps would be a third
  of what is left (`walkingMinutesStep`/`roundWalkingMinutes`/`ceilWalkingMinutes`). A value
  snapped at the floor is rounded *up* onto that grid so it can never land just inside it.
  Sub-minute radii are shown in seconds ("15 sec") rather than as a fraction of a minute —
  `formatWalkingRadius()` is what every user-facing radius label goes through.
  While a pinch is actively pinned at the floor, `state.walkingRadiusAtFloor` is true
  and `overviewNearestHtml()` shows a transient "nothing closer to show" notice
  (`.walk-radius-floor-notice`); both clear as soon as the gesture ends or backs off. That notice
  lives in the Nearby list, so the lightweight re-render that keeps it in sync is skipped on
  Filter/Settings/Report — there is nothing there to refresh, and `selectOverview()` would
  replace the open screen. On the
  Settings slider, the same floor is enforced natively via the `<input type="range">`'s own
  `min` attribute (rounded up onto the value grid, since a range input steps from its own `min`)
  with a matching `step`, and a `#settingsWalkMinsFloorNote` appears whenever the slider sits
  at it. That form is built once when the screen opens, so a radius changed from *outside* it --
  the pinch gesture (which engages over Settings too) or the automatic grow-back below -- writes
  the new value, floor, step and label back into it via `syncSettingsWalkSlider()` (`js/nav.js`).
  It is deliberately not called from `refreshNearbyRadiusView`, which a live slider drag runs
  through on every `input`: writing the value back mid-drag would tug the thumb under the finger.
- **Wheel and trackpad resize the ring (`updateNearbyRadiusWheel`, js/nav.js).** The canvas wheel
  handler routes to the radius gesture on exactly the screens the two-finger pinch engages on
  (`wheelResizesNearbyRadius()`: a user location plus `isOverviewScreenActive()` or
  `secondaryScreenActive()`); anywhere else it falls through to the old `zoomAt()` map zoom.
  `deltaY < 0` (zoom in) shrinks the radius, matching both the pinch's direction and what the
  wheel used to do to the map. Deltas are normalised to pixels first (`normalizeWheelPixels`
  handles Firefox's line mode and page mode), then applied as `Math.exp(pixels * rate)` —
  `WHEEL_RADIUS_RATE_PER_PIXEL` puts a ~100px wheel notch at the 1.22x step the map zoom took,
  and a trackpad pinch (reported as ctrl+wheel, in far smaller deltas) multiplies that rate by
  `TRACKPAD_PINCH_RATE_MULTIPLIER` so a whole pinch is worth a whole pinch. The running value
  lives unrounded in `state.wheelRadiusMinutes` rather than being read back from the applied
  radius: a single trackpad delta is smaller than the value grid, so reading it back would round
  every event away to the radius it started from and the ring would never move. It is clamped to
  the floor/maximum, unlike the pinch's own base, because a wheel only accumulates — an unclamped
  value would make the user scroll back through everything they overshot before the ring moved.
  A wheel has no pointerup, so the gesture ends `WHEEL_RADIUS_SETTLE_MS` (220ms) after the last
  event (`endNearbyRadiusWheel`), which is where the settling animation, the cleared floor notice
  and the Settings-slider sync happen — the same things `endNearbyRadiusPinch` does on lift-off.
  Both gestures share one body, `applyWalkingRadiusGesture(rawMinutes)`, which does the clamp,
  the at-floor flag, the grid snap and the apply, and returns the floor it used so the wheel can
  clamp its running value without a second nearest-item scan.
- **Safari's trackpad pinch** does not arrive as a ctrl+wheel at all: it comes as
  `gesturestart`/`gesturechange`/`gestureend` carrying a cumulative `scale`, which is the same
  ratio the two-finger pinch already speaks in, so `startNearbyRadiusGesture`/
  `updateNearbyRadiusGesture`/`endNearbyRadiusGesture` (js/nav.js) map it straight onto
  `applyWalkingRadiusGesture` from a `state.gestureRadiusBaseMinutes` baseline — measured from
  where the gesture began, so returning the fingers returns the radius. Only Safari fires these
  events, so the handlers are inert everywhere else, and the Playwright projects (Chromium) can
  only cover this path in unit tests.
- **Automatic grow-back:** a radius closed down onto one find becomes an empty circle as soon as
  the user walks away from it, so every GPS fix runs `ensureWalkingRadiusCoversNearest()`
  (`js/nav.js`, called from the `watchPosition` handler in `ensureLocationWatch`, js/app.js).
  When the ring holds nothing — `nearbyRadiusIsEmpty()`, which reads the memoized in-radius scan
  and its `state.overviewOutsideRadiusFallback` flag rather than measuring again — the radius is
  lifted to the current floor, i.e. just past the nearest remaining highlighted location, and the
  camera zooms out with it through the usual `refreshNearbyRadiusView` fit. It is **grow-only and
  floor-only**: a deliberately wide radius is never pulled back in, and a ring that still has
  something in it is never touched. It stands down entirely while a pinch is live
  (`state.pinchActive`), while a browse-origin slide is animating
  (`nearbyOriginTransitionActive()`, whose whole point is that the ring holds still), and behind a
  real selection or an expanded cluster, which `refreshNearbyRadiusView` would otherwise replace
  with the Nearby list — each is re-checked on the next fix.
- **Relocating slides the map, not the circle.** A browse-anchor move is animated by
  interpolating the *origin* (`nearbyRenderOriginPoint`/`startNearbyOriginTransition`,
  js/app.js) over `NEARBY_ORIGIN_TRANSITION_MS` (520ms, animateViewportTo's cubic ease-in-out)
  while the camera keeps `cameraOriginPoint()` pinned at the focus — so the walking-radius circle
  sits still on screen and the map slides underneath it. The camera is re-derived from the
  interpolated origin every frame in `prepareCanvasForDraw`; `setNearbyAnchor`/`clearNearbyAnchor`
  therefore pass `animate: false` and must not also animate the viewport.
  - Animating the camera instead — the obvious way round — snaps the circle to the tapped point
    on the first frame (the origin changes at once) and then drags it back to the centre as the
    camera catches up. The circle is what the view is about; the map is what should move.
  - Only rendering follows the interpolated origin. `nearbyOrigin()` jumps straight to the new
    anchor, so the nearby list, the highlighted set and hit testing describe the destination
    immediately instead of being recomputed against a moving point every frame.
  - The interpolated value is **frozen per frame** (`_nearbyRenderOriginCache`, cleared wherever
    `_tiltProjectionCache` is, plus on `startNearbyOriginTransition`). Without that, the camera
    is solved from the origin as it was at the top of the frame while the circle is drawn from
    the origin a whole map-draw later — tens of milliseconds on a dense frame — so the circle
    lands slightly off the focus it is pinned to, which is a visible wobble on exactly the
    motion this exists to smooth.
  - **The new nearby set is held back until the map lands.** `nearbyRevealOpacity()` is 0 for the
    duration of the slide and then fades the highlighted pins in over
    `NEARBY_REVEAL_MS` (180ms). Those belong to the destination, but the map underneath them is
    still travelling: drawing them straight away puts a fan of lines pinned to a stationary
    circle sweeping across moving terrain, with pins sliding under a marker that is not moving —
    it reads as jitter even though every element is where it should be. The transition object
    deliberately outlives the slide by `NEARBY_REVEAL_MS` so the fade has frames. The camera is
    re-derived on every frame that object is alive, including the fade tail after the slide has
    landed: `nearbyRenderOriginPoint()` snaps from the interpolated origin to the final one the
    moment the slide ends, so a frame that skipped the re-derive left the camera on the last
    interpolated framing and the ring — the one thing the slide exists to hold still — twitched a
    few pixels on landing and hopped back when the fade finished. Once the origin has stopped
    moving the re-derive is a no-op. The "You" dot is exempt: it is the user's real position, not
    part of the nearby set.
  - In 3D the pivot fraction also differs between the first-person and browsing cases (0.94 at
    max tilt vs 0.5, see below), so `tiltRampedAnchor` eases between them across the same slide
    rather than jerking the whole view up or down the screen on one frame. The transition
    records whether it started from a browsed spot (`fromBrowsing`), so hopping between two
    browsed spots keeps the centred pivot throughout instead of dipping toward the first-person
    anchor and back.
  - **The 3D zoom is eased across the same crossing.** The two pivots come with two different
    scale fits: first-person lets the behind half of the ring run off the bottom edge
    (`excludeBehindDuringTilt`) and then frames past its sides (`NEARBY_TILT_FIT_ZOOM`), browsing
    frames the whole ring. Which one applies flips the frame the anchor is set, a whole slide
    before the pivot has moved to where the browse rule makes sense — solved as-is, that put the
    behind half into a fit still anchored near the bottom edge, which is exactly the collapse
    the first-person rule exists to avoid, so the map
    zoomed out several-fold on one frame and crept back in over the slide. `maxNearbyHeadingUpScale`
    instead solves each end in its own consistent pivot-and-rule pair (`nearbyPivotFitScale`,
    `nearbyPivotAnchorFraction`) and blends the two scales on the slide's own easing, so the zoom
    starts at exactly what was on screen, lands on the browse fit, and passes through nothing
    neither end would have chosen. The same applies in reverse when the anchor is cleared.
    Mid-slide framing is therefore deliberately between the two: the whole-ring rule below
    describes the settled browse view.
- **Relocating reframes; it never zooms out.** The Nearby camera anchors `nearbyOrigin().point`
  at the focus point and sizes itself to the walking-radius ring, so moving the browse anchor
  slides the same view onto the new spot: same scale, ring the same size, origin at the same
  place on screen. Getting that right means the *scale fit* has to measure its points from the
  same origin the camera anchors — `maxScaleForHeadingUpPoints` takes an `originPoint` option
  (defaulting to the real GPS fix, which is what selected navigation always wants) and
  `maxNearbyHeadingUpScale` passes `nearbyOrigin().point`. Previously the fit stayed on the real
  fix while the camera centred the anchor, so an off-centre ring was measured as if it sat
  hundreds of metres to one side and the scale collapsed to squeeze that into the rect — and
  since each relocation re-ran the same calculation from further out, repeated browsing walked
  the Nearby view out to whole-forest scale a tap at a time.
- **`nearbyOrigin()`** (`js/nav.js`) is the single seam this feature relies on: it returns
  `state.nearbyAnchor` if set, else `state.userLocation`, and is read by the walking-radius
  circle, the nearby list/camera-fit pipeline (`overviewItemsForActiveFilter`,
  `nearbyCameraFitPoints`, `maxNearbyHeadingUpScale`, `alignHeadingUpNavigationViewport`'s
  nearby branch), and the anchor marker. Everything else — the "You" dot, compass heading, bearing arrows, and distance/
  navigation for an actually-selected item — always reads `state.userLocation` directly and is
  unaffected by browsing. Filter/Settings/Report read `nearbyOrigin()` like every other screen:
  they draw the same ring around the same anchor, so scanning their lists and pins from the raw
  GPS fix instead left the ring centred on the browsed spot while the matches inside it came
  from wherever the user was actually standing.
- **Returning to the real location:** while a browse anchor is set, `#nearbyAnchorBar` shows a
  "Showing places near where you tapped" notice with a **Use my location**
  (`data-action="reset-nearby-anchor"`) button that clears `state.nearbyAnchor`
  (`clearNearbyAnchor`) and re-renders/re-fits back to the real GPS fix. The bar lives in the
  inspector *chrome* (between the header and the tools row), not in the Nearby list's HTML, so
  it survives the body swap that opening Filters, Settings or Report performs — all three keep
  drawing the ring around the browsed spot behind them, and while the notice was part of the
  list, opening any of them left the user browsing with nothing on screen offering to undo it.
  `updateNearbyAnchorBar()` (js/nav.js) is called from `setInspectorSelectionChrome` (every
  screen change routes through it), from `refreshNearbyRadiusView` (every anchor/radius change)
  and from `focusNearbyOnMapPoint`'s exit-a-selection branch; it hides the bar only for a real
  selection (`hasRealSelection`), which replaces the whole map view anyway.
- **One camera origin (`cameraOriginPoint`, js/app.js).** The point the camera anchors at its
  focus, the point the scale fit measures its points from, the pivot the heading-up rotation
  turns about, and the pivot the 3D perspective projects around are all the same point:
  `state.userLocation.point` while navigating to a selected destination, `nearbyOrigin().point`
  otherwise. Everything that needs "where is the camera" reads this rather than
  `state.userLocation.point` directly — `alignHeadingUpNavigationViewport`,
  `maxNearbyHeadingUpScale`, `tiltProjection`, `tiltRotatedHeadingOffset`, `worldToScreenFlat`,
  `worldToScreenForOverlay`, `screenToWorld`, and `updateHeadingUpCanvasRotationTransform`.
  They used to disagree the moment a browse anchor was set: the camera centred the anchor while
  the fit, the rotation pivot and the tilt projection stayed on the GPS fix, so the ring was
  fitted as if it sat far off to one side, rotation swung it across the screen as the compass
  moved, and in 3D it was projected around a pivot that had itself gone off screen.
- **Browsing is not a first-person view.** Three tilt behaviours exist to model standing
  somewhere and facing forward, and all three are suspended while a browse anchor is set, via
  the shared `tiltHidesWhatIsBehind()` (`!state.nearbyAnchor`):
  - `maxNearbyHeadingUpScale` stops passing `excludeBehindDuringTilt`, so the *whole*
    walking-radius ring is framed inside the available map area rather than letting its behind
    half run off the bottom edge, and `nearbyFirstPersonFitZoom()` returns 1 rather than
    `NEARBY_TILT_FIT_ZOOM`, so the ring is framed rather than zoomed past — a browsed spot has no
    "ahead" to walk into, and its whole nearest area has to stay on screen.
  - `tiltRampedAnchor` stops ramping the pivot toward the bottom of the screen
    (`HEADING_UP_ANCHOR_NEARBY_TILT`, 0.94) and pins it at the untilted centre
    (`HEADING_UP_ANCHOR_NEARBY`, 0.5), so the ring gets equal room above and below the pivot and
    is framed at a useful size instead of squeezed into the sliver below a bottom anchor —
    measured on a 375×812 phone at 49° of tilt, that is the difference between the ring filling
    the map area and it being roughly a third of the width.
  - `isBehindTiltHeading` and `tiltPinScale` stop culling roads/paths and collapsing pins behind
    the pivot, so the newly-framed half of the ring is not drawn as empty ground.

  **`radarRadiusForMetres(point, metres, toScreen)`** takes the projection to measure through,
  and it must be the same space the caller builds its geometry in. The tilted radar
  (`drawUserRadarOverlayTilted`) builds its arcs in flat, pre-perspective space and projects each
  arc point itself, so it passes `worldToScreenFlat`; measuring its radius through the full
  projection while placing its arcs flat mixed the two and inflated the cone — 6× on a browsed
  spot 1km from the user (114 CSS px for what should be 19), since the user sits far enough
  off-pivot there for the perspective divide to magnify the projected distance. The flat-map
  radar (`drawUserRadarMainCanvas`) keeps the default, which is correct because with tilt
  inactive the two projections are the same thing.

  One consequence to keep in mind when touching the overlay: because the heading rotation now
  pivots on the camera origin, the user's *raw* screen position is no longer where the user is
  drawn whenever a browse anchor is set. Anything positioning something at the user must use
  `worldToScreenFlat(state.userLocation.point)` (or `worldToScreenForOverlayTilted`), never
  `rawWorldToScreen`. `drawUserRadarOverlayTilted` did the latter — correct only while rotation
  pivoted on the user, since rotating a point about itself leaves it fixed — which left the 3D
  radar cone floating detached from the "You" dot it belongs to.

  The first-person case is untouched: standing where the camera is, the ground behind you still
  runs off the bottom edge and content behind you is still revealed by turning around, which is
  what keeps 3D from zooming out to about a third of what the visible half needs.

### Selected Detail Content

All selected detail screens with a distance pill (trees, places, cows, and paths) show an always-visible combined distance + walk-time chip (`{distance} · {walk time}`) using the walking icon. This chip is not expandable/tap-to-reveal and follows the same readable unit formatting (`formatDistance()`: metres below 1km, kilometres above 1km with trimmed precision).

The figure itself is the real road/path-following distance (and the walk time derived from it), matching the routed line described under "Route Lines" above, whenever that route is available -- not the straight-line/crow-flies distance. `selectedRouteMetres(target)` (js/renderer.js) sums the segment lengths of whatever `selectedRoutePoints(target)` currently returns, so it shares that function's memoization and its same fallback conditions; `updateSelectedDetailFields()` (js/app.js) uses this routed figure when it's available and falls back to the plain straight-line distance otherwise (graph still building, no route found, etc.), so the chip is never blank and never regresses below the previous behaviour. The chip is refreshed both on every GPS fix and the moment the routing graph finishes its lazy background build, so a selection made before the graph is ready still self-corrects from the straight-line figure to the routed one shortly after, without waiting for the next GPS fix.

#### Tree Details

- **Tag number** (physical forest tag) is shown as the **first** always-visible field, before Estimated age and Common name. This is the number printed on the physical tag nailed to the tree, making it easy to confirm you're looking at the right record without extra taps.
- Register fields: IDs, taxonomy, status, girth, metadata, comments, grid refs
- Enriched named-tree data: match metadata, folklore/historical notes, source links
- Inspector title icon: `tree.png`
- Live distance + walking time
- The **National tag** field stays inside the collapsed "Technical data" accordion (it is often blank or `0` and is distinct from the physical tag number).

#### Place Details

- Name, category, address, contact, source
- Inspector title icon matches the map pin: a place resolves through `placeIconSlug` (via `landmarkEmoji`), other types through `filterKindEmoji`, with a glyph only where no artwork exists
- OSM attribution (only for OSM-sourced places)
- Live distance + walking time
- Bus stop selections append live departures when online; the departures block also shows a bus-stop direction summary (`Buses towards …`) using TfL stop metadata when available, otherwise a deduplicated summary of upcoming destination names for that stop only.
- The direction is only ever a place a bus is heading for, or wording such as `northbound`/`via …` from the stop's own flag. A compass bearing is never used: TfL's `bearing`, `CompassPoint` and similar metadata (`225`, `NE`, `north-east`) are discarded rather than shown, because a bearing tells a rider nothing they can act on. A stop with no usable direction shows no direction line, and its Nearby entry keeps its plain name.

#### Cow Details

- Serial number, type, coordinates
- Last update timestamp
- Source attribution
- Inspector title icon: `cow.png`
- Live distance + walking time

#### Street (Road) Details

Tapping a street on the map opens the same navigation view a highlighted location does, not a
bare records list:

- Road type, name, reference, highway tag
- Live distance + walking time chip (`.detail-top-row`, the same `data-live-field="distance"`
  element the other navigable selections use)
- A street has no single position of its own, so `selectedCompassTarget()` (js/app.js) resolves
  a **street navigation target** for it: `roadNavTarget(road)` projects the user's position onto
  each of the road's own segments in world space and returns the nearest point as a pseudo-item
  (`{point, latitude, longitude, name}`). Everything downstream — the inspector compass arrow,
  the routed dashed line, the camera fit, heading-up navigation — then treats a street exactly
  like any other destination. The target is resolved lazily and cached on `state.selected`, both
  because `selectedRoutePoints`' memoization keys on target object identity (it must be the same
  object every frame) and because a street selected before the first GPS fix has nothing to
  measure from yet, so the attempt has to be repeatable. It stays fixed at the point that was
  nearest when the street was selected, the way any other destination stays put.
- The selected street itself keeps its existing pulsing overlay (`drawSelectedRoadOverlay`).
- Railways are unchanged: still a plain detail view with no navigation target.

### Secondary Screens (Search, Filter, Settings, Report)

Search, Filter, Settings, and Report share identical navigation behaviour, gated by the shared `secondaryScreenActive()` helper (`state.searchScreenOpen || state.filterScreenOpen || state.selected?.type === "settings" || state.selected?.type === "report"`). Where the points below say "all three", Search is the fourth and behaves the same:

- **Map canvas tap on open ground does not dismiss the screen**, but it *does* move the browse anchor, exactly as on Nearby. Only the Nearby button, the header back arrow and the URL return to overview. The "any tap beyond the ring relocates" rule is Nearby-only: these screens deliberately frame the map wider than the ring, so most of what is on screen is outside it.
- **Everything that removes or adjusts the browse anchor works here too.** All three screens draw the same walking-radius ring around the same `nearbyOrigin()`, and it would be incoherent for the ring to be visible and un-editable: the `#nearbyAnchorBar` "Use my location" control is inspector chrome and stays on screen across all of them, pinch-to-resize the radius engages here, and `overviewItemsForActiveFilter()` reads `nearbyOrigin()` so the matches inside the ring come from the spot the ring is actually drawn around.
- **Map icon set: the ring's contents, exactly as on Nearby, plus the nearest match of each selected filter.** `buildFullNearbyIconLookup()` (`js/renderer.js`) reads `overviewItemsForActiveFilter()` on every screen, so the highlighted locations are the ones inside the walking radius, scanned from `nearbyOrigin()` — and resizing the ring from any of these screens (the Settings slider, the two-finger pinch, the wheel/trackpad gesture, all of which engage here) re-derives what is highlighted, rather than redrawing the same circle with the same pins inside it. These screens differ from Nearby in one respect only: they additionally highlight the single nearest match of each selected filter when it falls *outside* the ring — `addNearestSelectedFilterReach()`, reading the same `nearestSelectedFilterEntries()` their camera fit reaches for (see below). Those items are drawn at full strength like every other pin (see "Out-of-radius clusters" above), an item already inside the ring is left to the in-radius pass rather than being re-added, and with the radius toggle off (`state.showAllOutsideRadius`) the reach is skipped entirely, since the unlimited set already holds those matches and nothing is out-of-radius on a screen state that is ignoring the radius. Without this the fit framed a match the map drew nothing for, so the zoom-out looked like it had reached for empty ground.
- **Camera fit is identical across all three screens.** All three use the same "survey mode" camera fit (see Survey mode under Camera Behavior below) — the walking-radius ring plus the nearest match for each selected filter, so the view zooms out past the ring far enough to show that each selected kind exists and which way it lies, even when every one of them is outside the walking radius. Opening any of the three screens (`openFiltersScreen`, `openSettings`, `openReportModal`) triggers this fit with a 420ms animation; GPS updates, resizes (e.g. the on-screen keyboard opening on the Report form), and heading-up compass rotation all keep re-fitting to the same target while any of the three screens is open, so switching between them never changes the view. `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `centerOverviewOnUserLocation` all treat `secondaryScreenActive()` the same as plain overview mode rather than bailing out for the settings/report pseudo-selection. Because `nearestSelectedFilterPoints()` ignores the walking radius, this fit reaches filtered items beyond the radius, not just items within it; it measures "nearest" from `nearbyOrigin()`, the same origin the ring is drawn around and the in-radius scan runs from, so browsing a spot moves the reach with it. The items it reaches for are highlighted on the map too — see "Map icon set" above.
- **Search results are drawn from the whole dataset, not the ring.** The other three screens are views of what is around you; Search is not, so its list is built by `searchMapFeatures()` over a name index of every named feature (`ensureSearchIndex`), independently of the walking radius and of the active filters. The ring and the map behind it are unchanged — only the list differs. See "Search Screen" in `spec.md`.
- **Search results reuse the Nearby row markup** (`.nearest-item`, `searchResultsHtml`) but carry `data-search-type`/`data-search-key` rather than `data-overview-type`/`data-overview-key`, so they route through `openSearchResult()` and the shared `SELECTION_ROUTES` table instead of `focusOverviewItem()`. That is what lets a road or a railway line — neither of which the Nearby list can contain — be opened from a result, and what lets a result be opened with no location fix at all.
- **Full 3D tilt is available on all three screens**, exactly as on the nearby overview (see "3D tilt available on every screen" under Camera Behavior below) — the "identical view" invariant above covers pan/zoom framing only; the live tilt angle tracks phone orientation the same way it does everywhere else and is not held fixed across screen switches.

### Filter Panel (Overview mode only)

- Hidden when in selected-detail mode
- Toggle button shows active filter count badge

Filter groups (defined by `FILTER_GROUPS` in `js/categories.js`, the single source of truth):

| Group | Subfilters |
|-------|-----------|
| 🌿 Nature | Trees, Cows, Ponds & streams |
| 🍽️ Food | Pubs & bars, Restaurants, Cafés, Shops |
| 🚌 Transport | Bus stops, Underground, National Rail, Car parks |
| 📜 History | Historic sites, Plaques, Monuments, WWII sites |
| 📍 Locations | Churches, Education, Medical sites, Campsites |
| ✨ Stories | Legends, Literature, Film & TV, Art |

Which places a subfilter matches is decided by `matchesPlaceFilter(place, filterKey)` and its
`is*Category` predicates, which live in `js/categories.js` alongside the group definitions
themselves. They are pure functions of a normalised place — no state, no DOM — so the weekly
report's map inventory (`scripts/report/map-inventory.js`, see `spec-weekly-report.md`) counts
places using the app's own rules rather than a second copy of them that could drift.

Behavior:
- Multi-select within and across groups
- Group header click enables/disables all subfilters in group
- Deselecting all filters shows all content
- Subfilter pills horizontally scroll with fade edges

### Nearest Count Control

- Dropdown below nearest list
- Options: 3, 5, 10, 15, 20, 25
- Default: 10
- Changing updates: list count, highlighted markers, camera fit

---

## Camera Behavior

### Fit to Bounds

- On load: fit all data in view

### Selection Camera

- **Expanded inspector + selected target:** camera fits user + target in the area not covered by the inspector. The inspector is always expanded after a map tap selection (on both mobile and desktop) so the detail panel opens immediately; the same holds for a selection made via a URL (`showRoutedSelection` in `js/app.js`), which explicitly forces the inspector open rather than merely skipping a minimize call, so arriving at a new linked location — by link, by `hashchange`, or by going back to one — while the inspector was already minimized doesn't stay collapsed. It is only auto-minimized when selecting from the overview/nearby list (`focusOverviewItem`).
- **Navigation mode GPS follow:** on each GPS update, the camera checks whether both the user and the selected destination are comfortably inside the visible area (14% edge margin). If both are visible, no animation is triggered. If either drifts toward the edge or off-screen, `fitToPoints` runs with an 800 ms animation — long enough that consecutive GPS ticks blend smoothly rather than producing visible jumps. The fit never zooms out beyond the initial forest-level scale (`baseFitScale` floor).
- **Heading-up selected navigation:** when a selected navigation target is active, the user location exists, and compass heading is available, the map switches from north-up to heading-up regardless of whether the inspector is expanded or minimized. The user anchor ramps from a base of 62% (no tilt) to 88% (max tilt, full 3D) via `tiltAnchorFraction()`, then `headingUpAnchorFraction(true)` mirrors that ramped anchor around the screen's 50% centre based on `selectedNavigationTargetBearingOffsetRadians()` -- the destination's bearing relative to straight ahead, computed by rotating the vector from the user to the destination (averaged across `selectedNavigationTargetPoints()`, which includes any waypoints along the route, not just the final destination) into heading-up space the same way pin rotation does, then `Math.atan2`: a destination dead ahead (offset 0) keeps the plain ramped anchor unchanged, a destination dead behind (offset ±π) mirrors it to `1 - anchor` (user anchored high, most of the screen given to what's behind them since that's where the route actually is), and a destination directly to either side (offset ±π/2) settles exactly at the 50% centre -- interpolated by `cos(offset)` so the transition across all bearings is smooth, not a snap at some threshold. This only applies to selected navigation; nearby mode's anchor (`headingUpAnchorFraction(false)`) is unaffected and still just the plain `tiltAnchorFraction()` ramp, since nearby has no single destination bearing to mirror around. The map rotates around the user as `state.compassHeading` changes, so the direction the device is facing is always toward the top of the screen. The map/overlay canvases are rendered with an overscan bitmap area (150% of viewport, centered) while heading-up is active so CSS delta rotation can run through full compass turns without exposing clipped canvas edges; in north-up mode the canvas uses an exact-fit allocation to avoid unnecessary GPU fill-rate overhead. Tilt does not change this allocation at any angle: it is projected per point in `worldToScreen()` rather than applied to the finished bitmap, so there is no canvas edge for perspective to expose (see "3D tilt projection" below). On mode change `prepareCanvasForDraw()` detects the heading-up transition and calls `resizeCanvas()` to expand or shrink the allocation immediately. On very large/high-DPR screens, overscan resize logic caps bitmap allocation to a conservative budget (max dimension 3072 px, max area 9,437,184 px) and lowers effective DPR as needed. During normal heading updates, `updateHeadingUpCanvasRotationTransform()` applies a CSS rotation delta around the user point and avoids full redraw churn; on heading entry animation frames the rotation is still baked into redraws. While tilt is active that delta shortcut is skipped and a redraw is requested instead — rolling an already-projected 3D image around the pivot would visibly roll the horizon rather than re-project the ground at the new heading. The redraw is `requestAnimationFrame`-coalesced, and in 3D the main canvas carries terrain only (pins move to `#overlayCanvas`), so it stays one draw per frame for as long as the compass is actually moving. Heading-up fits in this mode keep the same scale stabilisation as nearby mode: a 4% fit buffer (extra off-screen render room), deferred non-essential zoom updates while compass sensor events are active, and a small strict-fit tolerance so tiny corrections do not trigger redraw churn. Unlike nearby mode (below), the scale fit for selected navigation no longer excludes points that fall behind the user's heading (`rotatedY > 0` after rotating into heading-up space) while tilt is active: `maxScaleForHeadingUpPoints` takes an `excludeBehindDuringTilt` option (default `true`, matching the old behaviour), and `maxHeadingUpNavigationScale` passes `false`, so the origin, route waypoints, and destination are all fit onto the available map space together even when the destination is currently behind the user during full 3D tilt -- previously such a destination was excluded from the fit entirely (only its rendering was affected by "Full 3D — hiding what's behind" below, but the *zoom* stayed anchored on wherever the last-visible-ahead fit had left it, wasting the screen space freed up by the destination no longer constraining anything). The points themselves are still culled from being drawn while behind the heading and tilt is active, per "Full 3D — hiding what's behind" below, except the selected navigation target and its route line, which are exempted from that cull for exactly this reason (see the exemption noted there) — so a destination behind the user during tilt now correctly pulls the fit in to include it, and stays visible, rather than sitting off-screen at a stale zoom. Because a destination behind the user can now occupy most of the screen below a mirrored-toward-top anchor, `setInspectorMinimized` (`js/nav.js`) re-runs the real heading-up scale fit (`alignHeadingUpNavigationViewport({ force: true })`) when the inspector expands during heading-up selected navigation, instead of the plain-mode `centerViewportOnPointsKeepScale` recentre (which keeps whatever scale was already in effect) -- otherwise a fit computed against the smaller minimized-inspector footprint would never get corrected once the inspector grows to its full size, letting the destination end up rendered behind the now-larger panel. North-up selected navigation (no compass heading) is unaffected and keeps the plain recentre. The selected destination must remain inside the visible map area while heading-up mode is active; if heading, resize, drag, or zoom would push the destination out of view, the viewport zoom is set to the exact scale that places the destination at the edge of the visible area — `Math.min` is not used here, so the viewport always zooms to the correct level even when coming from a wider zoom such as the walking-radius overview. When this mode is inactive, the map remains north-up. On entering heading-up mode for the first time (transition from north-up), `state.renderedNavigationHeading` is interpolated from 0° toward `state.compassHeading` over the same duration as the viewport animation using `state.headingUpEntryAnim` (from/to/startTime/duration). `prepareCanvasForDraw()` advances the interpolation each frame and calls `requestDraw()` while in progress, so every canvas draw already reflects the correct intermediate heading — pins always point downward throughout the transition.
- **Heading-up nearby mode:** when there is no real navigation target (`selectedCompassTarget()` returns null) but user location and compass heading are available, `nearbyHeadingUpActive()` returns true and the map switches to heading-up. This covers the overview/nearby screen, the filter panel, and pseudo-selection screens (settings, report) — all of which show the map in the background and rotate with the device heading, escalating into full 3D tilt exactly like the plain nearby screen (see "3D tilt available on every screen" below). **The Nearby camera frames one thing and one thing only: the walking-radius circle.** It is what the screen is about ("how far can I get in N minutes"), it is centred on `nearbyOrigin()`, and it is a circle -- so the fit is a fixed calculation that does not depend on the compass heading at all, and the camera holds still while you turn on the spot. Highlighted items do not enter the fit: every earlier design fitted the item cluster and tried to bound the result somehow, and each one had the camera chasing whichever matches happened to be nearest -- zooming in past the ring and clipping it when they were clustered close, zooming out past it when one sat near the edge, and re-solving on every compass frame. The fit points come from `nearbyCameraFitPoints()` (see "Camera fit target" below); the scale is one `maxScaleForHeadingUpPoints(..., { projectTilt: true })` call on them.

  The user anchor ramps smoothly from 50% (no tilt -- dead centre, so the circle is centred in the available map space and the four corners fall outside it and show the out-of-radius wash) to 94% of the visible map height as tilt deepens (via `tiltAnchorFraction()`, the same 0-1 ramp used for `rotateX`), leaving only a narrow gap below the dot at max tilt rather than pinning it flush to the edge. A heads-up view is about what is in front of you, so every pixel spent on the ground behind you is a pixel not spent on where you are walking; the forward-shifted anchor also keeps more geographic content rendered in the ahead direction during deep tilt, reducing the chance of a bare-background horizon.

  **In 3D the camera frames past the ring, not around it** (`nearbyFirstPersonFitZoom()`). Fitting the ahead half of the ring exactly put its left and right extremes right on the screen edges, so 3D read as a small disc of forest being looked at from outside, with the search area's own boundary drawn around it -- the second half of the "too zoomed out in 3D" report. The first-person fit is therefore multiplied by `NEARBY_TILT_FIT_ZOOM` (1.6), ramped in on `tiltAnchorFraction()` like the anchor is: flat 2D -- the one view that is *about* seeing the whole ring -- stays at 1.0 and is untouched, raising the phone eases the zoom in rather than stepping it, and at full 3D the ring's sides run off the screen so you stand inside the radius looking down it. The ring is still drawn in full; it is simply no longer the thing being framed. Browsing a tapped spot keeps the plain fit (see "Browsing is not a first-person view" above), and the crossing between the two is blended on the slide's own easing like the pivot is.

  The behind-heading exclusion (`excludeBehindDuringTilt`, default `true`) applies to the ring like any other fit points: while tilt is active only the half of the circle ahead of the heading constrains the scale. That matches what 3D actually renders -- `isBehindTiltHeading` culls everything behind the user -- and is what keeps 3D usable: with the pivot anchored near the bottom of the screen at tilt, forcing the behind half of the ring into the few pixels below it collapsed the scale to roughly a third of what the visible half needs (the "far too zoomed out in 3D" report). The behind half is still *drawn* (`drawWalkingRadius` always draws the full 360-degree circle) -- it simply runs off the bottom edge, the way the ground immediately behind you does in any first-person view. Outside tilt nothing is excluded, so the whole circle is framed.

  `projectTilt: true` solves the fit against where the tilt camera actually projects each point instead of flat (untilted) geometry -- without it, the ahead-side margin is solved as if screen distance grew linearly with world distance, when tilt actually compresses ahead points toward the horizon, so the fit stops zooming in too early and leaves real unused space above the "You" dot at any active tilt angle. The same underlying bounding-box math (`maxScaleForHeadingUpPoints`) is shared with `maxHeadingUpNavigationScale` in selected navigation; the two differ only in which points they pass and whether behind points are excluded. `walkingRadiusCirclePoints()` samples the ring as a 64-gon rather than a 16-gon: sampling error is what would otherwise make a heading-independent fit wobble as the ring rotates (~1.9% at 16 samples, ~0.12% at 64), and it also stops the circle being clipped by up to 2%. `alignHeadingUpNavigationViewport()` bails out entirely until `state.dataLoaded` is true -- on devices where compass events arrive before map data finishes loading (observed on iOS), fitting before the world bounds exist could otherwise produce a nonsense initial scale.

  Because the fit is heading-invariant and depends only on the focus rect, the tilt angle, and the circle itself, `alignHeadingUpNavigationViewport()` returns "unchanged" on almost every compass frame -- the per-frame work stays a `drawOverlay()` rather than a full viewport change and redraw. The camera only moves when the circle does: the origin (GPS or browse anchor) shifts, the walking radius changes, the tilt angle changes, or the visible rect resizes.

  **The overlay-only frame must never paint a different camera to the one the map was drawn at.** Tilt is baked into main-canvas pixels by `worldToScreen()`, so the map keeps whatever `rotateX` the last `draw()` used, while the overlay re-projects pins, the radar and the "You" dot live. `prepareCanvasForDraw()` records the angle each draw bakes in `state.renderedTiltRotateXDeg`, and `tiltRenderStale()` (true once the live `tiltRotateXDeg()` differs by more than `TILT_RENDER_STALE_DEG`, 0.05°) is checked alongside the viewport-changed result everywhere that choice is made -- the compass smoothing tick (both the per-frame and the settle branch) and the GPS `watchPosition` handler -- so a stale map takes the full redraw instead. Without it, pitching the phone with no turn changed nothing the viewport fit cares about (this is the browse-anchor case above, where the fit is already settled), so the overlay was repainted alone at the new tilt over terrain still drawn at the old one: everything far from the pivot sits near the horizon, where a fraction of a degree of `rotateX` moves it tens of pixels, and the "You" dot slid up and down the screen while the map under it stood still.

  Selected navigation, by contrast, has no ceiling on how far it may zoom in: getting tighter as you physically approach your destination is the intended behaviour there, not a bug.

- **3D tilt available on every screen:** full 3D (`tiltActive()`) is available on every screen — the plain nearby overview, active navigation to a selected item, and the filter panel, settings, and feedback screens all allow it. `tiltAllowedForCurrentScreen()` returns `true` unconditionally, with no exceptions. Returning to the nearby overview (`goToInitialView()`, from any prior screen — a selected-item navigation view, cluster-detail, or Filter/Settings/Feedback) does not force a flatten-to-2D transition first; the camera re-fit runs immediately, while `state.tiltBetaSmoothed` keeps tracking the live physical device tilt through the normal ~1/4s exponential filter (in `startCompassSmoothing`, see below) toward `state.tiltBetaTarget`, so the map stays at whatever angle the phone is currently at throughout the re-fit animation. Every downstream consumer of `tiltBetaSmoothed` (`tiltRotateXDeg`, `tiltAnchorFraction`, `tiltInfluence`, `tiltActive` itself, — see "3D tilt projection" below) reads this same single smoothed value.

  Pins/roads behind the user's heading cull the same way on every screen (see "Full 3D — hiding what's behind" below) — there is no screen-specific exception. On the filter/settings/feedback screens this means survey-mode zoom (below) frames the filtered items regardless of heading, but items currently behind the user still shrink/vanish from the canvas exactly as they do on the nearby overview and in navigation mode; turning to face them reveals them.
- **Full 3D — hiding what's behind:** once tilt is active (`tiltActive()` true, i.e. full 3D), `isBehindTiltHeading(worldPoint)` tests whether a world point falls behind the user's current heading (`rotatedY > 0` after rotating into heading-up space, the same test used for the scale-fit exclusions above). This is a rendering-level cull, separate from the camera-fit exclusion: even a point close enough that the fit-scale change alone wouldn't push it off-screen is fully excluded from lines while tilt is active. It is applied to road and path lines in `drawRoads`/`drawPaths` via the shared `traceAheadOnlyPath()` helper, which breaks a polyline into a fresh `moveTo` whenever it crosses back into the ahead half rather than drawing a stray connecting stroke across the hidden gap; path name labels are skipped the same way. Tree/landmark/cow/waymarked-trail/water pins use a continuous companion, `tiltPinScale(worldPoint)`, instead of the hard cull: it returns a 0–1 size multiplier that eases from full size (well ahead) down to `TILT_PIN_COLLAPSE_MIN_SCALE` (0.3, well behind) across a `TILT_PIN_COLLAPSE_BAND_PX` (130px, converted to world units via `state.viewport.scale`) band straddling the same boundary, using a smoothstep ease. Pins are never fully removed from the draw call in `drawAllPinsSorted` — each cluster's icon size (and, for the emoji-fallback landmark case, its badge padding/border) is multiplied by this scale — so turning the heading reads as pins continuously growing/shrinking from their own anchor point rather than popping in and out, while collapsed pins stay small enough not to crowd the pins ahead. Unlike `isBehindTiltHeading`, this is gated on `headingUpActive()` and blended by `tiltInfluence()` — `clamp((state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD), 0, 1)` — rather than switched on at the `tiltActive()` threshold itself: gating on `tiltActive()` directly would let a currently-collapsed pin jump straight to full size the instant tilt deactivates while leaving 3D. `tiltInfluence()` instead ramps across the same active-tilt range as `tiltRotateXDeg()`/`tiltAnchorFraction()` — 0 at `TILT_BETA_THRESHOLD` (12°, where tilt itself first engages) to 1 at `TILT_BETA_MAX` (85°, max tilt) — so pins stay close to full size as tilt begins and only collapse toward minimum size near max tilt, rather than sitting at minimum size through nearly the entire active-tilt range and only growing back in the last few degrees before flattening to map mode. Because the ramp's lower bound coincides exactly with `tiltActive()`'s own threshold, a collapsed pin still eases continuously back to full size as beta drops through 12° and tilt deactivates, so leaving 3D never snaps. The selected navigation target (the one item you're actively walking to) and the route line to it are exempt — they must stay visible per the "selected destination must remain inside the visible map area" rule above, since hiding your actual destination when you walk past it would defeat navigation. The intent is that full 3D is a deliberate "look ahead" view: content behind is revealed by physically turning around (which updates `state.compassHeading` and rotates it into view) rather than by keeping a squashed/enlarged version visible at the bottom of the screen. Heading-up fits keep a 4% zoom buffer so highlighted points stay comfortably inside the visible area with extra draw room when the device rotates; while compass sensor events are still actively arriving, zoom changes are smoothed rather than applied directly, with a small strict-fit tolerance to ignore micro corrections. That smoothing (`resolveHeadingUpTargetScale`) is a hysteresis deadband in front of a two-directional ease. The *anchor* the camera frames you at is kept continuous separately, in `balancedNavigationAnchorY` -- see the Anchor continuity bullet below. The fit is re-solved on every compass frame against a live heading, a live GPS fix and a route whose head is the walker's current position, so the scale it asks for is never still -- every step and every degree of heading noise moves it. The camera therefore **holds** the scale on screen until the fit has drifted more than `HEADING_UP_SCALE_HOLD_RATIO` (13%) away from it, and only then eases; `state.headingUpScaleEasing` latches that glide so it runs all the way to the fit rather than stopping the moment it re-enters the band and sitting there re-triggering. Holding does not freeze the frame -- `alignHeadingUpNavigationViewport` still re-derives `tx`/`ty` every frame, so the map keeps tracking the walker, only the zoom holds. Both directions ease: zoom-in over about a second (`HEADING_UP_SCALE_EASE_RATE`, 4) and zoom-*out* over about half of that (`HEADING_UP_SCALE_EASE_OUT_RATE`, 9), the asymmetry being that zooming out is recovering room the target is running out of while zooming in only tightens a frame that is already correct. A one-frame snap is reserved for a genuine overshoot -- the previous scale more than `HEADING_UP_SCALE_SNAP_RATIO` (1.25x) past the raw target, i.e. the destination has actually left the framed area (a phone just tilted away from it) and waiting out an ease would leave it off-screen -- and `force: true` bypasses all of it. Previously **any** zoom-out, however slight, fell straight through to that snap while only zoom-in was eased; since walking produces a steady trickle of small zoom-out requests, the camera sawtoothed (snap out hard, ease back in over ~1s, snap out again), reported from the field as the zoom jumping in and out while walking a route. The 13% band is comfortably wider than the wander a walking pace produces and still inside the room the fit leaves itself: with the 4% buffer holding the camera tighter than the true fit, a full band of drift puts the framed target about 8% past where a perfect fit would place it, still inside `headingUpFitMarginPx` (10% of the rect plus 12dp). The ease integrates real elapsed time between calls (`state.headingUpScaleEaseAt`), clamped per step to `HEADING_UP_SCALE_EASE_MAX_DT` (50ms) so one call never advances further than an ordinary frame would -- but a gap past `HEADING_UP_SCALE_EASE_STALE_MS` (500ms) is treated as genuinely stale (a backgrounded tab, or a screen the ease did not run on) and discards the elapsed time outright rather than integrating it as one large step. Gaps in between -- an occasional slow frame well short of that, e.g. from the tilt-aware fit's own per-frame projection math running while the phone is actively being re-tilted -- still advance the clock by the clamped amount and carry the remainder over onto the next call (a fixed-step accumulator) rather than being discarded like a stale gap would be; discarding every such frame outright used to freeze the ease indefinitely at whatever scale the last *urgent* (off-screen) correction had snapped to, reading as "it zooms out partway through a tilt gesture and never comes back." Explicit navigation events (e.g. `goToInitialView()` returning from the filter screen) pass `force: true` through `ensureOverviewTargetsVisible` → `alignHeadingUpNavigationViewport` → `resolveHeadingUpTargetScale` to bypass this deferral and update the zoom immediately. On first activation an entry animation rotates from north-up to the current heading over 500 ms, driven by the same `headingUpEntryAnim` mechanism. Drag, zoom, resize, compass changes, and nearby filter changes all re-fit the overview targets via `alignHeadingUpNavigationViewport()` / `ensureOverviewTargetsVisible()`. The `headingUpActive()` helper returns true for either selected-navigation or nearby heading-up and is the single check used in the compass smoothing tick and CSS delta rotation path. The user radar cone points toward the top of the screen in both heading-up modes. Tree, landmark, and cow pins are drawn on `#overlayCanvas` (not `#mapCanvas`) so they remain at their correct geographic positions on screen.
- **Initial selection zoom:** waits for the inspector CSS transition to settle, then runs a single 600 ms `animateToHeadingUpNavigationViewport` (when compass is active) or `ensureUserAndSelectionVisible` (without compass) — never double-stepping. There is no secondary viewport snap after the animation.
- **Overview mode GPS follow (all cases, including all four secondary screens):** `ensureOverviewTargetsVisible` (via `keepOverviewCenteredOnUser`) is called whenever the user moves ≥ 24 px on screen or any target point goes off-screen. It re-fits `nearbyCameraFitPoints()` so the walking-radius circle (plus any survey-mode filter points) fills the visible map area above the inspector, using a tighter `padding: 28` (CSS px) vs the default 54 to reduce wasted space at the screen edges. Every correction is animated — 620 ms for large movements (≥ 200 px on screen), 300 ms below that. Sub-threshold corrections used to be applied instantly on the grounds that animating them caused jitter, but a 24–200 px jump landing on each GPS fix *is* the jitter: the map visibly ticked sideways once a second while walking. Consecutive fixes no longer stack, because a re-request of an unchanged target leaves the running ease alone (see "Animations" below). The fit never zooms out beyond `baseFitScale` (initial forest-level scale). If there is no circle to frame (no origin, or a zero radius), the camera pans to keep the user centred without changing zoom. `ensureOverviewTargetsVisible`, `keepOverviewCenteredOnUser`, and `centerOverviewOnUserLocation` bail out only for a real tree/landmark/cow/path/water selection — they treat the Filter/Settings/Report pseudo-selections the same as plain overview mode via `secondaryScreenActive()`, so GPS-triggered re-centering keeps running on all four secondary screens rather than freezing the camera at whatever it showed before the screen opened.
- **Resize events in overview mode or any secondary screen:** when the viewport resizes (keyboard, orientation, inspector animation) and user location is available, `ensureOverviewTargetsVisible` is called with `animate: false` so the fit is recalculated for the new canvas size without snapping to `fitToBounds` (full-forest zoom). This also covers the Report screen's on-screen keyboard opening — previously this fell through to a full-forest `fitToBounds` snap because the resize handler only checked `isOverviewScreenActive()`; it now also checks `secondaryScreenActive()`.
- **First location fix / loading reveal:** the map snaps onto the walking-radius circle (`maxScaleForRadiusVisible`, at 0.82x so the reveal eases outward-to-inward rather than starting on the final frame) while the overlay is still visible, then after the 320 ms pause runs the animated reveal. Snapping to the same thing the live Nearby view frames is what stops the reveal beginning on a tight fit of whichever items happened to be nearest and then pulling back out to the circle. If a URL hash selected an item, `applySelectionFromHash()` fires first and the animation uses `ensureUserAndSelectionVisible` (user + item fill screen). Otherwise the animation uses `ensureOverviewTargetsVisible` with fresh GPS points (not the pre-pause snapshot) so a mid-pause GPS update never causes a visible zoom-out during the reveal.
- **Camera fit target (`nearbyCameraFitPoints`):** the single source of what the overview camera frames, shared by `alignHeadingUpNavigationViewport`, `ensureOverviewTargetsVisible` and `keepOverviewCenteredOnUser`'s off-screen check (so the camera and the "has the view drifted" test can never disagree and re-fit each other in a loop). Two modes:
  - **Nearby (no secondary screen active):** the walking-radius circle (`walkingRadiusCirclePoints()`) plus the out-of-radius reach below. Highlighted items *inside* the ring never enter the fit — see "Heading-up nearby mode" above.
  - **Out-of-radius reveal (`outOfRadiusFitPoints()`, every screen):** the single nearest match for each filter the user has **just switched on** that turned out to have *nothing at all* inside the walking radius — exactly the entries `overviewItemsForActiveFilter()` marks `outOfRadius` (tagged with `outOfRadiusFilterKey`, since `entry.kind` is the item's kind and cannot be matched back to a filter key on its own), which are exactly what the Nearby list is already showing for those filters. Without it, adding a filter whose nearest match lies beyond the ring (Underground stations, from inside the forest) changed the list and changed nothing on the map, so the station the list had just named was nowhere to be seen. One point per filter, not the three the list offers: the camera only has to reach far enough to show the nearest one exists and which way it lies. It reads the memoized scan, so it costs a walk of an array the list has already built.
    - **It is a response to an action, not a standing property of the camera.** `refreshOutOfRadiusReveal(previousFilters)` runs inside `setOverviewFilters` and sets `state.outOfRadiusRevealFilters` to the keys just added that went unanswered; anything else (a filter switched off, a filter switched on that *is* in range, no additions at all) clears it, as do `applyWalkingRadiusChange`, `setNearbyAnchor` and `clearNearbyAnchor` — resizing the ring or moving the browse point is the user taking the camera back. Reaching for every unanswered filter all the time instead meant a *saved* filter set with one far-off kind in it left the Nearby view permanently zoomed out, with the walking radius a quarter of its proper size on every boot (caught by `13-tilt-3d.spec.js`'s flat-2D ring fill assertion).
    - **Never while browsing a tapped spot** (`state.nearbyAnchor` set): that view is "show me what is around *there*", and the ring around the tapped spot is the whole of it — the same reasoning as "Browsing is not a first-person view" above.
    - **Capped at `NEARBY_OUT_OF_RADIUS_FIT_MAX_RATIO` (12) times the walking radius:** some filters have no local example at all and their nearest match is hundreds of kilometres away; framing that would shrink the ring — the thing the screen is about — to a speck. Past the cap the list still names the match and still marks it out-of-radius; the map simply stays where the user can read it.
  - **Survey mode (Filter/Settings/Report):** the circle and the out-of-radius reach **plus the nearest single match for each selected filter**, ignoring the walking radius entirely (`nearestSelectedFilterPoints()`, built from `nearestOverviewEntryForFilter` per active point-filter key, measured from `nearbyOrigin()`). These are the screens where you choose what you are looking for, so the map must show that the nearest pub/pond/veteran tree exists at all and which way it lies — the view zooms out past the ring as far as it takes to reach them. One point per filter, not every match: the fit only has to reach the closest of each kind. With no filters selected there is nothing extra to reach for and the fit is the circle alone, identical to the Nearby screen.
  - Adding out-of-radius filter points can only widen the fit, never tighten it past the circle: the circle is always in the point set, so the ring stays fully framed on every screen.
- **GPS-triggered refit during animation:** `keepOverviewCenteredOnUser` skips the off-screen check (`anyOffscreen`) while a programmatic viewport animation is in progress (`state.viewportAnimationFrame != null`). This prevents GPS updates from interrupting smooth transitions (e.g. the loading reveal or back-to-overview zoom) by snapping mid-animation.
- **Minimized inspector:** auto-reposition paused — free pan/zoom
- **Expand from minimized:** recenter once to user + selected target, preserve zoom intent
- **Manual camera override (`state.manualCameraOverrideFor`):** the auto-reposition follow is a correction, never a lock. The first drag or wheel-zoom made while a location is selected and the inspector is expanded records the *current selection object* in `state.manualCameraOverrideFor` (`markManualCameraOverride`) and then pans/zooms normally; while that record still matches `state.selected` (`manualCameraOverrideActive()`), `shouldAutoRepositionSelection()` returns false and unforced `ensureUserAndSelectionVisible` calls — which is what the `watchPosition` handler makes on every fix — return without touching the viewport. Keying on the selection rather than a flag means picking a different location hands the camera straight back with nothing to reset; it is additionally cleared (`clearManualCameraOverride`) by any `force: true` fit, by expanding the inspector from minimized (the one sanctioned re-frame, above), and by `goToInitialView()`. Heading-up modes never set it: they genuinely do pin the viewport to a fitted target, so there is no manual position to preserve. Without this the fit was re-run on every `pointermove` and every GPS fix, and since the fit was already satisfied the map could not be dragged or zoomed anywhere at all while a selection was open.

### Animations

- GPS-triggered navigation follow uses 800 ms cubic ease-in-out so consecutive position updates blend without visible restarts.
- Overview repositioning uses 360–620 ms depending on distance moved.
- View transitions animate with configurable duration; all state-change transitions produce exactly one smooth animation with no intermediate jumps.
- **One ease per destination (`viewportAnimationAlreadyHeadedTo`):** `animateViewportTo` returns without doing anything when an animation is already in flight toward effectively the same viewport — within 0.5% on scale and 6 device px on `tx`/`ty`. The repeat callers (the GPS watch, the compass tick, the inspector resize drag) re-request their fit many times a second while the target itself barely moves; restarting the ease each time made the camera decelerate toward the end of every ease and then accelerate again from zero, so the motion arrived in visible steps rather than gliding. A genuinely different target still cancels and replaces the running animation as before.
- **Inspector resize drag:** while the drag handle is held, each frame re-frames the camera instantly (`recentMapForInspectorChange({ animate: false })`), and a single 240 ms animated settle runs on release — the same live/settle split the walking-radius slider and pinch gesture use. Requesting a fresh 180 ms animation per frame instead meant no ease ever got more than a few milliseconds in before the next one cancelled it. `pointercancel` on the handle settles identically to `pointerup`, so an interrupted resize still ends with the camera eased into place.
- **Waiting for the inspector to settle (`onInspectorHeightTransitionEnd`, `js/inspector.js`):** callers that must measure the panel after it finishes growing/shrinking (`zoomToSelection`, `goToInitialView`) listen for `transitionend` filtered to `event.target === els.inspector && event.propertyName === "max-height"`, with the existing `INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS` fallback. `transitionend` bubbles and the panel is full of descendants with shorter transitions of their own (row backgrounds 120 ms, drag handle 40 ms, nearest-item reorder 150 ms), so an unfiltered one-shot listener routinely fired *before* the 180 ms height transition it was waiting for and the camera then framed the map against a footprint that no longer existed.
- **Screen transition ghost (`setInspectorSelectionChrome`):** the outgoing screen is cloned for the slide-out, and every `id` attribute is stripped from the clone. `#inspectorTitle`, `#inspectorBody` and friends live inside `.inspector-screen`, so leaving them on the ghost put duplicate ids in the live DOM for the 310 ms of the animation, and any `getElementById`/`#id` lookup running during a transition could answer with the frozen outgoing copy. The ghost is `aria-hidden` and `pointer-events: none`; nothing addresses it.
- Entering heading-up mode: `renderedNavigationHeading` is eased from 0° toward `state.compassHeading` over the same 600 ms duration as the viewport animation. Each canvas draw reflects the intermediate heading, so pins always point downward throughout.
- `animateToHeadingUpNavigationViewport(durationMs)` is the single authoritative function for transitioning to heading-up view — it starts the viewport animation while heading interpolation is redrawn frame-by-frame on canvas.
- `setInspectorMinimized(true)` no longer makes any direct viewport change; the caller (`zoomToSelection`, `goToInitialView`, etc.) is responsible for the camera transition after the inspector settles.

---

## Zoom & Input

- **Pointer lifecycle robustness (`js/nav.js`):** `setPointerCapture`/`releasePointerCapture` are always called through `capturePointerSafely`/`releasePointerSafely`, which swallow the `NotFoundError` the browser raises for a pointer it has already finished with. An uncaught throw there aborted the rest of the `pointerup` handler, leaving `state.dragging` true and the lifted finger still in `state.activePointers` — after which the map ignored every subsequent gesture until the page was reloaded. The canvas also handles `lostpointercapture`, tearing the gesture down the same way `pointercancel` does, because the browser can take a captured pointer away (a system edge gesture claiming the touch, the tab backgrounding mid-drag) without ever sending `pointerup` or `pointercancel`.
- Browser/page pinch zoom disabled
- Ctrl+wheel zoom disabled at document level
- Map zoom via: map interactions only (wheel/drag) — there is no on-screen zoom control in the main map UI
- Touch double-tap zoom prevented
- **Two-finger pinch on the map canvas is repurposed** (rather than left inert once native
  pinch-zoom is disabled): on any screen that draws the walking radius — Nearby, Filters,
  Settings, Report — it resizes that radius instead of the map scale directly, see "Browsing
  Another Spot" under Inspector Panel above. Over a real selection a second touch point is still
  just ignored, same as before this feature existed.

---

## Selected Direction Arrow

- Appears in the inspector title row when: user location exists AND selected navigation target exists
- Aligns to the far right edge of the inspector modal title row and is roughly three times larger than the default title-row arrow size, with title text padding reserved so the arrow and name do not collide
- Shows only the directional arrow; the previous top-of-screen compass card with title/distance text is not shown during selected-location navigation
- Shows directional arrow smoothed with device heading
- Updates continuously via `requestAnimationFrame`
- In heading-up selected navigation mode, the radar cone around the user is drawn on `#overlayCanvas` and points straight ahead on screen while the map rotates underneath it. Outside heading-up mode, the radar cone is drawn at the absolute compass heading on the north-up map. The radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom, so it naturally grows when zooming in and shrinks when zooming out.
- **3D tilt projection:** While tilt is active the perspective is applied in JS, per point, inside `worldToScreen()` — there is no CSS `perspective()`/`rotateX()` on the canvas. `tiltProjectOffsets()` rotates the ground plane by `tiltRotateXDeg()` about a horizontal axis through the user (the pivot) and divides by the camera distance `tiltPerspectivePx()`. Ahead of the pivot the projected row converges on a finite horizon at `-P/tan(T)` (`tiltHorizonCanvasY()`), so ground is drawn all the way to it; behind the pivot the divide is clipped just short of the camera plane by `TILT_NEAR_PLANE_RATIO` (0.98), which bounds the scale and keeps coordinates finite — a point at that near plane already projects far below the viewport, so the clip is never visible. `tiltProjection()` caches the camera (angle, distance, pivot, DPR) per frame, sharing `_overlapRectCache`'s invalidation points; without that cache every projected point would re-derive the camera distance through `bestVisibleCanvasRect()` and read DPR from a DOM attribute. `tiltFarClipCssPx()` bounds how much world the draw loop walks, at the distance where the perspective scale falls below `TILT_FAR_FADE_RATIO` (0.1) and the horizon haze has already erased the ground. `worldToScreenFlat()` is the untilted position (raw viewport transform plus heading rotation) and is what viewport fitting and on-screen visibility checks use — feeding them tilted coordinates would let horizon compression near the top of the screen read as "point near the edge" and retrigger a re-fit every frame.

  This replaced a CSS `perspective()`/`rotateX()` on the finished bitmap, which could not satisfy "nothing disappears at any tilt angle" for two independent reasons: a finite rotated bitmap runs out of pixels short of the horizon (leaving a blank band at the top of the screen that grows with tilt and that no amount of overscan closes), and the part of the plane below the pivot swings towards the viewer until it crosses the camera plane, at which point the browser clips the layer and the perspective divide flips negative. Overscan made the second failure strictly worse — more canvas below the pivot meant it crossed the camera at a lower tilt angle.
- **3D tilt distance fade:** When tilt is active, `drawTiltDistanceFade()` runs on `#mapCanvas` after all terrain/route/pin content. It uses `globalCompositeOperation = "destination-out"` so erased pixels become transparent and the `.map-stage` background shows through — a seamless match with no hardcoded colour. It is anchored to the horizon row rather than a fixed fraction of the canvas: everything above the horizon is erased outright (that region is sky), and the 28%-of-height band below it is hazed off with a gradient, so only genuinely distant ground is softened. The overlay canvas is unaffected since it is a separate DOM element layered above.
- **3D tilt mode radar:** When tilt is active (`tiltActive()` true), the radar is moved from `#mapCanvas` to `#overlayCanvas` and each arc point is explicitly projected through `projectCanvasPoint` (the same perspective math used for overlay pins). The arc is drawn as a series of 24 line-segment steps rather than `ctx.arc()` so the foreshortening is geometrically correct. This makes the cone appear to lie flat on the tilted ground plane — a `ctx.arc()` circle drawn without that projection is visually ambiguous and reads as a vertical fin. In non-tilted heading-up mode the radar remains on `#mapCanvas` as before. Max tilt angle is 75° (`TILT_ROTATEX_MAX`); threshold to activate is 12° (`TILT_BETA_THRESHOLD`); the camera distance is derived per-frame by `tiltPerspectivePx()` (see "3D tilt mode" in `spec.md` for the device-independent horizon math), not a fixed pixel value.
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
- **Camera-facing GPS smoothing (`ingestLocationFix` / `advanceLocationGlide`).** `watchPosition` delivers roughly one fix a second and consecutive fixes wander several metres under tree cover, while `state.userLocation.point` is the camera anchor, the scale fit's origin and the 3D pivot at once (`cameraOriginPoint`) — so a raw fix moved the whole map at once. Measured walking toward a destination ~80 m away with the heading held still, the map lurched 15.8 px on average and 26.2 px at worst on each fix frame against 0.3 px on the frames between: a once-a-second twitch. `ingestLocationFix` therefore does not move the position at all; it records the new fix as a target, with a time constant taken from that fix's own reported `accuracy` over `LOCATION_SMOOTHING_ACCURACY_DIVISOR` (10), clamped to `LOCATION_SMOOTHING_MIN_TAU_S`–`LOCATION_SMOOTHING_MAX_TAU_S` (0.3–2.5 s), so a 5 m fix is followed almost as given and a 25 m one is leaned on hard. `advanceLocationGlide()` then eases `state.userLocation` toward that target one frame at a time. A move of `LOCATION_SMOOTHING_SNAP_METRES` (30 m) or more is not wander — a first fix after a gap, or coming out of a tunnel — and lands at once, as does the first fix of a session.

  **One continuous filter, not a per-fix low-pass feeding a fixed-length glide.** That two-stage form was tried first and is wrong: it only recomputed its target when a fix arrived, so a single fix followed by silence left the position permanently short of the last thing the device actually reported — fine while `watchPosition` keeps firing, wrong the moment it stops. Easing toward the newest raw fix on every frame smooths identically while fixes keep arriving (each new one moves the target before the last has been reached, so the wander averages out) and always converges on the truth when they stop.

  **Driven by its own animation frames (`ensureLocationGlideLoop`), not only by the draw loop.** `prepareCanvasForDraw` advances it too, so the position is current at paint time, but that cannot be the only driver: the map stops painting while a secondary screen is open, and the position would freeze part-way until something else requested a draw. Both of these failure modes were caught in CI by the settings spec, which sets a position once, opens Settings, and waits for `state.userLocation` to reach it. Glide progress is integrated against a clamped `dt` with the same staleness rule as the heading-up scale ease, and a gap past `HEADING_UP_SCALE_EASE_STALE_MS` lands on the target rather than integrating a jump; a duplicate call within one tick does nothing, so the two drivers cannot double-advance a frame.

  Because the ease writes `state.userLocation` itself, the camera, the fit, the route head and the "You" marker all move together and cannot disagree. Result on the same walk: 0.5 px average and 3.5 px worst on a fix frame, against 0.4 px between — motion spread evenly across frames instead of concentrated in one. Both functions sit in the two GPS ingestion paths (`applyLocationFix` and the `watchPosition` callback) rather than in a getter, so anything that assigns `state.userLocation` directly — the unit suite, and the e2e specs that place the walker somewhere — is unaffected. `state.rawUserLocation` keeps the unfiltered fix.
- **`visibilitychange` recovery + foreground heartbeat (`setupVisibilityRecovery`)** — fires when the tab returns to foreground AND via a 10-second `setInterval` that runs while the app is in the foreground:
  - If no orientation event has arrived in >15 s, `state.compassHeading` (and `compassHeadingTarget`, `renderedNavigationHeading`, `headingUpEntryAnim`) is cleared so the map goes north-up rather than showing a frozen direction, and `resetCompassCalibration()` is called so the next readings go back through the calibration gate below rather than being trusted immediately. New events restart heading-up automatically. (Compass stale detection is only done on visibility return, not on the periodic tick.)
  - Orientation listeners are removed and re-added to coax iOS back into firing `deviceorientation` events. (Only on visibility return.)
  - `restartStaleGpsWatch()` — if the GPS watch has not delivered a position in >20 s, the watch is cleared and `ensureLocationWatch()` is called to start a fresh one. Called on both visibility return and every 10-second tick so iOS GPS stalls are caught even when the tab stays in the foreground.
- **Stranded animation frames (`releaseStrandedAnimationFrames`, called first on every foreground resume)** — every animation loop in the app re-arms itself from inside its own `requestAnimationFrame` callback and parks the pending handle on `state` (`animationFrame`, `overlayAnimationFrame`, `compassAnimationFrame`, `viewportAnimationFrame`), so a second request cannot stack a duplicate loop. Backgrounding breaks that contract: rAF callbacks do not run while hidden, and a frame requested just before the app went away is frequently dropped outright rather than delivered on return (iOS does this routinely on an app switch). The handle is then set for ever and the duplicate-loop guard silently becomes a *no loop at all* guard — `requestDraw()` never paints again, `startCompassSmoothing()` never eases the heading or the tilt again, and a stranded `state.viewportAnimationTo` keeps `selectionCameraTransitionActive()` true, which makes `alignHeadingUpNavigationViewport()` bail on every call. Between them that is the "the compass and the 3D tilt stop updating after I come back from another app, and only a reload fixes it" report. `handleForegroundResume()` therefore cancels and nulls all four handles (via `stopViewportAnimation()` for the viewport one, so `viewportAnimationTo` is cleared too), resets `state.compassAnimationTime` so the first frame back does not compute a dt measured in minutes, and then restarts the loops with `startCompassSmoothing()` and `requestDraw()` — the sensors that would normally kick them can take seconds to resume, or may already be delivering into a loop that is no longer running. `releaseStrandedAnimationFrames()` itself runs only on resume, never on the 10-second heartbeat, since cancelling unconditionally would kill legitimately in-flight animations — the heartbeat reaches it only through the wedge check below, which first proves a frame is overdue.
- **Wedged animation loops (`recoverWedgedAnimationFrames`, on the foreground watchdog heartbeat)** — the resume hook above only fires on `visibilitychange`/`pageshow`, and iOS routinely suspends and resumes a page without firing either; a callback that throws before it re-arms strands a handle the same way, and every one of these loops calls deep into fitting, overlay and draw code. Either way the parked handle — which *is* the duplicate-loop guard — silently becomes a "no loop at all" lock, and the symptoms are the ones above: the map stops repainting, heading and 3D tilt stop easing, and a stranded `viewportAnimationTo` keeps `alignHeadingUpNavigationViewport()` bailing on every call. Reported from the field as the map simply freezing, recoverable only by reloading. Each loop therefore stamps `state.<loop>AnimationFrameRequestedAt` when it asks for a frame and clears it when that frame actually runs (`requestDraw`/`draw`, `requestOverlayDraw`, the `startCompassSmoothing` tick, the `animateViewportTo` tick), and a request still pending `ANIMATION_FRAME_WEDGED_MS` (2 s) later is a wedge by definition — a frame runs within ~16 ms, so two seconds is far past any plausible scheduling delay on a loaded phone. The watchdog then calls `releaseStrandedAnimationFrames()` and restarts the loops with `startCompassSmoothing()` + `requestDraw()`. Unlike the resume hook this is safe on the 10-second heartbeat precisely because it acts only on a provably overdue request: a loop whose frames are running is never touched, and an in-flight camera animation is never cancelled. It also returns early while the page is hidden, where no rAF callback is expected to run at all.
- **Background battery saving (`pauseBackgroundedTracking`)** — when the tab/screen goes hidden (`visibilitychange` → `document.visibilityState !== "visible"`), the GPS watch (`navigator.geolocation.clearWatch`) and the 60-second location-tracking beacon interval (`stopLocationTracking()` in `js/tracker.js`) are both stopped, since `enableHighAccuracy: true` GPS polling and periodic network beacons are the largest background battery drains. On return to visibility, `ensureLocationWatch()` restarts both (it starts the GPS watch and calls `startLocationTracking()` internally). The 10-second `restartStaleGpsWatch` heartbeat keeps running while hidden but is a no-op since it only acts when a watch is active.
- **Return-to-overview compass stale check** — `goToInitialView()` checks if no orientation event has arrived in >5 s. If so, `compassHeading` is cleared (and `resetCompassCalibration()` called) before rebuilding the overview, preventing the map from snapping to a stale heading-up direction.
- **Anchor continuity (`balancedNavigationAnchorY`).** Where on screen the camera puts you during selected navigation is `headingUpAnchorFraction` (the bearing-mirrored anchor) for a two-point crow-flies line, and the ahead/behind split of the routed line for anything longer. That split divides the focus rect by how far the fitted route reaches ahead of the pivot versus behind it, so with nothing ahead it returns the top of the rect (you at the top, the whole route below) and with nothing behind the bottom, always inset by `headingUpFitMarginPx` at both ends so `maxScaleForHeadingUpPoints` still has room to divide by. It runs across that whole range with no "is there anything on both sides?" guard, deliberately: there used to be one (`ahead <= 0 || behind <= 0` fell back to the plain anchor) and it was a cliff, because the two formulas are far apart at the boundary while a single vertex decides between them. Walking a route that runs behind you, the last junction you have not yet reached is exactly such a vertex, and walking past it -- or a `SELECTED_ROUTE_RECOMPUTE_MIN_METRES` (20 m) route re-solve dropping it -- stepped the anchor 138 px in one frame, reframing the map by 97 px and snapping the zoom 23% (measured in the browser with the heading held still so nothing else could move the camera). Letting the split run to its own limits removes the step with no threshold to tune, and the limits are also the better framing: on the route fixture at beta 20 the route fills 0.75+ of the binding axis anchored at the top against 0.61 falling back to the plain anchor. The two-point fallback keeps the plain anchor because one of those two points *is* the pivot, so there is no shape to split.

  **The anchor's own screen placement is damped separately from the scale fit (`resolveHeadingUpAnchorFraction`/`dampedHeadingUpFocusY`).** Both `headingUpAnchorFraction`'s bearing mirror and `balancedNavigationAnchorY`'s ahead/behind split are functions of the *live, rotating* heading, so simply turning on the spot -- neither the walker nor the destination moving an inch -- continuously slides the anchor, and with it the user's own marker, up and down the screen: reported from the field as "it seems to move the user's position up and down a lot when rotating round, even when it's not helping at all with navigation." Unlike the scale fit above, this had no hysteresis at all before, so it tracked every degree of heading noise. `resolveHeadingUpAnchorFraction` holds/eases it exactly the way `resolveHeadingUpTargetScale` holds/eases the scale -- a `HEADING_UP_ANCHOR_HOLD_RATIO` (12%) deadband of the focus rect's height, then an ease at the same rate as the scale's zoom-in ease -- as a *fraction* of the focus rect's own height, not an absolute canvas y: the rect itself can shift position between calls for reasons that have nothing to do with the compass (a resize, the inspector opening, the canvas's own heading-up overscan sizing in for the first time), and holding a stale absolute position across such a shift places it nonsensically inside the new rect. It is keyed on `selectedCompassTarget()` identity, so a fresh selection never eases in from wherever a *different* target's anchor last settled -- it snaps immediately, the same way `manualCameraOverrideFor` is keyed on selection identity elsewhere. Deliberately **not** folded into `navigationFocusPoint()` itself: `maxHeadingUpNavigationScale` still fits against the instantaneous (undamped) anchor on every call, exactly as before -- smoothing that input too made the scale fit chase a *lagging* anchor instead of the live one, which swung further and more often triggered the urgent one-frame snap while walking a route with a swaying heading. Only where the anchor is used to place the camera (`alignHeadingUpNavigationViewport`'s `ty`, and `animateToHeadingUpNavigationViewport`'s initial one, forced) is it damped; the destination's on-screen position, solved by the undamped fit, is unaffected.
- **Compass calibration gate (`registerCompassCalibrationSample`)** — whenever `state.compassHeading` is `null` (cold start, or just after either staleness clear above), `onDeviceOrientation` does not trust the very first raw reading. Phones commonly need a moment of physical movement for a magnetometer/fused-orientation sensor to settle, and rotating the map to whatever the first reading says is the "dodgy" initial-load state this guards against. Instead, raw readings are buffered in `state.compassCalibrationSamples` (trimmed to a trailing `COMPASS_CALIBRATION_WINDOW_MS` = 900 ms window) and `state.compassHeading` is only set once at least `COMPASS_CALIBRATION_MIN_SAMPLES` (4) of them agree within `COMPASS_CALIBRATION_STABLE_SPREAD_DEG` (6°) of each other (`isCompassCalibrationStable`/`compassCalibrationSpreadDegrees`, using the same circular `shortestCompassDelta` used for smoothing). If it's still unstable after `COMPASS_CALIBRATION_PROMPT_DELAY_MS` (1500 ms), a non-blocking "move your phone in a figure-8" banner (`#compassCalibrationBanner`, `showCompassCalibrationPrompt`/`hideCompassCalibrationPrompt` in `js/app.js`, styled in `css/map-ui.css`) is shown — the map stays fully interactive and north-up-anchored on the user underneath it. The user can dismiss it (`dismissCompassCalibrationPrompt`, wired in `js/nav.js`'s `setupInspectorHandlers`) for the rest of that calibration cycle; `resetCompassCalibration()` clears the dismissal along with the sample buffer so a later re-acquisition can prompt again. `COMPASS_CALIBRATION_MAX_WAIT_MS` (6000 ms) is a safety valve: calibration force-completes with the latest reading once exceeded, so a device whose readings never settle still gets heading-up navigation rather than being blocked indefinitely. Once a heading is trusted, subsequent `onDeviceOrientation` events bypass the gate entirely and update `compassHeadingTarget` directly as before. Rotation is deliberately held back during calibration, but the anchored *zoom* fit is not gated on a heading at all (`nearbyNavigationAnchorActive()` only needs `state.userLocation`) — so `registerCompassCalibrationSample` also drives `startCalibrationViewportSync()`, a `requestAnimationFrame` loop that calls `alignHeadingUpNavigationViewport({ force: true })` every frame (rotation comes out as 0° since `headingUpActive()` is still false) until a heading is trusted. The `force: true` is required, not cosmetic: `resolveHeadingUpTargetScale` holds and then eases zoom changes (rather than applying them) whenever `headingUpCompassSensorActive()` is true (compass events arrived in the last `HEADING_UP_SENSOR_ACTIVE_MS` = 350 ms) so zoom doesn't fight an in-progress rotation — but `onDeviceOrientation` sets `compassLastEventAt` on every raw reading regardless of calibration state, so that "sensor active" condition is true throughout the entire calibration window even though there is no rotation for the zoom to fight (`headingUpActive()` stays false). Without forcing, the initial fit would have to cross the hysteresis band and then ease in, arriving over the following second rather than being established before the map is first shown — and while calibration is still running there is no rotation for it to fight, so there is nothing to smooth over. Forcing keeps the boot fit exact, rather than the "zoom only corrects after it rotates" bug this exists to fix. This mirrors what `startCompassSmoothing`'s own tick already does once heading exists, and exists because that tick previously provided incidental "self-heal on the next frame" zoom correction for races like the `state.dataLoaded` one above — since calibration no longer calls `startCompassSmoothing()` until trusted, without this separate loop the initial zoom could get stuck wrong (e.g. that dataLoaded race, or any other timing gap) until the next GPS fix, which in practice often meant "until the user physically moved". `startCalibrationViewportSync()` stops itself once `compassHeading` becomes finite (handing off to `startCompassSmoothing`'s tick) and carries its own copy of the `COMPASS_CALIBRATION_MAX_WAIT_MS` safety valve so a stalled sensor (no further orientation events to deliver the check inside `registerCompassCalibrationSample`) still force-completes rather than looping forever.
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

The full routing model — the URL for each screen, history entries, back/forward — is in
[spec.md](spec.md) § "URL hash / navigation state". What matters for rendering:

- Every screen is reflected in the URL, for restore, for sharing, and so back retraces the trail
- `#filters`, `#settings` and `#report` open those screens; `#report=<text>` pre-fills the report textarea with `<text>: ` when the field is empty (a saved draft is never overwritten). All are handled in `applyRoute()` before the selection lookups
- `applySelectionFromHash()` is called after the 320 ms loading-overlay pause (after the overview snap, before the animated reveal) so the selection zoom overrides the overview snap rather than being overridden by it
- Hash updates are suppressed while a route is being applied and throughout boot (`routeApplyDepth`, `routerBooting`), so the URL never overwrites the entry it is being read from

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
