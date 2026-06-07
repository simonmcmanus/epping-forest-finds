# Epping Forest Finds — Icon Specification

## Overview

Icons appear in three contexts:
- **Filter chips** — sidebar filter panel, ~20px inline with label text
- **Inspector title** — large emoji next to the panel heading when a feature is selected
- **Nearest-items list** — inline with place names in the overview list

The visual style should feel like a **polished outdoor/nature app** — earthy, calm, slightly illustrated but legible at small sizes.

## Output format

- **Format:** SVG, one file per icon
- **ViewBox:** `24×24`
- **Padding:** 1–2px inside the viewBox
- **Colour:** use `currentColor` for main fill/stroke so CSS can tint per category
- **Destination:** `assets/icons/<name>.svg`
- **Integration points:**
  - Filter emojis → `filterKindEmoji()` in `js/categories.js:200`
  - Landmark type fallbacks → `landmarkTypeEmoji()` in `index.html:1958`
  - Inspector titles → `setInspectorSelectionChrome()` calls in `js/inspector.js`

**Do not replace:**
- `filter-underground` — must stay as the official TfL branded SVG (`assets/london-underground-logo.svg`)
- `filter-national-rail` — must stay as the official branded SVG (`assets/national-rail-logo.svg`)
- `ui-filter` — has a custom CSS implementation; SVG version already at `assets/forest_finds_top_nav_icons/svg/filter.svg`

---

## Filter group headers

Labels for collapsible filter sections in the sidebar.

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-nature.svg` | 🌿 | Nature | Leaf or sprig — represents the natural environment category |
| `filter-food.svg` | 🍽️ | Food | Plate with cutlery — covers pubs, restaurants, cafés, shops |
| `filter-transport.svg` | 🚌 | Transport | Bus or transit icon — public transport options near the forest |
| `filter-history.svg` | 📜 | History | Scroll or document — historical places and heritage |
| `filter-locations.svg` | 📍 | Locations | Map pin — notable locations by topic |
| `filter-stories.svg` | ✨ | Stories | Sparkle/stars — legends, folklore, film locations |

---

## Nature subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-trees.svg` | 🌳 | Trees | Veteran/ancient tree — the primary feature of the app. Should feel significant and old, broad spreading canopy, often pollarded |
| `filter-cows.svg` | 🐄 | Cows | Grazing cow — the forest has free-roaming cattle; this filter toggles their live GPS positions |
| `filter-waymarked-trails.svg` | 🥾 | Waymarked trails | Walking boot — waymarked hiking routes through the forest |
| `filter-ponds-streams.svg` | 💧 | Ponds & streams | Water drop — ponds, streams and hydrology features |

---

## Food & drink subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-pubs.svg` | 🍺 | Pubs & bars | Beer mug — pubs and bars near the forest |
| `filter-restaurants.svg` | 🍽️ | Restaurants | Plate with cutlery — restaurants |
| `filter-cafes.svg` | ☕ | Cafés | Coffee cup — cafés and tea rooms |
| `filter-shops.svg` | 🛒 | Shops | Shopping basket — local shops |

---

## Transport subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-bus.svg` | 🚌 | Bus stops | Bus — bus stops near the forest |
| *(keep branded SVG)* | London Underground logo | Underground | Must remain as official TfL branded SVG |
| *(keep branded SVG)* | National Rail logo | National Rail | Must remain as official branded SVG |
| `filter-parking.svg` | 🅿️ | Car parks | Blue letter P — car parks |

---

## History subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-historic-places.svg` | 🏛️ | Historic places | Classical building with columns — general historic places |
| `filter-royal.svg` | 👑 | Royal | Crown — royal-history associations (hunts, lodges, monarchs) |
| `filter-ww2.svg` | 🪖 | WWII | Military helmet — WWII sites (anti-aircraft, POW camps, bomb sites) |
| `filter-social-history.svg` | 🧺 | Social history | Basket — social history (public access, Victorian recreation, working-class history) |
| `filter-plaques.svg` | 🪧 | Plaques | Plaque/sign mounted on wall — commemorative plaques |
| `filter-blue-plaques.svg` | 🔵 | Blue plaques | Blue circle/disc — English Heritage blue plaques specifically |

---

## Locations subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-celebrity.svg` | ⭐ | Celebrity | Star — places with celebrity associations |
| `filter-science.svg` | 🔭 | Science | Telescope — science-related places |
| `filter-education.svg` | 🎓 | Education | Graduation cap — schools, universities, educational sites |
| `filter-medicine.svg` | ⚕️ | Medicine | Caduceus/medical cross — hospitals, public health history |
| `filter-literature.svg` | 📚 | Literature | Stack of books — literary connections (authors, poets, settings) |
| `filter-theatre.svg` | 🎭 | Theatre | Comedy/tragedy masks — theatre and performing arts |
| `filter-politics.svg` | 🏛️ | Politics | Columns building — political history locations |
| `filter-art.svg` | 🎨 | Art | Artist palette — art and music locations |
| `filter-church.svg` | ⛪ | Church | Church with steeple — churches and places of worship |

---

## Stories subfilters

| Filename | Current | Label | Description |
|---|---|---|---|
| `filter-legends.svg` | ✨ | Legends | Sparkle/magic stars — local legends, ghost stories, folklore |
| `filter-film-tv.svg` | 🎬 | Film/TV | Clapperboard — film and TV filming locations |

---

## Inspector title icons

Appear as a large icon next to the inspector panel heading when a map feature is selected.

| Filename | Current | Trigger | Description |
|---|---|---|---|
| `inspector-map-overview.svg` | 🗺️ | General area / default state | Folded map — overview/no-selection state |
| `inspector-forest-land.svg` | 🌲 | Epping Forest polygon tapped | Conifer tree — the forest land designation area |
| `inspector-buffer-land.svg` | 🟢 | Buffer land polygon tapped | Green circle — buffer/protected land around the forest |
| `inspector-motorway.svg` | 🛣️ | Motorway road tapped | Road with central divider — major motorway |
| `inspector-trunk-road.svg` | 🛤️ | Trunk/primary road tapped | Road — trunk or primary road |
| `inspector-road.svg` | 🚙 | Minor road tapped | Car — smaller local road |
| `inspector-subway.svg` | 🚇 | Subway/tube line tapped | Underground train — tube line |
| `inspector-tram.svg` | 🚊 | Tram line tapped | Tram — tram line |
| `inspector-light-rail.svg` | 🚈 | Light rail line tapped | Light rail vehicle |
| `inspector-railway.svg` | 🚂 | General railway tapped | Locomotive — general railway line |

---

## Landmark type icons (OSM amenity fallbacks)

Used when a landmark does not match a named filter category. Appear in the nearest-items list and as inspector titles.

| Filename | Current | OSM tags covered | Description |
|---|---|---|---|
| `landmark-parking.svg` | 🅿️ | parking | Blue letter P — car park |
| `landmark-bicycle-parking.svg` | 🚲 | bicycle_parking, cycle_parking | Bicycle — bike parking point |
| `landmark-bench.svg` | 🪑 | bench | Bench/seat — a place to sit and rest |
| `landmark-toilets.svg` | 🚻 | toilets | WC/restroom symbol — public toilets |
| `landmark-drinking-water.svg` | 🚰 | drinking_water, water_well | Tap — drinking water point or water well |
| `landmark-information.svg` | ℹ️ | information | Info symbol — information board or visitor centre |
| `landmark-memorial.svg` | 🕯️ | memorial | Candle — war memorial or commemorative marker |
| `landmark-monument.svg` | 🗿 | monument, boundary_stone | Stone monolith — monument or boundary stone |
| `landmark-archaeological.svg` | 🏺 | archaeological_site, roman_road, ruins | Amphora — archaeological site, Roman road, ruins |
| `landmark-museum.svg` | 🏛️ | museum, attraction, building, folly, gate_pier | Classical building — museum or notable building |
| `landmark-campsite.svg` | ⛺ | camp_site, caravan_site | Tent — campsite or caravan site |
| `landmark-picnic.svg` | 🧺 | picnic_site | Picnic basket — picnic site |
| `landmark-viewpoint.svg` | 🔭 | viewpoint | Telescope — scenic viewpoint |
| `landmark-taxi.svg` | 🚕 | taxi | Taxi cab — taxi rank |
| `landmark-telephone.svg` | ☎️ | telephone | Phone handset — public telephone |
| `landmark-events-venue.svg` | 🎟️ | events_venue | Ticket — events venue |
| `landmark-alcohol.svg` | 🍷 | alcohol | Wine glass — off-licence / alcohol shop |
| `landmark-chemist.svg` | ⚕️ | chemist | Medical cross — pharmacy or chemist |
| `landmark-dry-cleaning.svg` | 👔 | dry_cleaning | Shirt — dry cleaning shop |
| `landmark-cafe.svg` | ☕ | cafe, tea | Coffee cup — café or tearoom |
| `landmark-gate.svg` | 🚪 | gate, entrance, stile, kissing_gate | Gate/door — forest entry point, stile, kissing gate |
| `landmark-barrier.svg` | 🚧 | cycle_barrier, lift_gate, cattle_grid, fence | Barrier — physical barrier or access restriction |
| `landmark-default.svg` | 📍 | fallback for unmatched places | Pin — generic location marker |

---

## UI control icons

Action buttons in the app header/toolbar.

| Filename | Current | Button | Description |
|---|---|---|---|
| `ui-search.svg` | 🔍 | Opens tree number search panel | Magnifying glass |
| `ui-report.svg` | ✍️ | Opens feedback/report-missing-data form | Pencil writing |
| `ui-settings.svg` | ⚙️ | Opens settings panel | Gear/cog |
| `ui-back.svg` | ← | Back to overview list in inspector | Left-pointing arrow |

---

## Location / compass UI icons

| Filename | Current | Used as | Description |
|---|---|---|---|
| `ui-location-gate.svg` | 📍 | Large icon on "Allow location" prompt card | Pin — prompts user to enable GPS |
| `ui-distance-warning.svg` | 🗺️ | Large icon on "You're not near the forest" card | Folded map — user is outside the forest area |
| `ui-compass-arrow.svg` | ↑ | Rotating arrow pointing toward selected location | Clean upward arrow — rotated by JS to point at target; must look good at any rotation angle |

---

## Tree species icons

Each species icon appears as a map marker and optionally in the inspector title when a specific tree is selected. The three dominant species (Beech, Oak, Hornbeam) represent ~99% of all veteran trees and must be **clearly distinguishable from each other at ~20px**.

Design approach: **leaf-forward** — the characteristic leaf silhouette is the primary differentiator, with a minimal trunk/pollard hint below.

| Filename | Common name | Latin name | Count | Key visual features |
|---|---|---|---|---|
| `tree-common-beech.svg` | Common Beech | *Fagus sylvatica* | 13,129 | Oval leaf with smooth wavy edge and parallel side veins; smooth pale grey bark; wide spreading canopy. Often seen as squat multi-stemmed pollards. Turns copper/gold in autumn. |
| `tree-english-oak.svg` | English Oak | *Quercus robur* | 7,793 | Classic deeply-lobed rounded leaf; acorns on long stalks; thick gnarled fissured bark; massive spreading crown. Many are ancient pollards with stubby thick limbs. |
| `tree-hornbeam.svg` | Hornbeam | *Carpinus betulus* | 3,573 | Sharply double-toothed oval leaf with pronounced parallel veins; distinctive muscle-like fluted silver-grey trunk; hop-like clusters of winged fruit. Epping Forest is famous for its hornbeam pollards. |
| `tree-holly.svg` | Holly | *Ilex aquifolium* | 9 | Glossy dark evergreen leaf with spiny lobed edges; red berries; dense rounded canopy. Very recognisable silhouette. |
| `tree-wild-service.svg` | Wild Service | *Sorbus torminalis* | 7 | Maple-like deeply lobed leaf turning red/orange in autumn; small brown spotted fruit. A rare ancient-woodland indicator species. |
| `tree-field-maple.svg` | Field Maple | *Acer campestre* | 7 | Small 5-lobed leaf similar to sycamore but smaller and neater; turns yellow in autumn; corky ridged bark. |
| `tree-ash.svg` | Ash | *Fraxinus excelsior* | 3 | Compound pinnate leaf with 7–13 paired leaflets; distinctive black buds in winter; clusters of winged seeds ("keys"); tall open canopy. |

---

## Summary counts

| Group | Icons to generate |
|---|---|
| Filter group headers | 6 |
| Nature subfilters | 4 |
| Food & drink subfilters | 4 |
| Transport subfilters | 2 (underground + national rail stay as branded SVGs) |
| History subfilters | 6 |
| Locations subfilters | 9 |
| Stories subfilters | 2 |
| Inspector title icons | 10 |
| Landmark type icons | 24 |
| UI control icons | 4 |
| Location / compass UI | 3 |
| Tree species icons | 7 |
| **Total** | **81** |
