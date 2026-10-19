# Community Verification (proposed — not yet implemented)

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
- One offline **outbox** (reports and feedback), flushed on `online`, `visibilitychange`, app start and Background Sync where available; exponential backoff; "N waiting to send" chip.
- **Optimistic UI**: a submitted report is merged over the feature locally at once, with the note "Saved. Other people may take up to a day to see this." The local copy is dropped when the daily overlay includes it.
- Anonymous device identity (random id + secret) with an optional recovery code. No login in v1.

## Tree statuses
`VERIFIED`, `NO_TAG_LIKELY_SAME`, `NO_TAG_UNSURE`, `DIFFERENT_TREE`, `NOT_HERE`, `MOVED` (carries a dragged pin position), `NEW_TREE` (GPS position, optional tag/species). Businesses: `OPEN_CONFIRMED`, `CLOSED`, `MOVED`, `RENAMED`, `DETAILS_CHANGED`, `WRONG_CATEGORY`, `NEW_PLACE`. Statuses live in a registry keyed by feature kind.

## Consensus
Independent devices only. Verify + independent verify = confirmed. Two agreeing change reports = "questioned". Conflicts, and `NEW_TREE` without a second sighting, escalate to an issue. Reports within ~40 m of the feature are trusted fully; others are flagged and score less.

## Scoring
+1 on verify, +1 when independently confirmed. `NEW_TREE` +1, +3 when found by a second device. Accepted correction +2. Points show as pending until the server accepts them. Rank, badges, quests and area progress are follow-ups. Leaderboard is private in v1.

## Upstream loop
A scheduled export (e.g. monthly) writes the questioned/confirmed discrepancies as CSV + GeoJSON (feature id, status, count, last reported, position) to send to the City of London so they can issue a corrected dataset. After a new dataset is ingested, the daily job clears resolved overlay entries.

## Admin
The admin dashboard (`spec-admin.md`) gains community usage: active reporters, reports per day by status, outbox backlog, questioned-feature count, and the upstream export. Public leaderboard is a later, opt-in follow-up.
