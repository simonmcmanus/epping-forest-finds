filter-nature
A simple sprig with three leaves

filter-food
A plate with fork and knife

filter-transport
A red London double-decker in side profile, with two rows of windows and visible wheels

filter-history
A rolled historical scroll

filter-locations
A map pin

filter-stories
An open cream storybook with a terracotta cover and a star on its page

filter-trees
A veteran ancient oak tree with a broad canopy

filter-cows
A grazing cow in side profile

filter-waymarked-trails
A timber waymarker post with a single arrow plaque

filter-ponds-streams
A blue woodland pool edged with a few reeds

filter-pubs
A British nonic pint glass with a curved rim, tapered body and creamy head, without a handle

filter-restaurants
A plate with fork and knife

filter-cafes
A coffee cup

filter-shops
A supermarket trolley with an open metal cart, gold handle and two wheels

filter-bus
A red London double-decker in side profile, with two rows of windows and visible wheels

filter-parking
The original-style cream car in side profile, isolated without its P badge or map pin

filter-historic-places
A classical building with columns

filter-royal
A crown

filter-ww2
A British Brodie helmet, without a star or crossed weapons

filter-social-history
A historical scroll

filter-plaques
A bronze wall plaque with an engraved inscription and corner fixings

filter-blue-plaques
A circular blue heritage roundel with a lettered face

filter-celebrity
A five-point star

filter-science
A glass laboratory flask with golden liquid

filter-education
A graduation cap

filter-medicine
A medical cross

filter-literature
A single open book, without a map pin

filter-theatre
Comedy and tragedy masks

filter-politics
The Elizabeth Tower clock tower

filter-art
An artist palette

filter-church
A church with a steeple

filter-legends
A golden trophy cup with a single star

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
The original-style cream car in side profile, isolated without its P badge or map pin

landmark-bicycle-parking
A single bicycle, without a P badge

landmark-bench
A park bench

landmark-toilets
A single cream toilet in side view, without a building or extra signage

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
A London black cab in side view, with a squared passenger cabin and distinct bonnet

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
## UK setting and small-size legibility

Map artwork uses one recognisable subject, with no additional location pins,
parking badges or decorative props. Bus, pub, taxi and WWII artwork uses a
London double-decker, British nonic pint glass, London black cab and Brodie
helmet respectively. Parking uses a car; bicycle parking uses a bicycle;
medical sites use a single cross; literature uses an open book; campsites use
the original tent artwork. Keep the forest-green outlines and house palette, using heritage red
for the bus. Illustrated subjects share restrained shading, cream highlights
and forest-green outlines. The cab uses a recognisable side silhouette; the
pint has glass highlights and a curved creamy head. Toilets use a single
toilet silhouette rather than a detailed building. Every map icon has a
transparent background, with no opaque square or baked-in checkerboard.
Check silhouettes at map size as well as the 256px original.
The remaining map artwork was reviewed: UK rail symbols, the K6 telephone
box, heritage buildings, local nature and generic facilities retain their
existing subjects.

## App-wide illustration style

Place, filter and screen-heading illustrations share forest-green contours,
soft cream highlights and gentle dimensional shading. Use warm gold and tan,
terracotta, natural greens and water blue to distinguish subjects without
adding decorative objects. Food and restaurant icons share the same plate
artwork; the campsite filter reuses the original tent silhouette. The home
icon is an isolated cream lodge with a sage roof and transparent surroundings.
Tree-species leaves retain their distinct outlines and veins, with tonal
greens; the cow has English Longhorn horns curving down beside its face.

The rail symbols, medical cross and inline search/back controls retain their
familiar simple shapes. The walking figure and completion tick use softly
shaded illustrations while preserving their recognisable silhouettes. Launcher
tiles keep their separate platform backgrounds. All registered in-app PNG
icons have transparent space around the artwork; check them at 28px as well
as at full size. `data/icons/src/prompts.json` records the built-in ImageGen
prompts for the app-wide illustration pass.

The Nearby screen-heading mark is a yellow/gold location beacon with an empty shaded
emerald centre and two green arcs, without a compass star. The loading/onboarding
brand mark and homepage's independent location illustration retain the emerald
beacon with a gold centre. The earlier gold compass-pin concept is retained in
`docs/icon-review/` for reference, not loaded by the app.
The folded map and compass illustrations replace their flat or platform-specific
counterparts in the location fallback and compass calibration prompt. Review
decisions and generation prompts are recorded in `docs/icon-review/`.

Road and railway search results and detail headings use matching transparent
illustrations: a winding grey road with UK white markings, and a simple section
of railway track. Route types stay explicit in their text labels; no platform
car or train emoji are used for these line features.

## Drawing an icon

`data/icons/src/` holds SVG or transparent PNG masters, with exactly one
source per icon. The 256px PNGs in `data/icons/` are committed build output.
Raster masters retain the approved illustrations; the generator fits their
visible artwork to a consistent 0.48 content radius while preserving alpha.
`npm run gen:icons` (`scripts/generate-map-icons.js`) rasterises the sources to
256x256 through headless Chromium, and takes a name fragment to do one at a
time. `data/icons/src/_palette.md` holds the house palette, sampled from the
original set: deep forest `#284830` for every outline, cream `#f8f0d0`, sage
`#80a068`, warm tan `#c0a068`, stone `#c0c0b0`, heritage blue `#3e67c4` and
poppy red `#b23a2e`.

**Every drawing sits inside a circle of radius 128 on the 256 viewBox**, and
the generator fails rather than writing a PNG that does not. The renderer
paints artwork at 1.85x the pin head's radius (`drawPngMapIcon`), so content
past `1/1.85 = 0.541` of its own half-width reaches outside the white pointer,
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

The five main-navigation buttons in `app.html` use consistent inline SVG outline
glyphs: a pin for Nearby, magnifier for Search, sliders for Filters, speech
bubble for Feedback and cog for Settings. They use `currentColor`, 2px strokes
on a 24px viewBox, and persistent text labels. The navigation row uses 24px
icons and minimum 60px-tall targets, scaled by `--icon-scale`; equal-width
columns keep all five labels visible on narrow phones. Charcoal icons become
white on the solid charcoal current-screen tile. These navigation glyphs do
not use the illustrated PNG registry assets; screen headings retain those
illustrations. No external icon library is loaded.

The inspector's Back arrow remains inline SVG, with a 30px glyph in a 44px
target on its own row. The Search heading retains `searchIconHtml()` in
`js/app.js`; `app.html` contains markup only. The `ui-search` prompt remains
unused. General `.nav-icon` and `.title-icon` sizes remain 22px and 23px;
the main navigation and Back override their glyph sizes as described above.

The Filters screen has its own two sizes: a `64px` icon (`.app-icon.filter-group-icon`)
beside each group header (Nature, Food, …) and a smaller `56px` icon
(`.app-icon.filter-chip-icon`) inside each subfilter chip — the category
reads as the bigger of the two, its subfilters as the lesser. Both selectors
are compound (`.app-icon.X`, not bare `.X`) on purpose: `.app-icon`'s own
`width/height: 1em` lives in `css/inspector.css`, which loads after
`css/filter.css` in `app.html`, so a bare `.filter-group-icon`/`.filter-chip-icon`
tied on specificity with `.app-icon` and lost on load order — every filter
icon rendered at its label's own font-size (13–15px) instead of 64/56px,
reading as barely visible next to the label it sits beside. Matching
`.app-icon` onto the selector settles it on specificity instead.

The main navigation row's labels (`.inspector-actions .nav-label`) used to
overflow at the narrowest tested width (320px): a column-direction flex item
is sized to its own content on the cross axis regardless of `flex-shrink`
(that only governs the main axis), so "Feedback" and "Settings" — wider than
their own fifth of a five-across row — spilled a few pixels past both edges
of their own button and crowded into the next one, rather than being clipped
by it. Sized down to `0.625rem` with `-0.2px` letter-spacing instead (see
"Navigation" in `spec-data-rendering.md`), which fits every label inside its
own column at 320px without truncating any of them; `test/e2e/02-overview.spec.js`'s
"labelled charcoal navigation stays readable and separate from Back at narrow
widths" test checks each label stays inside its own button at 320/390/1280px.

The Nearby list's own per-row icon (`.nearest-icon`/`.nearest-icon .app-icon`,
`css/map-ui.css`) is enlarged instead, to `44px` (up from 20px) — that row has
no such fixed-width neighbours to overrun. It sits in its own grid column
(`.nearest-item`'s `grid-template-columns: auto 1fr`) spanning the full
height of both the name row and the meta/distance row beside it
(`.nearest-content`, holding `.nearest-header`/`.nearest-footer` stacked),
rather than being sized to just the first line the way a flex-row icon would
be. `test/forest-finds.test.js`'s "generated UI icon classes render at the
enlarged sizes" test locks all four sizes in place; its regexes deliberately
bound each match inside `[^}]*` rather than `[\s\S]*` so a later, unrelated
selector's own "width: 44px;" can't vacuously satisfy an assertion about a
rule higher up the file — an earlier, unbounded version of that regex did
exactly that and stayed green through a size that had quietly reverted.

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

`trees/logo.png` is not part of this set. It uses the emerald Nearby beacon, and is
used by the onboarding welcome step and the loading screen.
