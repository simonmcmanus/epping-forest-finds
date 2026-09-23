# Marketing, Positioning & Public Homepage Specification

Owns the words and the public-facing surfaces of Epping Forest Finds: the
positioning, the approved phrase bank, the marketing homepage at `/`, the
mailing-list sign-up, the social sharing assets, and the hero image.

ChatGPT owns this spec and the marketing surfaces. Claude owns app copy,
metadata, onboarding and the manifest. The phrase bank is a reference for
consistent wording, not a shared runtime dependency: changing marketing copy
does not require editing app files. Cross-surface wording changes are handed
to the app owner for a separate change. See `spec/agents.md` for file ownership.

It does **not** own the alpha access gate — who may reach `/app`, how the
shared secret link works, or the edge function that enforces it. That belongs
in `spec-alpha-access.md` (to be written). This spec only defines the *call to
action* that the gate's state selects between (§8).

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
| `/app` | The map application | Invited alpha users; everyone after launch |
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

> Fancy a nose round the forest? There are 24,906 veteran trees
> to get to know. Pop in a tree’s tag number, find your way over and see roughly
> how old it is. Paths, pubs, loos and the longhorns are on here too.
> All on a free, offline map. Handy when your signal’s done a runner.

### 3.3 One-line description (meta description, manifest, store listings)

> Explore 24,906 veteran trees in Epping Forest. Find trees by tag number,
> navigate to them and discover their estimated ages with an offline map.

### 3.4 Pillar headings and bodies

**Works where your phone doesn't**
> Get the map downloaded while you’ve got wi-fi or a bit of signal.
> Then off you go. The trees, paths and landmarks stay on your phone,
> even when the bars disappear. Which, round here, they do.

**Get to know the old trees**
> All 24,906 trees from the Epping Forest Veteran Tree Register, right here
> on the map with their species and records. Got a tag number? Pop it in
> to find that tree and see its estimated age. There’s a fair bit of history in those trunks.

**Follow the longhorns**
> The longhorns have got GPS collars. Very high-tech for a bunch that spends
> most of the day chewing. We show their latest reported positions and check
> online for updates now and then. Offline, you’ll see the last saved positions,
> so they might have wandered off since.

**Everything else you need out there**
> 9,162 paths and bridleways. 771 pubs, cafés and shops. 1,596 car parks,
> benches, toilets and gates. 1,106 bus stops and stations. All within walking
> distance of the forest.

### 3.5 Short forms

- Tagline: **Epping Forest, offline.**
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

Warm, chatty and lightly cheeky: a local London/Essex voice with a bit of Cockney
charm. Use everyday contractions and phrases such as “have a nose”, “give you a
shout” and “done a runner”. Let the humour come from familiar forest moments:
patchy signal, a cuppa after a walk, cattle going about their business. Keep facts
and practical instructions clear. No phonetic accent spelling, forced rhyming
slang, invented personal anecdotes or claims of local residence.

Avoid: exclamation marks, "revolutionise", "seamless", "experience" as a noun,
"powered by", emoji in body copy, and stacked superlatives. If a sentence would
sound odd said out loud on a footpath, rewrite it.

## 4. Feature counts are generated, never written

The counts in §3.4 are real values from the current checkout:

| Figure | Source |
| --- | --- |
| 24,906 veteran trees | `data/trees/index.json` → `recordCount` |
| 9,162 paths | feature count, `data/local-paths.geojson` |
| 771 food & drink | feature count, `data/local-landmarks-food.geojson` |
| 1,596 facilities | feature count, `data/local-landmarks-facilities.geojson` |
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
2. **What’s with the tree tags?** — directly after the hero, explain
   searching physical tag numbers, navigating to a specific tree and checking
   its tag on arrival, with three app screenshots: searching its number,
   following its route and viewing its estimated age. Use each screenshot
   caption for the matching explanation rather than repeating the same three
   points in a separate list. On wide screens, keep the three cards in one
   row. Load these supporting images lazily. The navigation caption explains
   that routes try to favour scenic forest paths and alleyways, without
   guaranteeing them. The screenshots are interim real captures from the app
   (`app-search.jpg`, `app-nearby-route.jpg`, `app-tree-age.jpg`), scaled to
   600px wide, until final marketing captures replace them. Each is framed as a
   phone with a 4px dark-green rounded border and no card around it; its white
   caption card, exactly the phone's width, tucks behind the bottom of the
   phone, and the three caption cards stretch to a common height on wide
   screens. Phone and caption move as two objects: on reveal the phone rises
   further (28px against 10px) and its caption trails by 160ms; on hover the
   phone lifts 6px while the caption moves 1px. The phone's shadow stays tight
   (it deepens only slightly on hover) so it never smudges the caption card. Ages are educated guesses from recorded girth and
   species where data is available, not exact birthdays.
3. **Example tag** — its own section between the tag guide and the feature
   cards: a photograph of a real numbered metal tag (27400), cropped to a
   centred circle, with descriptive alt text and no visible caption. Load it
   lazily, with no section divider line above or below it.
4. **Three feature cards** — offline, veteran trees and cattle (§3.4). White
   cards have rounded borders, shadows and 80px centred independent brand
   icons from `assets/home/`, with centred headings. Use three equal columns
   on wide screens and stack them on mobile.
5. **What's on the map** — one neutral inventory card, matching the Ledger's
   categorisation: a headline total with a 44px map-pin icon
   (`map-icons/all-finds.png`) to its left, the six app filter groups (Nature, Food,
   Transport, History, Locations and Stories), every subfilter and count, then
   a full-width row for always-shown facilities. Each group heading uses an
   independent homepage copy of the corresponding app category icon, with a
   smaller app icon beside every subcategory. Parent icons are deliberately
   larger so the group hierarchy remains clear. Both icon sizes sit centred
   in the same 38px column, with aligned category and subcategory labels. The
   header brand mark is the transparent oak leaf from the app icon, without
   the app icon's yellow background, shown at 44px (36px on phones), with the
   brand name and Ledger link each kept to one line. The same leaf sits in a
   34px cream circle before the hero eyebrow ("Epping Forest, offline").
6. **Sign-up** — the mailing-list form (§9), boxed in warm cream with a gold
   left border accent using the app icon's gold (`#f3d36b`), matching the
   Ledger card's accent placement. A 52px envelope icon
   (`assets/home/mail.svg`, cream fill with dark-green outline, in the style of
   the homepage map pin), 44px, sits on the heading's line, vertically centred
   on it, never on a line of its own. The eyebrow runs above, its left edge
   flush with the icon. The layout is tight: email field and button share one row on wide
   screens (stacked on mobile), with the consent checkbox and privacy line
   directly beneath. Introduction, consent and supporting text
   use the full card content width; only the email-and-button row has a narrower cap. Both introduction and
   consent include weekly Epping Forest Ledger updates once the site launches.
7. **No signal? Here’s the plan** — a one-line intro, then three steps: open it once
   on signal, it downloads, it then works anywhere in the forest. The steps and
   the cattle note share one white shadowed card (like the map inventory), so
   there are no floating boxes. Each step has a round dark-green number badge
   with its bold title beside it and a short line beneath; the steps are split
   by thin rules — three columns on wide screens, stacked on mobile — with a
   small circled arrow on each rule showing the sequence. The card's footer is a
   green-tinted strip with the cow icon explaining that fresh cattle locations
   require a connection and saved positions may be stale.
8. **FAQ** — headed “Good to know”, after the offline section, with `FAQPage` JSON-LD (§6.3).
   Covers signal, cost/account, tree data, cattle positions and coverage.
   No battery-use question. All answers stay visible (no accordion) in one
   white rounded card, each question-and-answer pair divided by a hairline;
   on wide screens the question sits in a left column beside its answer.
9. **From the Ledger** — the last section before the footer, after the FAQ: an
   inset editorial card matching the sign-up card's layout: responsive padding, a green left border and shadow, the “Round the forest · Every week”
   eyebrow above a 44px newspaper icon (`assets/home/ledger.svg`, same style as
   the envelope) centred beside the heading, aligned like the sign-up card, and a solid green "Read the Ledger →"
   button linking to `/reports/` (§6.4).
   The index carries individual reports; the homepage remains static.
10. **Footer** — builder credit, `/terms.html`, GitHub feedback and contact address
   `mcmanus.simon@gmail.com`. No separate dataset-attribution paragraph; source
   explanations remain in the FAQ.

### 5.1 Page weight and assets

- Homepage CSS, JavaScript and images live together in `assets/home/`.
  `index.html` references only that directory for local runtime assets. Brand
  icons are independent copies, so app icon changes cannot change the homepage.
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
  the root URL; `app.html` canonicalises to `/app`.
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
- `/app` is **not** listed, and is added to `DISALLOWED_PATHS` for the duration
  of the alpha. A gated path that serves crawlers a landing page or a 403 is a
  soft-404 signal with no upside.
- `/reports/` and `/terms.html` are unchanged.

`test/sitemap.test.js` updates alongside.

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
| `closed` | Keep me in the loop → sign-up form | "We’re still getting things ready. Alpha invitations aren’t open yet, but leave your email and we’ll give you a shout about the release and major app updates." |
| `open` | Open the map → `/app` | "Free, and it works offline." |

Everything else on the page — the pillars, the counts, the FAQ, the ledger
links — is written to be true in all three states and does not change.

The page must not imply immediate access or invitations already being sent.
The signup heading is “Be in the know”, the submit button
is “Keep me posted”, and the introduction repeats that invitations aren’t
open yet and subscribers will also receive major updates and weekly Ledger updates
once the site launches. The consent label states the same mailing scope.

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

- Double opt-in. A new contact receives a confirmation message, but EmailOctopus
  does not resend one when an existing contact produces a `409`. The shared
  success state therefore says **"Confirmation is needed — check your inbox.
  The email might be in your spam folder"**. It does not reveal whether the
  address is already on the list.
- After a successful response, the email and consent controls remain visible
  but disabled, and the disabled submit button reads **"Request received"**.
  This makes the completed state unmistakable; reloading restores the form if
  the visitor needs to correct an address.
- The consent checkbox is unbundled and never pre-ticked.
- Record the consent timestamp **and the wording consented to**, so the record
  survives later copy changes.
- Every message carries a working unsubscribe link from the first one.
- Consent wording in the form and server-side record must match exactly:
  “Email me about the Epping Forest Finds release, alpha invitations and major
  updates about the app, plus weekly Epping Forest Ledger updates once the site launches.” Nothing else is sent to this list without fresh consent.

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

The gate therefore covers `/app` only. This is a deliberate trade recorded in
`spec-alpha-access.md`: the loose assets under `/js`, `/css` and `/data` stay
public, because the data is public OpenStreetMap and a public tree register,
and because gated asset responses would poison the service worker's caches.

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
  disabled; the sign-up form shows the "check your inbox" state on success;
  the honeypot rejects silently; the CTA reflects the alpha state.
- **Screenshot** — **not yet taken.** A baseline captured before the hero image
  lands would be replaced immediately, and per `spec/agents.md` a baseline must
  come from a Linux CI runner rather than a developer sandbox. Add one via the
  `Update Snapshots` action in the same change as the hero image, on the
  `mobile` project only.
- **Sitemap** — `test/sitemap.test.js` updated for the `/app` disallow.

Note that `server.js` does not run Netlify edge functions, so the gate is
invisible in local dev. Homepage and sign-up behaviour is testable locally;
anything that depends on the gate's state must be exercised through
`npm run netlify:dev` or a deploy preview.

## 13. Non-goals

- No analytics or tracking on the homepage. `js/tracker.js` covers the app and
  has its own consent flow; the marketing page collects nothing.
- No cookie banner, because the page sets no cookies.
- No blog beyond the existing weekly ledger.
- No pricing, testimonials, or team page.
- No app store badges until the native builds in
  [spec-native.md](spec-native.md) actually ship.
