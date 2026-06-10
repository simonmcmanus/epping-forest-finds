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

Authentication: password passed as query param `?pw=...` or `Authorization: Bearer <password>` header.

## Pages / Views

### Login screen
- Full-page password form
- On success: loads all tracking data, transitions to the map view
- On failure: shows inline error message

### Map view (canvas)

The map canvas fills the remainder of the page after the top bar. It renders:

- **Forest outline** — a simplified polygon of Epping Forest, filled in translucent green
- **Route lines** — one coloured polyline per user, connecting location pings in timestamp order
- **Direction arrows** — small filled triangles on routes every 5 pings, oriented by the recorded `heading`
- **Last-position dots** — filled circle at each user's most recent ping; larger when that user is selected
- **Tap markers** — small yellow dots at the user position recorded with each click event

#### Coordinate system
Simple linear + Mercator-corrected projection for the bounding box:
```
minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155
```
Longitude is scaled by `cos(midLat)` to correct for Mercator distortion at this latitude.

### Tracks view (default)
Route lines and direction arrows are drawn per user. Selected user's line is thicker (2.5 px vs 1.5 px). All users shown when none is selected.

### Heatmap view
A 60 × 45 cell grid over the canvas. Each cell is coloured by `sqrt(count / maxCount)` on a cold-to-hot scale (dark blue → yellow → red). Useful for identifying popular areas and blank spots.

## Sidebar

Lists every user who has at least one location ping, sorted by most recently seen. Each row shows:
- Coloured user dot (deterministic colour from palette, assigned in order of first seen)
- Truncated anonymous ID (first 8 chars of the UUID)
- Ping count
- Tooltip with last-seen timestamp

Clicking a row filters the map to that user only. Clicking again (or the "All users" row) clears the filter.

## Top bar controls

| Control | Behaviour |
|---|---|
| **Tracks** | Switch to route-line view (default) |
| **Heatmap** | Switch to density grid view |
| **Refresh** | Re-fetch all data from the server |

Auto-refresh runs every 5 minutes.

## Stats bar

Fixed to bottom-right of the canvas. Shows:
- Number of distinct users in current view
- Total location pings
- Total tap events

## Data API

### `POST /api/track`
Receives a batch of events from the client. No authentication required.

**Request body:**
```json
{
  "events": [
    { "type": "location", "uid": "...", "ts": "ISO8601", "lat": 51.65, "lng": 0.04, "heading": 180, "navTarget": { "id": "T123", "name": "Oak", "type": "tree" } },
    { "type": "click",    "uid": "...", "ts": "ISO8601", "userLat": 51.65, "userLng": 0.04, "itemType": "tree", "itemId": "T123", "itemName": "Oak" }
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
| `netlify dev` (linked site) | Netlify Blobs |
| Deployed to Netlify | Netlify Blobs |

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

## Planned future features

- Date range filter to narrow the time window shown
- Per-user route replay (animated playback)
- Export to CSV / GeoJSON
- Integration with folklore/POI data to show which specific features are most-clicked
