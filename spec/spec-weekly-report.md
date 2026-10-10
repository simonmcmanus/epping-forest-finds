# Weekly Epping Forest Ledger — Report Generator

The weekly report is a standalone HTML page published under `reports/`, built by
`scripts/report/render_report.py` from a small structured `report-data.json`. The
generator owns the design, layout and SVG map; the
research and the written findings come from the weekly workflow
(`.github/workflows/weekly-ledger.yml`).

The workflow's cron is currently nightly rather than weekly (temporary, from
2026-09-30) while the business-detection data is being brought up to scratch —
see the "NOTE on cadence" comment above `on:` in the workflow file. Nothing
below this changes because of it: the report file name and PR branch are
already keyed by calendar date, and `business_watch`'s escalation counts runs,
not weeks, so it just reaches confidence sooner. Revert the cron once the data
settles.

## Keeping the map's businesses current

The report is only half the weekly job. The other half is noticing that the
high street has changed and putting that on the map, by pull request, without
anyone asking.

That half used to consist of a list of candidates and an instruction to
"cross-check anything promising", which meant nothing was ever confident
enough to act on: a restaurant that closed in 2024 and a pub that closed in
2023 were both still drawn on the map two years later. The detection now has
memory and an outcome.

**One open ledger PR at a time.** The workflow runs nightly and auto-merge is
disabled, so a previous run's `weekly-data-report/*` PR is often still open
when the next run starts. Branching fresh from `main` every night would let
two open PRs edit the same data files independently, so whichever merged
second would conflict with the first. Instead, the HOUSEKEEPING step in the
workflow prompt looks for an already-open PR whose branch changed a `data/`
file (closing any empty leftover from a prior attempt) and, if one exists,
checks it out, merges current `main` into it, and applies that night's
changeset on top of it rather than starting a new branch — pushing to the
same branch and folding the new findings into the same PR body (via `gh pr
edit`) rather than opening a second one. A night with no new candidates still
commits `data/business-watch.json`'s updated patience count and that night's
report onto the open PR rather than skipping it. Only when no such PR is open
does a run branch from `main` and call `gh pr create`. This keeps Simon with
exactly one weekly-report PR to review and merge at any time, however many
nights it has accumulated changes from.

**The sources.** Three, deliberately unalike, so no one blind spot is the
system's:

- `scripts/user_reports.py` — **what people report from inside the app**, and
  the best evidence this project has. The report screen already posts to
  `netlify/functions/report-missing-data.js`, which opens a GitHub issue
  labelled `user-report` carrying the reporter's own words and, when they had
  granted location, the GPS fix they were standing on. A person in front of
  the thing outranks anything the other two infer, so the weekly run works
  these first. They are never applied automatically — a report is free text,
  not a name, a category and a position — but the run must resolve each one
  and say what it did. A fixed report's PR body says `Closes #<number>`, so
  merging tells the reporter their report landed; that is what keeps people
  reporting. While the repository is public its issues read without a token at
  all, so `Issues: Read` is not strictly required — but grant it anyway:
  unauthenticated requests are rate limited per IP, a runner's IP is shared,
  and it becomes mandatory the day the repository goes private. A token that
  cannot see issues gets a loud 403 rather than an empty list, because
  "not allowed to look" must never pass for "nothing to report".

- `scripts/osm_business_diff.py` — OpenStreetMap. Reports four things: places
  new to it, our places it no longer lists, our places it marks closed
  outright (`disused:`/`was:`/vacant tags — a mapper stating a fact rather
  than a silence), and our places now trading under a different name or type.
  That last signal is the one that matters most and the one nothing used to
  catch: when a unit changes hands the map element is *edited in place*, so
  the site looks neither missing nor new. Covers food, shops, and community
  venues (halls, libraries, arts centres), which were previously out of scope
  entirely.
- `scripts/fsa_business_diff.py` — the councils' food-hygiene register.
  Openings only, never removals: the register holds the name a business
  registered under rather than the name over the door, so "absent from the
  register" is far more often a naming difference than a closure, and that
  mistake would repeat weekly and so clear any patience threshold. It knows
  about places that are trading but unmapped, because registering precedes
  trading.

Name matching is proximity-scoped (`scripts/place_matching.py`): the same name
only counts as the same business within a few hundred metres. Matching on name
alone across the whole search area meant a new branch of a chain was treated as
one the map already had.

It compares two keys, because sources get a name wrong in two different ways.
`name_key()` strips punctuation and the words that describe a trade rather
than name a business, so "The Bell Public House" and "The Bell" agree.
`compact_name()` closes up spacing and writes out an ampersand, so "CHAPTER
21" and "Chapter21", or "Bobo & Wild" and "Bobo and Wild", agree.
`names_look_like_one_place()` accepts either, and `same_premises()` adds the
distance bound.

**Every candidate is scope-checked before it reaches the watchlist**
(`scripts/forest_boundary.py`). The sources are queried over a box about 22km
by 12km, taking in Leytonstone, Walthamstow and most of Epping Forest
district; the map itself only carries what is within eight minutes' walk of
the forest boundary, which is why the food dataset holds 684 places and not
many thousands. The first run to reach the food-hygiene register found 2,949
"new" places out of 3,204, nearly all of them miles from any tree — every one
would have been banked, grown confident over two weeks, then been rejected
one at a time by `apply_weekly_changeset.py`, after burying the week's real
findings. Only additions are checked: anything already on the map passed this
test when it was added, and re-judging it could have the run propose removing
places it put there itself. Measuring one point against all 74,579 boundary
segments takes 0.07s, so the segments are grid-indexed — same answer, 20×
faster, and a whole candidate list in seconds rather than minutes.

**The memory.** `scripts/business_watch.py` and `data/business-watch.json`
record what each source said each week. A signal escalates to *confident* only
once it has repeated: three runs for "absent from a source", two for an
opening or a change of hands, and one for a stated closure, which needs no
patience.

Patience guards against a source changing its mind, so it is set per source.
OpenStreetMap can be edited by anybody and reverted by anybody, and earns the
wait. A statutory register does not: a food business must register before it
may trade, and the council does not un-register it a week later because the
entry was a mistake — so `CONFIDENT_AFTER_RUNS_BY_SOURCE` lets the
food-hygiene register propose an opening on first sight. Its real weaknesses
are different in kind and waiting fixes none of them, so they are handled by
cleaning the record instead: registered company names are trimmed to the name
over the door (`Lidl Great Britain Limited` → `Lidl`), concessions trading
inside another business's premises are dropped rather than becoming a second
pin on a shop the map already has, and members' clubs are not listed as pubs. Confident entries are written out as a changeset that
`scripts/apply_weekly_changeset.py` applies mechanically, so the week's run
produces a reviewable diff rather than a paragraph.

Guard rails, because this runs unattended:

- A run whose source population has collapsed against last week's is treated
  as a bad query and escalates nothing.
- No single run may remove more than `MAX_AUTO_REMOVALS` places; over that,
  every removal is held back for a person.
- No single run may add more than `MAX_AUTO_ADDITIONS`. Over the cap it takes
  the longest-waiting and leaves the rest queued, rather than holding
  everything back as a removal overflow does — an addition that is wrong is
  one extra pin, so the risk is the size of the batch, not the direction. The
  first run to read the food-hygiene register banked 679 openings at once, all
  of them due to turn confident on the same day; unchecked, that would have
  arrived as a pull request proposing 679 additions on a source that cannot
  tell a cafe from a restaurant.
- A signal that stops appearing is forgotten rather than banked, so an
  intermittent source can never accumulate its way to confidence.
- Setting `"dismissed": true` on an entry by hand parks it permanently. This
  is the only way to stop a false positive being re-proposed every week, and
  it is how the closures confirmed on foot in September 2026 are kept from
  being re-added by a source that has not caught up.

**Agreement beats repetition.** Two sources that have never heard of each
other describing the same new place is stronger evidence than one source
saying it twice, so an opening both agree on is confident immediately
(`link_agreements`). Agreement is only read for openings: sources are
unreliable in the *same* direction about absence — neither knows about a
place nobody recorded — so it never shortens the wait on a closure. Linking
also stops the same café arriving as two pins, one from each source.

**Confirmations, and what is stale.** Every run sees, as a free side effect
of diffing, which of our places a source still lists.
`scripts/verification.py` keeps those in `data/verification.json`, one
compact line per place, so "how stale is the map?" stops being a question
only a walk can answer. It is a separate file rather than a field on every
feature deliberately: stamping the GeoJSON would rewrite hundreds of features
weekly and bury the week's three real changes in a diff nobody can read.
Anything unconfirmed for more than `STALE_AFTER_DAYS` — or never confirmed at
all — counts as stale.

**Filling blanks.** `enrich_candidates` are fields a source has that our
record leaves blank: an address, a website, opening hours. They are not
changes of fact, so they need none of the patience a closure does, and
`apply_weekly_changeset.py` only ever fills a blank — a value already on the
map may have been put there by somebody who went and looked.

**Measuring it.** `scripts/data_quality.py` reports, per dataset, how many
places exist, how many a source has confirmed recently, how many never have
been, and how thin the useful fields are. `--compare` against a run saved
before the week's changes gives the movement, which the PR quotes. Without
it a slow regression looks exactly like a quiet week — which is how four of
seven datasets sat untouched from May to September without anyone noticing.

**Duplicates.** `apply_weekly_changeset.py` refuses an addition that matches
a mapped place on either name key within a short walk (`same_premises()`), and
checks against what earlier entries in the same changeset just added, so two
sources describing one new place produce one pin. It used to compare exact
lowercased names across the whole map, which was wrong in both directions: it
blocked a genuinely new branch of a chain, and it let "CHAPTER 21" onto the
map 24 metres from the mapped "Chapter21" — caught by a person reading the
week's summary, not by the check.

`scripts/find_duplicates.py` sweeps the datasets for what is already there
from before that check, bucketing under both keys and measuring only the pairs
that could be one place. It reports and never deletes: two genuinely different
shops can share a name and a corner, so the call is a person's.

**Learning from reports, not just acting on them.** Every run also reads the
week's reports as a set, not just one at a time: `scripts/user_reports.py
--closed-since-days 7` adds `closed_reports` to its output alongside
`open_reports` — issues closed in the last week, however they closed,
including by the issue-fix automation's own pull request
(`.github/workflows/claude-issue-agent.yml`, see `spec-issue-workflow.md`),
marked `wasAutoFixed`. A single report never shows a pattern; a week's worth
can — the same kind of gap recurring, several reports about one settlement, a
source this project doesn't check at all.

When a real, repeating pattern turns up, the fix for it never rides the
`weekly-data-report/*` branch, which stays data and the report only. A
concrete, scoped code or script fix gets its own `weekly-data-quality/*`
branch and its own pull request, opened and left open the same way as the
data PR (no auto-merge). Something that needs a person's judgement instead
becomes a plain GitHub issue — never guessed at as code just to have
something to push. Either way, the data-update PR's body carries only a
one-line pointer to what was opened, not the change itself. Finding nothing
worth generalising is a valid outcome and is stated plainly rather than
manufacturing a pattern to report.

**Places a person reported.** `data/business-watch.json`'s `reportedMissing`
list is for gaps somebody spotted by walking past them — better evidence than
anything the tooling produces on its own, and previously with nowhere to live
between the message and the next run. Each entry is a standing instruction:
the weekly run looks the place up, adds it, and deletes the entry in the same
commit, or says in the pull request why it could not. It carries no run count
and is never escalated or cleared automatically.

**Homepage counts.** The marketing homepage quotes how many food places the
map has, and `test/home-counts.test.js` holds the page to the real data. A
weekly data change therefore breaks that test unless the copy moves with it —
which is why every proposed data change arrived with a red suite on it.
`scripts/sync-homepage-counts.js` rewrites those figures in `index.html` and
`spec-marketing.md` from the datasets; the weekly run calls it straight after
applying a changeset. See `spec-marketing.md` §4.

## Road closures, events and standing notices

Unlike business detection, the "road & access" and "events" sections have no
dedicated script or memory of their own yet — each run researches them fresh
with `WebSearch`/`WebFetch` against a fixed URL list in the workflow prompt,
so nothing persists between runs and a long-running item (the High Beech
water-mains project, say) has to be hand-coded into the prompt as a standing
reminder rather than remembered automatically. That fixed list covers the
forest-wide aggregators (City of London's own pages, the EFCC diary) plus,
as they're found, the own-site events pages of venues that run independently
of City of London and so never appear in those aggregators — each such site
has to be checked individually, the same way the aggregators are. It also
covers the towns and villages around the forest, whose own events (a village
beer festival, a town council's Christmas market) appear in none of the
forest-wide aggregators above: the Wanstead Village Directory's events
calendar is checked as a real iCal feed, verified to actually carry the
event that first surfaced this gap (the Wanstead Beer Festival); Visit
Epping Forest's district-wide calendar and Epping Town Council's events
diary are each checked as a page, the same way Copped Hall's site is.
Facebook and X/Twitter accounts of forest-adjacent organisations were
evaluated and excluded: both gate programmatic read access behind paid
tiers or app review that a page's own website doesn't need, so the run
does not spend time on them (see the `sourceNotes` in
`data/forest-events.json`, which also records which other town/village
sources were checked and found to have no usable feed yet, or to block
automated requests outright).

`data/road-closures.json`, `data/forest-events.json` and
`data/forest-notices.json` are a first step towards fixing that: real,
researched entries (road/utility works, dated events, and standing
visit-affecting notices — car park hours, riding/fishing seasons,
conservation works — that fit none of the report's existing categories) with
their own sources and a `lastVerified` date, seeded and kept current by hand
(by the weekly run, per its own prompt) rather than by a diff script. Each
file's `sourceNotes` records which upstream sources were evaluated and why
(an API worth building a scraper against, a page too JS-rendered to scrape,
a URL that has gone 404) — that evaluation is the reusable part until a
script like `osm_business_diff.py`'s exists for this data. An entry marked
`needsReverification` is a research gap being surfaced honestly, not a
finding ready to print; `scripts/report/structured_findings.py` (below)
carries that caveat into the finding's own body text rather than dropping it.

`scripts/report/structured_findings.py` reads the three files and returns
whichever entries are still within their own recorded dates as of a given
day, in `report-data.json`'s finding shape — see "Road, access and event
findings" in `report-data.schema.md`. A multi-week roadworks project or a
dated event now shows up every week it's genuinely true, not only the week a
web search happened to resurface it. Dated events surface up to
`EVENT_HORIZON_DAYS` (30 days) ahead, not just the current week: the ledger's
main job is this week's news, but a reader also wants enough notice of a
dated event to plan it into their diary, not only a mention once it's days
away. A recurring series with no next date confirmed is always surfaced,
labelled "Recurring", since it carries no date to measure against the
horizon.

The published report's Events section splits on this: each event finding
carries a `when` of `"week"` (happening within the next 7 days) or `"month"`
(further out, or recurring with no next date confirmed), and
`render_report.py` groups the section into a "This week" and a "Coming up in
the next month" subheading accordingly, only showing a subheading that
actually has something under it. Without this split, a 30-day horizon would
read as if the whole month were "this week"'s news. `structured_findings.py`
sets `when` itself from the date; a finding written by hand straight into
`report-data.json` (the workflow's own fresh research) needs it set
explicitly — see `report-data.schema.md`.

It is a floor under the weekly run's own
research, not a replacement for it: the workflow still researches road/access
and events fresh each run (step 2c/2d), and that step's job now includes
updating these three files' dates, bodies and `lastVerified` stamps so they
don't go stale sitting unread. "Notices" is not yet its own `categories.py`
entry — the script folds them into `"road"`, which the report already titles
broadly as "Road closures & access".

`scripts/report/tfl_transit_status.py` adds a fourth source that needs none
of this upkeep, because it checks Transport for London's own live status
rather than a hand-researched file: the Central line (Epping, Theydon Bois,
Debden, Loughton) and the Weaver line, London Overground's name for the
Chingford branch, plus bus stop disruptions around the coverage settlements.
It folds into `"road"` the same way notices do, needs no `TFL_APP_KEY` (see
`.env.example` — the key only raises a shared rate limit, it doesn't unlock
different data), and most weeks prints no findings at all, which is the
correct result (good service, no disrupted stops), not a gap to research
around. The bus stop check batches its stop ids: `/StopPoint/{ids}/Disruption`
rejects a request past 22 comma-joined ids regardless of which ones.

## Files

- `scripts/report/render_report.py` — entry point; renders the page
- `scripts/report/template.py` — design system (CSS, font links)
- `scripts/report/categories.py` — finding categories (opening/closing/road/event/grazing)
- `scripts/report/svg_map.py`, `geo.py`, `places.py` — the "This week on the map" SVG
- `scripts/report/png_icon.py` — dependency-free PNG reader/writer used to shrink an app icon to pin size and inline it
- `scripts/report/jargon_guard.py` — refuses to write a report containing developer jargon
- `scripts/report/map-inventory.js` — counts everything on the map (see below)
- `scripts/test_render_report.py` — unit tests

Business detection (see "Keeping the map's businesses current" above):

- `scripts/user_reports.py` — what people reported from inside the app
- `scripts/osm_business_diff.py` — OpenStreetMap change detection
- `scripts/fsa_business_diff.py` — food-hygiene register cross-check
- `scripts/business_watch.py` — the week-to-week ledger and escalation rules
- `scripts/verification.py` — when each place was last confirmed
- `scripts/data_quality.py` — how good the data is, and which way it moved
- `scripts/find_duplicates.py` — the same place mapped twice
- `scripts/place_matching.py` — shared name/proximity matching
- `scripts/apply_weekly_changeset.py` — applies a changeset to the map data
- `scripts/sync-homepage-counts.js` — keeps the homepage's quoted counts true
- `data/business-watch.json` — the committed watchlist
- `data/verification.json` — the committed confirmation record
- `data/road-closures.json`, `data/forest-events.json`, `data/forest-notices.json`
  — manually-researched road/event/notice entries and source evaluations (see
  "Road closures, events and standing notices" above)
- `scripts/report/structured_findings.py` — turns the three files above into
  report-data.json findings that are still within their own recorded dates
- `scripts/report/tfl_transit_status.py` — live Central line / Weaver line
  and bus stop disruption check; no file of its own, no key required
- `scripts/test_*.py` for each of the above — unit tests

Handy while working: `npm run audit:quality` and `npm run audit:duplicates`.

## Who the report is for

A reader interested in Epping Forest, whether or not they use the app. Each
edition leads with useful local news: what happened, where, and why it matters
for a visit. Intros are one or two short sentences; stories keep dates, source
links and genuine uncertainty, without research diaries or maintenance lists.

Write for publication after the accompanying PR merges. Review status stays in
the PR body, never the published page; the jargon guard rejects pending-review
and map-edit proposal wording. A newly discovered established business is a
local find, not evidence of a new opening. The map legend and search description
use “local find” for the historical `opening` category.

The report uses the homepage’s dark-green heading panel beside its longhorn
photo without a caption, on a cream page, with Fraunces headings and Public Sans body
text, with the homepage oak brand mark, longhorn photograph and Ledger image
from `assets/home/`. The hero selects from the shared 480, 768, 960, 1280 and
1600px WebP variants using responsive `srcset`/`sizes`, with a JPEG fallback,
intrinsic dimensions and high fetch priority. Published editions and future
reports use the same responsive photo without changing the crop. A split text/photo header stacks on phones. No app CSS or
JavaScript is loaded. Published editions share this design. A high-level opening paragraph inside the green heading panel summarises the
actual findings in one or two brief sentences, including cattle movement and
quiet categories where relevant. Avoid generic introductions and directions to
the rest of the report; no updates included does not mean no disruptions exist. The town list is a quiet
footer. A statistics strip attaches to the bottom of the photo header, showing
food/shop totals, local finds, closure updates, access changes, events and grazing
status when available; it wraps to two columns on phones. The location map follows, then
the individual business, access, event and grazing details; the detailed food breakdown and full app
inventory are omitted so the newsletter stays focused on forest news.

Nothing about how the report is produced goes on the page: not which sources
the tooling reached, not what it checked or what failed, not how the page is
built. `jargon_guard.py` enforces this — it refuses to write a report whose
visible text mentions files, OSM ids, git/PR/CI, workflows, scripts, APIs,
deployments or rendering. Notes like that belong in the write-up on the
week's proposed change, where the person reviewing it will look.

Published reports are HTML only. A Markdown draft or working notes are never
committed under `reports/` and are never listed by the index or the sitemap.

## Address

The site's official address is `https://www.eppingforestfinds.uk`. The app
advert and its "report a mistake" deep link default to
`https://www.eppingforestfinds.uk/app`; canonical and link-preview addresses
remain under their public report URLs. These addresses are built from
`SITE_BASE` in `render_report.py`.

## Sections that are always there

Openings/closures, road & access, and events each render whether or not the
week turned anything up; an empty one says so in plain English
(`EMPTY_SECTION_NOTES`). A missing "Events" heading reads as "nobody looked";
an explicit empty note says no updates are included in this edition, without
claiming there are no events or disruptions.

## Cattle on the map

The cattle are drawn with the app's own cow icon in the app's own white map
pin, not a numbered dot — in the map SVG, in the legend, in the list beside the
map, and on the cattle card. Everything else keeps its numbered dot, which is
what the cards refer back to.

The icon is `data/icons/cow.png`, shrunk to `COW_ICON_SIZE_PX` by
`png_icon.py` and written into the page as a `data:` address, carried once by
the page's own `--cow-icon` rule plus once in the map SVG. It is inlined rather
than linked because a report gets read on a phone with no signal, saved for
later and forwarded by email, and a linked image is a broken-image box in all
three. When the icon isn't in the checkout to read (the report's own tests
render against a stand-in folder), the generator falls back to the icon's
address on the site.

## The app advert and the AI note

Both are added by the generator; neither is ever written by hand into
`report-data.json`.

- **The advert** (`render_app_promo`) sits after the week's news, not in the
  masthead — a reader who has just read what is going on in the forest has a
  reason to want the map; someone who has only read the headline does not. It
  explains what the app is and what it does. Its primary link invites early
  access updates through the homepage signup; existing testers can use
  `app_link`. It describes saved cattle locations honestly when offline.
- **The mailing-list invitation** comes after the news and map, before the app
  advert. It offers standalone forest updates and uses the existing homepage
  signup, explicitly saying weekly email updates start once the site launches.
- **The AI note** (`render_ai_note`) is the last thing on the page: the report
  is researched and written by AI, it can be wrong, and here is how to say so.
  Its link is a deep link into the app's own report-a-problem screen
  (`<app_link>#report=<which report>`), so a reader lands on the form with the
  week already filled in. See "URL hash / navigation state" in `spec.md`.

## Search visibility

Each report carries a title naming its week, a meta description built from
that week's own findings (so no two reports read as boilerplate), a canonical
address, Open Graph / Twitter tags and `NewsArticle` structured data. The site
sitemap and `robots.txt` are generated by `scripts/generate-sitemap.js` — see
"Search Visibility" in `spec.md`.

`scripts/generate-reports-index.js` lists only published web pages (`.html`),
titles each weekly ledger by the week it covers rather than its file name, and
is indexable. Both generators run from `npm run build`.

The listing wears the homepage's look (palette, Fraunces and Public Sans, cards)
with its styles inlined, loading only the oak leaf and Ledger icon from
`assets/home/` (including the shaded `ledger.png`) and nothing from the app. It has the homepage's brand header
(linking to `/`, with a "Get updates" link to `/#signup`), a cream text-and-photo hero using the homepage longhorn image
with the "Field notes · Published weekly" eyebrow, then **Every edition**: one
white card of rows, each reading "Epping Forest Ledger" over the week's date,
newest first with a **Latest** badge on the top row. Editions are ordered by
the week in their file name, not file modification time, because a fresh
checkout gives every file the same mtime. Rows show no file type, size or
modification date. A tinted note repeats the "written automatically" caveat
beside an "Open the Epping Forest map →" button, then the homepage footer. It
is light only, like the homepage, and fits a 390px phone without sideways
scrolling.

## Inventory utilities

The newsletter shows a compact statistics strip; its food/shop total is read
from the food dataset when rendering. Historical editions retain their original
totals. Local finds are not labelled as confirmed new openings.
`scripts/report/map-inventory.js` remains available for the homepage and other
count consumers. It classifies places using the app’s own filter rules; the
newsletter renderer does not load the full inventory to publish a report.
