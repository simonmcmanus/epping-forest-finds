filter-nature
A simple sprig with three leaves

filter-food
A plate with fork and knife

filter-transport
A front-facing bus

filter-history
A rolled historical scroll

filter-locations
A map pin

filter-stories
Three sparkles

filter-trees
A veteran ancient oak tree with a broad canopy

filter-cows
A grazing cow in side profile

filter-waymarked-trails
A hiking boot

filter-ponds-streams
A single water droplet

filter-pubs
A beer mug

filter-restaurants
A plate with fork and knife

filter-cafes
A coffee cup

filter-shops
A shopping basket

filter-bus
A front-facing bus

filter-parking
A parked car

filter-historic-places
A classical building with columns

filter-royal
A crown

filter-ww2
A military helmet

filter-social-history
A woven basket

filter-plaques
A bronze wall plaque with an engraved inscription and corner fixings

filter-blue-plaques
A circular blue heritage roundel with a lettered face

filter-celebrity
A five-point star

filter-science
A telescope

filter-education
A graduation cap

filter-medicine
A medical cross

filter-literature
A stack of books

filter-theatre
Comedy and tragedy masks

filter-politics
A civic building with columns

filter-art
An artist palette

filter-church
A church with a steeple

filter-legends
Three magical sparkles

filter-film-tv
A film clapperboard

inspector-map-overview
A folded map

inspector-forest-land
A conifer tree

inspector-buffer-land
A shield containing a leaf

inspector-motorway
A motorway with central divider

inspector-trunk-road
A primary road

inspector-road
A small car

inspector-subway
An underground train

inspector-tram
A tram

inspector-light-rail
A light rail vehicle

inspector-railway
A railway train

landmark-parking
A parked car

landmark-bicycle-parking
A bicycle with the P badge the car-park icon carries

landmark-bench
A park bench

landmark-toilets
A public toilet facility

landmark-drinking-water
A water tap

landmark-information
An information board

landmark-memorial
A stone memorial cross on a stepped plinth, with a remembrance poppy

landmark-monument
A standing stone

landmark-archaeological
An ancient amphora

landmark-museum
A museum building with columns

landmark-campsite
A camping tent

landmark-picnic
A picnic table, plank top over a bench

landmark-viewpoint
A spotting telescope on a tripod

landmark-taxi
A taxi cab

landmark-telephone
A K6 telephone box

landmark-events-venue
An admission ticket

landmark-alcohol
A wine glass

landmark-chemist
A medical cross

landmark-dry-cleaning
A collared shirt

landmark-cafe
A coffee cup

landmark-gate
A wooden gate

landmark-barrier
An access barrier

landmark-default
A map pin

ui-search
A magnifying glass

ui-report
A pencil writing a mark

ui-settings
A gear cog

ui-back
A left-pointing arrow

ui-location-gate
A friendly map pin

ui-distance-warning
A folded map

ui-compass-arrow
A compass arrow

tree-common-beech
A single beech leaf with smooth wavy edges

tree-english-oak
A single oak leaf with rounded lobes

tree-hornbeam
A single hornbeam leaf with toothed edges

tree-holly
A single holly leaf with spiny edges

tree-wild-service
A single wild service leaf with deep lobes

tree-field-maple
A single field maple leaf with five compact lobes

tree-ash
A single ash compound leaf with paired leaflets
## Drawing an icon

`data/icons/src/*.svg` is the editable original for every icon added since the
set was first drawn; the PNGs beside them in `data/icons/` are build output.
`npm run gen:icons` (`scripts/generate-map-icons.js`) rasterises the sources to
256x256 through headless Chromium, and takes a name fragment to do one at a
time. `data/icons/src/_palette.md` holds the house palette, sampled from the
original set: deep forest `#284830` for every outline, cream `#f8f0d0`, sage
`#80a068`, warm tan `#c0a068`, stone `#c0c0b0`, heritage blue `#3e67c4` and
poppy red `#b23a2e`.

**Every drawing sits inside a circle of radius 128 on the 256 viewBox**, and
the generator fails rather than writing a PNG that does not. The renderer
paints artwork at 1.75x the pin head's radius (`drawPngMapIcon`), so content
past `1/1.75 = 0.571` of its own half-width reaches outside the white pointer,
which is what made the old full-width plaque rectangle sit wrong among the
others. `scripts/lib/icon-fit.js` holds that rule and the 0.52 ceiling both
scripts measure against — under the spill point, with room for the
antialiased edge.

Two shapes read at the 35 CSS pixels a pin actually occupies; four do not.
The memorial went through a wreath-and-cross version that closed into a dark
blob at map size before settling on cross, plinth and poppy.

## Fitting the original artwork

The set the app shipped with was drawn without the pointer rule, and 18 of its
icons genuinely poked out of the white head — the restaurant's cutlery, the
drinking-water tap, the museum's columns, the beer froth. They also ranged from
0.43 to 0.67, so a gate pin read half again the size of an art pin beside it on
the same map.

`npm run fit:icons` (`scripts/refit-map-icons.js`) scales any icon over the
ceiling about its own centre and rewrites the PNG, which is the only transform
that is safe to apply to raster artwork without a person redrawing it. It took
34 icons in, the largest (the restaurant) by 25%, and the set now spans 0.43
to 0.52 rather than 0.43 to 0.67. `npm run fit:icons -- --check` reports without
writing, and re-running is a no-op because the rescale aims a little under the
ceiling rather than exactly onto it — the rendered edge lands a pixel wide of
where the arithmetic put it, and aiming at the limit left icons measuring 0.521
and rewrote all of them every run.

Two things keep it from drifting back: `test/map-icons.test.js` fails if any
map icon overflows or if their sizes spread too far apart, and the audit below
reports the same. An icon that is app chrome rather than a map pin — the nav
buttons, the filter group and chip icons, the generated launcher icons — is
exempt; `mapIconEntries()` in `scripts/lib/icon-fit.js` is the one list of
those, so the generator, the refit, the audit and the test cannot disagree
about what counts as a map pin.

## Community venues reuse existing icons

A village hall, library, arts centre, theatre or cinema became something the
map can carry when the weekly run learned to add them (see
`spec-weekly-report.md`). `landmarkIconSlug` maps them onto icons the set
already has rather than waiting on new artwork: theatre → `theatre`, cinema →
`film`, arts centre → `art`, library → `literature`, and a hall, town hall,
social club or events venue → `landmark-museum`, whose classical building
reads as civic. Without those lines each one would draw as a bare emoji, which
is what the audit below exists to count.

## Auditing what the map actually draws

`js/renderer.js` picks a pin by working down a fixed order — the food and
transport special cases, then `PLACE_FILTER_PRIORITY` via `matchesPlaceFilter`,
then `landmarkIconSlug` — and when nothing matches it falls back to an emoji
glyph. That fallback is silent: nothing errors, a pin appears, and only a
person looking at the map notices the artwork is not the product's own.

It used to be silent *and* conspicuous. The glyph was painted straight onto
the map with no pointer behind it, so 609 of 6,048 places — memorials as a
candle, plaques as a red pushpin, every bicycle parking stand as a bicycle —
floated at a different visual weight from every other marker. Two things fixed
that: `drawEmojiMapPin` now draws the same white pointer and puts the glyph
inside it, so a place without artwork is still the same kind of marker; and
the categories that were falling through got artwork of their own, taking the
count from 609 to 7. The seven left are OSM `building=yes` records with no
type at all, and draw as a plain dot in the pointer.

The fall-through had a second cause worth remembering: `PLACE_FILTER_PRIORITY`
listed the subfilter keys `FILTER_GROUPS` uses (`historic`, `monuments`,
`churches`, `campsites`) while `matchesPlaceFilter` switched on a different
vocabulary and had no `case` for any of them. They could never match, so those
four chips hid every place they were meant to show and their icons were
unreachable — which is how memorials ended up on the emoji path. Plaques got
there another way: every plaque in the data is a blue plaque, `blue_plaques`
was not in the priority list at all, and `isPlaqueCategory` excluded blue ones,
so a plaque drew whatever topic it also happened to carry (Jacob Epstein's drew
an artist's palette). `blue_plaques` now leads the history block and
`isPlaqueCategory` covers every plaque, so the "Plaques" chip finds all 65.

The `plaques` bronze plate is drawn but not currently reached: every plaque in
the dataset is a blue one, and `blue_plaques` wins ahead of it. It is the
right pin for the first green or black plaque the weekly ledger adds.

A third cause was quieter still. `royal`, `celebrity_association`, `science`,
`politics` and `social_history` are topics a folklore place carries, and no
filter chip offers any of them, so nothing ever reached `crown`, `celebrities`,
`science`, `politics` or `social-history`: those places fell past every rule
into the broad `historic` bucket and all drew the same castle.
`PLACE_FILTER_TOPIC_PRIORITY` now sits between the tag rules and the buckets,
which is the only place it can go — ahead of the tags, a viewpoint tagged
`science` would stop being a viewpoint. `celebrities`, `politics` and `theatre`
are still rarely drawn, because the places carrying those topics almost always
have something better to show (a blue plaque, a school, a film location).

`node scripts/icon-audit.js` (or `npm run audit:icons`) names every place that
falls through, grouped by category with examples, by loading the app's real
rules from `js/categories.js` the way `scripts/report/map-inventory.js` does.
It also reports the ways the icon set and the rules drift apart: filter keys
`matchesPlaceFilter` can never return true for (their icon is unreachable and
the places they were meant to cover fall through to the emoji), registry
entries with no file behind them, files reached from outside the registry (the
service worker's precache list, a page's `<link>`, the manifest — legitimate,
and listed so they are not mistaken for dead), files nothing refers to at all,
and files that are byte-identical to another under a different name, and map icons
whose artwork reaches outside the pointer. `--json` gives the same result as
data.

The resolution order in `icon-audit.js` restates `drawLandmarks()` rather than
calling it, because the real function needs a canvas and live app state. If the
renderer's order changes, the audit has to change with it or it stops
describing the real map.

## Inline UI glyphs

Two navigation glyphs are drawn as inline SVG rather than shipped as registry
assets: the inspector's back arrow (`#inspectorBack` in `app.html`) and the
search magnifier, which appears both as the main-navigation button
(`#searchToggle` in `app.html`) and as the Search screen's title icon
(`searchIconHtml()` in `js/app.js` — `app.html` carries its own copy because
that file holds no logic). Both take `class="app-icon nav-icon"` so they size
and sit exactly like the PNG nav icons around them, and both stroke in
`currentColor` so the `screen-active` state recolours them for free. The
`ui-search` prompt above is unused and stays listed only so the set is
complete if the glyph is ever drawn as an asset.

## Generated app icon assets

`scripts/generate-app-icon.py` composites `trees/oak.png` — the English oak
leaf — onto a gold gradient tile (#f7dc82 top-left to #e2a13c bottom-right)
and writes:

- `icon-192.png`, `icon-512.png` — manifest `purpose: any`. Corners rounded at
  19% and knocked out to transparency, so the tile sits on any wallpaper.
- `icon-maskable-512.png` — manifest `purpose: maskable`. Gold bleeds to the
  edge and the leaf is drawn at 50% of the tile height to clear Android's
  circular crop.
- `apple-touch-icon.png` — 180px, square and opaque: iOS ignores transparency
  and applies its own mask.
- `favicon.png` — 128px, square, leaf at 72% so it still reads at 16px. Linked
  from `index.html`, `admin.html`, `terms.html` and the generated reports index.

`trees/logo.png` is not part of this set. It stays the location pin, and is
used by the onboarding welcome step and the loading screen.
