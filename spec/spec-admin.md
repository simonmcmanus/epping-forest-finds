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
- Full-page password form
- On success: loads all tracking data, transitions to the map view
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

**Request body:**
```json
{
  "events": [
    { "type": "location", "uid": "...", "ts": "ISO8601", "lat": 51.65, "lng": 0.04, "heading": 180, "navTarget": { "id": "T123", "name": "Oak", "type": "tree", "targetLat": 51.66, "targetLng": 0.05 } },
    { "type": "click",    "uid": "...", "ts": "ISO8601", "userLat": 51.65, "userLng": 0.04, "targetLat": 51.66, "targetLng": 0.05, "itemType": "tree", "itemId": "T123", "itemName": "Oak", "source": "map" }
  ]
}
```

**Response:** `{ "ok": true, "stored": <count> }`

### `GET /api/admin/tracks?pw=<password>`
Returns all stored events. Requires authentication.

**Response:**
```json
{
  "locations": [ /* all location events */ ],
  "clicks":    [ /* all click events */ ]
}
```

## Storage

The `netlify/functions/track.js` function tries Netlify Blobs first, and automatically falls back to local NDJSON files if Blobs context is unavailable. This means all three run modes use the same function code:

| Run mode | Storage used |
|---|---|
| `node server.js` | `data/tracking/*.ndjson` (via server.js directly) |
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
Path: `data/tracking/` (gitignored)
- `location.ndjson` — one location event per line
- `click.ndjson` — one click event per line

Created automatically on first write.

### Netlify Blobs
Each batch stored as a separate blob to avoid concurrent-write conflicts:
- Location batches keyed `location/<timestamp>_<random>`
- Click batches keyed `click/<timestamp>_<random>`

Admin read endpoint lists all blobs by prefix and downloads them in parallel.

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

## Planned future features

- Date range filter to narrow the time window shown
- Per-user route replay (animated playback)
- Export to CSV / GeoJSON
- Date/time filters for click-detail aggregation
