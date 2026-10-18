# Marketing, Positioning & Public Homepage Specification

Owns the words and the public-facing surfaces of Epping Forest Finds: the
positioning, the approved phrase bank, the marketing homepage at `/`, the
mailing-list sign-up, the social sharing assets, and the hero image.

ChatGPT owns this spec and the marketing surfaces. Claude owns app copy,
metadata, onboarding and the manifest. The phrase bank is a reference for
consistent wording, not a shared runtime dependency: changing marketing copy
does not require editing app files. Cross-surface wording changes are handed
to the app owner for a separate change. See `spec/agents.md` for file ownership.

It does **not** own the alpha access gate — who may reach the app's screens
(`/nearby`, `/nearby/search`, `/nearby/filter`, `/settings`, `/feedback`), how the shared
secret link works, or the edge function that enforces it. That belongs in
`spec-alpha-access.md`. This spec only defines the *call to action* that the
gate's state selects between (§8).

## 1. Why the homepage exists

Before this spec, `/` served the map itself. `index.html` carried a comment
saying so explicitly — *"no filler copy on a page whose whole job is to be a
map"* — and that was a reasonable position for an app-only site, but it meant
the site's strongest URL was a `<canvas>` element with nothing indexable
behind it, sitting at priority 1.0 in `sitemap.xml`. The weekly ledger reports
were carrying discovery on their own (see the header comment in
`scripts/generate-sitemap.js`).

The alpha gate forces the app off `/` anyway. The homepage that replaces it is
therefore **not a temporary alpha landing page**. It is the permanent public
front door:

| Path | Role | Audience |
| --- | --- | --- |
| `/` | Marketing homepage — explains the app, ranks in search, collects sign-ups | Everyone |
| `/nearby` | The map application's entry point (`/app` redirects here) | Invited alpha users; everyone after launch |
| `/reports/` | Weekly Epping Forest Ledger | Everyone — the main organic discovery path |
| `/terms.html` | Privacy & terms | Everyone |

At the end of the alpha the homepage stays exactly where it is. Only the
call-to-action element changes (§8). No URL moves, no redirects are added, and
no accumulated search ranking is reset.

## 2. Positioning

**What it is:** a free, offline-first field map of Epping Forest.

**Who it is for:** people already walking in or heading to Epping Forest —
dog walkers, runners, families, cyclists, tree enthusiasts, and visitors who
do not know the forest. Local, repeat, on-foot.

**The problem it solves:** the forest has patchy-to-absent mobile coverage.
General-purpose map apps degrade to a blank grid exactly when you need them,
and none of them know where the veteran trees, the gates, or the cattle are.

**What makes it different, in order of distinctiveness:**

1. **24,906 veteran trees.** The complete Veteran Tree Register, searchable by
   physical tag number, with navigation to individual trees and estimated ages.
2. **It works with no signal.** Downloaded map data remains available offline.
3. **Grazing cattle positions.** GPS collar data from the Nofence open API is
   refreshed periodically over the network; offline positions may be out of date.

Lead feature and social copy with the trees and their tag numbers. Keep the
hero's offline headline, with tree discovery in its supporting copy.

## 3. Phrase bank

These are the approved marketing phrases. Other surface owners may adopt them
independently; marketing changes do not automatically change those surfaces.

### 3.1 Hero headline

> **Your guide to Epping Forest. No Signal Necessary.**

"No Signal Necessary." sits on its own line, set smaller than "Your guide to
Epping Forest." so the first line leads.

### 3.2 Hero sub-line

> A free, offline map of Epping Forest. Find 24,906 veteran trees, forest paths, pubs and grazing cattle.

### 3.3 One-line description (meta description, manifest, store listings)

> Explore 24,906 veteran trees in Epping Forest. Find trees by tag number,
> navigate to them and discover their estimated ages with an offline map.

### 3.4 Pillar headings and bodies

**Works where your phone doesn't**
> Download once, then explore the trees, paths and landmarks without a signal.

**Get to know the old trees**
> Look up a tree’s tag number to find its species, record and estimated age.

**Follow the longhorns**
> See the latest reported cattle locations from their GPS collars. Positions refresh while online; offline, you’ll see the last saved positions, which may be out of date.

**Everything else you need out there**
> 9,162 paths and bridleways. 1,358 pubs, cafés and shops. 1,597 car parks,
> benches, toilets and gates. 1,106 bus stops and stations. All within walking
> distance of the forest.

### 3.5 Short forms

- Social/sharing line: **Find Epping Forest’s veteran trees by tag number, navigate to them and discover their estimated ages on an offline map.**
- Free/access line: **Free. No account needed. No signal needed.**

### 3.6 Banned phrases

Each of these contradicts something the project has already published:

| Do not use | Why |
| --- | --- |
| "No ads", "ad-free", "never any advertising" | `terms.html` §4 explicitly reserves the right to show sponsored or advertising content in future. |
| "Never get lost", "always know where you are", any safety promise | `terms.html` §11 disclaims accuracy and completeness. Do not imply navigational safety. |
| "Real-time" cattle or no network requests after download | Cattle move. Positions refresh periodically over the network; offline positions are the last saved ones and may be out of date. Repeat this caveat in the cattle pillar, offline section and FAQ, including its JSON-LD. |
| "Anonymous" applied to mailing-list sign-ups | The mailing list is identifiable personal data. Only the *tracking* data is anonymous (see §9.4). |
| Any hand-written feature count | Counts drift. They are generated — see §4. |

### 3.7 Tone

Warm, plain and concise. Lead with what the app does. Keep contractions, but cut
jokes, rhetorical questions and repeated explanations that delay the useful point.
Keep the age-estimate and offline cattle caveats explicit.

Avoid: exclamation marks, "revolutionise", "seamless", "experience" as a noun,
"powered by", emoji in body copy, and stacked superlatives. If a sentence would
sound odd said out loud on a footpath, rewrite it.

## 4. Feature counts are generated, never written

The counts in §3.4 are real values from the current checkout:

| Figure | Source |
| --- | --- |
| 24,906 veteran trees | `data/trees/index.json` → `recordCount` |
| 9,162 paths | feature count, `data/local-paths.geojson` |
| 1,358 food & drink | feature count, `data/local-landmarks-food.geojson` |
| 1,597 facilities | feature count, `data/local-landmarks-facilities.geojson` |
| 1,106 transport | feature count, `data/local-landmarks-transport.geojson` |

**The homepage must never be able to quote a stale number.** `spec.md` states
approximately 500 food, 1,100 facilities and 520 transport features — all three
are now stale by a wide margin, which is precisely the drift a public page
cannot afford. (Those `spec.md` figures should be corrected separately.)

Implementation: the counts are written into the committed `index.html`.
`test/home-counts.test.js` holds the grouped inventory to
`scripts/report/map-inventory.js`, the same classifier that supplies the
Ledger, and holds the headline tree claim to `scripts/count-datasets.js`. A
dataset or classification change fails the suite, and the copy is corrected
in the same change.

Correcting it is `scripts/sync-homepage-counts.js`'s job, not a hand edit. It
rewrites the inventory total, group totals and subfilter rows in `index.html`,
as well as the headline figures in §3.4 and §4 of this document, from the
current data. `--check` reports drift without changing anything and exits
non-zero.

The same sync writes `assets/home/inventory/*.json` from the read-only map
datasets, using the app's classification and normalisation rules at generation
time. Each list preserves every counted record, sorts by name, and labels
unnamed places and untagged trees explicitly. List lengths and contents are
checked alongside counts; dataset updates commit the generated lists too.

It exists because the test alone left a person in the loop, and the weekly
ledger run (`spec-weekly-report.md`) changes the food dataset unattended: every
data change it proposed therefore arrived with this suite already red, and a
pull request that always fails is one nobody merges. Run it after anything
that adds or removes features from a quoted dataset.

Counting at build time was the other option and was rejected: the homepage
would then only exist after `npm run build`, which breaks running the site from
a plain checkout — the project's stated constraint — and would leave the e2e
suite with no page to load. A test gives the same guarantee without making the
page a build artifact.

Run `node scripts/count-datasets.js` to print the current values. Counts are
rendered with thousands separators.

## 5. Homepage structure

Copy stays brief: no introductory filler above the inventory or offline steps;
tree captions give one action each. The signup introduction says “Hear when early
testing opens, plus weekly Epping Forest Ledger updates once the site launches.”
FAQ answers match their JSON-LD wording. The veteran-tree card uses the oak-leaf
brand icon. These edits preserve the signup consent wording and mailing scope.

`/` is plain, static, server-rendered HTML. **All copy is present without
JavaScript** — a share target that needs JS to say what it is, isn't one. JS is
permitted only to enhance the sign-up form (inline validation, async submit) and
to add motion that never gates content.

**Motion** stays subtle and professional. The hero copy rises in on load and
the hero photo fades in (CSS only). Section headings, intros and cards fade up
about 16px as they scroll into view, siblings in a row staggered by 90ms (capped
at three steps); `assets/home/home.js` adds the hidden state only when
IntersectionObserver exists, so without JavaScript everything is simply shown.
Cards lift 3px with a deeper shadow on hover (pointer devices only), the tag
photo scales 3%, and buttons nudge up on hover and press down on click.
`prefers-reduced-motion: reduce` turns all of it off.

Sections, in order:

1. **Hero** — the line-art longhorn (§7) as background, headline (§3.1),
   sub-line (§3.2), and the primary CTA element (§8). The photo caption uses
   white text on an opaque dark-green backing for contrast across the image,
   running flush to the photo's left, right and bottom edges with no inset.
   The photo uses shared 480, 768, 960, 1280 and 1600px WebP variants with
   responsive `srcset`/`sizes` and the original JPEG fallback. Its high-priority
   preload matches the WebP candidates and sizes, downloading only the selected
   image. Preserve the full-width crop and intrinsic 4:3 dimensions.
2. **What's on the map** — directly after the hero, one neutral inventory card, matching the Ledger's
   categorisation: a headline total with a 44px map-pin icon
   (`map-icons/all-finds.png`) to its left, the six app filter groups (Nature, Food,
   Transport, History, Locations and Stories), every subfilter and count, then
   a full-width row for always-shown facilities. Each group heading uses an
   independent homepage copy of the corresponding app category icon, with a
   smaller app icon beside every subcategory. Parent icons are deliberately
   larger so the group hierarchy remains clear. Both icon sizes sit centred
   in the same 38px column, with aligned category and subcategory labels. The
   Group headings and subcategory labels are ordinary links to their matching
   `/nearby/<slug>/` filtered map pages (for example, Pubs & bars links to
   `/nearby/pubs/`), so the homepage does not provide a separate category
   search or results UI. The links work without JavaScript. The
   header brand mark is the transparent oak leaf from the app icon, without
   the app icon's yellow background, shown at 44px (36px on phones), with the
   brand name and Ledger link each kept to one line. The hero starts directly
   with its headline; there is no eyebrow repeating the offline promise.
3. **Three feature cards** — offline, veteran trees and cattle (§3.4). White
   cards have rounded borders, shadows and 80px centred independent brand
   icons from `assets/home/`, with centred headings. Use three equal columns
   on wide screens and stack them on mobile.
4. **What’s with the tree tags?** — directly after the feature cards, explain
   searching physical tag numbers, names, species and place terms, navigating
   to a specific tree and checking its tag on arrival. The search caption
   explains that results are ranked by relevance and nearby distance before
   appearing on the map. Note that some tree data may be inaccurate, invite issue
   reports, and say that these will be passed on to the City of London. Show
   three app screenshots: searching its number,
   following its route and viewing its estimated age. Use each screenshot
   caption for the matching explanation rather than repeating the same three
   points in a separate list. On wide screens, keep the three cards in one
   row. Load these supporting images lazily. The navigation caption explains
   that routes try to favour scenic forest paths and alleyways, without
   guaranteeing them. The screenshots are interim real captures from the app
   (`app-search.jpg`, `app-nearby-route.png`, `app-tree-age.png`), scaled to
   600px wide. Each is framed as a
   phone with a 4px dark-green rounded border and no card around it; its white
   caption card, exactly the phone's width, tucks behind the bottom of the
   phone, and the three caption cards stretch to a common height on wide
   screens. Phone and caption move as two objects: on reveal the phone rises
   further (28px against 10px) and its caption trails by 160ms; on hover the
   phone lifts 6px while the caption moves 1px. The phone's shadow stays tight
   (it deepens only slightly on hover) so it never smudges the caption card. Ages are educated guesses from recorded girth and
   species where data is available, not exact birthdays.
   The introduction pairs its heading and text with the circular tree-tag photo
   (27400) on the right on screens at least 640px wide. On smaller screens, centre
   the photo below the text. Keep its descriptive alt text and lazy loading, with
   no caption or separate section divider. The three app screenshots sit below
   this introduction at the full section width.
5. **Sign-up** — the mailing-list form (§9), boxed in warm cream with a gold
   left border accent using the app icon's gold (`#f3d36b`), matching the
   Ledger card's accent placement. A 52px envelope icon
   (`assets/home/mail.png`, shaded cream and gold with dark-green outline, in the style of
   the homepage map pin), 44px, sits on the heading's line, vertically centred
   on it, never on a line of its own. The section starts with this heading,
   without a repeated signup eyebrow. The layout is tight: email field and button share one row on wide
   screens (stacked on mobile). The introduction doubles as the explicit opt-in
   statement above the form; the privacy line sits below. Both use the full card
   content width; only the email-and-button row has a narrower cap. The opt-in
   statement includes weekly Epping Forest Ledger updates once the site launches.
6. **No signal? Here’s the plan** — three steps: open it once
   on signal, it downloads, it then works anywhere in the forest. The steps and
   the cattle note share one white shadowed card (like the map inventory), so
   there are no floating boxes. Each step has a round dark-green number badge
   with its bold title beside it and a short line beneath; the steps are split
   by thin rules — three columns on wide screens, stacked on mobile — with a
   small circled arrow on each rule showing the sequence. The card's footer is a
   green-tinted strip with the cow icon explaining that fresh cattle locations
   require a connection and saved positions may be stale.
7. **FAQ** — headed “Good to know”, after the offline section, with `FAQPage` JSON-LD (§6.3).
   Covers signal, cost/account, tree data, cattle positions and coverage.
   The tree-data answer credits the City of London, acknowledges possible
   inaccuracies, and explains that the trial will investigate and improve the
   data and report findings back to the City of London. The visible answer and
   JSON-LD use the same wording.
   Each question links to its own stable fragment: `#faq-offline`, `#faq-free`,
   `#faq-tree-data`, `#faq-cattle` and `#faq-coverage`. Direct links scroll to
   the answer with breathing room above it and highlight the targeted row in
   warm cream, including with JavaScript disabled.
   No battery-use question. All answers stay visible (no accordion) in one
   white rounded card, each question-and-answer pair divided by a hairline;
   on wide screens the question sits in a left column beside its answer.
8. **From the Ledger** — the last section before the footer, after the FAQ: an
   inset editorial card matching the sign-up card's layout: responsive padding, a green left border and shadow, the “Round the forest · Every week”
   eyebrow above a 44px newspaper icon (`assets/home/ledger.png`, same style as
   the envelope) centred beside the heading, aligned like the sign-up card.
   It progressively loads the newest report listed at `/reports/` and displays
   its date and a full-width homepage adaptation of its opening summary (which
   starts “This week's Ledger” and removes references to report content below), followed by the leading local find,
   visit-planning update and upcoming event. Each preview shows only its
   category, title, date/status and place; it does not duplicate the report's
   longer descriptions. The primary button
   links directly to that latest edition; an “All editions” link still leads to
   `/reports/`. Without JavaScript, the primary link remains a working route to
   the editions index and the summary is omitted rather than becoming stale.
9. **Footer** — "Created and curated by AI with oversight from Simon McManus"
   (linking to `simonmcmanus.com`), an "AI can make mistakes, please report
   them here" GitHub issues link, and `/terms.html`. No separate
   dataset-attribution paragraph; source explanations remain in the FAQ. The
   reports index (`scripts/generate-reports-index.js`) uses the same footer copy.

### 5.1 Page weight and assets

The walking-distance pillar uses a shaded folded map (`assets/home/distance.png`)
and the location pillar uses the emerald-and-gold Nearby beacon
(`assets/home/logo.png`), stored as independent homepage copies.

The email, Ledger, tree-tag, FAQ and offline illustrations use transparent PNGs
with gentle shading and forest-green contours. “Good to know” uses a question-mark
speech bubble (`faq.png`); “No signal? Here’s the plan” uses a phone showing a
saved map (`offline.png`). Both sit beside their headings at 44px. The tree-tag section heading carries a
numbered metal-tag icon based on the adjacent photograph; the photograph stays
as the real-world example. Their masters and prompts live in
`assets/home/icon-sources/`. The reports index reuses the Ledger PNG.

- Homepage CSS, JavaScript and images live together in `assets/home/`.
  `index.html` references only that directory for local runtime assets. Brand
  and map icons are independent copies, so the homepage does not import app
  code; when the illustrated icon style changes, review and update these
  copies in the same change, preserving transparent backgrounds and readable
  small-size silhouettes.
- The root-scoped app service worker passes `assets/home/` requests directly
  to the browser without reading or writing app/data caches, including for
  returning app users. Marketing releases therefore need no app cache bump.
- Dataset counts remain a read-only checked dependency. Data changes that alter
  counts require a coordinated marketing update, not imports of app code.

- The homepage must **not** load `css/base.css` or any other app stylesheet.
  It gets its own small stylesheet that redeclares only the brand tokens it
  needs (`terms.html` sets this precedent).
- It must **not** load any `js/*.js` from the app.
- It must **not** link `manifest.webmanifest`. If it did, visitors would
  install the *marketing page* as a PWA instead of the app. The manifest stays
  on `app.html` only.
- It must **not** register the service worker.
- The hero is a preloaded, compressed local photograph — never a render blocked
  behind JS. The display copy sits on an adjacent dark panel, so its contrast
  does not depend on the image.

Rationale: the page competes on mobile local search, where speed is a ranking
and conversion factor, and it is the one page that must load fast on a bad
connection.

## 6. Search

### 6.1 Target queries

Local and question-shaped:

- `epping forest map`, `epping forest offline map`, `map of epping forest`
- `veteran trees epping forest`, `ancient trees epping forest`
- `epping forest car parks`, `epping forest toilets`, `epping forest pubs walk`
- `where are the cows in epping forest`, `epping forest cattle`
- `epping forest walks`, `epping forest no phone signal`
- `epping forest paths map`, `epping forest bridleways`

Each target is answered by a real section on the page. No keyword-stuffed copy:
the FAQ and pillar sections cover these because they are the honest answers.

### 6.2 On-page requirements

- One `<h1>`, carrying the headline (§3.1).
- `<title>` and `meta description` from §3.3.
- `link rel=canonical` → `https://www.eppingforestfinds.uk/`. The homepage owns
  the root URL; `app.html` canonicalises to `/nearby`, its entry point.
- Semantic headings in order, descriptive `alt` text, real `<a>` elements.

### 6.3 Structured data

Inline JSON-LD:

- `WebSite` — name, URL, publisher.
- `SoftwareApplication` — name, `applicationCategory: TravelApplication`,
  `operatingSystem`, `offers` priced 0 GBP.
- `FAQPage` — the §5 FAQ entries. This is the cheapest available route to a
  rich result on the long-tail queries above.

Publisher/author is **Simon McManus**, contact `mcmanus.simon@gmail.com`.

### 6.4 Internal linking

The homepage and the weekly ledger currently do not link to each other. They
should: the homepage surfaces the latest reports (§5, item 6), and every
generated report links back to the homepage. This is what lifts both.

### 6.5 Sitemap and robots

`scripts/generate-sitemap.js` changes:

- `/` stays priority 1.0 — now with content actually behind it.
- The app's five screen paths (`/nearby`, `/nearby/search`, `/nearby/filter`, `/settings`,
  `/feedback`) are **not** listed, and are added to `DISALLOWED_PATHS` for the
  duration of the alpha. A gated path that serves crawlers a landing page or a
  403 is a soft-404 signal with no upside. `/app` itself is a bare redirect
  with no content, so it needs no entry either way.
- `/reports/` and `/terms.html` are unchanged.

`test/sitemap.test.js` updates alongside.

### 6.6 Category pages (`/nearby/<slug>`)

**Parity is tested, not just intended.** `test/e2e/30-find-pages.spec.js` loads a
category page with JS disabled, then forces the live Nearby renderer on the same
page, and asserts the heading, type line, chip row (hrefs, labels, `nearby-link`
class), each card's name and footer text, and each arrow's starting angle match.
Nearest-card footers carry the same parts as the live row: walk chip with its
walking icon, type label, optional tree tag, and direction arrow. The static
business list is capped at the same 10-item display limit as the live list, while
the type line's count stays uncapped. The unit suite (`test/find-pages.test.js`)
covers the card markup directly.

**Governing principle: progressive enhancement, with the static and live
renders matching as closely as possible.** Every one of these pages must work
and read as real, specific content with no JS at all — a crawler or a
no-JS/slow-JS visitor gets the genuine thing, not a shell waiting to be
filled in — and the moment JS boots and replaces it, as little as possible
should visibly change. Concretely, that means: the static render reuses the
exact live markup/CSS classes (`.nearest-item`, `.detail-top-row`,
`#inspectorTitle`/`#inspectorType`/`#inspectorTitleEmoji`, the consent
banner's own copy) rather than inventing a differently-styled stand-in that
then visibly restyles itself; any list is built with the *same* data,
ordering, and distance/radius computation the live code uses (reproduced in
the generator since it cannot load `js/app.js` into its own `vm` sandbox —
see `loadAppRules()`, `scripts/report/map-inventory.js`) rather than a
different fallback ordering; and any one-time explanation (e.g. "measuring
from High Beach") is written once, into whichever element both renders
share, rather than duplicated as a second sentence that can drift out of
sync or that live has to delete and redraw. Each of these pieces earned an
e2e test asserting the static and live DOM/text literally match (see "the
live app" tests below and in `test/e2e/30-find-pages.spec.js`) — that
byte-for-byte comparison, not just "both look plausible", is what this
principle is checked against, and is the bar a new static page (e.g. a
future `/nearby/filter`-adjacent or location-style landing page) should be
built to from the start, not retrofitted onto afterwards.

One crawlable page per POI filter subfilter — "Pubs & bars in Epping
Forest", "Historic sites in Epping Forest" — plus one per top-level filter
*group* — "Food in Epping Forest", "Transport in Epping Forest" — pre-
filtering Nearby to every subfilter in that group at once. A group page is a
broader entry point than any single subfilter and has real search volume of
its own ("things to do in Epping Forest" reads at this level, not "pubs in
Epping Forest"). Both kinds are generated by `scripts/generate-find-pages.js`
and wired into `npm run build` (after `generate-reports-index.js`, before
`generate-sitemap.js`, which lists them via `listFindSlugs`). Never gated
during the closed alpha: these pages are real content, not the gated part
of the app.

These pages live under `/nearby/` rather than `/find/` because that is the
screen they actually land on — the Nearby view, pre-filtered — and `/find/`
is reserved for individual businesses and points of interest (not yet
built), never for a category. A category slug can therefore never be
`filter` or `search`: those two are the Filters and Search screens' own
paths at that same depth (`/nearby/filter`, `/nearby/search` — spec.md
"Routing"), not categories, and `collectPages` (`scripts/generate-find-pages.js`,
`RESERVED_SLUGS`) throws at build time if a subfilter or group key's slug
ever collided with either.

**A category page IS the app, not a separate marketing page that links to
it.** The generator templates its output directly off `app.html` — same DOM
(the real map canvas, nav, inspector), same `<script src>` list — rather than
writing a standalone page. Only two things are swapped:

- The `<head>`'s SEO tags: `<title>`, meta description, canonical URL (see
  below), Open Graph `title`/`description`/`url` (app.html's own `og:image`
  is left as-is), and an inserted `CollectionPage`/`ItemList` JSON-LD block
  with `numberOfItems` set to the live count.
- The app's own "nothing selected yet" placeholder inside `#inspectorBody`
  (the one static, pre-boot paragraph `app.html` ships) is replaced with real,
  specific, crawlable text — the category's count and description, plus
  cross-links. A subfilter page links sideways to its siblings in the same
  group and up to that group's own page ("More in Food: ..."); a group page
  links down to each of its member subfilters ("Browse by type: ..."). This
  is exactly what a crawler or a slow-JS visitor sees; `transitionInspectorBody`
  (`js/inspector.js`) overwrites it unconditionally once the real Nearby list
  renders, the same way it already overwrites that paragraph on `/nearby`
  today.

`js/app.js`'s boot sequence (`applyShowFilterFromQuery`) reads the category
straight out of the URL path (`filterKeysFromFindPath`, reversing the
hyphen-for-underscore slug) and calls the existing `setOverviewFilters(keys)`
— a subfilter page resolves to that one key, a group page to every member
subfilter's key at once — so the page lands already filtered on its own URL,
with no redirect through `/nearby` and no separate `?show=` hop (that query
param still works as a fallback on any screen path for any older link).
The same boot step also widens the walking radius to 30 minutes
(`applyRadiusFromQuery`, `LANDING_PAGE_WALKING_DISTANCE_MINUTES`) unless the
URL already named one with `?radius=` — the ordinary 5-minute default is
too easy for a single category to come up empty within, which would
undersell a page whose whole job is answering "is there enough near here to
be worth a visit".

`app.html`'s CSS/JS/icon references, and several of the app's own
runtime-constructed ones (`FOLKLORE_URL`/`PATHS_URL`/etc. in `js/app.js`,
`navigator.serviceWorker.register("sw.js")` in `js/nav.js`), are relative
paths — correct from a one-segment path like `/nearby` but not from one
directory deeper, where the browser resolves `"css/base.css"` against the
page's own directory and 404s. That reach extends further than `/nearby/<slug>/`:
`/nearby/filter` and `/nearby/search` (spec.md "Routing") are one segment
deep in exactly the same way. Rewriting every `href`/`src` in the markup
alone isn't enough, since it can't reach the paths JS constructs at runtime
(this was found by the service worker registration itself 404ing on a live
page). `app.html` carries `<base href="/">` as the first thing after
`<meta charset>` for exactly this reason — one tag that changes what *every*
relative URL on the page resolves against, markup and script-constructed
alike, for every path the file is ever served at, without touching any of
`app.html`'s or the JS files' existing relative-path code. The generator
inherits it for free by templating off that same file, so it has nothing of
its own left to insert.

**Without location, a category page lists and shows everything in its
category anyway — it does not sit behind the "enable location" prompt.**
`overviewNearestHtml()` (`js/app.js`) special-cases exactly this:
`activeFiltersShowFullListWithoutLocation()` is true with no `state.userLocation`
and either exactly one active filter (a subfilter page, or a reader's own
deliberate single choice) or several filters but only when
`state.overviewFiltersEphemeral` is set (a group page's own pre-filter —
never a reader's own multi-filter choice, and never the 1-3 filter default
state nobody chose, which would otherwise try to list the entire matching
dataset). In that case it lists every match via `allEntriesForActiveFilters`
(dataset order, no distance — there is no origin to measure from) instead of
the generic prompt, and `fitMapToSingleFilterIfNoLocation` fits the camera to
all of them instead of the forest-wide default `fitToBounds` leaves in
place, so the map is genuinely zoomed to the category (or categories) rather
than an arbitrary framing. Granting location is unaffected — same
radius-based nearest list and camera behaviour as everywhere else in the app.

**The map pins themselves need the same fallback as the list, separately.**
`buildFullNearbyIconLookup()` (`js/renderer.js`) is the one source every pin
draw and hit-test reads from, and on its own it only ever scans
`overviewItemsForActiveFilter()` — origin-only, same as the list — so the
list could show every restaurant while the map, reading a lookup built from
nothing, drew none of them. It takes the same `allEntriesForActiveFilters`
fallback under the same condition. Its cache key (`nearbyIconLookupCacheKey`)
needed the matching fix: without an origin it used to collide on one
constant key regardless of which filter(s) were active, harmless while that
case was always empty, but a real bug once it was not — switching from one
category page to another with no location would have kept showing the first
one's pins. The key now stays `state.overviewFilters`-aware in both
branches.

- **Slugs**: a subfilter or group key with underscores turned to hyphens
  (`national_rail` → `/nearby/national-rail`). The canonical URL carries a
  trailing slash (`/nearby/pubs/`), matching `/reports/`: Netlify's static
  hosting serves `nearby/<slug>/index.html` directly only at that
  trailing-slash path, 301-redirecting the bare one to it, so the
  canonical/OG/JSON-LD `url` and every sitemap entry and cross-link use the
  slash form, not the one that redirects.
- **Counts and labels** come from `scripts/report/map-inventory.js`'s
  `buildInventory()` — the same classification the weekly report and the
  homepage's dataset counts use, so a category page's number is never a
  second, separately-computed guess (a group page's count is its members'
  counts summed). This also means the same two exclusions apply: `cows`
  (live-tracked, no fixed count) and the whole `events` group (time-bound,
  not a static map fact) never flow through this inventory-driven path, and
  no group page is generated for `events` or for any other group
  `GROUP_TITLES` (`scripts/generate-find-pages.js`) has no hand-picked
  description phrase for. `cows` and `events` do each still get their own
  page (`/nearby/cows/`, `/nearby/events/`) — `renderCowsPage`/`renderEventsPage`
  generate them directly in `generate()`, outside `collectPages`, since both
  are real filter keys `filterKeysFromFindPath` (`js/app.js`) already
  resolves like any other subfilter slug; their content is honest about
  having no fixed count/list to show rather than one manufactured to look
  like a normal category page's.
- **Output**: `nearby/<slug>/index.html`, gitignored like `sitemap.xml` and
  `reports/index.html` — regenerated fresh on every build, never committed.
  Sharing a path prefix with the Nearby, Filters and Search screens needs
  one more piece of care that `/find/<slug>/` never did:
  `scripts/generate-sitemap.js`'s `DISALLOWED_PATHS` disallows the three
  gated screens (`/nearby`, `/nearby/search`, `/nearby/filter`) with a
  trailing `$` — robots.txt's own end-of-path anchor — rather than the bare
  path a plain `Disallow: /nearby` would otherwise prefix-match. Without the
  anchor, that one line would also swallow every `/nearby/<slug>/` category
  page nested under the same prefix, silently undoing the entire point of
  generating them.
- **Offline fallback, without inflating the app cache.** `isAppNavigation()`
  (`sw.js`) recognises `/nearby/<slug>/` and `/find/<slug>/` (any single-
  segment path under either prefix) as app navigations, alongside the app's
  fixed screens, so a navigation to one of them never falls through to the
  browser's own network-error page. But unlike the five fixed screens (which
  share one `./app.html` cache entry because they're genuinely byte-identical
  content), none of these ~1,500+ generated pages are ever written into that
  shared slot — each has its own distinct title and JSON-LD, so caching any
  one of them there would make that slot's content depend on whichever page
  was last loaded. They're fetched
  network-first instead (so an online visitor always gets that exact page's
  real content) and only fall back to the generic shared shell when offline —
  the real app still boots and works, just unfiltered rather than
  pre-filtered to that one category/business, which is the honest trade-off
  available without precaching 1,500 individual pages. The app's working set
  stays the JSON data plus the one shared shell either way; none of this
  shows up as extra cache weight.
- **Also not yet done** (tracked separately): per-page content (the specific
  category or business's own title/body) itself has no offline case —
  the fallback above is the generic app shell, not that page's own HTML.
- **Category pages now list every individual place they cover**, not just a
  count sentence: `renderPage` (`scripts/generate-find-pages.js`) reads
  `listBusinessesForFilterKey(page.key)` (`scripts/generate-business-pages.js`)
  and, when that subfilter/group falls inside the `/find/` scope below, prints
  a card per place, each linking to its own `/find/<slug>/` page. A category
  outside that scope (transport, history, stories) gets an empty list and
  falls back to the summary sentence it always had — this is conditional on
  the business index actually covering the key, not a second hand-maintained
  list.
- **Every such list reuses the live Nearby list's own `.nearest-item` card**
  (`nearestItemCardHtml`, `scripts/generate-find-pages.js`), not a bare `<ul>`
  styled only by the browser's own defaults. Before this, a reader — or a
  crawler — saw a plain, unstyled blue-link list that then visibly reflowed
  into cards the instant `js/app.js` replaced it with the live Nearby list;
  the static page now already looks like the screen it's showing. The
  per-item icon is `filterKindEmoji(key)` (`js/categories.js`, now also
  exposed by `loadAppRules()` — `scripts/report/map-inventory.js`), read off
  each business's own `key`/`groupKey` (a group page mixes several
  subfilters, so this is never a single icon guessed from the page itself).
  `.nearest-item` is already used this way for a plain `<a>` elsewhere
  (`relatedCategoryLinksHtml`, `js/inspector.js`'s "nearest tree"/"nearest
  cow" cards), so this is the same established pattern, not a new one.
- **The list itself is distance-sorted and walking-radius-filtered, matching
  what the live Nearby list shows for a visitor with no real location fix**
  (`nearestWithinWalkingRadius`, `scripts/generate-find-pages.js`), rather
  than every matching place in dataset order. A build has no visitor to
  measure a real distance from, so it measures from the same
  `DEFAULT_LOCATION` (High Beach) stand-in `revealNoRealLocation()`
  (`js/app.js`) centres the live map on, within the same
  `LANDING_PAGE_WALKING_DISTANCE_MINUTES` (30 min) radius a landing-page
  arrival widens to live — falling back to the nearest 3 overall when
  nothing falls inside that radius, so the list is never empty. Each card
  gets the matching `.nearest-footer`/`.walk-chip` distance-and-walk-time
  label (same `formatDistance`/walk-time formulas as the live Nearby list,
  replicated here since this script cannot load `js/app.js` into its `vm`
  sandbox — see `loadAppRules()`, `scripts/report/map-inventory.js`). Before
  this, a crawler or no-JS visitor saw every shop or pub in the dataset in
  build order, while JS replaced it moments later with a short, nearest-first
  list scoped to a 30-minute walk — the two renders showed genuinely
  different content, not just a different look.
- **The page's own heading names its real category, not a generic
  placeholder, and the "measuring from High Beach" note is folded into its
  type line rather than a separate sentence in the list body.**
  `inspectorHeadingHtml` (`scripts/generate-find-pages.js`) templates
  `#inspectorTitleEmoji`/`#inspectorTitle`/`#inspectorType` — the exact same
  three elements `selectOverview()` (`js/inspector.js`) sets live — to read
  "Nearby `<Category>`" (e.g. "Nearby Pubs & bars") with the generic "nearby"
  pin icon, instead of app.html's own pre-boot placeholder ("Epping Forest
  Finds", no icon, no type line). `landingPageCategoryLabel()` (`js/app.js`)
  resolves the live heading the same way from the current `/nearby/<slug>/`
  path, so the two never show a different heading moments apart. The type
  line itself is "`<count>` `<Category>` within 30 min walk of High Beach"
  where a real within-radius count exists at build time (a business list, or
  a single nature filter) and falls back to the honest no-count "Nearest
  `<Category>` around High Beach" where it doesn't (transport, history,
  stories) — mirroring `overviewHeadingText()`'s (`js/app.js`) own branches,
  which append the same "of High Beach"/"around High Beach" suffix only
  while `state.userLocation.isDefault`.
- **The generic "Find all `<count>` `<title>` in Epping Forest, mapped and
  ready to walk to" lead sentence is dropped from the visible body wherever a
  real itemized list already demonstrates the page's content** (businesses,
  or trees/water) — it read as boilerplate filler sitting right above a real
  list. It survives only in the SEO `<meta name="description">`, and as the
  visible body text for the categories with no itemized list of their own
  (transport, history, locations, stories), which would otherwise show
  nothing but pills and a sibling-links paragraph.
- **The separate "Enable location to see how far away..." sentence is gone,
  folded into `#consentBanner`'s own copy instead of repeating the same ask
  twice on the page.** `customizeConsentBannerText` (`scripts/lib/html-template.js`)
  replaces the banner's generic lead phrase with one naming the page's own
  category (e.g. "Enable location to get walking directions and see what's
  near pubs and bars") — the cookie-consent half of the sentence, and the
  banner's accept/decline buttons, stay the same either way, since enabling
  the one banner covers both regardless of which page asked.
- **Bare `/nearby` has a static index too, but a narrower one.** Its own
  root file, `nearby-index.html`, is generated by `renderNearbyIndexPage`
  (`scripts/generate-find-pages.js`) and routed to by `/nearby` alone
  (`netlify.toml`, `server.js`); `/nearby/search`, `/nearby/filter`,
  `/settings` and `/feedback` still rewrite to `app.html`. It lists the
  nearest trees within the 30-minute walk of High Beach, the no-fix origin,
  using the same list and cap as the live screen, under the heading
  "Nearby" and the type line "Nearest selected filters within 30 min walk
  of High Beach". The page also carries the location and cookie banner
  (`#consentBanner`, shown by default as on a landing page), the Filters
  button with its live count, and `data-server-rendered-nearby` on
  `#inspectorBody`. Boot keeps that list on screen, without rebuilding it,
  until a real location fix arrives, and only while the filters are still
  the default set, so nothing repaints as JS starts. The banner hides again
  for a visitor who has already answered the cookie question, and on a
  first visit the onboarding wizard takes its place. The list is trees
  only: cows and events join it only once a real fix rebuilds the list.
- **The static page carries one pill row at the very top of a
  `/nearby/<slug>/` landing, matching `categoryLandingLinksHtml()`
  (`js/app.js`) chip for chip** (`topChipsHtml`, `scripts/generate-find-pages.js`;
  `.detail-top-row.related-chips`/`.detail-map-link`, `css/inspector.css`;
  icons via `appIconHtml`/`treeSpeciesIconHtml`, both exposed by
  `loadAppRules()`). In order: a chip up to the category's own group; an
  "Everything nearby" chip back to the unfiltered list; on a **group** page
  only, a down-link pill per member subfilter ("Browse by type" — e.g.
  `/nearby/nature/` gets "Trees" and "Ponds & streams", excluding cows, which
  is live-tracked with no fixed count and so never one of a group's own
  `page.members`, `COW_KEY`, `scripts/report/map-inventory.js`); and a
  "see also" pill each for veteran trees and grazing cattle, omitting a
  self-link (`/nearby/trees/` never gets its own trees pill, `/nearby/cows/`
  never its own cows pill) and never repeating a pill the type-chip row
  already shows (the nature group page's own "Trees" pill is the only trees
  link there — the see-also row doesn't add a second one next to it).
  `selectOverview()` replaces the rest of this body with the live list the
  moment JS boots, but had no up-links of its own until `categoryLandingLinksHtml()`
  grew this same logic — without it, a reader (or a crawler) saw this whole
  row until JS swapped it in and then never again. `/nearby/cows/` and
  `/nearby/events/` (rendered outside `collectPages`/`renderPage`, so with no
  `page.groupSlug` of their own) get the breadcrumb half too, via
  `groupContainingSubfilter()` — the same group lookup `FILTER_SUBFILTERS_BY_KEY`
  does live. `/nearby/events/`'s chip points back to itself (its own
  subfilter and group share the "events" key) — a pre-existing quirk of the
  live version this faithfully reproduces rather than silently "fixing" only
  on the static side, which would be a new mismatch, not a smaller one. This
  used to be two separate plain-text sentences at the *bottom* of the page
  ("Browse by type: ..." and "See also veteran trees and grazing cattle near
  Epping Forest.") — reshaped into pills and promoted to the top so they
  survive `selectOverview()` instead of vanishing with the rest of the body.
- **`trees` and `ponds_streams` get a real nearest-item list exactly like a
  business does — including on the `nature` group page, where it's the
  *same* list, not two separate ones** (`natureNearestListHtml`,
  `scripts/generate-find-pages.js`). This replicates
  `overviewItemsForActiveFilter()`'s own per-filter computation (`js/app.js`):
  each active filter key (trees, water, or both on the nature group page) is
  scanned independently for matches within the walking radius, falling back
  to its own nearest 3 if it has none — the same `nearestWithinWalkingRadius`
  every business-scope list above already uses, called once per filter — and
  the results are concatenated and re-sorted by real distance before capping
  the display to 10 (`state.nearestItemsCount`, `js/app.js`). Trees
  (~24,900 individually anonymous Veteran Tree Register records) vastly
  outnumber the ~100 named water features within any given radius, so the
  nature group page's own merged list reads as "mostly trees" both here and
  live — matching what JS shows a moment later instead of disagreeing with
  it, which a water-only list (or a tree species breakdown, tried and
  dropped: see below) would. A tree has no name and no `/find/<slug>/` page
  of its own (§6.7's scope carve-out), so each card links to
  `/nearby/trees/#tree=<hashKey>` instead — the app's own existing `tree=`
  deep-link route (same mechanism as `#water=`/`#place=`), so clicking one —
  static page or not — selects that exact tree live. `treeHashKey`/
  `treeDisplayName`/`treeTagLabel` (`js/app.js`) are reproduced in the
  generator (`loadTrees` reads the on-disk chunked dataset into the same
  shape `js/loader.js` normalizes `state.trees` into) for the same reason
  `DEFAULT_LOCATION` above is: that file can't load into `loadAppRules()`'s
  `vm` sandbox. **A tree species breakdown ("By species: Common Beech —
  13,122...") was tried first and dropped**: real and useful on its own, but
  it made no sense as something tied to a High Beach stand-in nobody is
  actually standing at, and didn't match what the live list showed either
  way — the nearest-item list above is what actually satisfies "the same
  content, live or not."
- **Every category/subcategory page also links onward to veteran trees and
  grazing cattle, as pills in the top chip row above, not a bottom
  sentence** — see the top-pill-row bullet above for exactly how the
  trees/cows "see also" pills are built and when each is omitted.
- **Title tags state the page's own real content, not a repeated generic
  phrase.** A subfilter page's title leads with its count (`"129 Pubs & Bars
  in Epping Forest | Epping Forest Finds"` — a plural noun reads naturally
  with a number in front); a group page's count sits after its label instead
  (`"Food in Epping Forest — 1,359 places | Epping Forest Finds"`, since a
  group label like "Food" isn't grammatically a plural noun). Both are the
  most concrete, searched-for fact the page has to offer, computed from the
  same live count the page's own content shows.

## 6.7 Individual business/location pages (`/find/<slug>/`)

One crawlable page per individual place, for the two groups where a
place's own name is itself worth searching: **Food** (pubs, restaurants,
cafés, shops) and **Locations** (churches, education, medical sites,
campsites). Never trees, transport, history or stories — scoped out
deliberately: trees alone are 24,906 records with no individual page of
their own (an order of magnitude bigger than this whole feature, and far
thinner — a tag number and a species, nothing else), and a bus stop or a
war memorial has no comparable "find this exact one" search intent the way
a named pub does.

**Why a committed index, not build-time-only output.** Every other `/find/`
or `/nearby/` artifact (the pages themselves, `sitemap.xml`) is build-time
output, gitignored and regenerated fresh by `npm run build` — but three
independent consumers need the *same* slug for the same place without
running a build: the live app (a map pin's inspector links to its own
page), the weekly Ledger renderer (a business mention links to its page),
and the page generator itself. `data/business-slugs.json`
(`scripts/regenerate-business-slugs.js`) is therefore **committed**, the one
exception to the gitignored-build-output rule above, and is the single
source every one of those three reads rather than recomputing its own
slug. Run `npm run regen:business-slugs` after any change to the underlying
place data (a landmark regen, a weekly business-watch merge);
`test/business-slugs.test.js` fails the build if the committed file goes
stale, the same drift guard `sync-homepage-counts.js`/`home-counts.test.js`
use for the homepage's counts.

- **Slugs**: the place's name, lowercased and hyphenated. A name collision
  (chain branches — Costa, Boots, Londis) is disambiguated first by the
  address's UK postcode outward code (`costa-e4`, `costa-e11`) when that's
  unique per branch, and only falls back to a numeric suffix
  (`boots`, `boots-2`) when even that doesn't separate two branches (no
  usable address, or two branches sharing one outward code).
- **Content, server-rendered, no JS required**: name, category, address,
  phone (`tel:` link) and website where known, distance from the forest
  boundary, a "Nearby" list of the real closest other `/find/` places by
  haversine distance (genuinely unique per page — two pages never share this
  list), and up-links to the place's own subfilter and group category pages.
  This swaps the same `app.html` "nothing selected yet" paragraph the
  category pages replace (§6.6) — a `/find/` page is the same templated app
  shell, not a separate static page.
- **The consent banner names the place too.** The same
  `customizeConsentBannerText` swap as §6.6 replaces `#consentBanner`'s generic
  lead phrase with "Enable location to get walking directions and see how far
  you are from `<name>`", so the server-rendered banner and the live one match.
  `/find/events/` keeps app.html's default copy: it is excluded from
  `isLandingPageArrival()` and never shows the combined banner live.
- **Two more fields, shown only when the source data actually has them —
  never manufactured copy to pad a page out**: raw OSM `opening_hours`
  (~80 of 1,500 entries today), and, for the handful of entries sourced from
  the folklore dataset rather than OSM, that record's own narrative
  (`folkloreSummary` — genuinely unique text no other page shares, not a
  second description computed from the same name/address/category fields
  every page already shows). A third field, `verifiedAt` (a verification
  date from `data/verification.json`'s `confirmed` map), still rides along
  in `data/business-slugs.json` and `js/loader.js`'s live place object, but
  is no longer rendered anywhere — an earlier "Checked against OpenStreetMap
  on \<date\>" note was removed (both the static page and the live view) for
  sitting directly beside the Nearby/Related distance cards below and
  reading as if it were crediting OpenStreetMap as their source, when those
  distances are computed entirely from this site's own data. Fixed a related bug in the same change:
  `normalizeFolkloreLocations` (`js/normalize.js`) returns
  `latitude`/`longitude`, not `lat`/`lon` like an OSM record, so every
  folklore-sourced business entry previously got `lat: null, lon: null` --
  no coordinates, no "Nearby" list of its own, never appearing in anyone
  else's either. `scripts/regenerate-business-slugs.js` now remaps this
  explicitly.
- **Opening hours and a tappable phone number are not static-page-only —
  the live view shows the same thing.** Once JS boots and a place is
  selected (on `/find/<slug>/` itself, or anywhere else in the app),
  `showLandmarkDetails` (`js/inspector.js`) adds an "Opening hours" row
  alongside Address/Type/Area/Confidence (gated on `place.openingHours`,
  same as the static page — never shown when absent); `detailsHtml`'s
  generic row renderer wraps a `"Phone"` row's value in a `tel:` link
  rather than leaving it as inert text, matching the static page's own
  `tel:` link.
- **Landing on `/find/<slug>/` selects that exact business, through the
  app's own ordinary deep-link path — no separate mechanism of its own.**
  `routeValueFromLocation()` (`js/app.js`) resolves the URL to the same
  `place=<hashKey>` value a `#place=<key>` hash already would (via
  `findPlaceByFindSlug`, a reverse lookup over the loaded landmarks), so
  `applySelectionFromHash()` — the same boot step that opens a tree or place
  named by any other deep link — selects and shows it. (An earlier version
  of this page embedded its own coordinates for a dedicated
  `applyFindPageOrigin()` step to anchor the Nearby screen; once this
  selection path existed that anchor was always immediately overwritten by
  the selection itself — `showRoutedSelection` clears `state.nearbyAnchor`
  — so it was removed as dead weight.) The no-JS fallback is the
  server-rendered content itself. `isLandingPageArrival()` (`js/app.js`,
  "Onboarding" in `spec.md`) also recognises a `/find/<slug>/` path, the
  same as `/nearby/<slug>/` — without it, a genuine first-time visitor
  (not just a returning one) landed on the first-run onboarding wizard
  instead of the business, since `boot()` awaits the wizard's own dismissal
  before reaching the selection step above.
- **Related-content links, both server-rendered and live, as two headed
  sections.** The static page (`scripts/generate-business-pages.js`) renders
  the same inspector panel the live page does, with the same classes: header
  (name, category, category icon), detail rows, and `Nearest` / `Related`
  `<h3 class="detail-section-heading">` sections of `.nearest-item` cards. Its
  cards are real links even with no JS, but carry no distance for the
  trees/cattle (a build-time figure would be wrong for live-tracked cattle
  positions by the time anyone reads it).
  Once JS boots and the business is selected, `relatedCategoryLinksHtml()`
  (`js/inspector.js`) renders the live continuation as two
  `<h3 class="detail-section-heading">`-headed lists — **Nearby** (the
  nearest tree, when any cow positions are currently loaded the cows, each
  with a real live walk-time via `nearestTreeTo`/`nearestCowTo`,
  `js/app.js`, and always the "Everything within 15 min walk" card, below)
  and **Related** (this place's own subfilter and group) — so the reader
  always knows which kind of link they're looking at. Both sections render
  the exact same `.nearest-item` card the Nearby list itself uses (icon,
  name, and — Nearby only — a walk-time chip; Related has no distance of
  its own to show), not the mismatched pill-chip/card pairing an earlier
  version of this had: one visual language throughout, not two.
  `a.nearest-item` gets a small `text-decoration: none; color: inherit;`
  override in `css/map-ui.css` since that class is normally a `<button>`,
  which has no default link underline to begin with. The cows card is
  omitted entirely when no cow positions are currently loaded (`state.cows`
  empty), rather than showing a distance to nothing. The two headed
  sections (Nearby and Related together) are scoped to places with a
  `findSlug` (the same food/locations groups throughout this section) —
  any other selected place (a tree, a bus stop) has neither this static
  server-rendered version nor `relatedCategoryLinksHtml()`'s live one, but
  still gets its own one-card "Nearby" section for the walk-radius card
  alone (`standaloneNearbySectionHtml`, "Selected Detail Content" in
  `spec-data-rendering.md`) — the walk-radius card itself is never scoped
  to `findSlug`.
- **The trees and cows links both carry the selected place's own position**,
  via `/nearby/trees/`'s and `/nearby/cows/`'s existing `near=<lat>,<lon>`
  browse-anchor route (`nearbyAnchorRouteValue`, `js/app.js` — the same one a
  map tap or a shared link already use): `#near=${lat.toFixed(6)},${lon.toFixed(6)}`
  on both the static page's links (`scripts/generate-business-pages.js`,
  falling back to a bare `/nearby/<slug>/` when the entry has no
  coordinates) and the live cards' hrefs (`js/inspector.js`). Without it,
  landing on either page re-anchored to the reader's own GPS fix, showing a
  distance to the nearest tree/cow from *there* rather than from the
  business the card's own distance was quoted against — reported live as
  "nearest grazing cattle... is doing the correct behaviour... but for
  veteran trees it's still using the current user's location" once the cows
  link was fixed first and the trees link, which carried the identical bug,
  was initially assumed not to need the same fix (an earlier version of this
  spec said so explicitly, reasoning that `/nearby/trees/` already lists
  everything nearby rather than promising one distance — true of the page in
  general, but not of the one card linking to it, which does quote a single
  distance to a single nearest tree the same way the cows card does).
- **Every in-app link rendered into the inspector is a real SPA transition,
  not a full page reload.** A plain `<a href="/...">` (every link above,
  plus `fullDetailsLinkHtml`'s own "Full details") used to fall straight
  through to the browser's own navigation — re-downloading and re-booting
  the whole app shell for content already sitting in memory, the one thing
  this whole feature's internal linking was supposed to avoid. A delegated
  click handler on `#inspectorBody` (`js/nav.js`) now intercepts a click on
  any such link (skipping `target="_blank"` links — Open in Maps, external
  website/source rows — and a modified click, both left to the browser as
  normal) and calls `navigateInApp(href)` (`js/app.js`): the same
  `history.pushState` shape `setHashFromSelection` already uses, followed by
  `applyRouteFromUrl()` — the same entry point the back/forward buttons and
  a hand-edited hash already use — so an intercepted link behaves exactly
  like landing on that URL any other way, just without the reload.
- **Category/subcategory pages keep their own pill row once JS boots.** The
  static page's whole top chip row (§6.6 — breadcrumb, a group page's own
  "Browse by type" members, and the "see also veteran trees/grazing cattle"
  pills) is real markup with no JS, but `selectOverview()` replaces that
  whole static body with the live, interactive Nearby list the moment JS
  boots — which had no chip row of its own, so a real visitor's browser
  silently dropped it the instant the page finished loading. `categoryLandingLinksHtml()`
  (`js/app.js`) reproduces all of it live, chip for chip, gated on the URL's
  own path (same regex `filterKeysFromFindPath`/`isLandingPageArrival` use —
  never a reader's own multi-filter choice from the Filters screen, which has
  no single category to breadcrumb up from) and prepended to every one of
  `overviewNearestHtml`'s return paths, the empty-list ones included, so it
  survives exactly the states that most need a way out of a now-empty
  category list. A subfilter page's sideways "More in `<group>`:
  `<siblings>`" link is the one piece that stays a plain-text paragraph at
  the bottom rather than a pill — it isn't reproduced live, the same gap
  this whole bullet used to describe for everything else before the pill
  row existed.
- **Linked everywhere a business is mentioned, not only from its own page**:
  `js/loader.js` fetches `data/business-slugs.json` alongside the other
  datasets and attaches `findSlug` to each matching place; `showLandmarkDetails`
  (`js/inspector.js`) renders a "Full details" link to it when present — so
  tapping the pin on the map, or finding it through in-app search, links to
  the same page. Suppressed only when the page already showing *is* that
  business's own `/find/` page (landing there already selects it, per above),
  where the link would otherwise be a dead end pointing at itself. The weekly
  Ledger (`scripts/report/business_links.py`) resolves a finding's name (and,
  for a name shared by more than one branch, its coordinate) against the
  same index and links the business's name in the rendered report —
  conservatively: an unresolvable or still-ambiguous name links to nothing
  rather than risking a wrong link.
- **Selecting such a business anywhere in the app navigates the address bar
  to this same URL** — see "Routing" in `spec.md`.
- **Events get one index page, not individual pages**: `/find/events/`
  lists every entry from `data/forest-events.json` and `data/events.json`
  with its date, place and source link. Time-bound events are a poor fit for
  a permanent per-event URL (a page for a dated fair reads as dead content
  once the date passes), and the dataset is currently small (single digits);
  this is revisited if and when individual event pages would earn their own
  URL.
- **Title/meta/JSON-LD**: `"<name> – <category> in Epping Forest | Epping
  Forest Finds"`, a description naming the category and distance from the
  forest boundary, and a `LocalBusiness` JSON-LD block typed per category
  (`BarOrPub`, `Restaurant`, `CafeOrCoffeeShop`, `Store`, `Church`, `School`,
  `MedicalClinic`, `Campground`) with address/geo/telephone/sameAs where
  known.
- **Output**: `find/<slug>/index.html`, gitignored like `nearby/<slug>/` —
  regenerated fresh on every build by `scripts/generate-business-pages.js`,
  wired into `npm run build` after `generate-find-pages.js` and before
  `generate-sitemap.js`, which lists every slug via `listBusinessSlugs`.
  Sitemap priority is deliberately lower than the category pages and
  reports (`0.3` against `0.5`/`0.6`): roughly 1,500 of these next to a few
  dozen category pages would otherwise dilute crawl budget away from the
  pages that actually drive discovery. `/find/events/` keeps the category
  pages' own priority (`0.5`) as a hub rather than one of the 1,500.

## 7. The hero image

The supplied photograph of GPS-collared English Longhorns is used as the hero
image and as a separately cropped social card. The collar is the detail that
makes the live-cattle feature possible and tells the product's best story
without a caption.

Requirements:

- Beside the hero text, never competing with it: the headline sits on the
  forest-green panel and meets contrast requirements independently of the
  photograph.
- Readable at 320px wide (single column, phone) and at full desktop hero width.
- Served in a modern format at a sensible size. This page competes on mobile
  local search, so the hero must not be the reason it loads slowly.
- Not blocked behind JavaScript — it is part of the page, not an enhancement.
- A 1200×630 crop of the same image serves as the social card (section 10), so
  the composition needs to survive that aspect ratio with copy beside it.
- Meaningful `alt` text describing the animal, not the file.

The 1600×1200 hero JPEG and 1200×630 social JPEG live in `assets/home/`. The
hero is preloaded and neither image is blocked behind JavaScript.

## 8. The call to action

The CTA is **one swappable element**, not a theme running through the copy.
Launch must be a configuration change, not a rewrite.

The alpha state (owned by `spec-alpha-access.md`) selects between two states.
There is no third "waves" state: access is a shared secret link, so letting
people in a batch at a time is a matter of who you mail the link to, not a mode
the site runs in.

| State | CTA | Supporting line |
| --- | --- | --- |
| `closed` | Keep me in the loop → sign-up form | "Sign up to hear when early testing opens." |
| `open` | Open the map → `/nearby` | "Free, and it works offline." |

Everything else on the page — the pillars, the counts, the FAQ, the ledger
links — is written to be true in all three states and does not change.

The page must not imply immediate access or invitations already being sent.
The signup heading is “Be in the know”, the submit button
is “Email me updates”, and the introduction offers news when early testing opens
and weekly Ledger updates once the site launches. The consent statement retains
the same mailing scope.

## 9. Mailing list

### 9.1 Provider

**EmailOctopus**, called server-side from a Netlify function.

Chosen over Buttondown on one point that matters here: it is UK-based with
EU/UK data residency, which keeps the UK GDPR story simple for a UK product
collecting UK subscribers. Both offer the double opt-in and compliant
unsubscribe that are the actual requirement.

The API key lives in a Netlify environment variable and is documented in
`.env.example` alongside the existing `ADMIN_PASSWORD`. **It is never exposed
to the client** — the browser posts to our own endpoint, which calls the
provider. The form never posts directly to a third-party endpoint.

### 9.2 Endpoint

`POST /api/subscribe` → `netlify/functions/subscribe.js`, routed in
`netlify.toml` alongside the existing `/api/*` redirects.

Accepts an email address and a consent flag. Returns a neutral success response
whether or not the address was already subscribed — an endpoint that reveals
which addresses are on the list is an enumeration oracle.

### 9.3 Consent and compliance

- The dedicated email signup uses an explicit **“Email me updates”** button
  instead of a checkbox. The nearby consent statement explains the sender and
  mailing scope, and is associated with the button via aria-describedby.
  Only submitting the form sends the affirmative consent flag to the endpoint.
- Double opt-in remains required. A new contact receives a confirmation message,
  but EmailOctopus does not resend one when an existing contact produces a 409.
  Both responses reveal the same inbox instructions without claiming a new email
  was sent or exposing whether the address is already listed.
- While sending, the form stays visible with a disabled submit button and busy
  state; repeated submissions are ignored. Errors preserve the address and restore
  the button so the visitor can retry.
- On success, the entire signup introduction and form are hidden and replaced by
  a dedicated panel: an envelope illustration marked with a gold **2** badge,
  **“Step 2 of 2”**, **“Confirm your email to finish”**, instructions to check
  the inbox, open the email from Epping Forest Finds and click **“Confirm my
  email”** to complete sign-up, and a spam/junk reminder. The numbered image
  and heading make the remaining action explicit, rather than implying that
  submitting the form completed the subscription. There is no separate pre-submit confirmation
  reminder. The heading receives keyboard focus; the panel scrolls into view only
  if needed. Reloading restores the form.
- A gold **“Don’t forget”** reminder sits beside the step label. Its decorative
  bell makes one gentle 900ms swing after a 500ms delay; it never loops. The
  reminder remains static for reduced-motion visitors.
- Motion runs once: a 140ms fade and slight lift removes the entry panel, a 420ms
  height transition settles the card, and the envelope and text gently arrive
  over roughly half a second. There is no looping animation. Reduced-motion
  visitors get the same focused confirmation immediately, without animation or
  smooth scrolling.
- Record the consent timestamp **and the wording consented to**, so the record
  survives later copy changes.
- Every message carries a working unsubscribe link from the first one.
- Consent wording in the form and server-side record must match exactly:
  “By choosing “Email me updates”, you agree to receive emails from Epping Forest Finds when early testing opens, plus weekly Epping Forest Ledger updates once the site launches.”
  Nothing else is sent to this list without fresh consent.

### 9.4 Privacy policy changes (blocking)

`terms.html` §2 currently states, under *"What we do NOT collect"*: **"Your
name, email address, or any account details."** Shipping the form makes the
published policy false. The policy must be updated in the same change set, not
afterwards. Required edits:

- Remove email address from the "do not collect" list.
- Add a mailing-list section: lawful basis (consent), purpose, what is stored,
  retention, and how to unsubscribe.
- Name the data controller: **Simon McManus**, `mcmanus.simon@gmail.com`.
- Name **EmailOctopus** as a processor.
- Keep the existing anonymity claim intact for tracking data, and state
  explicitly that **mailing-list addresses are not linked to the anonymous
  tracking identifier**. This is true by construction: access is a single
  shared secret, so the gate carries no per-person identity there would be
  anything to link.

### 9.5 Abuse

A public POST endpoint will be abused. Mitigations, in preference order:

- Hidden honeypot field, rejected silently if filled.
- Submission speed is not treated as a bot signal: browser autofill can produce
  a legitimate immediate submission.
- Per-IP rate limiting in the function.

The function logs privacy-safe processing stages with the Netlify invocation
ID, including validation failures, honeypot acceptance, configuration presence
and the EmailOctopus response status. It never logs the submitted address or
API key.

No third-party captcha. The script weight and the privacy cost are not worth it
at this volume, and it would sit on the one page that must load fastest.

## 10. Social sharing

### 10.1 Social card

`index.html` declares `twitter:card=summary_large_image` and points its Open
Graph and Twitter image fields at the dedicated 1200×630 longhorn crop.

### 10.2 Requirement

- A purpose-built **1200×630** crop of the supplied longhorn photograph (§7).
- Absolute URL. `og:image:width`, `og:image:height` and `og:image:alt` set.
- `twitter:image` set explicitly.
- `og:title`, `og:description` from the phrase bank (§3.3, §3.5).
- `og:type: website`, `og:site_name`, `og:locale: en_GB` — as `index.html`
  already does correctly.

### 10.4 Crawler access

The social image, the homepage, `robots.txt`, `sitemap.xml` and `/reports/*`
must all be reachable **without the alpha gate**. Crawlers and link unfurlers
carry no invite cookie. Gating any of them breaks every share preview.

The gate therefore covers only the app's five screen paths (`/nearby`,
`/nearby/search`, `/nearby/filter`, `/settings`, `/feedback`) and `/app.html`, never `/app`
itself (a bare redirect, not a gated page). This is a deliberate trade
recorded in `spec-alpha-access.md`: the loose assets under `/js`, `/css` and
`/data` stay public, because the data is public OpenStreetMap and a public
tree register, and because gated asset responses would poison the service
worker's caches.

## 11. Colour and type

The homepage uses the Ledger's editorial palette and typography:

| Token | Value | Use on the homepage |
| --- | --- | --- |
| `--paper` | `#f4f4ec` | Page background |
| `--ink` | `#181c11` | Body and headings |
| `--muted` | `#52514e` | Secondary text, captions |
| `--line` | `#ded9c6` | Rules, card borders, form fields |
| `--tree` | `#2e6b44` | Primary CTA, links |
| `--tree-deep` | `#1d4a2f` | Hero panel |
| `--bark` | `#9c6b34` | Offline-step accent |

Theme colour stays `#24382f`. `Fraunces` is used for display headings and
`Public Sans` for body copy, loaded with `display=swap`; this deliberately
matches the Ledger while preserving an immediate system-font fallback.

No new colours. If the design appears to need one, the answer is a different
weight or opacity of an existing token.

## 12. Testing

Per the project's completion checklist:

- **Unit** — email validation, the consent record shape, and the build-time
  counts step (including that it fails rather than emitting a blank count).
- **Boundary checks** — `test/home-boundaries.test.js` verifies that marketing
  assets bypass app caches and the app entry point does not import marketing
  assets. Homepage browser tests verify local assets load only from
  `assets/home/`, with no requests for app code or data, on desktop and mobile.
  Parallel worktrees select different local ports via `PLAYWRIGHT_BASE_URL`;
  each test run starts its own server and refuses an already occupied port.
- **E2E** — a spec covering: the homepage renders its copy with JavaScript
  disabled; the sign-up button sends affirmative consent; success replaces the
  form with focused inbox guidance in both motion modes; sending blocks duplicate
  requests and failures preserve the form for retry;
  the honeypot rejects silently; the CTA reflects the alpha state.
- **Screenshot** — **not yet taken.** A baseline captured before the hero image
  lands would be replaced immediately, and per `spec/agents.md` a baseline must
  come from a Linux CI runner rather than a developer sandbox. Add one via the
  `Update Snapshots` action in the same change as the hero image, on the
  `mobile` project only.
- **Sitemap** — `test/sitemap.test.js` updated for the five screen paths'
  disallow.
- **Accessibility** — a "Skip to content" link is the first focusable element
  in `<body>`, hidden off-screen until focused and jumping to `<main id="main"
  tabindex="-1">` so keyboard users can bypass the header. Heading order runs
  h1 → h2 (section headings) → h3 (inventory grid items) with no level
  skipped. Body text colours (`--muted` on `--paper`, and the hero's light
  green on `--tree-deep`) meet WCAG AA contrast (~7:1). The sign-up honeypot
  field carries `tabindex="-1"` so it is not keyboard-reachable despite being
  visually and semantically hidden.

Note that `server.js` does not run Netlify edge functions, so the gate is
invisible in local dev. Homepage and sign-up behaviour is testable locally;
anything that depends on the gate's state must be exercised through
`npm run netlify:dev` or a deploy preview.

## 13. Non-goals

- No blog beyond the existing weekly ledger.
- No pricing, testimonials, or team page.
- No app store badges until the native builds in
  [spec-native.md](spec-native.md) actually ship.
