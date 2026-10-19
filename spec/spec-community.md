# Community Verification (built: outbox, tree reports, consensus, overlay; scores UI, businesses, admin, upstream export still to do)

## Public URLs
- **`/contribute`** (`contribute/index.html`, static, no app code): the plain-language explainer for walkers: how checks, points and ranks work and what happens to reports. Update it when the rules below change. Linked from the homepage and from the Community screen's summary card.
- **`/reports/tree-report`** (`netlify/functions/tree-report.js`, `lib/community-report-data.js`): the discrepancy report to share with the City of London, built from the same daily snapshot as the overlay so it never shows more than the app does. Sections: trees questioned by two or more independent people (finding, number of people, last reported, listed and, for moved trees, reported position, with the register's tag and species looked up from the public tree chunks), possible new trees (tag number, position, one or more finders), conflicting reports, and a count of verified trees. Styled with the homepage's `assets/home/home.css` (hero with stat tiles, report cards, rows that stack as cards on a phone), no app code. Downloads: `?format=csv`, `?format=geojson`, `?format=json`; printable. Public and `noindex`; never contains device ids. Linked from the explainer and the admin Community panel.
- **`/community`**: the in-app Community screen (below). The nav tab stays labelled Community.

Lets users verify, question and add trees (and, with a different status set, businesses). Reports are an **annotation layer**; they never edit the shipped dataset.

## Source of truth
- The City of London dataset (`data/**`) is authoritative. Community reports never hide, move or delete a feature.
- A feature with enough agreeing reports shows a **"Questioned by the community"** badge in the inspector (with the reported status and count). Two independent reports that agree are enough to show it; the feature stays drawn as normal.
- Questioned features are exported for upstream (see Upstream loop). When a new City of London dataset lands, overlay entries it resolves are cleared by the daily job.

## Architecture
- `netlify/functions/community-report.js`: validates, rate-limits, appends to a Netlify Blobs ledger. Idempotent on the client-generated report id.
- Daily scheduled job: applies consensus, writes `overlay.json` (delta only: id → `{s,n,t}`) and per-device scores. Conflicts and unconfirmed new trees open a GitHub issue (escalation only; not the store).
- `GET /api/community/overlay`: served outside `data/**`, so it never moves `data-cache-version.js`. The service worker caches it in its own `COMMUNITY_CACHE` with an independent version, stale-while-revalidate, ETag, refreshed at most daily, fetched after first paint.

## Client
- **Built (phase 1):** `js/outbox.js` — IndexedDB outbox (in-memory fallback), items `{id,url,payload}` keyed by the report's `requestId` (server already de-duplicates on it). Flushes on `online`, `visibilitychange`, boot, and with backoff (5s/30s/2m/10m) after a network or 5xx/408/429 failure; other 4xx are dropped. Fires `outbox:change`/`outbox:sent` on `window`. Both feedback forms (Feedback screen and the per-location form) send via `sendOrQueueReport` (`js/app.js`): offline or unreachable → queued, status reads "Saved. It will be sent automatically when you're back online."; Submit is never disabled for being offline; the Feedback screen shows "N reports waiting to send". Cached in `APP_SHELL`.
- One offline **outbox** (reports and feedback), flushed on `online`, `visibilitychange`, app start and Background Sync where available; exponential backoff; "N waiting to send" chip.
- **Optimistic UI**: a submitted report is merged over the feature locally at once, with the note "Saved. Other people may take up to a day to see this." The local copy is dropped when the daily overlay includes it.
- Anonymous device identity (random id + secret) with an optional recovery code. No login in v1.

## Built so far (tree reports)
- `js/community.js`: anonymous device id (`ff-community-device-v1`), the tree check block on a tree's detail screen (`communitySectionHtml`, six choices; `MOVED` records the reporter's own GPS as the corrected position and needs location), optimistic local record (`ff-community-local-v1`) shown at once as "Thank you! Other people may take up to a day to see this", queueing via the outbox, overlay fetch 1 s after `load`, cached score (`ff-community-score-v1`).
- `netlify/functions/community-report.js` (`POST /api/community/report`): validates, idempotent on report id, 200/day per device, stores to Netlify Blobs (`community[-branch]` store) or `data/tracking/community/` locally.
- `netlify/functions/community-overlay.js` (`GET /api/community/overlay`, `?me=<deviceId>` for a score): recomputes from the ledger at most every `COMMUNITY_TTL_MINUTES` (default 1440), `Cache-Control: public, max-age=3600` + ETag.
- `netlify/functions/lib/community-consensus.js`: pure rules below, unit-tested.
- `sw.js`: `/api/community/overlay` is stale-while-revalidate in its own `COMMUNITY_CACHE_NAME` (`forest-finds-community-v1`, separate version, kept by the activate cleanup); the `?me=` query is never cached. `js/community.js` is in `APP_SHELL`.
- A questioned tree shows "Questioned by the community: … The official record is unchanged."; a verified one shows "Verified by N people". Nothing is hidden or moved.

## Visual design
All community UI uses the inspector's existing vocabulary (white cards, 1px hairlines, 10-12px radius, `--tree` green, `--gold-tint` for attention) and the nav's 2px round line icons (`communityIcon`, `COMMUNITY_ICONS` in `js/community.js`, `currentColor`, 24px grid). Rules:
- **Placement and boxing:** on a tree's detail screen the check block sits directly above the Nearest section (places put it at the bottom, see Place checks) (after the tree's own details), and is a single tinted, bordered card (`.community-check`) holding the header, the verify action, a "Something not right?" divider and the choices, so the choices read as part of the check.
- **Tree check block:** header (shield icon, "Help check this tree", "Is it where the map says it is?"), one full-width primary action (verify), then "Something not right?" and a two-column grid of icon chips (≥44px targets, labels wrap). After a report the choices are replaced by a success card (check, "You reported: …", "Thank you! Other people may take up to a day to see this.", a **Change** link that brings the choices back with the current one marked). A questioned tree shows an amber alert card, a verified one a green shield card, above the actions.
- **Contributions card (Community screen):** rank icon + name + points and points to next rank, a progress bar, three stat tiles (Verified, Confirmed by others, Your reports), then one card per report: status icon, tree name (links to the tree), status text and an outcome pill with its own icon (*Waiting to send* upload, *Awaiting a second opinion* clock, *Confirmed by others* check, *Being reviewed* alert). With no reports, an empty state with the app's tree illustration explains how points work.
- **Add a missing tree (Community):** a card with the tree illustration and a **Start** button that opens the boxed form (live GPS status row, tag number, optional note, Cancel / Submit tree).
- Motion is a 260 ms fade/rise on the success card and a width transition on the progress bar; both are disabled under `prefers-reduced-motion`.
- The score read back from storage is always coerced to numbers; a malformed response can never print "undefined".

## The Community screen
The nav tab formerly called **Feedback** is now **Community** (people icon), at **`/community`** (a gated app screen like `/settings`; `/contribute` is the public explainer, below). The tab keeps its element id `#reportToggle`. **Feedback** is its own page at `/feedback` (so published links and `/feedback#report=<text>` still open the form), reached from a "Send feedback" link at the bottom of the Community screen; the Community tab stays lit on it, and tapping the tab there returns to Community. The Community sheet opens taller than other screens on phones (`.inspector-tall`, 78% by default, applied without a transition so the map camera fits the sheet's real footprint, set in `syncHashFromSelection`; a height the user has dragged to wins) because it is all content and has no use for a big map. The screen is, top to bottom:
0. **Summary card**: "Help keep the map right", two sentences on what community checks are and that reports never overwrite the official record, and a "How it works" link (new tab) to the explainer `/contribute` (`communityIntroHtml`).
1. **Your contributions** (`communityContributionsHtml`, `js/community.js`): rank (Seedling 0, Sapling 5, Woodward 20, Warden 50 points, with points to the next), points, verified / confirmed counts, and a log of the user's reports, newest first, each showing one of *Waiting to send* (still in the outbox), *Awaiting a second opinion*, *Confirmed by others*, *Being reviewed* (conflict) or, for place changes, *Sent for review* (with a "View on GitHub" link once the issue exists). The log is built from the local record so it works offline; outcomes come from `GET /api/community/overlay?me=<id>&list=1` (a per-device `mine/<deviceId>` index written by `community-report.js`, `reportOutcome` in the consensus module), cached in `ff-community-log-v1`. Settings no longer carries this section.
2. **Add a missing tree** (below).
3. **Send feedback**: a link card to the Feedback page (the existing form, unchanged, which autofocuses its textarea as before).

### Add a missing tree
A form, never a one-tap action: **Start** reveals the form; nothing is saved or logged until **Submit tree**.
- **Tag number is required** (it identifies a new tree). "0" and empty tags are refused (thousands of untagged register entries carry 0). A tag already in the dataset is refused with "already on the map" so the user checks that tree instead.
- **Location must be close and accurate:** the tree's position is the user's own GPS fix, which must have a reported accuracy of 30 m or better. A live status row shows *Using your location · accurate to N m* or what to do (turn location on, step into the open). Submit stays disabled until a tag is entered and the fix is good enough. The server enforces the same rules (`validateReport`: tag number present, `accuracy` ≤ 30 m).
- Two people reporting the same tag number are the same new tree (matched by tag, not position); a second person makes it `new-confirmed`. Optional free-text note.

## Place checks (pubs, cafes, shops and other places)
A boxed **Help check this place** card sits at the **bottom** of a place's detail screen, after its Nearest/Related sections and above the small "Noticed a problem" link (not on events). Only trees get their check at the top of the panel, because for a tree the check is the main action. Choices: *Yes, it's still here and correct*, *It's closed*, *It has moved*, *The name has changed*, *Details are wrong*, *Wrong type of place*.
- A **confirmation** is a local-only check-in: it scores nothing, never opens an issue, and hides that place's check card on this device.
- Any **change** opens a short note step (required for rename and wrong details, optional otherwise) and is filed as a **GitHub issue for manual review** via `report-missing-data` (`reportType: "place-check"`, labels `place-check` + `user-report`). Nothing is applied to the data or shown to other users automatically; a person decides. A further report about the same place (matched by a `place-key:` marker) is added as a comment on its open issue instead of a new issue. Requests carry the usual de-duplicating request id and travel through the offline outbox.
- No community overlay or "questioned" badge exists for places.

## Nudges
With a real, accurate fix (30 m or better) and a tree within 25 m that this device has not yet checked, the app prompts once per tree per day (`communityNudgeCheck`, `js/community.js`, called with every GPS fix). On the Nearby overview it shows a dismissible card ("You're next to tree N" with **Check it** and a close button, auto-dismissed after 20 s) and at most one such card every 10 minutes. If that tree's own page is already open there is no card: the check card pulses twice (a static outline under `prefers-reduced-motion`). Users can turn nudges off with a checkbox on the Community screen (`ff-community-nudges-off-v1`). Nothing is shown for the stand-in location or inaccurate fixes. Constants are at the top of the Nudges block in `js/community.js`.

## Tree statuses
`VERIFIED`, `NO_TAG_LIKELY_SAME`, `NO_TAG_UNSURE`, `DIFFERENT_TREE`, `NOT_HERE`, `MOVED` (carries a dragged pin position), `NEW_TREE` (GPS position, optional tag/species). Businesses: `OPEN_CONFIRMED`, `CLOSED`, `MOVED`, `RENAMED`, `DETAILS_CHANGED`, `WRONG_CATEGORY`, `NEW_PLACE`. Statuses live in a registry keyed by feature kind.

## Consensus (as implemented)
Latest report per device per target. Reports from a device more than 60 m from the tree are ignored (no consensus, no points); reports with no GPS are tolerated. ≥2 independent devices agreeing on a question status (and outnumbering confirms) = `questioned`; confirms with no questions = `verified` (≥2 = `confirmed`); confirms and questions together = conflict, held for review and not shown. `NEW_TREE` reports match on an ~11 m grid; a second device makes `new-confirmed`.

(Original design notes:)
Independent devices only. Verify + independent verify = confirmed. Two agreeing change reports = "questioned". Conflicts, and `NEW_TREE` without a second sighting, escalate to an issue. Reports within ~40 m of the feature are trusted fully; others are flagged and score less.

## Scoring
All values and rank thresholds are configured in `netlify/functions/lib/community-points.js` and explained in `docs/community-points.md`.
+1 on verify, +1 when independently confirmed. `NEW_TREE` +1, +3 when found by a second device. Accepted correction +2. Points show as pending until the server accepts them. 
**Rewards after the fact** (`REWARD_POINTS` in `lib/community-consensus.js`): +10 when a later City of London register validates a report (a reported new tree's tag now exists, a "not here" tree is gone, a moved tree's register position changed towards the report; `lib/community-validation.js`), +1 when a feedback or bug issue is closed as completed, +3 when a place-check issue is closed as completed. The first validation run only records a baseline, so existing differences never pay out. Reporters are matched through an HMAC `reporter-ref` stored in the issue; the device id is never in the issue. A daily scheduled function (`community-validate-scheduled`) and an admin `/api/community/validate` run the check, idempotently. Place confirmations earn nothing.

Rank, badges, quests and area progress are follow-ups. Leaderboard is private in v1.

## Upstream loop
A scheduled export (e.g. monthly) writes the questioned/confirmed discrepancies as CSV + GeoJSON (feature id, status, count, last reported, position) to send to the City of London so they can issue a corrected dataset. After a new dataset is ingested, the daily job clears resolved overlay entries.

## Admin
The admin dashboard (`spec-admin.md`) gains community usage: active reporters, reports per day by status, outbox backlog, questioned-feature count, and the upstream export. Public leaderboard is a later, opt-in follow-up.
