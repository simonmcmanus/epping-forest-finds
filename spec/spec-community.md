# Community Verification (built: outbox, tree reports, consensus, overlay; scores UI, businesses, admin, upstream export still to do)

A public, plain-language summary is published at `/reports/tree-report/` (`reports/tree-report/index.html`, static, no app code). Update it when the rules below change.

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

## Your contributions (Settings screen)
The Settings screen opens with a **Your contributions** section (`communityContributionsHtml`, `js/community.js`): rank (Seedling 0, Sapling 5, Woodward 20, Warden 50 points, with points to the next), points, verified / confirmed counts, and a log of the user's reports, newest first, each linking to its tree and showing one of *Waiting to send* (still in the outbox), *Waiting for a second opinion*, *Confirmed by others* or *Being reviewed* (conflict). The log is built from the local record, so it works offline; outcomes come from `GET /api/community/overlay?me=<id>&list=1` (backed by a per-device `mine/<deviceId>` index written by `community-report.js` and `reportOutcome` in the consensus module) and are cached in `ff-community-log-v1`. Outcomes update with the daily overlay. A fuller rename of the nav tab (Settings → "You") and a separate Contribute tab are not built; routes and element ids are unchanged.

## Tree statuses
`VERIFIED`, `NO_TAG_LIKELY_SAME`, `NO_TAG_UNSURE`, `DIFFERENT_TREE`, `NOT_HERE`, `MOVED` (carries a dragged pin position), `NEW_TREE` (GPS position, optional tag/species). Businesses: `OPEN_CONFIRMED`, `CLOSED`, `MOVED`, `RENAMED`, `DETAILS_CHANGED`, `WRONG_CATEGORY`, `NEW_PLACE`. Statuses live in a registry keyed by feature kind.

## Consensus (as implemented)
Latest report per device per target. Reports from a device more than 60 m from the tree are ignored (no consensus, no points); reports with no GPS are tolerated. ≥2 independent devices agreeing on a question status (and outnumbering confirms) = `questioned`; confirms with no questions = `verified` (≥2 = `confirmed`); confirms and questions together = conflict, held for review and not shown. `NEW_TREE` reports match on an ~11 m grid; a second device makes `new-confirmed`.

(Original design notes:)
Independent devices only. Verify + independent verify = confirmed. Two agreeing change reports = "questioned". Conflicts, and `NEW_TREE` without a second sighting, escalate to an issue. Reports within ~40 m of the feature are trusted fully; others are flagged and score less.

## Scoring
+1 on verify, +1 when independently confirmed. `NEW_TREE` +1, +3 when found by a second device. Accepted correction +2. Points show as pending until the server accepts them. Rank, badges, quests and area progress are follow-ups. Leaderboard is private in v1.

## Upstream loop
A scheduled export (e.g. monthly) writes the questioned/confirmed discrepancies as CSV + GeoJSON (feature id, status, count, last reported, position) to send to the City of London so they can issue a corrected dataset. After a new dataset is ingested, the daily job clears resolved overlay entries.

## Admin
The admin dashboard (`spec-admin.md`) gains community usage: active reporters, reports per day by status, outbox backlog, questioned-feature count, and the upstream export. Public leaderboard is a later, opt-in follow-up.
