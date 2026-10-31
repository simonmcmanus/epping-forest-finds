# Epping Forest Finds PWA Specification

Build a static, offline-capable PWA for exploring veteran trees, nearby places, transport links, and live cow positions around Epping Forest.

The app is lightweight, dependency-free on the client, and runnable directly from this folder via a local static/proxy server.

## Detailed Specs

This top-level spec provides the product overview. Implementation details are split into focused specs with a clearly defined data interface between them:

- **[spec-data-fetching.md](spec-data-fetching.md)** — Fetching, loading, normalizing, and caching all data sources. Defines the `AppData` output interface.
- **[spec-data-rendering.md](spec-data-rendering.md)** — Drawing, interaction, and UI. Consumes the `AppData` interface from the fetching layer.
- **[spec-native.md](spec-native.md)** — iOS/Android native wrapper: the Capacitor shell, the `js/native.js` capability layer, native heading and permissions, bundled data and delta updates, store submission requirements.

All specs live in the `spec/` folder at the project root.

The repository automation for Claude pull-request review and remediation is
described in [spec-claude-pr-review.md](spec-claude-pr-review.md).

All specs should be kept in sync with every change.

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
- `data/events.json` (time-bound events at a fixed location — fairs, guided walks, markets — merged into the map's landmarks; see "Events" below)

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

Cow requests use a fixed center coordinate (not user location) and refresh every 5 minutes. Because every visitor asks the same question, the proxy's successful answers are shared at Netlify's edge for a minute (`Netlify-CDN-Cache-Control: s-maxage=60, stale-while-revalidate=30`, varied on `center`), so Nofence sees about one request a minute however many people have the app open; a position can therefore be up to about 90 seconds older than Nofence's own (a minute fresh, plus at most 30 seconds served while the edge refreshes). Errors are never cached, and the upstream call gives up after 6 seconds. The proxy accepts only the app's own centre (any other `center` is a 400), so nobody can miss the shared copy, and reach Nofence on every request, by varying it. Live bus and train departures (`/.netlify/functions/transport-departures`) are shared the same way per stop (`s-maxage=30, stale-while-revalidate=30`, so at most about a minute old), with a 4-second limit on each TfL call; set `TFL_APP_KEY` in Netlify, since without it every visitor shares TfL's small anonymous allowance (the function logs a warning once).

## Events

Events (fairs, guided walks, markets — anything at a fixed location with a start/end time) are
sourced from `data/events.json` and merged into `state.landmarks` exactly like folklore
locations, so they get clustering, search, filtering, routing and the inspector's place-detail
view for free rather than a parallel code path. **Events is a default-on filter category**, like
Trees and Cows, shown as its own top-level group (not a subfilter of something else) with the
calendar icon.

- **Past events are never loaded into the app.** `scripts/prune_past_events.js` drops expired
  events from the committed `data/events.json` itself, so a client never downloads bytes for
  something nobody can still attend; `normalizeEventLocations` (`js/normalize.js`) drops them a
  second time at load, in case a cached copy of the file is briefly stale. An event with no
  `endsAt` is assumed to run for 24 hours from its `startsAt`.
- **The map only shows an event once it's within a week of starting** (`isEventTooFarAhead`,
  `js/normalize.js`) — a one-directional display cap, not a data change: the source file can
  carry events further out (the weekly ledger report has its own longer-range view of upcoming
  events), they simply don't appear on the map yet. An event already under way is never held
  back by this, however long ago it started.
- Live event pin and detail view: see "Map Layers and Markers" and "Details Content
  Requirements" below.
- **Nearby-event alert (in-app only — no OS push).** On every GPS fix, if a *live* event (its
  current time falls between `startsAt` and `endsAt`) is within the user's walking radius and
  the Events filter is active, a dismissible banner appears over the map (`#eventNearbyBanner`,
  same card styling as the compass-calibration banner) naming the event and the walk time.
  Tapping it opens the event's detail view and dismisses the banner; dismissing it directly just
  hides it. Each event alerts at most once per session — walking in and out of its radius, or
  lingering nearby, never re-shows it. Real OS-level push notifications are a native-app
  feature to revisit once there is a native wrapper (see `spec-native.md`); the static PWA has
  no push-subscription backend.

## Core UX

- First screen is the map.
- App title: `Forest Finds`.
- Inspector supports overview mode and selected-detail mode.
- Install button appears when `beforeinstallprompt` is available.
- The installed app is named "Epping Forest Finds" on the home screen (manifest `name` and `short_name`; `apple-mobile-web-app-title` for iOS, whose Add to Home Screen otherwise defaults to the page title). Its icon is the homepage's oak leaf on a gold tile (see "Generated app icon assets" in `spec-icons.md`).
- Search is available from the inspector's main navigation (see "Search Screen").
- Mobile layout keeps controls compact and avoids overflow.
- On mobile, the modal navigation controls sit below the fixed-height inspector panel with a clear gap so the two cards remain visually distinct and easy to use.

## Search Visibility

The weekly reports are the main way someone who has never heard of the app
finds it — they are real, dated, local news about Epping Forest. So the site
has to be indexable, without a word of filler added to a product whose whole
job is to be a map:

- `index.html`, the report index and every weekly report carry a title, a
  meta description, a canonical address on `https://www.eppingforestfinds.uk`
  and Open Graph / Twitter link-preview tags. Each report also carries
  `NewsArticle` structured data and a description built from that week's own
  findings, so no two reports look like boilerplate to a crawler.
- `sitemap.xml` and `robots.txt` are generated at build time by
  `scripts/generate-sitemap.js` (see `spec-weekly-report.md`). Both are
  generated, never hand-edited, and are gitignored for that reason.
- `robots.txt` keeps crawlers out of `/admin.html`, `/api/` and
  `/.netlify/`, and points them at the sitemap.
- Only finished web pages are ever published under `reports/` — working
  notes and Markdown drafts are neither committed there nor listed.

## Loading Experience

- A blocking loading overlay is shown at startup.
- Overlay displays step-by-step load states (`pending`/`loading`/`done`/`error`) for:
  - tree records
  - local places
  - roads & streets
  - forest/buffer boundaries
  - live cows
- The overlay waits for the non-tree map and place layers, then the map is rendered first and the overlay fades out (0.32s opacity transition) so the map is revealed beneath the dissolving card. Veteran-tree chunks continue in the background, allowing place-focused screens such as Filters and its pubs option to open without waiting for the full tree register; tree deep links still wait for the register so they resolve correctly.
- A small version badge (`#sw-version`, `.version` class) is shown at the bottom-right of the loading overlay, populated via `caches.keys()` once the service worker is active. Displays the cache version (e.g. `v120`). Hidden until the SW is ready.
- A ~500ms pause after all steps complete lets the user see the finished state before the fade begins.
- The location gate (shown when geolocation permission is not pre-granted) also fades out on dismissal.
- **The reveal is never blocked indefinitely on the location request.** Boot starts the location request in parallel with the data load and waits for it before revealing the map, but that wait is bounded (`BOOT_LOCATION_TIMEOUT_MS`, `BOOT_GEOLOCATION_TIMEOUT_MS` + 2s). The Geolocation API's own `timeout` option does not start counting until the permission decision has been made, so a permission prompt left unanswered — or a stalled OS location service — means `getCurrentPosition` never calls back at all, neither success nor error. Without the bound the map would sit behind the loading overlay for ever. On timeout the boot takes the same path a genuine location failure takes: the map opens uncentred and the location gate offers a retry. The request itself asks for `BOOT_GEOLOCATION_TIMEOUT_MS` (20s) — enough room for a cold, high-accuracy outdoor fix, which tree canopy slows further still — so a too-short bound here previously meant someone whose location *was* available, just not yet fixed, saw the same "Get a more custom experience" invite a denial would, on every visit; the outer bound sits just above it and only bites when the browser is not honouring that timeout at all.
- **Distance warning.** A real GPS fix more than a 15-minute walk (1,250 m) from the forest boundary opens a modal saying how far away the forest is; "Explore the map" or Escape dismisses it with the same fade, once per session. The check needs the boundary layer, so it runs when the fix arrives and again when the boundary finishes loading after an earlier fix (the usual order on a cold load).
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
- Events draw with the calendar icon (`data/icons/event.png`), through the same place-marker pipeline as every other landmark.
- Selected marker gets a clear highlight ring.
- Background ornamental grid scales in world space with zoom.

## Selection, Inspector, and Camera Behavior

### Selection

- Click tree/cow/place to open details.
- Details include live distance + walking time (when user location is available).
- Selection is reflected in URL hash for restore/share behavior.

### Inspector modes

- Overview mode: nearest list + map setup control.
- Map setup mode: the compatibility flag `state.filterScreenOpen = true` while the guided Map setup dialog is open. It starts with the saved filters selected, explains that the choices control map pins and the Nearby list, stages edits locally, and applies them only when the user taps Done. Cancel leaves the saved filters unchanged. GPS updates, cow refreshes, locate-button taps, and empty canvas taps must not close it.
- Search screen mode: `state.searchScreenOpen = true`; same rules as the Filter screen — it is a screen, not a selection, and nothing but an explicit navigation closes it.
- Selected-detail mode: map setup button hidden, guided setup closed (not relevant when viewing a specific location).
- Minimized mode: collapsed header only.
- The inspector is always expanded after a map-tap selection, on both desktop and mobile, so the detail panel opens immediately. This also applies to a selection made via a hash/deep link (`applySelectionFromHash`) — including a `hashchange` to a new linked location while the inspector was already minimized, which forces it back open. It is only auto-minimized when selecting from the overview/nearby list (`focusOverviewItem`).
- Tapping the Nearby button always calls `goToInitialView()` (clears selection, refits camera) rather than `selectOverview()` alone. It is the one-tap way home; the header's back arrow steps back through the trail instead (see "URL hash / navigation state").
- Re-tapping an already-active nav button (one with `screen-active` while the inspector is not minimized) plays a spring bounce animation (`.nav-reselect`) on the button instead of re-entering the screen. This gives tactile confirmation that the user is already on that screen.

### URL / navigation state

The URL is the app's navigation state: every screen has one, and the URL is what puts the app
on that screen. Nearby, Search, Map setup, Settings and Report are each a real path of their own
(GA4 fires a pageview on a path change, not on a hash-only one, so each screen and each
`/nearby/<slug>` category is distinguishable in analytics); a selected thing — a tree, a place, a
cow, a street — stays a URL fragment on top of whichever path it was selected from, since none of
those are a "screen" of their own. Map setup and Search nest under `/nearby/` — both only ever
change what the Nearby view itself is showing (a filtered set, a typed query), never a
destination of their own — while Settings and Report stay top-level, general app screens with
nothing to do with the Nearby view underneath them. Implemented by the router in `js/app.js`
(see the `--- Router ---` block there).

| URL | Screen |
| --- | --- |
| `/nearby` | Nearby — the app's home screen and entry point; served from a generated static index with the real tree list, so crawlers and no-JS visitors get content (see spec-marketing.md § 6.6) |
| `/nearby/search` | Search — carries the typed text as a live `?q=<text>` query string (see below) |
| `/nearby/filter` | Map setup — compatibility route that opens the guided setup dialog with the active set as its starting selection |
| `/settings` | Settings |
| `/feedback` | Feedback form (a sub-page of Community) |
| `/community` | Community (contributions, add a missing tree) |
| `/nearby#tree=<key>` | a selected tree; likewise `cow`, `path`, `water`, `road`, `railway`, on top of whichever screen's path it was selected from. A selected `place` (landmark) does this too, *unless* it has its own `/find/<slug>/` page (below), in which case selecting it navigates there instead — see that row |
| `/nearby#near=<lat>,<lon>` | the Nearby view's browse anchor (tap-to-relocate, or an expanded cluster's centre) — shareable and restored on a fresh load, same as a selection |
| `/nearby/<slug>` | The same app, served at its own URL and pre-filtered to one category (a subfilter's own slug, e.g. `pubs`, or a whole top-level group's, e.g. `food`) — a `/nearby/<slug>` category page (`spec-marketing.md` § "Category pages") is itself an instance of this app, not a separate page linking to it. `<slug>` is never `filter` or `search`: those two are the screens below, not categories |
| `/nearby/filter?show=<filterKey>` | Map setup, starting with one or more categories selected — also accepted as a fallback entry point on any path for a link still using the query-param form, superseded by `/nearby/<slug>` above for the single-category case |
| `/nearby/search?q=<text>` | Search, with the box already filled in and showing that text's results, so a search is shareable the same way a filter set is |
| `/nearby?radius=<minutes>` | Nearby (or its `/filter`/`/search` sub-paths) with the walking radius already set to that many minutes, instead of the 5-minute default |
| `/nearby/<slug>?radius=<minutes>` | A category or group page, with the radius set to that many minutes instead of its own 30-minute default (see below) |
| `/find/<slug>` | The same app, served at its own URL for one individual business/location (`spec-marketing.md` § 6.7) — e.g. `/find/the-forresters`. Not a filtered Nearby view like `/nearby/<slug>`: the page describes one specific place, with its own title, JSON-LD and nearby-places list, server-rendered with no JS required. **Also the address-bar URL a selection navigates to in-app**: selecting a place with a `findSlug` (`urlPartsForRouteValue`, `js/app.js`) pushes `/find/<slug>/` as a real history entry — the same URL a search engine would show for it — rather than `#place=<key>` on whichever screen it was selected from; `routeValueFromLocation` resolves the reverse direction (`findPlaceByFindSlug`) so back/forward re-selects the same place through the ordinary landmark selection route — and the same resolution runs at boot too (`applySelectionFromHash`), so loading `/find/<slug>/` directly (a reload, a shared link, a crawler) selects and shows that exact business immediately, the same way loading `/nearby#tree=<key>` already opens that tree. This is a client-side `history.pushState` on in-app selection, not a page reload: once the app shell boots, `document.title` follows the selected place as `<name> near Epping Forest | Epping Forest Finds`; category landings use `Nearby <category> in Epping Forest | Epping Forest Finds`, and returning to Nearby restores its own title. A place with no `findSlug` (a tree, a bus stop, anything outside the Food/Locations groups) is unaffected in its URL and uses the same dynamic selected-location title |
| `/find/events` | An index of upcoming/recent events near the forest — the one `/find/` path that lists several things rather than describing one place |
| `/app` | Bare redirect (301) to `/nearby`, kept working for old links and bookmarks |

- **`/nearby`, `/nearby/filter` and `/nearby/search` each track their query string.**
  Search text and walking radius remain live URL state. Map setup accepts `?show=` as an initial
  selection for compatibility, but its category edits are staged inside the dialog: the saved
  filters and Nearby view change only after Done, while Cancel returns to Nearby with the prior
  choices. This keeps a half-configured setup out of the address bar and out of local storage.
  `?radius=` travels on all three paths, since the radius describes the Nearby view underneath
  each of them; `?show=` is the compatibility entry lens for `/nearby/filter` and `?q=` is
  `/nearby/search`'s own. The radius param is omitted at the 5-minute default, same as `?show=`
  and `?q=` are omitted with nothing to carry — a plain `/nearby` link stays plain for the common
  case. While an expanded cluster badge has borrowed the radius to cover the tapped group
  (`focusNearbyOnClusterGroup`, "Cluster tap interaction" in `spec-data-rendering.md`), that
  borrowed value is excluded from `?radius=` in favour of the reader's own radius
  (`state.preClusterWalkingDistanceMinutes`) — the same reasoning that radius is restored to on
  leaving the group — so a history entry written mid-expansion never bakes the group's borrowed
  ring into the address bar as if the reader had chosen it.
- **A `/nearby/<slug>` landing page defaults the radius to 30 minutes, not the ordinary
  5-minute default.** `applyRadiusFromQuery()` applies this (`LANDING_PAGE_WALKING_DISTANCE_MINUTES`,
  `js/app.js`) whenever the path itself names a category or group and the URL carries no explicit
  `?radius=` of its own — a single category is otherwise too easy to come up empty within the
  ordinary 5-minute default, which would undersell a landing page meant to answer "is there
  enough near here to be worth a visit". An explicit `?radius=` always wins, the same as it does
  everywhere else. Applied the same way on every arrival at the path, boot or popstate alike,
  matching the filters' own "arrival sets the lens" treatment just below.
- **A category landing URL remains the URL while Nearby refreshes.** Location, radius and
  other live updates may re-render the filtered list, but must not replace `/nearby/<slug>/`
  with the generic `/nearby?radius=30` URL unless the reader explicitly navigates to ordinary
  Nearby; the category path and the list it names stay in sync.
- **A `/nearby/<slug>` page's single category never becomes the reader's own default.**
  `setOverviewFilters` takes a `persist: false` option, used only when the filter set comes from
  the URL itself (a `/nearby/<slug>` path or a `?show=` link) rather than a chip the reader tapped
  — so arriving at a category page is never saved as the reader's new default for a later, plain
  visit to `/nearby`. The Nearby nav button goes further for the current visit too: landing on
  one of these pages marks the filters `state.overviewFiltersEphemeral`, and tapping "Nearby"
  while that is set restores whatever the reader's own saved filters were
  (`loadStoredOverviewFilters`) rather than carrying the page's one category over to the plain
  Nearby screen. A filter the reader actually chose — on that same page's own Filters screen
  included — always persists and is never treated as ephemeral. `/nearby/filter`'s own live
  `?show=` (the line above) round-trips through the same `?show=` fallback on every popstate,
  including a plain back/forward retracing a history entry the reader's own filterToggle click
  already created — `applyShowFilterFromQuery()` skips that fallback entirely while on
  `/nearby/filter` itself during a route application (`routeApplyDepth > 0`), so retracing the
  trail back to Filters is never mistaken for a fresh `/nearby/<slug>` arrival. Without this, the
  ordinary 1-3 filter default state got the no-location full-list/fit treatment above on every
  single back-navigation to Filters with no location granted.
- **"All nearby" ignores the saved filters.** `/nearby?filters=false` (read by
  `showsEverythingFromQuery()`, js/app.js) applies every category ephemerally (`persist:false`), so
  the reader's own saved filters are untouched and return on the next plain visit. The same
  override is applied by the walk-radius card's own button (`focusNearbyWithinWalkMinutes`, js/nav.js).
- **Nearby filter rail.** Every Nearby view carries one row of toggle pills (`filterRailHtml()`,
  js/app.js; detail in `spec-data-rendering.md` "Nearby filter rail"): top-level category pills on
  `/nearby`, that category's subcategory pills on a
  `/nearby/<category>` page. Enabled pills show a
  tick. A top-level pill toggles all of its subcategories; a subcategory pill toggles only itself.
  Changes remain an ephemeral lens (`persist:false`), so the reader's saved filters are untouched.
  The address bar follows the selection: one category is
  its own landing path (`/nearby/trees`), several are `/nearby?show=trees,ponds_streams`, and none
  (every category on) is `/nearby?filters=false`. A tap replaces the history entry rather than
  adding one.
- **Navigating in-app straight from one `/nearby/<slug>` arrival to another never loses the new
  page's own category.** A link out of a selected place's inspector (a business page's own
  "Related" section, `js/inspector.js`) or a bare `near="" ` link like "All nearby"
  (the static `/nearby/<slug>/` page's "All nearby" chip, which links `/nearby?filters=false`) routes through `navigateInApp()` →
  `applyRouteFromUrl()` → `applyRoute()`, the same path a popstate takes. Both a `/nearby/<slug>`
  arrival (its own route value is `""`, same as the plain Nearby screen's) and a tap on the Nearby
  nav button land in `goToInitialView()`, whose own ephemeral-filter restore (above) would
  otherwise fire for the *new* page's just-applied category too — `applyShowFilterFromQuery()` and
  `goToInitialView()`'s restore run back to back in the very same pass when leaving a selection for
  a new landing page, both seeing the same `""` route value with no way to tell "just arrived here"
  from "actually leaving". `goToInitialView()` tells them apart by checking whether it is being run
  *from inside* `applyRoute()`/`applyRouteFromUrl()` (`routeApplyDepth > 0`, held open across the
  call) and the current path itself still names a category (`filterKeysFromFindPath`) — true only
  for a fresh landing-page arrival, never for a direct call (the Nearby nav button, the Report
  form's Cancel, the inspector back arrow with no history to retrace), which always runs outside
  that depth. Landing on the bare `/nearby` path itself (no slug — "All nearby"'s own
  target) is handled the other way round, in `applyShowFilterFromQuery()`: since its own route
  value also never changes from the page being left, `goToInitialView()`'s restore never runs on
  its own, so `applyShowFilterFromQuery()` restores the reader's stored filters itself whenever the
  path is bare `/nearby` with no selection and the current filters are still marked ephemeral.

- **A screen change pushes a history entry** (`setHashFromSelection` → `history.pushState`), so
  browser back, the phone's back gesture and the inspector's own back arrow all retrace the same
  trail: Nearby → Filters → a tree comes back out one screen at a time. Until this existed the
  app only ever used `replaceState`, so back left the site from wherever the user had got to.
- **The inspector back arrow (`#inspectorBack`) goes back one step, not straight to Nearby**
  (`navigateBack`), so it and the device back button agree. The Nearby nav button remains the
  one-tap way home. With nothing of this app's own behind the current screen — a link opened in
  a fresh tab, where `history.state` carries depth 0 — it returns to Nearby rather than leaving
  the site.
- **Browsing a different spot carries the anchor in the hash, so it can be shared like a
  selection.** Moving the Nearby view's browse anchor (tap-to-relocate, or expanding a cluster)
  writes `#near=<lat>,<lon>` (`nearbyAnchorRouteValue`/`currentScreenRoute`, `js/app.js`) and
  pushes a history entry, exactly as selecting a real location does — `selectOverview()` also
  shows `#inspectorBack` whenever `state.nearbyAnchor` is set, giving that moved view the same
  back arrow as every other screen (see "Browsing Another Spot" above). Opening a `#near=` link
  fresh restores the anchor the same way a `#tree=` link restores a selection
  (`applyNearbyAnchorFromRoute`, `js/nav.js`), reusing the same tap-to-relocate machinery
  (`setNearbyAnchor`) so the view it produces is identical to tapping that spot by hand.
- **`popstate` and `hashchange` both apply whatever the URL now says** (`applyRouteFromUrl`).
  A history traversal fires `popstate` (and `hashchange` too when only the fragment differs),
  while a fragment edited by hand fires `hashchange` alone; applying a route the app is already
  on is a no-op, so being called twice for one change costs nothing. Clearing a selection's hash
  therefore returns to whichever screen's path is current — Nearby included — the URL is what
  says which screen is open and what, if anything, is selected on top of it.
- **Screen changes made by the URL do not write history entries.** `applyRoute` and the boot
  sequence both suppress URL writes (`routeApplyDepth`, `routerBooting`), so replaying a route
  never buries the entry behind it, and the launch URL survives the Nearby screen being built
  behind the loading overlay.
- **Every selectable thing has a URL**, listed in `SELECTION_ROUTES`. Trees and places were the
  only two before the router, so selecting a cow, a street or a trail used to rewrite the address
  bar to the Nearby screen's URL while that thing was on screen.
- **Moving the Nearby browse anchor — a cluster tap or a tap on open ground — has no URL of its
  own**, but still retraces on back/forward like a selection does. `pushNearbyAnchorHistory`
  (`js/app.js`) pushes a history entry alongside every anchor move (`setNearbyAnchor`,
  `focusNearbyOnClusterGroup`'s `moveAndSettle`, `clearNearbyAnchor`), carrying a snapshot of
  `state.nearbyAnchor` in `history.state` rather than the URL. `popstate`'s
  `restoreNearbyAnchorFromHistory` (`js/nav.js`) applies that snapshot before the URL's own route
  is re-applied, so tapping a cluster, then another, then pressing back walks the anchor back one
  hop at a time — and forward replays it — the same way selecting a tree and going back returns
  to what was selected before.
- **A URL naming something the dataset does not have** (a stale share link) falls back to Nearby
  and corrects the entry in place with `replaceState`, rather than leaving the app on a screen
  its URL does not describe.
- `/feedback` opens the Feedback form page directly (`/community` is the Community screen it hangs off) (the old `/report` path 301-redirects to it, keeping the hash, so published ledger links still work). `/feedback#report=<text>` also pre-fills the form with that text followed by `": "`, so a link can say what the reader was looking at when they found the problem — this is how the weekly reports link back for corrections. A saved draft of the reader's own always wins: the pre-fill only applies to an empty field.

### Camera behavior

- With selected target + expanded inspector: camera fits user + target in the visible area above the inspector (not behind the modal). Zoom adjusts so both fill the available viewport.
- Navigation mode GPS follow: smooth 800 ms animation that only triggers when the user or destination drifts near the edge of the visible area (14% margin). Sub-threshold GPS noise is ignored so the camera glides rather than jumps.
- In overview mode, GPS updates keep the user location and nearest items within the visible map area.
  - the first successful location fix triggers a 700ms cinematic zoom to the user's 5-minute walking radius
  - if location is obtained before map data finishes loading (user clicks the gate early), the zoom is re-triggered once data and `fitToBounds()` are ready — ensuring the animation is never permanently cancelled by the data-load sequence
  - the zoom frames the walking-radius circle and only that: it is what the Nearby screen is about, it is centred on you, and it is a circle — so the camera holds still as you turn, and only moves when the circle does (you move, the radius changes, the tilt angle changes, or the map area resizes)
  - fast movement (walking, train) never causes the user or their nearest items to disappear from the map
- In nearby heading-up mode, flat (2D) puts you dead centre with the whole walking-radius circle on screen and the four corners falling outside it; as the phone tilts into 3D the camera shifts you right down toward the bottom edge to give the screen to what is in front of you, frames the half of the circle ahead of you — the half 3D actually draws — and then zooms in past its sides, so you stand inside the walking radius looking down it rather than viewing it as a disc from outside. The zoom-in eases in with the tilt, so 2D still shows the whole circle and raising the phone never steps the view.
- Nearby ↔ selected-location transitions use a single eased ~500 ms camera move; both directions wait for the inspector layout transition to settle before measuring the visible map area, and heading-up rotation/pan/zoom start together so the map never snaps through an intermediate framing.
- With minimized inspector: auto-reposition is paused.
  - user can pan/zoom freely
  - GPS updates/drag/zoom/resize must not force recenter
- On expand from minimized: recenter once to user + selected target while preserving current zoom intent.
- View transitions should animate.

## Zoom and Input Constraints

- Disable browser/page pinch zoom and ctrl+wheel zoom.
- Map zoom is controlled only by map interactions (wheel/drag) — there is no on-screen zoom or "home/fit" button in the main map UI.
- **On a laptop the wheel and the trackpad do what the phone's pinch does.** On every screen that draws the walking-radius ring (Nearby, Filters, Settings, Report), a scroll wheel or a trackpad pinch resizes that ring — scrolling in closes it, scrolling out widens it — and the map zooms with it, because the Nearby camera frames the ring and nothing else. A wheel notch takes the same step the old map zoom did; a trackpad pinch, which Chrome and Firefox report as a ctrl+wheel in much smaller deltas, is scaled up so a whole pinch moves the ring a whole pinch's worth (Safari sends its own pinch events instead, and they are handled too). The gesture ends a fraction of a second after the last event, with the same settling animation and the same "nothing closer to show" limit notice the two-finger pinch has. Over a real selection, which replaces that view, the wheel still zooms the map as before.
- On the plain Nearby screen, a two-finger pinch instead resizes the walking radius continuously (spread to shrink it, pinch together to grow it, no fixed stops); the map then re-fits to show the radius/nearby items. The radius cannot be pinched smaller than the distance to the nearest real item (plus a buffer) — pinning there shows a transient "nothing closer to show" notice instead of shrinking to an empty view. That limit is the nearest item itself, not a fixed minute: with a find closer than a minute's walk the pinch keeps closing in, down to a 15-second (~21 m) ring, and the map zooms in with it. Radii under a minute read as seconds ("15 sec"). See "Browsing another spot" below and "Pinch-to-resize the radius" in `spec-data-rendering.md`.

## Nearest and Filter Behavior

- Overview lists nearest items across active types.
- **The list is a heads-up view, not a distance table.** Items are ranked by how near they are *and* by whether you are facing them: of two finds the same walk away, the one in front of you is listed above the one behind you. Distance still leads — something at your back only drops below something more than twice as far ahead — and the ranking is applied before the list is capped, so a find you are walking straight at can reach the list instead of being crowded out by closer ones over your shoulder. Turning on the spot re-orders the list (with the same animated reorder GPS movement uses), but only once you have genuinely turned, so it never shuffles under your thumb as the compass drifts. Without a compass the list is plain nearest-first.
- If nothing is found within the selected walking-radius range, the nearest list shows the closest available item for each active type and displays a notice explaining that no matches were found within the selected walking time.
- **The radius widens itself back out as you walk.** A radius closed right down onto one find is an empty circle once you have walked away from it, so any position fix that leaves nothing inside the ring grows it back to just past whatever is nearest now, and the map zooms out to match. Only ever outwards, and only as far as it has to: a wide radius you chose is never pulled in, and a ring that still has something in it is left exactly as you set it.
- A first-visit link that already selects a location via a recognized URL hash (for example, `/nearby#tree=<key>`) skips the onboarding overlay, so the linked location opens directly. This does not mark onboarding as complete; it remains available when the reader later visits plain Nearby.
- **Onboarding (first visit):** On first visit (`forest-finds-onboarding-v1` not in localStorage) to the plain Nearby screen, the map opens immediately and a non-blocking card in the inspector chrome asks for location and cookies while map data continues loading. A landing-page arrival — a `/nearby/<slug>` page's own path, a `/find/<slug>/` business page's own path (not `/find/events/`, which has no single business of its own to land on), or a first-touch `?show=` link (`isLandingPageArrival()`, `js/app.js`) — uses the same non-blocking card even on a first-ever visit: that reader already arrived with their own category, or their own exact business, picked for them. The first-run card's **Enable location & cookies** action records location and usage-analytics choices together; **Maybe later** records both as declined. After that it offers **Set up my map** in the same inspector slot. Only the explicit setup action opens the guided onboarding dialog. “Explore first” leaves the map usable and records that setup was declined, so the invitation does not return on the next visit. The dialog contains a welcome screen followed by one screen per filter group (Nature, Food, Transport, History, Locations, Stories). Each category screen shows all subfilters as toggle chips (the interesting low-density defaults are Trees, Cows, Events, Pubs & bars, Churches and Campsites); the user deselects anything unwanted. **Back** returns from the first category screen to the welcome screen. A skip option is available on every category screen except the last, where the "Next" button becomes "Done" and finishes onboarding directly. On completion (or skip), selected filters are saved and onboarding is marked done. Implemented in `js/onboarding.js` + `css/onboarding.css`. **Icon performance:** All `data/icons/` PNGs (excluding PWA manifest icons) are capped at 256×256px — sufficient for the largest canvas draw size at retina zoom — reducing per-icon sizes from 400KB–1.4MB to under 100KB. `pin.png` and `trees/logo.png` are preloaded via `<link rel="preload">` in `app.html`. Each step also eagerly preloads the next step's icons via `new Image()` so images are in-flight while the user reads the current screen.
- **Map setup from Nearby:** The inline stacked-layers control is labelled **Map setup** rather than Filters. It opens the existing guided onboarding dialog in filter mode: the first step explains that categories control visible pins and the Nearby list, previews the currently selected categories with their icons, and starts with those choices selected. Changes are staged locally, **Cancel changes** or clicking the lightly transparent, blurred backdrop returns to Nearby without saving, and **Done** applies the new set once. The compatibility route `/nearby/filter` opens the same flow, so older links continue to work without reviving the removed live filter panel.
- **Location on a returning visit:** boot requests a position in parallel with map data loading — so the map usually opens centred on the user — but only when that request cannot put an unexplained system prompt on screen: the permission is already granted, or this person turned location on in the app before (`bootMayRequestLocation()`, `js/app.js`). Otherwise the map opens on `DEFAULT_LOCATION` and the app asks in its own words first ("Permissions and Consent" below). Immediately after a successful fix, compass permission follows: non-iOS browsers auto-grant; iOS Safari only allows `DeviceOrientationEvent.requestPermission` from a real tap, so it is asked from the same tap that asked for location, and otherwise offered by the "Enable compass" card. **Generated `/nearby/<slug>/` pages and bare `/nearby`'s static index render `#consentBanner` un-hidden** (`scripts/generate-find-pages.js`), so the location ask is on screen before JS runs and reserves its layout space from the first paint instead of JS inserting it after boot and pushing the Nearby list down. `boot()` hides it synchronously when the answer is already known (not a first-run card, not a landing arrival, or both questions answered), and otherwise as soon as the permission state has answered, so a returning visitor never sees it flash on and off.
- **No real location fix:** denied, timed out, unsupported, or skipped in the first-run card — the map still opens usable rather than bare. `applyDefaultLocation()` (`js/app.js`) stands in with `DEFAULT_LOCATION`, a well-known central forest spot (High Beach), run through the same pipeline a real fix uses (nearest-tree/cow/pub/etc, the Nearby list, the walking-radius ring), so everything works immediately; the walking radius starts at the ordinary 5-minute default (`DEFAULT_LOCATION_WALKING_DISTANCE_MINUTES`); an explicit `?radius=` or a `/nearby/<slug>` landing page's own 30-minute default still wins (see "URL / navigation state" below). The stand-in is flagged (`state.userLocation.isDefault`) so `hasRealLocation()` (`js/nav.js`) can tell it apart from an actual fix: the "You" dot and the facing-direction radar cone never draw for it (they would misrepresent where the reader actually is), and the locate button keep treating "no real fix" as the reason to ask for one, rather than being satisfied by the stand-in. **The invite shown alongside it (`offerLocationInvite()`/`showLocationInviteBanner()`, `js/app.js`) is a dismissible, non-blocking card — `#locationInviteBanner`, the same inline, in-chrome treatment `showConsentBanner()`'s own card uses — never a full-screen modal**: the map and Nearby list behind it are already usable, so there is no reason to cover the whole screen. When it is shown, and when it is not, is in "Permissions and Consent" below. A `/nearby/<slug>` landing page takes the same stand-in too, rather than listing its whole category unsorted: it already defaults its own walking radius to 30 minutes regardless of location (see "URL / navigation state" below), so this just gives that radius a real centre to measure distance from. **Unlike the dismissible invite banner, which the reader can tap away and never see again, the Nearby heading's own type line carries a persistent explanation** (`overviewHeadingText()`, `js/app.js`) — a trailing "of High Beach"/"around High Beach" suffix appended to whichever count/radius phrasing is already showing — for as long as the stand-in is what the list is actually measuring from, so dismissing the banner never leaves the list's own High Beach centring unexplained. This used to be a separate, persistent sentence at the top of the Nearby list body (`overviewNearestHtml()`) — folded into the heading's own type line instead, since the two were saying the same thing one above the other. **On a `/nearby/<slug>/` landing the server-rendered list is kept on screen throughout boot** — no rebuild, and no inspector slide-in — until a real fix arrives (`_serverRenderedNearbyList`, `js/inspector.js`). When a reader taps a location button on that landing, the list is replaced by a "Requesting your location…" state; a granted fix rebuilds it around them, and a refusal or error restores the High Beach default list.
- **Compass permission — iOS per-session requirement:** On iOS, `DeviceOrientationEvent.requestPermission()` must be called from a synchronous user-gesture handler every page load before orientation events are fired — even when the user has previously granted permission. The stored `forest-finds-compass-permission-v1` value of `"granted"` is therefore treated as `"unknown"` at boot on iOS-like browsers (those where `DeviceOrientationEvent.requestPermission` is a function), so the compass gate is shown and the per-session call happens from the gate button click (a real user gesture). On non-iOS browsers no user gesture is required and the stored value is used as-is.
- **Default filters:** On first visit, **Trees**, **Cows**, **Events**, **Pubs & bars**, **Churches** and **Campsites** are pre-selected in the onboarding chip screen. All other subfilters start deselected. If onboarding is skipped without changes, the same six filters are active.
- **Filter persistence:** Active filters and expanded groups are saved to `localStorage` under `forest-finds-filter-state-v1` and restored on next visit.
- Supported overview filter groups and subfilters:
  - **Nature:** trees, cows, waymarked trails, ponds & streams
  - **Food:** pubs & bars, restaurants, cafés, shops
  - **Transport:** bus stops, underground stations, national rail stations, car parks
  - **History:** historic places, royal history, WWII sites, social history, plaques, blue plaques
  - **Locations:** celebrity associations, science, education, medicine, literature, theatre, politics, art, churches
  - **Stories:** legends, film/TV locations
- **Events:** events (a single subfilter — fairs, guided walks, markets; see "Events" above)
- **Note:** Paths, hydrology, nature designations, and buildings are always visible as base layers and not included in filters.
- Filters are multi-select within and across groups.
- Selecting a top-level group enables all subfilters within that group.
- Deselecting all filters shows all content.
- Nearest list entries show icon/type, distance, and directional cue; the nearby header uses generated nearby/walking PNG icons from `data/icons/`, and bus entries use the generated bus icon.
- **Keyboard navigation:** with focus on a list row (or, on the Search screen, the search field), <kbd>↓</kbd>/<kbd>↑</kbd> move focus to the next/previous row in whichever list — Nearby or Search results — is currently shown; <kbd>↑</kbd> from the first row returns focus to the search field on Search, and is a no-op on Nearby (which has no field above its list). <kbd>Enter</kbd> on a focused row opens it, the same as a click or tap — no extra handling is needed for that, since a focused `<button>` already activates on Enter. Arrow keys elsewhere in the inspector (the Filter/Settings/Report screens, for instance) are untouched.
- **Browsing another spot:** tapping open map ground — anywhere, at any distance, including inside the current walking radius — moves the Nearby view to that spot: the walking-radius circle, nearest list, and camera all pivot there, marked on the map with a small amber ring distinct from the real "You" dot, which never moves. A "Use my location" control in the nearby list returns to the real location. The same tap made while a location is selected, or while a group of pins is expanded, leaves that view and returns to Nearby focused on the tapped spot. Only Filter/Settings/Report are exempt: a map tap neither dismisses them nor moves the anchor.
- **What a map tap does not relocate to:** *inside* the walking-radius ring, taps that land on a highlighted location (tree, place, cow, waymarked trail) or on a street open that location instead, as they always have. Background polygons (forest, nature designations, water bodies) are not selectable at all — tapping inside the forest is a tap on open ground.
- **Relocating stays in the nearby view, and the circle does not move.** Moving the browse anchor animates by sliding the *map* behind a stationary radius circle over about half a second, rather than throwing the circle across the screen and chasing it with the camera. The view keeps the same zoom, the same ring size and the same framing, so repeated browsing steps from place to place rather than progressively zooming out. Every further tap outside the (now moved) ring relocates again.
- **In 3D, the whole walking radius stays on screen when browsing.** Full 3D normally lets the ground behind you run off the bottom edge, because you are standing at the pivot facing forward. A browsed spot is not somewhere you are standing, so that stops applying: the pivot sits at the centre of the map area instead of near its bottom, the entire radius circle is framed inside the available map area, and the content inside it (roads, paths, full-size pins) is no longer hidden behind you. Standing in your own surroundings is unchanged.
- **The new surroundings arrive after the move, not during it.** While the map is sliding, the highlighted pins and the lines out to them are held back, then fade in quickly once it settles — otherwise they sweep across moving terrain and the whole half-second reads as jitter. Your own "You" dot is never hidden.
- **A pointer shows which way you are.** When browsing takes the "You" dot off screen, a blue arrow labelled `You · {distance}` sits on the radius circle's edge on the bearing to your real position, pointing out at it. It lies flat on the ground with the circle rather than floating over the map, so it foreshortens with the 3D view. Tapping it returns to your real location. It is only shown while you are outside the circle.
- **Outside the ring, everything relocates.** The ring is the nearest area, so on the Nearby screen any tap beyond it moves the nearest area there whatever it landed on — otherwise a tap into the out-of-radius corners of the screen opened a navigation view to whichever road or trail happened to run through there, since those lines are drawn right across the map. Once a location is selected there is no ring on screen and this does not apply.

### Nearest count control

- A nearest-items dropdown select is shown below the nearest list.
- Options: 3, 5, 10, 15, 20, 25 items.
- Default: 10.
- Changing the selection updates all of the following in sync:
  - number of nearest items listed
  - number of highlighted targets on map
  - camera fit to keep all overview targets visible

### Nearby list footer

- The nearby list shows only the nearest items and the walking-radius summary header.
- The walking distance selector and app version are **not** shown in the nearby list.

## Search Screen

One search box over everything the map draws, reached from the magnifier in the inspector's
main navigation (`#searchToggle`) or directly at `/app#search`. It replaced the tree-number-only
search that used to float over the map on mobile: a tree tag is one of the things it finds, not
the only one.

- **What it searches:** veteran trees (common or Latin species name, generic “tree”/“trees”
  type, and tag number), places
  (name, category group and subcategory, and useful source metadata such as address and OSM
  classification), roads, waymarked trails, water features, railway lines, and the live cows by
  serial number. This means searches such as “Food”, “Cafés”, or a venue's street can discover
  a location even when its name is unknown. Roads and railway lines are only in reach this way —
  the Nearby list does not carry them.
- **Results use the Nearby list's exact row layout** (`.nearest-item`): its icon column and
  name/meta content column, walk chip, type label and direction arrow. A find therefore looks
  the same whether it was searched for or walked past. Choosing one opens exactly the screen a
  map tap or a deep link would, through the same `SELECTION_ROUTES` table, and the map animates
  to it.
- **Matching ignores case, accents and punctuation**, so "st marys" finds "St Mary's" and
  "cafe" finds "Café". Each field is ranked on its own — exact, then prefix, then whole-word,
  then substring — so a tree's tag can match exactly without its species name diluting it. A bare
  species word ("oak", "holly", "hornbeam") whole-word-matches every tree whose common name
  contains it ("English Oak", "Holm Oak", …), so searching a type of tree returns every nearby
  tree of that kind, not only one searched by its exact full name. A multi-word query that no
  single field answers still matches when every word appears somewhere in the entry. Equal
  matches are ordered by distance from the Nearby origin.
- **A name the map repeats is not allowed to fill the list.** A street arrives from
  OpenStreetMap as many separate ways, so a line feature (road, trail, water, railway) is listed
  once — the nearest piece of it. Points are capped rather than collapsed: the eight bus stops
  called "Forest Road" are three rows, leaving room for the street itself. At most 30 results.
- **It works with no location fix**: matches are still listed, without distances or walk times.
- Typing only re-renders the results list, never the field, so focus and the caret survive; the
  results are re-rendered at most once per animation frame.
- **Keyboard: <kbd>Enter</kbd> in the field opens the top result** (the one the list is already
  sorted to put under the user's thumb) without needing to arrow down to it first, dismissing the
  on-screen keyboard on a phone. <kbd>↓</kbd> from the field moves focus into the list instead,
  for stepping to a result other than the first — see "Keyboard navigation" above, which this
  shares with the Nearby list.
- **The map highlights the results, not just the list.** The top 10 matches (nearest first) are drawn with their ordinary map pins — no separate ring or highlight styling, and not dimmed or hidden by whatever category filters are active — while everything else in those categories is left off the map. Search offers no control of its own to clear those filters; the Filters icon next to the Nearby heading is one tap away instead. The camera fits itself to those matches plus the user's own position, live as the query changes, rather than showing the same fixed view as the Filter, Settings and Feedback screens. See "Search's camera and highlighting" in `spec/spec-data-rendering.md` for the mechanics.

## Settings Screen

- Accessible via the generated settings icon button in the inspector header.
- Contains a **Walking radius** control: a slider (its floor to 30 min, half-minute steps — quarter-minute when its floor is under a minute — with tick marks at the old preset stops) choosing how far to walk when listing nearby places. Its lower bound tracks the distance to the nearest real item so it can't be dragged down to a radius with nothing in it; where that is closer than a minute's walk the slider opens up the sub-minute end and shows the value in seconds. Sitting at that floor shows a "nothing closer to show nearby" note. The tick marks are drawn as separate positioned elements (`.walk-radius-tick`), not the input's native `list` rendering: `appearance: none` (needed to restyle the track/thumb) silently discards a browser's own datalist tick marks too, so they have to be reimplemented to be visible at all.
- Contains a **Map** section with a **3D map** switch (`#map3dToggle`, off by default, remembered on the device) that enables 3D tilt mode — see "3D tilt mode" below. Beneath the switch, a small screenshot of the tilted map (`css/img/map-3d-preview.webp`, in `APP_SHELL` so it shows offline) shows what it does. The section (`#map3dSetting`) is only shown once the device has reported a finite `DeviceOrientationEvent.beta` (`state.motionSensorSeen`, remembered as `ff-motion-sensor-v1`), so a laptop, which never sends one, is not offered a switch that can do nothing. Chrome's single all-null orientation event on desktop does not count. If Settings is already open when the first reading arrives, the section appears in place. On iOS no reading arrives until motion permission is granted, so the switch appears after that.
- Contains an **About** section displaying the current app version (e.g. `v80`; `dev-v80` when served by the local dev server — see "Local dev flag" in `spec/glossary.md`) and three refresh buttons: **Refresh data**, **Refresh app**, and **Refresh both**. Placed before Privacy so the troubleshooting controls people open Settings for aren't the last thing in the sheet.
- Under the version, an **update status** line (`#appUpdateStatus`, rendered by `js/nav.js`) says where the app stands, with one action button:
  - before any check this session: "Updates are checked automatically while the app is open." — **Check for updates**
  - checking: "Checking for updates…" — button disabled
  - nothing newer: "You have the latest version. Checked at HH:MM." — **Check for updates**
  - a newer release installing, or its waiting worker fetching its map data: "Downloading update vN… You can keep using the app while it finishes." — button disabled. The incoming version is read from the new `forest-finds-app-vN` cache, which install opens first.
  - fully downloaded: "Update vN has downloaded. Restart to start using it." — **Restart now** (filled)
  - check or download failed: "Couldn't finish checking for updates. Your current app still works offline." — **Try again**
  - offline (instead of the idle/latest/failed/checking states): "You're offline. Updates are checked when you're back online." — button disabled

  **Check for updates** skips the 10-minute throttle on `requestAppUpdateCheck`. The line is not shown without a service worker.
- The About section also shows the person's **Tester ID** (a 10-character hash, with a Copy button) to give the admin for early access (see `spec/spec-community.md`, Feature gate).
- **Refresh buttons**: all three are transactional. The current offline cache is never deleted or unregistered before a replacement is known to be available:
  - **Refresh data** — force-downloads and validates the complete offline data list into the existing data cache, then reloads. A failed or partial download leaves the current data in place.
  - **Refresh app** — unregisters the service worker, deletes the cached app, then reloads the page so it restarts on a fresh copy from the network. The update status's **Restart now** keeps its download-first guard.
  - **Refresh both** — completes a data download, then clears the app and data caches and reloads. Needs a connection.
  - **`?nuke=true` URL parameter** — retained as a troubleshooting alias for the safe **Refresh both** check. It removes the parameter, preserves all caches on failure, and keeps other query parameters.
  - Caches belonging to other apps are never touched. All three are disabled, with one shared inline note, while offline; a false online signal is also handled safely because refresh failure never clears the working cache.
- When the background data sync (see `spec/spec-data-fetching.md`) has cached newer map data, the About section shows a "New map data has been downloaded. Reload now to see it." note with an inline **Reload now** action (`#dataUpdateReloadButton`, a plain `location.reload()` — lighter than routing the user through one of the Refresh buttons, which also clear caches that don't need clearing here) and the settings icon carries the same update marker used for a pending app update.
- Contains a **Privacy** section with one row per question (see "Permissions and Consent"): **Location** — on/off, with **Use my location** (`#settingsLocateButton`) as the way back for anyone who said not now, replaced by an explanation (`#locationBlockedNote`) when the permission is blocked in browser or phone settings, where a button could not work; answering there updates the row in place rather than leaving Settings. **Usage analytics** — on/off, and one toggle (`#analyticsToggle`) that sets usage data and analytics cookies together (`js/app.js` `settingsFormHtml`/`setupSettingsLocationRow`). There is no separate cookie control in the app.
- Changing the walking radius stays on the settings screen, immediately animates the map to fit the new radius, updates the nearby list and nearest tree selection, and keeps the walking radius ring visible.
- Opening Settings shows the same map view as the Filter and Feedback screens (see below).

## Feedback Screen

- Accessible via the generated feedback icon button in the inspector header, and by a direct link to `#report` (see "URL hash / navigation state" above).
- Welcomes feedback, bug reports, and anything strange users notice, explaining that it helps improve the data for everyone; submissions are tracked as GitHub issues.
- The current app version is displayed in the form so the user can see which version will be reported.
- The app version, user agent, page URL, and optional geolocation are included in every submission payload.
- Reports may include one optional photo. On phones the photo control prefers the rear camera, making it easy to photograph a tree tag in place; browsers without that camera option offer their usual image picker. The app reduces large camera images before submission, stores the attachment in the report-photo Blob store, and adds its link to the filed GitHub issue.
- **Duplicate-submission prevention:** the Submit button is disabled and re-entrant submits are ignored for the duration of a request, so a double-tap cannot fire two GitHub issue creations. Each report also carries a `requestId` generated once and persisted (`localStorage`) until the report succeeds, so a retry after a dropped/failed response (e.g. flaky connection) reuses the same ID instead of minting a new one. The `report-missing-data` Netlify function searches existing GitHub issues for that ID before creating a new one and returns the existing issue if found, rather than filing a duplicate.
- On iOS Safari, the on-screen keyboard opening over the report textarea does not obscure it — the inspector sheet repositions using the `VisualViewport` API to keep the focused field visible above the keyboard, in both portrait and landscape (see "Keyboard avoidance" under Inspector Panel in `spec-data-rendering.md`).
- Opening Feedback shows the same map view as the Filter and Settings screens (see below).

### Reporting a problem with a specific location

- A tree's or landmark's detail view offers a "Noticed a problem with this location?" link (e.g. below its details), letting a user flag that item's own data as wrong — a mis-plotted landmark, a tree in the wrong spot — without leaving the detail screen or losing their place.
- Tapping it expands an inline form in place: a textarea, optional camera/photo control, and Submit/Cancel buttons, styled and behaving like the full Feedback form but never navigating away from the selected item. Cancel collapses it back to the link.
- Submission goes to the same `report-missing-data` Netlify function as the Feedback form, as `reportType: "location-issue"`: the `location` sent is the flagged item's own coordinates, not the reporter's GPS fix, and the payload also carries a `locationContext` (the item's type and name) so the filed GitHub issue names exactly what was flagged. Double-tap/retry protection matches the Feedback form's mechanism (disabled Submit button, in-flight guard, stable `requestId` reused on retry) but the ID is not persisted to `localStorage` — this form is opened, filled and submitted (or abandoned) in one sitting, unlike the Feedback form's saved draft.
- Only offered for point-feature, curated-data items with a fixed position to be wrong about — veteran trees and landmarks. Not offered for cows (a live GPS position, not curated data) or line/area features without a single point (paths, roads, railways, water).

## Secondary Screen Map Consistency

The Search, Filter, Settings, and Feedback screens all display the same fixed map view in the background, so switching between them never changes what's shown:

- The camera zooms out past the walking radius far enough to reach the nearest match of every selected filter — even when each one is a long walk outside the radius — so the screen where you pick what to look for actually shows that it exists and which way it lies (survey mode — see `spec-data-rendering.md`). With no filters selected there is nothing extra to reach for and the view is the plain walking-radius framing.
- The walking-radius ring is always visible on all four screens, and everything that removes or
  adjusts it works from them: the "Use my location" control that clears a browse anchor stays on
  screen, a tap on open ground moves the anchor (without dismissing the screen), and the
  two-finger pinch resizes the radius. The nearby list and map pins read from the same browse
  anchor the ring is drawn around.
- The view keeps updating live with GPS movement and heading-up compass rotation — including full 3D tilt — while any of the four screens is open, exactly as on the nearby overview screen. "Identical view across the four screens" refers to pan/zoom framing only; the live tilt angle (driven by phone orientation) is not part of that invariant and can differ moment-to-moment like it does everywhere else tilt is active.
- Any change to the view (opening a screen, GPS movement, resize) animates smoothly rather than snapping.

## Compass and Direction Guidance

- Use device orientation when available.
- **Heading source ranking (`orientationHeadingSource`):** not every orientation event carries a heading that means anything. Chrome on Android fires *two* streams at once — `deviceorientationabsolute`, whose `alpha` is referenced to magnetic north, and `deviceorientation`, whose `alpha` starts from an arbitrary zero chosen when the sensor started and drifts from there — and both land in the same `onDeviceOrientation` handler. iOS ships neither flag and exposes the real bearing as `webkitCompassHeading` instead, leaving its own `alpha` relative. Treating all of them as the same number made `compassHeadingTarget` flip between a true bearing and an arbitrary one many times a second: the smoothed heading then sat somewhere between the two, which reads as "a bit off" while the streams happen to agree and "completely wrong" once they have drifted apart. It also meant the calibration gate below never saw four readings agree within 6°, so a cold start always fell through its 6 s safety valve and trusted whatever mix it was holding. Sources are therefore ranked — `HEADING_SOURCE_ABSOLUTE` (a finite `webkitCompassHeading`, or `alpha` with `event.absolute === true` / on a `deviceorientationabsolute` event) above `HEADING_SOURCE_RELATIVE` (any other finite `alpha`) above `HEADING_SOURCE_NONE` — and `state.compassHeadingSource` remembers the best one seen. A reading from a worse source is dropped outright: it does not move the heading target and, deliberately, does not touch `state.compassLastEventAt` either, so staleness is judged on the stream actually in use and a live relative stream cannot mask a dead absolute one. Ranked rather than simply requiring absolute so a browser that only ever fires the relative event still gets a compass — a drifting heading is worse than a true one but much better than none. When a better source first arrives, everything the worse one produced is thrown away rather than averaged with it (`discardCompassHeadingFromWorseSource`): the two measure from different zeroes, so the buffered calibration samples are cleared, any already-trusted heading is dropped, and the map falls back to north-up and re-gates rather than holding a bearing it now knows is arbitrary. In practice the two Android streams start within a frame or two of each other, so this usually only discards a couple of samples. The ranking is never lowered again — if the north-referenced stream dies, `recoverStalledCompass` below handles it as the staleness it is.
- **iOS heading validity (`iosCompassHeadingIsValid`):** Safari reports the magnetometer's confidence in `event.webkitCompassAccuracy` alongside every heading, and Apple documents a **negative** value as meaning the heading is not valid at all — not merely imprecise; the number sitting in `webkitCompassHeading` next to it is arbitrary. Nothing read this, so an iPhone whose magnetometer had not settled (near a car dashboard, in a magnetic case, in the first moments after the screen woke) handed a confident-looking but meaningless bearing straight to the heading and the map rotated to it. That is the same "completely wrong" the Android stream mixing above causes, reached by a different route, and it is why the fault was reported on iPhones as well. Such an event now scores `HEADING_SOURCE_NONE`. Returning `NONE` rather than falling through to `event.alpha` is deliberate: iOS's `alpha` is measured from wherever the device happened to be when the sensor started rather than from north — that is the whole reason `webkitCompassHeading` exists — so it is no better. The event still records `state.orientationLastEventAt`, which is exactly what makes `recoverStalledCompass` surface the figure-8 calibration banner instead of thrashing listeners: the sensor is alive, its magnetometer wants calibrating, and physical movement is the only thing that fixes it. A missing or non-finite accuracy (every non-iOS browser, and older iOS) is not evidence of a bad heading and is trusted as before. **Valid but poor accuracy is deliberately not filtered:** a heading a few degrees out is still a heading, typical good values vary by handset, and no threshold separating "fine" from "poor" could be validated without real hardware — so it remains an unquantified contributor to the "sometimes it's just a bit off" reports, alongside the screen-orientation gap below.
- **Screen orientation is not compensated for.** Both `alpha` and `webkitCompassHeading` are measured in the device's own frame (the top edge of the handset), not the frame the page is rendered in, so a phone used in landscape reads 90° out. The app does not correct for this: the manifest requests `"orientation": "portrait"` and the CSS keeps the phone layout in landscape, so the supported posture is portrait. Adding the correction needs the sign of `screen.orientation.angle` verified on real hardware in both landscape directions — getting it backwards turns a 90° error into a 180° one.
- **Compass calibration gate:** The first raw headings after load (or after a heading is cleared by the staleness recovery below) are buffered rather than trusted — a magnetometer that has not settled reports headings that snap the map to a wrong rotation. Readings are trusted, and rotation begins, once at least `COMPASS_CALIBRATION_MIN_SAMPLES` (4) readings within a 900 ms trailing window agree to within `COMPASS_CALIBRATION_STABLE_SPREAD_DEG` (6°). A "move your phone" prompt appears after 1.5 s of instability, and `COMPASS_CALIBRATION_MAX_WAIT_MS` (6 s) is a safety valve so a device that never settles is not blocked from heading-up forever. While calibration runs, the zoom/anchor fit still tracks the user (`startCalibrationViewportSync`); only rotation waits.
- **Compass staleness recovery:** iOS stops delivering `deviceorientation` while the screen is off or the tab is backgrounded and does not reliably resume when it comes back, so a compass that has gone quiet is treated as a recoverable fault rather than a permanent state. Recovery is a single shared routine (`recoverStalledCompass`) driven from three places: `visibilitychange` → visible, `pageshow` **with `event.persisted`** (a bfcache restore never fires `visibilitychange`; the unguarded event also fires on every ordinary load, which would start a GPS watch before boot's own flow asked for one), and a foreground watchdog interval (`SENSOR_WATCHDOG_INTERVAL_MS`, 10 s) that also re-runs the GPS watch check. It must be repeatable, not one-shot: driving it only from `visibilitychange` gave the sensor exactly one chance to come back per return to the foreground, and a sensor that came back later (or not at all) left the map frozen on a stale heading — or stuck north-up with no tilt, since `tiltActive()` is gated on `headingUpActive()` — until the page was reloaded. When no heading-bearing event has arrived for `COMPASS_STALE_MS` (15 s), the trusted heading is dropped (so the map falls back to north-up rather than rendering a frozen rotation as if it were live), calibration is reset so new readings are re-gated, and the orientation listeners are removed and re-added — the remove-then-add is what nudges the iOS sensor back into firing; a bare `addEventListener` would be a no-op for an already-registered handler. `state.orientationLastEventAt` (set for *every* orientation event, and written by nothing but `onDeviceOrientation`) is tracked separately from `state.compassLastEventAt` (heading-bearing events only) so the two failure modes are distinguished: if orientation events are still arriving but carry no heading, the sensor is alive and its magnetometer needs physical movement, so the calibration prompt is shown and the listeners are left alone rather than thrashed. Recovery never runs while the page is hidden, never runs on a device whose compass has never fired (desktop, permission not granted), and never runs when heading state was set directly without any event firing — which also keeps the watchdog from waking mid-assertion in the e2e specs that diff two consecutive canvas draws. Window `focus` was tried as a fourth trigger and removed: it fires on every tab focus, so the resume work ran constantly instead of on an actual resume.
- Smooth heading updates for:
  - selected-location title-row compass arrow
  - nearest-list directional arrows
- In selected-location navigation, the map becomes heading-up whenever compass heading is available, regardless of whether the inspector is expanded or minimized: the device-facing direction is always toward the top of the screen, and the map rotates as the user turns. The user's vertical anchor is no longer fixed at 62% down the visible area (88% at max tilt) -- `headingUpAnchorFraction(true)` (selected-navigation only; nearby's anchor is unaffected) mirrors that base anchor around the screen's vertical centre based on `selectedNavigationTargetBearingOffsetRadians()`, the destination's bearing relative to straight ahead: dead-ahead keeps the plain anchor (user low, most of the screen shows the room ahead of them), dead-behind mirrors it to `1 - anchor` (user high, most of the screen now shows the room behind them, where the destination actually is), and a destination directly to a side settles at the screen's vertical centre -- so the fixed anchor no longer wastes most of the screen on empty space ahead when the route is actually behind the user. Separately, the zoom fit itself (`maxHeadingUpNavigationScale` / `maxScaleForHeadingUpPoints`) no longer excludes the selected destination from its fit calculation just because it's currently behind the user during 3D tilt (nearby mode's fit is unaffected and still excludes behind-the-user points) -- `maxScaleForHeadingUpPoints` takes an `excludeBehindDuringTilt` option, and selected-navigation now passes `false`, so the origin, route, and destination are all fit onto the available map space together rather than the destination being invisible off the bottom edge. The selected location must stay inside the visible map area; heading-up navigation reduces zoom when needed to keep it visible. Expanding the inspector panel while heading-up navigation is active re-runs this real scale fit (`alignHeadingUpNavigationViewport`) against the inspector's newly-expanded footprint, rather than just recentring at whatever scale was already in effect (`setInspectorMinimized`, `js/nav.js`) -- without this, a fit computed while the inspector was minimized (a bigger available area) was never corrected once the inspector grew back to its full size, so a destination positioned low on screen (especially likely now that a behind-the-user destination can occupy most of the screen below the anchor) could end up rendered behind the now-larger panel. North-up selected navigation (no compass heading yet) is unaffected and keeps the plain recentre-at-current-scale behaviour.
- In nearby (overview) mode, the map also becomes heading-up whenever user location and compass heading are available: the device-facing direction is always toward the top of the screen, the user stays anchored at the vertical center (50%), and the map rotates in real-time as the user turns. Map icons always point from top to bottom of screen. The nearby button is in the active state during this mode.
- While heading-up mode is active (either nearby or selected-navigation), compass-only rotation updates should rotate the existing map canvas around the user point and redraw only the lightweight user/radar overlay rather than redrawing all map layers every animation frame.
- The CSS rotation transform must always be re-applied after `alignHeadingUpNavigationViewport()` (which clears it for clean layout measurement) and after every full canvas redraw via a `postDraw()` hook — preventing the one-frame flash where the map appears un-rotated.
- The tilt-threshold `resizeCanvas()` call happens inside `prepareCanvasForDraw()` (not the compass tick), so the canvas resize and redraw are atomic within the same rAF callback and no blank-canvas frame is ever composited.
- **3D tilt mode:** Opt-in. Off by default; switched on by the **3D map** toggle in Settings (`state.map3dEnabled`, stored as `ff-map-3d-v1`). While off, `tiltActive()` is always false and `tiltInfluence()` is 0, so pitching the phone leaves the map flat (heading-up still applies); beta is still tracked because the compass deadband reads it. Switching it off mid-tilt flattens the map immediately. Once on, it is available on every screen — the plain nearby overview, actively navigating to a selected item, and the filter panel, settings, and feedback screens all allow full 3D tilt (see `tiltAllowedForCurrentScreen()` in `spec-data-rendering.md`), with no exceptions — returning to the nearby overview from any screen (including a tilted navigation view or cluster-detail) no longer flattens tilt first; the camera re-fit animates while tilt continues to track live phone orientation. When heading-up is active, tilt allowed, and `DeviceOrientationEvent.beta` exceeds 12° (phone tilted from flat), the ground plane is projected in perspective around the user's on-screen position, so the area ahead recedes into the distance. The projection is applied in JS, per point, as the map is drawn (`worldToScreen()` -> `tiltProjectOffsets()`), not as a CSS transform on the finished bitmap — see "3D tilt projection" in `spec-data-rendering.md` for why that distinction is what makes the 3D view hold together at every angle. The tilt angle is proportional to beta: 12° = 0° rotateX, 85° = 75° rotateX (`TILT_ROTATEX_MAX`). The perspective (camera) distance is no longer a fixed constant — `tiltPerspectivePx()` derives it from the screen space actually available above the tilt pivot (`tiltAvailableAheadCssPx()`), so the ground-plane horizon reaches a consistent fraction of the visible map (`TILT_HORIZON_GROUND_RATIO`, 62%) regardless of device height, once at max tilt — instead of leaving a fixed-size CSS-px gap that read as proportionally more empty sky on taller screens. Critically, this is calibrated against the fixed `TILT_ROTATEX_MAX` reference angle (`TILT_HORIZON_REFERENCE_TAN`), not the live, ever-changing `tiltRotateXDeg()`: calibrating against the live angle instead shrinks the camera distance sharply at low/mid tilt (an early version of this fix did exactly that), which pulls in the perspective-divide singularity behind the user — pins, the radar, and road/path lines that far behind the pivot get a blown-up projected `scale`. The divide can no longer go negative or infinite in any case — `tiltProjectOffsets()` clips just short of the camera plane (`TILT_NEAR_PLANE_RATIO`) — but keeping the camera distance generous is still what stops content ballooning before that clip. Calibrating against the fixed reference angle keeps that safety margin at least as generous as the old fixed-900px system had, at every active tilt angle, while the ground-fraction target itself only applies exactly at max tilt (at lower tilt angles the ground fraction is naturally larger — more of the screen is ground, less is sky — matching how the geometry already behaved before this whole fix). The result is clamped to a sane range (`TILT_PERSPECTIVE_MIN_PX`–`TILT_PERSPECTIVE_MAX_PX`) for extreme viewport sizes. `tiltAvailableAheadCssPx()` uses `max(anchor, 1 - anchor)`, not the raw anchor fraction: for selected navigation, the anchor can itself be mirrored toward the top of the screen when the destination is behind the user (see the anchor-mirroring note above), and feeding that now-small mirrored anchor straight in would shrink the camera distance right along with it -- reintroducing the exact singularity-margin regression described above, via bearing this time instead of tilt angle. Using whichever side of the pivot is actually larger keeps the camera distance sized for the bigger reach regardless of which side of the pivot it's on, so mirroring the on-screen anchor position never on its own shrinks the safety margin. That alone still dips as low as 0.5 exactly when the destination is directly to a side (the mirrored anchor passes through the screen's 50% centre there), which is lower than the historically-safe `tiltRampedAnchor()` floor (the plain, pre-mirror ramped anchor, always >= 0.5) this calculation always used before bearing-based mirroring existed -- an ordinary, frequent case in real walking navigation, not just the dead-behind extreme. `tiltAvailableAheadCssPx()` therefore takes the max of the mirrored anchor, its complement, and `tiltRampedAnchor()`, restoring that safety margin across the whole bearing range. Beta is smoothed with an exponential filter (τ ≈ 1/4 s, slower than the compass heading filter) in the same animation loop as compass heading, so the pin/pointer collapse this drives (see `tiltInfluence()` below) eases in over time rather than snapping as the phone lifts through the flat dead-zone. Tilt never resizes the canvas: with the projection applied per point rather than to the bitmap, there is no canvas edge for perspective to expose, and the ground is drawn all the way to the horizon. The overlay canvas is kept flat (no CSS tilt); pin positions are projected mathematically via `worldToScreenForOverlayTilted` so pins appear upright (billboard) at the correct perspective depth. The user radar cone is also perspective-projected using `projectCanvasPoint` so its rings and direction line appear in the same 3D space as the terrain. When tilt is inactive, no projection is applied and plain 2D rotation resumes.
- Show route lines in selected mode only: user → selected target. Overview mode (Nearby,
  Filters, Settings, Feedback) draws none — the ambient dashed lines from the user to every
  nearby match were removed because a fan of dotted lines to a dozen pins crowded the map and
  implied a walk the user had never chosen. A drawn route line always means "this is the
  destination you selected".
- The selected-location compass arrow appears only when user location and a selected navigation target exist. It lives in the inspector title row, aligned to the far right edge of the modal and roughly three times the normal title-row arrow size; no separate top-of-screen title/distance box is shown.
- The user radar cone is drawn on the **main canvas** in non-tilt heading-up mode so the CSS `rotate` transform keeps it aligned. The cone's centre line always points in the direction the user is facing — straight up on screen in heading-up mode (any target selected or not), or at the absolute compass heading in flat/north-up mode; it never swings to point at the selected destination (that bearing is shown by the dotted route line instead). **In 3D tilt mode** (`tiltActive()` true), the radar moves to `#overlayCanvas` and each arc point is explicitly projected through `projectCanvasPoint` (the same shared projection as overlay pins and the terrain), drawing the cone as 24 line-segment steps so it appears to lie flat on the tilted ground plane instead of as a vertical fin.
- The user radar cone outer edge represents roughly 60 metres in front of the user's current GPS position at the current map zoom.
- In heading-up mode (nearby or selected), all overlay pins are drawn using a **depth-sorted painter's algorithm**: clusters from all types (trees, landmarks, cows, paths, water) are collected into a single list, sorted ascending by screen Y (distant items at the top of the screen first), then drawn in that order so nearer items always paint over farther ones. The selected item is drawn last via `drawSelectedOverlay` and is always on top.

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

### Event details

Show the event name, a "Happening now"/"Upcoming" status in place of a category label, the
formatted date/time range ("When"), a "More info" link to `sourceUrl` when present, and the
description. Shares the place detail layout (`showLandmarkDetails`) rather than a separate view.

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
- Events

## Attribution Rules

- OpenStreetMap attribution note is shown only when viewing details for OSM-sourced places.
- No global attribution note in overview or non-OSM contexts.
- Attribution target: `https://www.openstreetmap.org/copyright`

## Offline, Caching, and Refresh

- Service worker caches app shell and offline datasets in two separate caches as of 2026-09-04: `forest-finds-app-vN` (app code) and `forest-finds-data-vN` (data). This allows weekly data updates without re-downloading app code.
- Cache versions live in `js/app-cache-version.js` and `js/data-cache-version.js`. `.github/workflows/cache-version-bump.yml` runs after a merge to `main`, mints a short-lived token from the dedicated cache-version GitHub App, increments the applicable marker(s), and commits only those files; app changes and data changes therefore never create version-line conflicts in `sw.js`. The marker commit itself is excluded from the bump job, so it cannot trigger a second bump. Netlify skips the intermediate Git-triggered production build for those changes, then the workflow calls its dedicated build hook after the marker commit reaches `main`, so the only production deploy contains both changes together.
- Cow proxy endpoint bypasses service-worker caching.
- Cow data is cached in browser storage and refreshed on interval (every 5 minutes).

### Service Worker Update Flow

1. When a new SW version is detected (`updatefound` → `statechange: installed`), the new SW waits — it does **not** auto-activate via `skipWaiting()` in the install handler. A manual refresh check also leaves the current worker in place if downloading the replacement fails.
2. A red dot badge appears on the settings toggle button (always visible, not just inside the settings panel).
3. Inside the settings panel, the update status line shows the download, then "has downloaded" with **Restart now** (see "Settings Screen").
4. Restarting from the banner or from Settings first confirms that a fully installed waiting worker is available (downloading it if necessary). Only then does it trigger `SKIP_WAITING` (posted to the waiting SW), the SW activates, and the page reloads automatically on `controllerchange`.
5. If the new release already controls the page (`controllerchange` with no restart pending: another tab restarted into it, or the browser activated it once every tab closed), the update shows as ready and **Restart now** is a plain reload. The new worker already has its complete shell, so there is nothing left to download.
6. `skipWaiting()` in the SW is triggered only via the `message` event (`event.data.type === "SKIP_WAITING"`), never automatically on install.

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

## Permissions and Consent

Every point at which the app asks for a permission or a consent follows the same four rules, on the web and inside the native app (`spec-native.md`):

1. **The app asks in its own words first.** A system dialog only ever follows a tap on one of the app's own asks. Nothing the app does on its own — booting, opening a screen, a background refresh — may put a system prompt on screen.
2. **An answer is remembered.** "Skip for now", "Maybe later", "No thanks" and a refused system dialog all stop every automatic ask of the same question. **Settings → Privacy** is the way back.
3. **Consent is explicit and reversible.** The first-run card clearly names that its single action covers location and cookies, and the equally prominent **Maybe later** path declines both. The map remains usable either way. Settings → Privacy provides separate controls to withdraw or re-enable location and usage analytics later.
4. **Nothing is offered that cannot work.** A permission blocked at the browser or OS level is explained, with where to change it, rather than offered as a button that would fail silently.

### Location

Stored answer: `ff-location-v1` — `granted` (asked for location in the app), `declined` (said not now, or refused the system dialog), absent (never asked). A legacy `ff-track-v1 = 1` (the old bundled "Enable location" tap) reads as `granted`. The permission state comes from the Permissions API on the web and the Geolocation plugin inside the native app (`Native.locationPermissionState()`, `js/native.js`); one that cannot be read counts as a prompt.

| Where | When | What it does |
| --- | --- | --- |
| First-run consent card | First visit to plain Nearby | **Enable location & cookies** records location `granted`, grants usage analytics and requests a position from the tap (plus the compass on iOS Safari, from the same tap); **Maybe later** records both choices as declined. A refused system dialog records location `declined`. The map remains usable either way. |
| `#consentBanner`, location stage | A landing-page arrival (or bare `/nearby`'s static index) with location never asked and the permission not yet granted or blocked | Non-blocking card in the inspector chrome. **Enable location** / **Maybe later**, same effects as onboarding. The server-rendered, page-specific sentence is the copy. |
| Boot, no card | Returning visit | Requests a position silently when the permission is granted, or when the answer is `granted` (a browser that re-asks each session is answering this person's own request). Otherwise makes no request. A refusal at that point records `declined` and is not followed by an in-app card. |
| `#locationInviteBanner` | After boot opened on the High Beach stand-in with nothing requested, and the answer is not `declined` | **Enable location** / **Maybe later** (records `declined`). If the permission is blocked, it explains where to allow it, with **OK** and no request button. A request that timed out offers it as a retry. |
| Settings → Privacy | Any time | **Use my location** — the way back after `declined`. Blocked: an explanation instead. |
| Feedback form | Opening it | Attaches a position only if the permission is already granted. Never asks. |

### Compass (iOS Safari only)

Other browsers, and the native app, need no ask: the native shell grants motion access itself and the client collects it silently on the first tap of the session (`Native.unlockMotionOnFirstGesture`). iOS Safari only allows `DeviceOrientationEvent.requestPermission()` from a tap, and forgets a grant on its own schedule, so a stored grant reads as unknown each launch. To avoid asking someone whose grant still holds, the "Enable compass" card (`#compassCalibrationBanner`) waits `COMPASS_GRANT_PROBE_MS` after the first real fix for a heading to arrive; if one does, the grant is still good and nothing is shown. Dismissing the card is remembered (`forest-finds-compass-prompt-dismissed-v1`) and it is not shown unprompted again. The compass is still asked in context from the tap that starts navigation to a find. A refused compass never blocks the map.

### Usage analytics

One consent covering both the app's own usage events (`js/tracker.js`: positions while the app is open, navigation, taps, sent with a random device id) and Google Analytics cookies. Stored in `ff-track-v1` (`1` / `0` / absent) and mirrored to `ff-cookie-consent`; a legacy `ff-cookie-consent = denied` counts as refused. On first run it is asked with location as one combined decision, with refusing exactly as easy as agreeing (**Maybe later** / **Enable location & cookies**):

- **First-run consent card** — the explicit **Enable location & cookies** action grants analytics alongside location and **Maybe later** declines both. Settings → Privacy can change either control later.
- **`#consentBanner`, landing-page arrival** — when both location and usage analytics are unanswered, the inspector card offers one combined action. If location is already answered, only the outstanding usage-analytics question is shown.
- **`#consentBanner`, returning visitor** — for someone who never answered usage analytics, once the map is up and no other card is showing (`askAnalyticsWhenFree()`), so two questions never stack.
- **Settings → Privacy** — one on/off toggle.

The shared cookie banner (`cookie-consent.js`) never appears on the app shell; it remains the cookie ask for the public pages.

### Legal basis

The asks are built to meet UK GDPR, PECR and the stores' rules, and changes to them must keep these properties:

- **Location** is a feature permission used on the device to draw the map; it is never collected on its own, so it needs no consent beyond the system permission, and the app's own explanation precedes every system dialog (Google Play's prominent-disclosure rule).
- **Usage analytics** (positions while the app is open, interactions, a random device id, and Google Analytics) is non-essential, so it runs only on prior, opt-in consent: its first-run action may bundle it with the location request, refusing is as easy as agreeing, the named third party is Google Analytics, and it is withdrawable at any time from Settings as easily as it was given.
- **Before consent nothing is stored or sent for it**: no device id written, no event queued, and no Google script loaded (so no cookieless pings either); every Consent Mode signal is denied and Google Signals and ad personalisation are off, which is also what lets the iOS privacy manifest declare no tracking.
- **Withdrawal removes**: the queued events, the device id and the `_ga` cookies.
- What is stored without consent is only what the person asked for or the app needs to work: their own answers (`ff-location-v1`, `ff-track-v1 = 0`, `ff-cookie-consent`, the compass dismissal), filters and onboarding state.

## User Tracking & Analytics

### Google tag (gtag.js) and the cookie-consent banner
Every page on the site (`index.html`, `app.html`, `admin.html`, `terms.html`, the weekly ledger reports under `reports/`, and the generated `reports/index.html`) defines the Google tag queue (`gtag()`, measurement ID `G-M9NL06G2JB`) as the first thing in `<head>`, with every Consent Mode v2 signal denied (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`) and Google Signals and ad personalisation turned off in `config` — but does **not** load Google's script: `cookie-consent.js` loads `gtag.js` only once analytics has been agreed to (stored, or on Accept), because a loaded tag in Google's "advanced" consent mode still sends cookieless pings (IP address, page, browser) to Google before anyone has answered. The weekly report generator (`scripts/report/render_report.py` `render_head`) and the reports-index generator (`scripts/generate-reports-index.js` `buildIndexHtml`) both emit the same snippet, so every future report and index rebuild carries it automatically. This is separate from, and gated independently of, the first-party tracker described below under Consent.

GA's own cookies (`_ga`, `_ga_*`) are not "strictly necessary", so UK PECR/GDPR requires consent before they're set — on every page, the homepage included, not just the app. Each page's `<head>` sets Google Consent Mode v2's default to `analytics_storage: 'denied'` inline (before `gtag.js` loads), then loads the shared `/cookie-consent.js` (repo root, used by every page regardless of marketing/app ownership). That script shows a small, dismissible banner fixed to the bottom of the viewport the first time a visitor reaches any page with no stored choice; **Accept** or **Decline** stores the decision once (`localStorage` key `ff-cookie-consent`) and calls `gtag('consent','update',...)`; Accept also loads `gtag.js`, and Decline (or a later withdrawal, anywhere) deletes any `_ga` cookies already set — the banner never reappears on its own afterward. It can be reopened deliberately via `window.ForestFindsCookieConsent.showBanner()`, exposed by the "Manage cookie preferences" control on `/terms.html`; the choice is shared across the whole origin, so accepting or declining on one page covers every other page too.

**The app shell never shows this banner.** Inside the app, analytics cookies are one half of a single usage-analytics question (see "Permissions and Consent"), so `cookie-consent.js` skips its banner on any page with a `#consentBanner` (app.html and every page generated from it) rather than ask the same person twice. The app's answer writes `ff-cookie-consent` too (`setAnalyticsConsent()`, `js/tracker.js`), so a choice made either way carries over across the whole origin. A cookie decision made on a public page answers only the cookie half: it does not cover the app's own usage data, which includes positions — except that a refusal is honoured as a refusal of both.

**Logo on notices:** the cookie banner, the app's location and usage-analytics card (`#consentBanner`) and the early-testing notice each lead with the oak-leaf logo, the same file as the homepage's top-left brand mark. On the homepage `cookie-consent.js` uses the homepage's own copy (`assets/home/map-icons/oak.png`), since marketing never loads app assets; everywhere else it uses `/data/icons/trees/logo.png`.

**Early-testing notice:** The homepage is excluded because it already explains the trial and invites sign-up. On the first other public page a visitor opens, a dismissible notice, led by the oak-leaf logo, says that Epping Forest Finds is still a work in progress, so visitors may find data problems or bugs, and links to the Feedback form. Where `cookie-consent.js` mounts it depends on width: at 760px and below it is mounted directly on `<body>` as a compact, fixed notice at the top of the map, leaving the Nearby sheet unobscured (a fixed child of the transformed inspector sheet would be fixed to the sheet instead); wider, it is part of the reading flow rather than an overlay — in the app's `#earlyTestingNoticeSlot` in the inspector, on standalone public pages at the start of their main reading container. This is informational rather than a consent choice: it records that it has been shown immediately, so it stays available on that first page but never appears again on a reload or another public page. The app defers it until first-run onboarding closes, so the notice never competes with that dialog.


#### App usage events sent to GA
Besides automatic pageviews, `js/tracker.js` fires two custom GA events via `gtag('event', ...)`, gated by the same cookie-consent state as everything else GA does — the analytics-cookie half of the usage-analytics answer:
- `screen_view` with `screen_name` when **Map setup**, **Settings**, **Report**, or **Search** is opened (`js/app.js` `openFilterSetup`/`openSettings`/`openReportModal`/`openSearchScreen`).
- `select_map_item` with `item_type`, `item_category`, `item_id`, `item_name` and `source` when a map item is selected (`js/inspector.js` `trackSelectionClick`, the same chokepoint the first-party `trackClick` uses). `item_type` is the broad kind (`tree`/`landmark`/`path`/`water`/`cow`/`road`/`railway`); for a `landmark` that's too coarse to tell a cafe from a viewpoint apart, so `item_category` carries the specific filter chip kind instead (`resolvePlaceKind`, `js/app.js`) — for every other type it just repeats `item_type`. This is the dimension that shows which kind of venue, and which named one, gets the most traffic.

Neither event ever includes the user's coordinates (their own position or the selected item's) — only which kind of place or screen was involved. GPS data stays entirely inside the first-party pipeline below, which never leaves this origin.

### Consent
Usage analytics is its own question, never folded into the location ask (see "Permissions and Consent"). Agreeing sets `ff-track-v1` to `1` and analytics cookies to granted; refusing sets `0` and denied (`analyticsChoice()`/`setAnalyticsConsent()`, `js/tracker.js`), so a refusal is remembered rather than read as never asked. Nothing is stored on the device for usage analytics without `1` — the anonymous device id (`ff-uid`) is created only when the first consented event is queued (`trackerSendEvent`), never while an event is built — and nothing is sent without it. Withdrawing in **Settings → Privacy** discards any queued, unsent events, deletes the device id and the `_ga` cookies. While analytics is on, Settings → Privacy shows the device id, which an access or erasure request quotes (terms.html § 7).

Full terms are at `/terms.html`. The modal links to this page.

### Data collected (with consent)
- **Location pings** — lat/lng, heading, current nav target — recorded every 60 seconds while location is active. Paused while the tab/screen is hidden (`document.visibilitychange`) along with the GPS watch, and resumed on return to foreground, to avoid draining battery in the background.
- **Click events** — item type, item ID, item name, user position — recorded on every map-item selection
- Events are queued on the device and sent in batches (once 20 are waiting, every 5 minutes, and when the page is hidden or closed), not one request each — see "Client batching" in `spec-admin.md`.
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

## GitHub Issue Clarification Workflow

See `spec/spec-issue-workflow.md`.

## Technical Constraints

- No client build step.
- Keep implementation in static HTML/CSS/JS and minimal local Node server for static/proxy hosting.
- Favor robust/simple logic over framework complexity.
- Preserve performance on mobile devices.
