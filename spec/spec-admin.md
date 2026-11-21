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

Authentication: the password, or a session token (below), is passed as an `Authorization: Bearer <value>` header, and only there. A `?pw=` query parameter is refused: a password in a URL is written into browser history and server access logs. Every admin endpoint uses the same check (`lib/admin-auth.js`), which compares in constant time.

Signing in exchanges the password for a session token (`POST /api/admin/session`). The page keeps that token in `sessionStorage` (so it belongs to one tab) and sends it as the Bearer value; the token expires after 8 hours and is an HMAC keyed by `ADMIN_PASSWORD`, so changing the password revokes every token. The password itself is never written to `sessionStorage`, `localStorage`, cookies or the URL; it is held only while the sign-in request is made. A reload or **Refresh** in the same tab therefore stays signed in. A new tab, closing the tab, **Log out**, a 401 response or an expired token shows the login screen and asks for the password again (a 401 shows "Admin session expired. Sign in again."). The password still works as a Bearer value, so scripts and the CLI need no session. On load, the page removes any password copy an earlier version left in browser storage. If browser storage is blocked, the page works but asks for the password on every load.

## Pages / Views

### Login screen
- Full-page password form on a white card (local app icon as a brand mark, title, subtitle), with a visually-hidden (`.sr-only`) `<label>` for the password field so it has a programmatic name beyond its placeholder text
- Until sign-in the dashboard (`#adminApp`) is not rendered at all (`.admin-app[hidden]` is `display: none`), so no dashboard control sits behind the login screen in the tab order or the accessibility tree
- On success: gets a session token, loads tracking data for the current window (see Data API), transitions to the map view
- On a reload or Refresh in the same tab: opens the dashboard directly with the stored session token; a new tab, or an expired or refused token, shows the login screen (see Access). If the server cannot answer while restoring, the login screen shows the error and the stored token is kept for the next reload
- **Log out** clears the stored session token and returns to the login screen
- On failure: shows an inline error message in `#loginError`, styled in the danger colour and marked `role="alert"` so it is announced. A wrong password reads "Incorrect password. Try again." (no development hint: it would be wrong on a deployed site). A server error reads like "Server error 502: Bad Gateway": the status and its plain name only, never the raw response body (which can be a page of HTML; it goes to the console for debugging). A network failure (the request never got an answer) reads "Cannot reach the server. Check your connection and try again." and never shows the browser's raw "Failed to fetch". After any failed attempt focus returns to the password field with its text selected, so the next try is one keystroke away. The field has `aria-describedby="loginError"` and `aria-invalid="true"` after a failed attempt (including an empty one), removed when the admin types or tries again

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

Clicking a row filters the map to that user only. Clicking again (or the "All users" row) clears the filter. The "All users" row's figure is labelled with its unit ("8 users", "1 user"), not a bare number.

After a row is activated the list is redrawn and focus returns to the same row (the "All users" row included). Rows are real `<button>` elements (class `.admin-user-item`, `.selected` for the current filter) with
`aria-pressed` reflecting whether it is the current filter, so Tab, Enter and Space work natively. The selected row has an accent edge.

On phones (720 px wide and under) the sidebar becomes a horizontally scrolling strip of user chips above the map, so the map and Navigation page get the full width; the "Users" heading is then visually hidden. Choosing a chip scrolls it fully into the strip (nearest edge, smooth unless the user prefers reduced motion; a chip already in view does not move), and redrawing the strip keeps its scroll position instead of snapping back to the start. While more chips (or, in the top bar, more buttons) are scrolled out of view at an edge, that edge of the strip and of the phone nav row fades out as a scroll cue (a CSS mask on the scroller, so it never intercepts a tap or hides the focus ring, which is drawn inside the chips and buttons). The cue follows scrolling and resizing and is absent when everything fits and on wide screens.

## Top bar controls

| Control | Behaviour |
|---|---|
| **Tracks** | Switch to route-line view (default) |
| **Heatmap** | Switch to density grid view |
| **Navigation** | Open the Navigation page (replaces the map; see "Navigation page") |
| **Community** | Open the Community panel |
| **Access** | Open the Access panel |
| **Refresh** | Re-fetch all data from the server |
| **Log out** | Clear the stored session token and return to the login screen |

The bar has three groups: the view tabs (Tracks, Heatmap, Navigation) are a segmented control whose active tab is filled with the accent colour; Community and Access are panel buttons with a bordered style; Refresh and Log out are quiet, borderless utility actions on the right. A small app icon and the title "Epping Forest Finds — User Analytics" sit on the left with the environment badge next to them. The three view tabs carry `aria-pressed` (true on the active view), updated whenever the view changes. Below 1100 px wide (narrow laptops, tablets, landscape phones) the bar is two rows so no button ever overlaps another or runs off screen: the icon, title, environment badge and utility actions, then one row holding the view and panel buttons. On phones (720 px and narrower) the same two rows apply: the icon, environment badge and utility actions, then one row holding all five view and panel buttons, which fit at 390 px wide without scrolling (the row still scrolls on narrower screens, and its focus ring is drawn inside the buttons so scrolling never clips it). The title is visually hidden on phones only, because it would truncate, but is still read out. Community and Access carry `aria-expanded` (true while their panel is open) and are drawn lit (accent border and tint, plus a short bar under the label so colour is not the only cue) while it is, and hover and press still show on the lit button; this follows every open and close path (the other panel opening, Escape, the close button, log out). Top-bar buttons are at least 44 px to tap on phones (720 px and narrower) and on coarse-pointer (touch) devices up to 1099 px wide such as tablets; fine-pointer desktops keep 34 px buttons. Map controls and the user chips are 44 px on phones. On phones the nav row and user strip have `scroll-padding-inline: 28px` and (on phones only) bring a focused or selected control into view with `scrollIntoView`, because the browser alone left a tabbed-to control half cut off at 360 px and 320 px; it stops clear of the 28 px edge fade. Desktop focus scrolling is left to the browser.

Disabled controls (the Access field and Save, Community buttons while an action runs, Refresh while refreshing) show no hover or press change and the not-allowed cursor.

The dashboard's colours, radii, spacing, type sizes and shadows are tokens in `:root` of `css/admin.css`; muted text on the dark shell is at least 4.5:1.

**Overlay panels.** Community, Access and the tap details share one sheet style (`.admin-click-details`): a bottom-left sheet over the map (full width on phones) with a close button. It sits above the stats bar (the stats bar's height is passed to the CSS as `--stats-clear`) and its height is capped so the map controls and the legend stay uncovered. Only one is open at a time: the user opening one closes the others, but a data refresh never closes an open panel or discards what is typed in it. Each panel is a labelled `role="region"` (not a live region; the Access status, the Community loading/error line `#adminCommunityStatus` and the rebuild/reward-check result `#communityValidateResult` are the `role="status"` elements, and `#adminCommunityBody`, which is replaced wholesale on every load, is deliberately not live so the whole panel is never re-announced). Live regions stay rendered while empty, with no height and no margin, so their first message is announced and an empty one leaves no gap. Opening a panel moves focus to its close button; Escape or the close button hides it and returns focus to the button that opened it (Community, Access) or to the map (tap details, including when a refresh removes the tapped target). The close buttons are named like "Close Community stats (Esc)" (so the name contains the visible "Esc"), have the title "Esc closes" and `aria-keyshortcuts="Escape"`, and on mouse-and-keyboard screens show a small "Esc" cue beside the cross; the Community status line and the Access help text keep a right margin (84 px there, 52 px on phones) so they never run under the close button. Focus is also returned when another panel replaces the one that held it. Logging out, or an expired session, closes every panel and empties them (Access text and status, Community body and status, tap details) so nothing reappears at the next sign-in.

**Refresh failure.** Refresh and the 5-minute auto-refresh share one path. If it fails (a server error or no connection) the data stays on screen and `#adminRefreshStatus` (`role="status"`, a thin warning strip under the top bar, zero height while empty) says "Could not refresh — showing data from HH:MM." with the time of the last successful load; the next success clears it. While a refresh runs the button reads "Refreshing…" (disabled, `aria-busy="true"`). A repeated failure adds the time of the latest attempt, "Could not refresh — showing data from HH:MM. Tried again at HH:MM.", and writes the live region again so it is announced again. Logging out during a refresh resets the button, so it is enabled after the next sign-in whatever the old request does. A 401 still forgets the session and returns to sign-in with "Admin session expired. Sign in again."

Auto-refresh runs every 5 minutes.

## Stats bar

Fixed to bottom-right of the canvas (the full width at the bottom on phones), in the same dark frosted glass as the legend box and map controls (a near-opaque dark background with a light blur), laid out as chips (one per figure) so the numbers scan rather than read as one sentence, and it reads over any map colour. Each chip carries a visually hidden comma so a screen reader pauses between figures. Text is at least 14 px, light on dark with a contrast of at least 4.5:1 for labels and values (checked against a white map as the worst case), and the numbers are bolder than the labels. The panel stays inside the viewport at 1024 and 1280 px wide. Shows:
- Number of distinct users in current view
- Total location pings
- Total tap events
- The active time window (e.g. "last 30 days"), omitted when the API returned the full history
- A Navigation block (see Navigation journeys), shown only when at least one journey was derived, as extra chip rows under the main figures

## Navigation journeys

The stats bar (and the Navigation page) summarise walks to a navigation target. They are derived in the browser by `js/navigation-metrics.js` (pure functions, no DOM) from the same filtered location pings the rest of the bar uses, so selecting a user narrows them too. Nothing new is sent or stored.

- Pings with non-finite coordinates are ignored. Pings are grouped by user and read in time order.
- A journey starts at the first ping whose `navTarget` has finite target coordinates. It continues while later pings carry the same target (matched by id when present, otherwise by coordinates).
- A journey ends when the target is cleared or changes, when the next ping is more than 3 minutes after the previous one (a later ping with a target then starts a new journey), on arrival, or when the data runs out.
- Every location ping is a fresh fix, so arrival is the first journey ping, including the start ping, within 30 m of the target. The walk ends there.
- After a journey arrives, further pings with the same target (same id, else same coordinates) do not start another journey: the walker lingering at the place is one journey. A new journey for that target needs the target to change or clear, or a gap of more than 3 minutes between pings.
- Distance walked is the sum of straight-line distances between consecutive pings in the journey, skipping any pair more than 3 minutes apart. For a journey that did not arrive, the remaining distance is the distance from its last ping to the target.
- Time to arrive is arrival time minus start time, bucketed as under 5 minutes, 5 up to (not including) 15, 15 to 30 inclusive, and over 30.
- The block shows journeys started, arrived and the completion rate, the time buckets, total distance walked, and the abandoned count with the median remaining distance (n/a when none).

**Explicit journeys.** The app also sends `navigation_start`, `navigation_arrive` and `navigation_end` events (see `POST /api/track`). `buildExplicitJourneys()` pairs them per user and `navId`: a start opens a journey; an arrive marks arrival; an end closes it (an end with `reason: "arrived"` also counts as arrival) and supplies the remaining distance; a newer start by the same user closes the previous journey as abandoned; arrive or end events with no open journey are ignored. Distance walked is the client's `walkedM`, taken from the arrive or end event.

**Explicit wins over derived.** `combineNavJourneys()` uses every explicit journey, and keeps a journey derived from pings only when no explicit journey of the same user covers it. A derived journey is covered when its time span overlaps an explicit journey's start to end plus 3 minutes (the ping gap), so the same walk is never counted twice, while older data and users on older app versions still show their derived journeys.

**Detour ratio.** For completed (arrived) journeys with both `routeM` (shortest walking route from the start fix) and `walkedM`, ratio = `walkedM / routeM`. The summary reports the median ratio and how many journeys had one (`medianDetourRatio` is null and `detourCount` 0 when none, and the Detour line is hidden). Derived journeys never have a ratio. With no navigation events the block behaves exactly as derived-only.

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

## Navigation page

**Page, not overlay.** `#adminNavigation` is a page-level view: a sibling of the map area inside `.admin-body`, beside the user sidebar (above the user strip on phones), taking the remaining space and scrolling on its own. It never sits on top of the map. While it is shown the whole map area is hidden (`hidden`): the canvas, map controls, legend and stats bar are not rendered, and the Community, Access and tap-detail panels are closed (their buttons read `aria-expanded="false"`). The canvas does not draw while hidden (a zero-size canvas is skipped); returning to a map view refits the map and the panel inset and redraws. Opening Community or Access from the Navigation page first returns to the last map view (the panels live on the map), then opens the panel.

**Heading.** The page has a heading `<h2 id="adminNavigationTitle" tabindex="-1">Navigation</h2>` and a subtitle (`#adminNavigationSub`) saying what it reflects: "Navigation journeys over the last 30 days (or all loaded history), for all users (or user xxxxxxxx). Choose a user in the Users list to filter these figures." The heading and subtitle are outside the re-rendered body, so a refresh does not move focus. Choosing the Navigation tab (or arriving by Back/Forward) moves focus to the heading. The subtitle names a selected user with the same short ID as the sidebar chip, and shows the "Choose a user in the Users list…" hint only while no user is selected. Leaving the page (Back/Forward, or a panel opener) hands focus to the matching view button (Tracks or Heatmap) instead of dropping it to the page body. Clicking the already-active tab, or Tracks with no hash, adds no history entry. The user sidebar or strip stays on screen as the user filter. An empty window shows "No navigation journeys in this window" (adding "for the selected user" when filtered) in a dashed empty-state card.

**Routing.** The view is held in the URL hash: `#tracks`, `#heatmap`, `#navigation`; none or an unknown value means Tracks. The tabs set the hash (so Back and Forward step through views, restoring the view and its `aria-pressed` state), and a `hashchange` applies it. The dashboard still asks for the password after a reload, so the hash is read when the dashboard appears: signing in on `/admin#navigation` lands on the Navigation page. Logging out or an expired session resets to Tracks and clears the hash, so the next sign-in starts on the map. Escape behaves as before (it closes overlay panels only).

**Polish in this sweep.** Page padding is 24 px (12 px on phones); the page title and subtitle give the page a clear hierarchy; on phones the seven summary cards no longer leave an orphan card beside an empty cell (the last card spans both columns). Card labels wrap rather than clip (no horizontal clipping at 320 or 390 px). **Refresh** keeps keyboard focus: the button is disabled while it runs, so focus is handed back to it when the refresh finishes.

## Navigation page content

A **Navigation** tab in the top bar opens a page (`#adminNavigation`) that shows how navigation journeys trend over time. It uses the same loaded tracking data, the same user and time-window filters as the stats bar, and the same explicit-over-derived journey rule as the navigation block (see "Navigation journeys").

- **Summary cards:** a row of equal-height cards, each with the figure large and a short one-line label beneath: Started, Completed, Completion rate, Median arrival (median time to arrive), Distance walked, Median detour (ratio) and Detour sample (journeys that have a detour ratio). Each card keeps the full meaning in a screen-reader-only span and in its `title` attribute. Under the cards a visible note says "Started and completed count journeys, not people. Distance includes abandoned walks."
- **Layout:** each chart sits in its own panel with a heading, a left-aligned legend above the chart, the chart and its daily table. On windows at least 1100 px wide the first panel (started, completed and completion rate) spans the full width and the other two sit side by side; below 1100 px the panels stack in one column. The content is centred and capped at 1400 px wide so chart text stays readable.
- **Top destinations, last 7 days:** the first panel, full width, with the visible note "Counted back from now, within the loaded data and selected user." under its heading. Destinations are the navigation targets of journeys that started in the last 7 days, counted back from the current time, within the loaded data and the selected user. Journeys are grouped by destination (the navigation id when present, otherwise the target coordinates rounded to 5 decimal places); up to 5 are shown, ordered by journeys started (most first), ties broken by completed, then name. Each row shows the destination name (taken from the journey's target name; "Unnamed place" when it has none), started, completed, completion rate, and the median time to arrive over completed journeys only ("n/a" when none). A small horizontal bar under the name is scaled to the top destination's started count; it is decorative (`aria-hidden`) and the numbers are the text. With no journeys in that 7-day period the panel shows "No navigation journeys in the last 7 days." The pure function is `topDestinationsThisWeek(journeys, { now, days = 7, limit = 5 })` in `js/navigation-metrics.js`.
- **Started, completed and completion rate by day:** bars for started and completed journeys and a line with a point per day for the completion rate on a 0-100% right axis.
- **Time to arrive by day:** stacked bars for the four buckets (under 5, 5-15, 15-30 and over 30 minutes), with a legend and the visible note "Completed journeys only." (it keeps the two side-by-side charts aligned with the detour panel, which also has a note).
- **Median detour by day:** a line with a point per day and a dashed reference at 1.0, labelled "shortest route". A visible sentence under the heading explains the number using the current median (for example "1.25x means the walk was 25% longer than the shortest route."), or says "No completed walks with a route yet." when there is none.
- **Marks carry text:** every bar and point has an SVG `<title>` with its day and values (for example "2026-10-22: 4 started, 3 completed, 75%"), so a value can be read on hover without reading the table.
- **Daily tables:** the same figures as each chart as real HTML (right-aligned tabular numbers, light rules in the `--line` colour, first column sticky when the table scrolls; each scrollable wrapper is a keyboard-focusable `role="region"` with an `aria-label` such as "Daily figures, scrollable"), so every chart has a text alternative. Each chart is an SVG with `role="img"` and an `aria-label` that summarises the trend. Charts use light gridlines, 12 px axis labels in canvas units, and no animation. Chart marks (rate line and dots, bars) are at least 3:1 against white, and the four time buckets and three trend marks are each distinct.

Days are grouped by the local calendar day on which each journey started, oldest first. A day with only abandoned journeys shows a completion rate of 0% and no median. Days without journeys are not drawn, and an empty window shows a plain sentence instead of empty axes. The trend chart draws on an 840-unit canvas and the other two on a 420-unit canvas, each filling its panel, so labels keep a readable size on desktop; the dashboard is a desk tool, but on a phone the view takes the full width without horizontal page scroll. Cards have a soft shadow and the view keeps bottom padding so the last panel clears the screen edge.

## Data API

### `POST /api/track`
Receives a batch of events from the client. No authentication required.

Location pings report the **raw GPS fix** (`state.rawUserLocation`), not `state.userLocation`. The latter is low-passed and glided for the camera's benefit (see "Camera-facing GPS smoothing" in `spec-data-rendering.md`); the two differ by only a couple of metres, but a heat-map of real visits is built from the readings the device actually gave. `trackedLocation()` in `js/tracker.js` picks the raw fix and falls back to `state.userLocation` when there is none. Each fix is stamped with its arrival time, and a ping repeats it only while it is fresh: a fix more than two location intervals (two minutes) old is not sent again. So once GPS stops delivering fixes the pings stop, instead of repeating the last position with a new timestamp and showing a stationary walker; the next fresh fix is sent at the next minute.

**Request body:**
```json
{
  "events": [
    { "type": "location", "uid": "...", "ts": "ISO8601", "lat": 51.65, "lng": 0.04, "heading": 180, "navTarget": { "id": "T123", "name": "Oak", "type": "tree", "targetLat": 51.66, "targetLng": 0.05 } },
    { "type": "click",    "uid": "...", "ts": "ISO8601", "userLat": 51.65, "userLng": 0.04, "targetLat": 51.66, "targetLng": 0.05, "itemType": "tree", "itemId": "T123", "itemName": "Oak", "source": "map" },
    { "type": "navigation_start", "uid": "...", "ts": "ISO8601", "navId": "T123", "navName": "Oak", "navType": "tree", "targetLat": 51.66, "targetLng": 0.05, "userLat": 51.65, "userLng": 0.04, "routeM": 1200 },
    { "type": "navigation_arrive", "uid": "...", "ts": "ISO8601", "navId": "T123", "targetLat": 51.66, "targetLng": 0.05, "userLat": 51.66, "userLng": 0.05, "walkedM": 1500 },
    { "type": "navigation_end", "uid": "...", "ts": "ISO8601", "navId": "T123", "reason": "arrived", "userLat": 51.66, "userLng": 0.05, "remainingM": 10, "walkedM": 1500 }
  ]
}
```

**Navigation events.** `navigation_start` (a route begins), `navigation_arrive` (the user reaches the target) and `navigation_end` (the route is over, `reason` being `arrived`, `cleared`, `changed` or another short string, at most 30 characters). `routeM` is the shortest walking route from the start fix to the target, `walkedM` the metres walked so far (summed by the client), `remainingM` the metres from the last fix to the target; each is a number of metres or `null` when unknown. A start or arrive without valid target coordinates, and any navigation event without a valid `uid` or `ts`, is dropped; a distance that is negative, not finite or over 1,000,000 m becomes `null`. Events with the same timestamp are read in a fixed order, arrive then end then start, so an end that replaces a journey is never read after the next journey's start. Other fields follow the same rules as the other events.

**Response:** `{ "ok": true, "received": <count>, "stored": <count> }`

**Client batching.** `js/tracker.js` queues events in `localStorage` (newest 500 kept) and sends them together, not one request each: once 20 have built up, every 5 minutes, when the page is hidden (`visibilitychange`) or closed (`pagehide`), and when the device comes back online. A request carries at most 150 events (about 40 KB, inside the 64 KB a `keepalive` request may send); a longer queue goes up as several. A 5xx, 408 or 429 (or no response at all) puts the batch back at the front of the queue, unless consent was withdrawn while it was in flight, when the batch is discarded; any other refusal drops it, since it can never succeed. After a failed upload nothing is sent again until a wait has passed: 30 seconds, doubling with each further failure up to ten minutes. Every trigger above (the count, the timer, hiding or closing the page, coming back online) waits out that time, and the events stay queued meanwhile. A successful upload clears the wait. Withdrawing consent (Settings → Privacy, `setTrackingConsent(false)`) discards the queue, and a flush without consent sends nothing and drops whatever is queued, so events recorded before the withdrawal are never uploaded after it. The location ping itself still samples once a minute, so the dashboard's resolution is unchanged; what moves is when it arrives — a walker's latest position reaches the dashboard up to five minutes late.

**Limits.** The function refuses a body over 256 KB or more than 500 events (413; 500 is what an older client's whole offline queue could hold). Each event is reduced to the fields above — strings truncated, coordinates range-checked and rounded to 5 decimal places (~1 m), anything else dropped — and events dated more than a day ahead or more than 90 days old are discarded. Each client IP may send 600 requests an hour (`TRACK_LIMIT_PER_IP`); beyond that it gets 429 with `Retry-After`. The counters live in 64 small documents (`track-rate/<shard>`, chosen by a hash of the address) so no one document grows with the number of visitors. A phone on the current app sends about 12 requests an hour, so many people can share one carrier or Wi-Fi address before it applies; a refused batch stays in the phone's queue. The cost: every accepted POST also reads and rewrites one small counter document. At launch scale (about 500 phones at once) that is under two POSTs a second spread over 64 documents, so each document is touched about every 30 seconds. Updates are read-modify-write, not atomic, so two simultaneous requests can overwrite each other's increment and the limit undercounts slightly. It is a brake on a script hammering the endpoint, not an exact meter. Even with these counter writes, the store does far fewer writes per walker than the old one-request-per-event client, which batching replaced.

### `POST /api/admin/session`
Trades the admin password for a session token. Request: `Authorization: Bearer <ADMIN_PASSWORD>`, no body. Compared in constant time, like every admin check.

**Response (200):** `{ "token": "<expiresMs>.<hex HMAC-SHA256>", "expiresAt": <ms epoch, 8 hours ahead> }`. The token is stateless: the HMAC is keyed by `ADMIN_PASSWORD` over `admin-session:<expiresMs>`, so any function instance can verify it and changing the password invalidates all tokens. Every admin endpoint accepts it, or the password, as the Bearer value. A malformed, tampered, expired or differently keyed token is refused.

**Errors:** 401 `{ "error": "Unauthorized" }` for a wrong or missing password, or when `ADMIN_PASSWORD` is unset. Other methods get 405.

### `GET /api/admin/tracks`
Returns stored events from a recent time window. Requires the Bearer header (see Authentication above).

**Query params:**
- `days` — size of the window in days. Defaults to **30**. `days=all` reads back to the retention period (a year by default). With `TRACKING_RETENTION_DAYS=0` nothing is deleted, but `days=all` still reads back only a year, so one dashboard request stays bounded.

**Response:** events are packed to fit about six times as many into the response — one table of uids (and of navigation targets) and one short array per event. `js/admin.js` `unpackTrackingEvents()` turns them back into the event objects above (the `navigation` table too); a plain array of events (an older server, a test fixture) is used as it is.
```json
{
  "format": 2,
  "locations": { "v": 2, "type": "location", "uids": ["..."], "targets": [{ "id": "T123", "name": "Oak", "type": "tree", "targetLat": 51.66, "targetLng": 0.05 }],
                 "rows": [[0, 1761562800000, 51.65, 0.04, 180, 0]] },
  "clicks":    { "v": 2, "type": "click", "uids": ["..."],
                 "rows": [[0, 1761562800000, 51.65, 0.04, 51.66, 0.05, "tree", "T123", "Oak", "map"]] },
  "navigation": { "v": 2, "type": "navigation", "uids": ["..."],
                  "rows": [[0, 1761562800000, "T123", "Oak", "tree", 51.66, 0.05, 51.65, 0.04, 1200, null, null, null, "start"]] },
  "meta": { "storeName": "...", "context": "...", "windowDays": 30 }
}
```
A navigation row is `[uid index, time ms, navId, navName, navType, targetLat, targetLng, userLat, userLng, routeM, walkedM, remainingM, reason, kind]`, where `kind` is `start`, `arrive` or `end` (the event type is `navigation_<kind>`). A location row is `[uid index, time ms, lat, lng, heading, target index or -1]`; a click row is `[uid index, time ms, userLat, userLng, targetLat, targetLng, itemType, itemId, itemName, source]`.

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
- `navigation.ndjson` — one navigation event (start, arrive or end) per line

Created automatically on first write.

### Netlify Blobs
The store is laid out by day (`netlify/functions/lib/tracking-store.js`), so a read costs what its window holds, never what the deployment has accumulated:

| Key | Holds |
|---|---|
| `raw/<location\|click\|navigation>/<YYYY-MM-DD>/<ms>_<random>.json` | One POSTed batch, filed under its events' own UTC day (a batch that spans midnight, or an offline queue sent days later, becomes one blob per day). Separate blobs, so concurrent writes never conflict. |
| `daily/<location\|click\|navigation>/<YYYY-MM-DD>.json` | That day's events, packed (same format as the admin response). The `navigation` type holds all three navigation event kinds; events are de-duplicated on merge by type, user, time and `navId`, so a start, arrive and end at the same instant stay separate. |
| `track-rate/<0–63>` | Per-IP request counters for the current hour. |
| `location/<ms>_<random>.json`, `click/…` | The old flat layout (one blob per POST, forever). No longer written; migrated (below). |

An admin read lists only `raw/<type>/<day>/` for the days in its window and reads one daily file per day and type. For each day it lists and reads the raw batches first and the daily file last: compaction writes the daily file before deleting the batches it absorbed, so a run that lands mid-read never drops events from the response. A daily file that fails to read marks that day incomplete (`partial`, `oldestDayIncomplete`) instead of quietly showing only the day's uncompacted batches.

**Compaction.** `netlify/functions/track-compact-scheduled.js` runs every 10 minutes (`netlify.toml`). It lists every raw batch (cheap, since it runs every 10 minutes and so only ever finds the last few minutes' batches plus any that arrived late from an offline queue), and for each day, newest first, reads that day's batches, merges them into the day's daily file, writes it, and only then deletes the batches it absorbed; a batch filed under a day already past the retention period is deleted instead; events are de-duplicated on merge, so a run that dies between the write and the delete never double-counts. A batch that fails to read is left in place for the next run rather than deleted unseen, and a failure reading a day's existing daily file stops the run instead of overwriting the day with only the new events. It then migrates one listing page of the old flat layout per prefix into daily files (by each event's own date) and deletes those blobs, so a long-lived store converts over successive runs without ever listing the whole of it at once. Each run stops at 20 seconds (scheduled functions get 30) and leaves the rest to the next. Between runs, an admin read also merges any raw batches not yet compacted, so nothing is missing from the dashboard while a day is still open. Until the old layout has been fully migrated, the history it holds appears day by day as it converts, oldest first.

**Retention.** Daily files, and any raw batch, older than `TRACKING_RETENTION_DAYS` (default **365**) are deleted by the compaction run. `TRACKING_RETENTION_DAYS=0` keeps everything on disk (nothing is deleted); the dashboard's `days=all` read is still capped at a year (see the admin read above). The period is the owner's decision and should match the privacy page; the default exists so the store does not grow without end.

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
  from = "/api/admin/session"
  to   = "/.netlify/functions/admin-session"
  status = 200
  force  = true

[[redirects]]
  from = "/api/admin/tracks"
  to   = "/.netlify/functions/track"
  status = 200
  force  = true
```

`admin.html` is resolved as `/admin` by Netlify's default pretty-URL behaviour (strips `.html`).

The native app calls `/api/track` from another origin (its own bundle). The `native-cors` edge function, declared in `netlify.toml` on `/api/*`, grants CORS to the two native WebView origins only; `/api/admin/*` is excluded, so the admin endpoint is never readable cross-origin. See `spec-native.md` § Networking.

## User colour assignment

Colours are assigned from a fixed 15-colour palette in the order users are first seen in the loaded dataset. The mapping is deterministic within a page load but may differ between loads if the order of events changes.

## Security notes

- The admin password must be set as an environment variable — there is no default
- Raw tracking data is never exposed to end users; the admin endpoint requires authentication
- All events contain only anonymous IDs — no PII is stored or returned
- The admin UI never stores the password. It keeps a signed session token (8-hour expiry) in `sessionStorage`; the token is per tab, dies with the tab, and stops working when `ADMIN_PASSWORD` changes

## Early access (feature gate)
The **Access** top-bar button opens a panel with one tester per line (Tester ID from the person's Settings screen, then an optional note). Save posts the list to `POST /api/features`; no deploy is needed. The panel has a monospace textarea, a primary **Save** button and a `role="status"` message beside it; the helper text is quieter than the field. An empty list means the gate is off and everyone has Community, so the list is only editable once it has loaded: while loading, and after a failed load ("Could not load the list (500). Try again." for a server error, "Could not load the list. Check your connection and try again." with no answer, never the browser's raw "Failed to fetch"; a **Retry** button appears; clicking Access again also retries), the textarea and Save are disabled and nothing can be posted, so a failed load can never save an empty list. A late load response cannot overwrite typing because the field is disabled until it arrives. Save disables the field and button and shows "Saving…" while the request runs (no double submit), then "Saved N testers." and, only when lines were dropped, "M lines were not valid tester IDs (10 characters, 0-9 and a-f) or were repeated, and were dropped." (singular "1 line was not a valid tester ID (…) or was repeated, and was dropped."). A failed save reads "Could not save (500). Try again." or "Could not save. Check your connection and try again."; the typed text stays and Save is enabled again. A 401 on a load or save returns to sign-in like Community does. **Unsaved edits are never lost silently:** Escape while the list differs from the last loaded or saved text does not close the panel but shows "Unsaved changes — Save or press Esc again to discard." in the status line; a second Escape discards and closes (typing in between cancels the warning). The warning stays armed, with no timeout, until the admin types or the panel is hidden; hiding it (the close button, Community opening, Escape) disarms it, so after coming back one Escape only warns again. The close button, opening Community, and re-clicking Access keep the typed text instead: reopening Access shows it again with "Unsaved changes kept — Save, or press Esc twice to discard." (typing clears that note). Re-clicking Access while it is open and has unsaved text (or is saving) only refocuses the field; when it is open and clean it reloads the list. Only a second Escape, a save, or logging out discards the draft. See `spec/spec-community.md` (Feature gate). `/api/features` is routed in `netlify.toml`.

## Planned future features

- UI control to change the window (currently fixed to the last 30 days, or all history via `?days=N`/`?days=all` on the API directly)
- Per-user route replay (animated playback)
- Export to CSV / GeoJSON
- Date/time filters for click-detail aggregation

## Community verification usage

A **Community** button in the admin top bar opens a panel (`#adminCommunity`) of usage numbers for community reports: shown as a grid of stat cards (people reporting (all time, active in the last 24 h / 7 days), report count, trees questioned / verified, new trees (unconfirmed / confirmed), conflicts awaiting review, points awarded) followed by label/value tables for reports by type and per day for the last 7 days. The rebuild and reward-check buttons sit at the top with their result in a `role="status"` line (the only live region inside the panel body), and the report links are styled for the dark panel. While one runs the result line says "Rebuilding…" or "Checking rewards…" and both buttons are disabled. Results are prefixed with the action so one never silently replaces the other's meaning: "Rebuild: Rebuilt from N reports (M trees on the overlay)." / "Reward check: 2 register rewards and 1 issue reward given.", "Reward check: first check done — today's register is now the baseline. No rewards given yet.", "Reward check: nothing new to reward.", and when GitHub could not be asked "Reward check: issue rewards could not be checked (<short reason>)." (the reason is one line cut to about 40 characters, never the raw error); failures read "Rebuild: Could not rebuild the snapshot (500). Try again." and "Reward check: Could not run the reward check (500). Try again." (or "… Check your connection and try again." with no response). After a successful rebuild the figures and the "As of the last snapshot" line are re-fetched and redrawn in place (`#communityFigures`; the buttons and result line are not replaced, so the panel stays open and focus stays on the button). The result line is written once, after both steps: if the figures then fail to refresh it reads the success sentence followed by "The figures below could not be refreshed.", so a screen reader hears it once. Only one action runs at a time even if the panel is closed and reopened meanwhile: the fresh buttons come up disabled with the progress text, and the result appears when it finishes. A load error shows "Could not load community stats (N)." in `#adminCommunityStatus`, with a **Retry** button outside the replaced body; a 401 from any Community request returns to sign-in with "Admin session expired. Sign in again." Data comes from `GET /api/community/overlay?admin=1` with `Authorization: Bearer <ADMIN_PASSWORD>` (401 otherwise). The figures are worked out by `communityAdminStats` (`netlify/functions/lib/community-consensus.js`) during each snapshot rebuild and stored as `admin-stats`, so opening the panel never reads the whole ledger; the panel says which snapshot it shows ("As of the last snapshot, …"), normally under an hour old, and **Rebuild snapshot now** refreshes it. Individual device ids and scores are not shown. See `spec-community.md`.

Resetting Community data is done by a local script (`scripts/reset-community.js`), not an HTTP endpoint or an admin-panel button. By default it clears the local directory `data/tracking/community/<BRANCH>/`, where `BRANCH` is the environment variable and defaults to `dev`. Production is refused unless `--production` is passed, and every run requires typing `RESET ALL COMMUNITY DATA`.

## Community data deletion
`POST /api/community/delete` (`Authorization: Bearer <ADMIN_PASSWORD>`, routed in `netlify.toml` and `server.js`) deletes one person's Community data on request; it has no button in the dashboard. See `spec-community.md` (Data deletion) and `docs/community-data-deletion.md`.
