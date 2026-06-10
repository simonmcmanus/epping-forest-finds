---
name: project-tracking
description: Location & click analytics tracking system added June 2026 — architecture, storage, admin interface, consent flow
metadata:
  type: project
---

Tracking system implemented June 2026 for user location analytics and admin map view.

**Why:** Understand popular forest routes, identify underserved areas, enable future advertising/monetisation.

**Key files:**
- `js/tracker.js` — all client-side tracking logic (consent, queue, flush, events)
- `css/tracking.css` — T&C consent modal styles
- `terms.html` — full privacy policy / terms page
- `admin.html` / `js/admin.js` / `css/admin.css` — password-protected admin map
- `netlify/functions/track.js` — Netlify function using @netlify/blobs
- `data/tracking/` — local NDJSON storage (location.ndjson, click.ndjson)

**Consent flow:** T&C modal appears before location is enabled (first time). Consent stored in `localStorage` key `ff-track-v1`. Integrates into onboarding location step and location gate button.

**Event format:** POST `/api/track` — `{ events: [...] }`. Types: `location` (lat/lng/heading/navTarget) and `click` (itemType/itemId/itemName/userLat/userLng).

**Offline:** Events queued in `localStorage` key `ff-track-queue`, flushed on `window online` event.

**Admin:** `/admin` — password via env var `ADMIN_PASSWORD`. Tracks view (route lines + arrows) and heatmap view (density grid). Sidebar shows user list; click to isolate route. Data from `GET /api/admin/tracks`.

**Pre-existing test failure:** `test/forest-finds.test.js` fails on `home.png` reference check — this failure exists on the original codebase before tracking changes.

**How to apply:** When touching tracking, consent, or admin features, refer to these files. Admin password must be set via `ADMIN_PASSWORD` env var — no default.
