# Epping Forest Finds — Admin Specification

## Overview

A password-protected analytics dashboard at `/admin` that shows where users are walking, what they are tapping, and how busy different parts of the forest are. Data is collected only from users who have given consent via the in-app privacy modal.

## Access

| Environment | URL | Backend |
|---|---|---|
| `node server.js` | `http://localhost:8080/admin` | `server.js` serves `admin.html`; data at `GET /api/admin/tracks` |
| `netlify dev` | `http://localhost:8888/admin` | Netlify function via redirect; falls back to local NDJSON if no linked site |
| Deployed | `https://<site>/admin` | Netlify pretty-URL resolves `admin.html`; data via `/.netlify/functions/track` |

Password is set via env var `ADMIN_PASSWORD`. If unset, all admin endpoints return 401.

Authentication: password passed as `Authorization: Bearer <password>` header. The API also accepts `?pw=...` for compatibility, but the admin UI must use the header so the password is not written into URLs, browser history, or server access logs.

The admin UI stores the password in `sessionStorage` under `ff-admin-session-password` after successful login. This keeps the admin signed in across same-tab refreshes while clearing the session when the browser tab is closed. The **Log out** button clears that session value. A 401 response during refresh or auto-refresh clears the stored password and returns the user to the login screen.

## Pages / Views

### Login screen
- Full-page password form, with a visually-hidden (`.sr-only`) `<label>` for the password field so it has a programmatic name beyond its placeholder text
- On success: loads tracking data for the current window (see Data API), transitions to the map view
- On same-tab refresh after a successful login: restores the session from `sessionStorage` and re-fetches data without asking for the password again
- **Log out** clears the stored admin session and returns to the login screen
- On failure: shows inline error message

### Map view (canvas)

The map canvas fills the remainder of the page after the top bar. It renders:

- **Base map** — the same local forest context as the user map, using the forest/buffer land, environment, roads, and paths GeoJSON layers
- **Semi-opaque map context** — base-map layers render with reduced opacity so route, location, and tap markers remain visually dominant
- **Route lines** — one coloured polyline per user, connecting location pings in timestamp order
- **Direction arrows** — small filled triangles on routes every 5 pings, oriented by the recorded `heading`
- **Last-position dots** — filled circle at each user's most recent ping; larger when that user is selected
- **Tap markers** — yellow bullseye markers at the clicked target location, falling back to user position or nearest location ping when older records lack target coordinates

#### Admin map controls

The admin map supports:
- `+` zoom-in button
- `-` zoom-out button
- **Reset** button to restore default zoom and pan
- mouse/touch drag panning
- wheel zoom around the pointer

The current admin viewport is stored in `localStorage` under `ff-admin-map-viewport` as `{ zoom, panX, panY }`. Refreshing the admin page restores the same zoom and pan for that browser/device. Reset also persists the reset state.

#### Coordinate system
Admin rendering uses a Mercator projection with a fallback Epping Forest bounding box:
```
minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155
```
When base-map GeoJSON layers are available, their projected bounds replace the fallback box.

### Tracks view (default)
Route lines and direction arrows are drawn per user. Selected user's line is thicker (2.5 px vs 1.5 px). All users shown when none is selected.

### Heatmap view
A 60 × 45 cell grid over the canvas. Each cell is coloured by `sqrt(count / maxCount)` on a cold-to-hot scale (dark blue → yellow → red). Useful for identifying popular areas and blank spots.

## Sidebar

Lists every user who has at least one location ping or tap event, sorted by most recently seen. Each row shows:
- Coloured user dot (deterministic colour from palette, assigned in order of first seen)
- Truncated anonymous ID (first 8 chars of the UUID)
- Ping count and tap count
- Tooltip with last-seen timestamp

Clicking a row filters the map to that user only. Clicking again (or the "All users" row) clears the filter.

Rows are keyboard-operable, not click-only: each row carries `role="button"`, `tabindex="0"` and
`aria-pressed` reflecting whether it is the current filter, and responds to Enter/Space the same
as a click (`makeActivatable()` in `js/admin.js`).

## Top bar controls

| Control | Behaviour |
|---|---|
| **Tracks** | Switch to route-line view (default) |
| **Heatmap** | Switch to density grid view |
| **Refresh** | Re-fetch all data from the server |
| **Log out** | Clear the same-tab admin session and return to the login screen |

Auto-refresh runs every 5 minutes.

## Stats bar

Fixed to bottom-right of the canvas. Shows:
- Number of distinct users in current view
- Total location pings
- Total tap events
- The active time window (e.g. "last 30 days"), omitted when the API returned the full history

## Tap / Click Details

Clicking a yellow tap marker opens an overlay panel in the admin map. The selected marker is highlighted while the panel is open.

The panel aggregates all click records with the same target key:
```
<itemType>:<itemId or itemName>
```

For the selected target, the panel shows:
- item name
- item type
- item ID when available
- total tap/click count
- unique user count
- explicit tap count
- navigation-selection count
- last-click timestamp
- recent tap list with short user ID, source, and timestamp

Example: an oak tree clicked four times by three users should show `4 taps` and `3 users`.

Click detail records can come from two sources:
- Explicit `click` events stored in the `clicks` array
- Derived navigation-click events produced by admin from `location.navTarget` changes when location pings include `navTarget.targetLat` and `navTarget.targetLng`

Admin suppresses duplicate derived navigation-click events when a matching explicit click exists for the same user/target near the same time.

## Data API

### `POST /api/track`
Receives a batch of events from the client. No authentication required.

Location pings report the **raw GPS fix** (`state.rawUserLocation`), not `state.userLocation`. The latter is low-passed and glided for the camera's benefit (see "Camera-facing GPS smoothing" in `spec-data-rendering.md`); the two differ by only a couple of metres, but a heat-map of real visits is built from the readings the device actually gave. `trackedLocation()` in `js/tracker.js` picks the raw fix and falls back to `state.userLocation` when there is none.

**Request body:**
```json
{
  "events": [
    { "type": "location", "uid": "...", "ts": "ISO8601", "lat": 51.65, "lng": 0.04, "heading": 180, "navTarget": { "id": "T123", "name": "Oak", "type": "tree", "targetLat": 51.66, "targetLng": 0.05 } },
    { "type": "click",    "uid": "...", "ts": "ISO8601", "userLat": 51.65, "userLng": 0.04, "targetLat": 51.66, "targetLng": 0.05, "itemType": "tree", "itemId": "T123", "itemName": "Oak", "source": "map" }
  ]
}
```

**Response:** `{ "ok": true, "received": <count>, "stored": <count> }`

**Client batching.** `js/tracker.js` queues events in `localStorage` (newest 500 kept) and sends them together, not one request each: once 20 have built up, every 5 minutes, when the page is hidden (`visibilitychange`) or closed (`pagehide`), and when the device comes back online. A request carries at most 150 events (about 40 KB, inside the 64 KB a `keepalive` request may send); a longer queue goes up as several. A 5xx, 408 or 429 puts the batch back at the front of the queue for the next attempt; any other refusal drops it, since it can never succeed. Withdrawing consent (Settings → Privacy, `setTrackingConsent(false)`) discards the queue, and a flush without consent sends nothing and drops whatever is queued, so events recorded before the withdrawal are never uploaded after it. The location ping itself still samples once a minute, so the dashboard's resolution is unchanged; what moves is when it arrives — a walker's latest position reaches the dashboard up to five minutes late.

**Limits.** The function refuses a body over 256 KB or more than 500 events (413; 500 is what an older client's whole offline queue could hold). Each event is reduced to the fields above — strings truncated, coordinates range-checked and rounded to 5 decimal places (~1 m), anything else dropped — and events dated more than a day ahead or more than 90 days old are discarded. Each client IP may send 600 requests an hour (`TRACK_LIMIT_PER_IP`); beyond that it gets 429 with `Retry-After`. The counters live in 64 small documents (`track-rate/<shard>`, chosen by a hash of the address) so no one document grows with the number of visitors. A phone on the current app sends about 12 requests an hour, so many people can share one carrier or Wi-Fi address before it applies; a refused batch stays in the phone's queue.

### `GET /api/admin/tracks?pw=<password>`
Returns stored events from a recent time window. Requires authentication.

**Query params:**
- `days` — size of the window in days. Defaults to **30**. `days=all` reads back to the retention period (a year by default).

**Response:** events are packed to fit about six times as many into the response — one table of uids (and of navigation targets) and one short array per event. `js/admin.js` `unpackTrackingEvents()` turns them back into the event objects above; a plain array of events (an older server, a test fixture) is used as it is.
```json
{
  "format": 2,
  "locations": { "v": 2, "type": "location", "uids": ["..."], "targets": [{ "id": "T123", "name": "Oak", "type": "tree", "targetLat": 51.66, "targetLng": 0.05 }],
                 "rows": [[0, 1761562800000, 51.65, 0.04, 180, 0]] },
  "clicks":    { "v": 2, "type": "click", "uids": ["..."],
                 "rows": [[0, 1761562800000, 51.65, 0.04, 51.66, 0.05, "tree", "T123", "Oak", "map"]] },
  "meta": { "storeName": "...", "context": "...", "windowDays": 30 }
}
```
A location row is `[uid index, time ms, lat, lng, heading, target index or -1]`; a click row is `[uid index, time ms, userLat, userLng, targetLat, targetLng, itemType, itemId, itemName, source]`.

The read goes newest day first, three days at a time, and stops when the window ends, after about 7 seconds, or at about 4.5 MB of packed events (Netlify refuses a function response over 6 MB). When it stops early it returns what it has, newest first, with `meta.partial: true`, `meta.oldestDay` (the earliest day it reached) and `meta.oldestDayIncomplete` (true when it stopped inside that day, by time or size, so only that day's newest events are included); the stats bar then says "partial … (back to <day>)", adding ", that day only in part" when it is incomplete. On a busy deployment a 30-day request can therefore show fewer than 30 days. If the full-window request still fails with a 5xx, the dashboard retries with `days=7`, then `days=1`, and shows the window it ended up with; if every attempt fails the login error includes the server's status and message. `meta.windowDays` is `null` when `days=all` was requested. The admin stats bar shows the active window (e.g. "last 30 days") next to the event counts.

## Storage

The `netlify/functions/track.js` function tries Netlify Blobs first, and automatically falls back to local NDJSON files if Blobs context is unavailable. This means all three run modes use the same function code:

| Run mode | Storage used |
|---|---|
| `node server.js` | `data/tracking/*.ndjson` (server.js runs the same function, which falls back with no Blobs context) |
| `netlify dev` (no linked site) | `data/tracking/*.ndjson` (Blobs fallback in function) |
| `netlify dev` (linked site) | Netlify Blobs, `tracking-<branch>` store |
| Branch deploy / deploy preview | Netlify Blobs, `tracking-<branch>` store |
| Production deploy | Netlify Blobs, `tracking` store |

### Environment isolation

The blob store name is derived from the Netlify `CONTEXT` environment variable, which Netlify sets automatically on every deploy:

| `CONTEXT` value | Store name |
|---|---|
| `production` | `tracking` |
| `deploy-preview` | `tracking-<branch>` |
| `branch-deploy` | `tracking-<branch>` |
| unset (local) | falls back to NDJSON files |

`<branch>` is the value of the Netlify `BRANCH` env var, lowercased and with non-alphanumeric characters replaced by `-`. This ensures that production data is never mixed with test or preview data, and the production admin dashboard only shows interactions from the production URL.

Users cannot switch environments: the store used is determined entirely by the Netlify deploy context, not by any client-side or user-controlled value.

### Local NDJSON files
Path: `data/tracking/` (gitignored), or `TRACKING_DIR` when set (the local-server test points it at a scratch directory)
- `location.ndjson` — one location event per line
- `click.ndjson` — one click event per line

Created automatically on first write.

### Netlify Blobs
The store is laid out by day (`netlify/functions/lib/tracking-store.js`), so a read costs what its window holds, never what the deployment has accumulated:

| Key | Holds |
|---|---|
| `raw/<location\|click>/<YYYY-MM-DD>/<ms>_<random>.json` | One POSTed batch, filed under its events' own UTC day (a batch that spans midnight, or an offline queue sent days later, becomes one blob per day). Separate blobs, so concurrent writes never conflict. |
| `daily/<location\|click>/<YYYY-MM-DD>.json` | That day's events, packed (same format as the admin response). |
| `track-rate/<0–63>` | Per-IP request counters for the current hour. |
| `location/<ms>_<random>.json`, `click/…` | The old flat layout (one blob per POST, forever). No longer written; migrated (below). |

An admin read lists only `raw/<type>/<day>/` for the days in its window and reads one daily file per day and type.

**Compaction.** `netlify/functions/track-compact-scheduled.js` runs every 10 minutes (`netlify.toml`). It lists every raw batch (cheap, since it runs every 10 minutes and so only ever finds the last few minutes' batches plus any that arrived late from an offline queue), and for each day, newest first, reads that day's batches, merges them into the day's daily file, writes it, and only then deletes the batches it absorbed; a batch filed under a day already past the retention period is deleted instead; events are de-duplicated on merge, so a run that dies between the write and the delete never double-counts. A batch that fails to read is left in place for the next run rather than deleted unseen, and a failure reading a day's existing daily file stops the run instead of overwriting the day with only the new events. It then migrates one listing page of the old flat layout per prefix into daily files (by each event's own date) and deletes those blobs, so a long-lived store converts over successive runs without ever listing the whole of it at once. Each run stops at 20 seconds (scheduled functions get 30) and leaves the rest to the next. Between runs, an admin read also merges any raw batches not yet compacted, so nothing is missing from the dashboard while a day is still open. Until the old layout has been fully migrated, the history it holds appears day by day as it converts, oldest first.

**Retention.** Daily files, and any raw batch, older than `TRACKING_RETENTION_DAYS` (default **365**) are deleted by the compaction run. `TRACKING_RETENTION_DAYS=0` keeps everything. The period is the owner's decision and should match the privacy page; the default exists so the store does not grow without end.

The local NDJSON fallback has no day layout, so it reads the whole file and filters by each event's own `ts` — fine at local-dev data volumes.

## Netlify routing

`netlify.toml` must include:
```toml
[[redirects]]
  from = "/api/track"
  to   = "/.netlify/functions/track"
  status = 200
  force  = true

[[redirects]]
  from = "/api/admin/tracks"
  to   = "/.netlify/functions/track"
  status = 200
  force  = true
```

`admin.html` is resolved as `/admin` by Netlify's default pretty-URL behaviour (strips `.html`).

## User colour assignment

Colours are assigned from a fixed 15-colour palette in the order users are first seen in the loaded dataset. The mapping is deterministic within a page load but may differ between loads if the order of events changes.

## Security notes

- The admin password must be set as an environment variable — there is no default
- Raw tracking data is never exposed to end users; the admin endpoint requires authentication
- All events contain only anonymous IDs — no PII is stored or returned
- The admin UI keeps the password in same-tab `sessionStorage`, not persistent `localStorage`

## Early access (feature gate)
The **Access** top-bar button opens a panel with one tester per line (Tester ID from the person's Settings screen, then an optional note). Save posts the list to `POST /api/features`; no deploy is needed. An empty list means the gate is off and everyone has Community. See `spec/spec-community.md` (Feature gate). `/api/features` is routed in `netlify.toml`.

## Planned future features

- UI control to change the window (currently fixed to the last 30 days, or all history via `?days=N`/`?days=all` on the API directly)
- Per-user route replay (animated playback)
- Export to CSV / GeoJSON
- Date/time filters for click-detail aggregation

## Community verification usage

A **Community** button in the admin top bar opens a panel (`#adminCommunity`) of usage numbers for community reports: people reporting (all time, active in the last 24 h / 7 days), report count, trees questioned / verified, new trees (unconfirmed / confirmed), conflicts awaiting review, points awarded, reports by type and per day for the last 7 days. Data comes from `GET /api/community/overlay?admin=1` with `Authorization: Bearer <ADMIN_PASSWORD>` (401 otherwise). The figures are worked out by `communityAdminStats` (`netlify/functions/lib/community-consensus.js`) during each snapshot rebuild and stored as `admin-stats`, so opening the panel never reads the whole ledger; the panel says which snapshot it shows ("As of the last snapshot, …"), normally under an hour old, and **Rebuild snapshot now** refreshes it. Individual device ids and scores are not shown. See `spec-community.md`.

## Community data deletion
`POST /api/community/delete` (`Authorization: Bearer <ADMIN_PASSWORD>`, routed in `netlify.toml` and `server.js`) deletes one person's Community data on request; it has no button in the dashboard. See `spec-community.md` (Data deletion) and `docs/community-data-deletion.md`.
