# Epping Forest Finds — Admin Specification

## Overview

An analytics dashboard at `/admin`, behind Auth0 sign-in and an allowlist, that shows where users are walking, what they are tapping, and how busy different parts of the forest are. Data is collected only from users who have given consent via the in-app privacy modal.

## Access

| Environment | URL | Backend |
|---|---|---|
| `node server.js` | `http://localhost:8080/admin` | `server.js` serves `admin.html`; data at `GET /api/admin/tracks` |
| `netlify dev` | `http://localhost:8888/admin` | Netlify function via redirect; falls back to local NDJSON if no linked site |
| Deployed | `https://<site>/admin` | Netlify pretty-URL resolves `admin.html`; data via `/.netlify/functions/track` |

The dashboard signs in with **Auth0**, the same provider as community sign-in, restricted by an allowlist. Env `ADMIN_SUBJECTS` is a comma-separated list of Auth0 subject ids (`sub`, for example `auth0|abc123` or `google-oauth2|123`); entries are trimmed, blanks ignored, and matching is exact (no case folding or prefixes). Unset or empty means nobody can sign in with Auth0 (fail closed). The Auth0 settings (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`) and `AUTH_SECRET` (32+ characters) are shared with community sign-in; the callback URL is the existing `/api/auth/callback`. See "Setting up admin sign-in" in `docs/admin-sign-in.md`.

**Flow.** The login card's link goes to `GET /api/auth/login?admin=1`. The admin intent is sealed into the signed state cookie (`admin: true`), the return path is forced to `/admin`, and `/authorize` gets `prompt=login` and `max_age=0`, so Auth0 always asks for a fresh sign-in. There is no second callback: `auth-callback.js` sees `admin` in the state, reads the userinfo `sub` and checks it against `ADMIN_SUBJECTS`. A listed subject gets a new signed `ff_admin` cookie (`{sub, name, exp}`, 8 hours, signed with `AUTH_SECRET`; `HttpOnly`, `SameSite=Strict`, `Secure` over https, `Path=/`) and is redirected to `/admin`. The community `ff_session` is neither created nor changed. An unlisted subject gets no cookie and is redirected to `/admin?signin=denied` (the subject id is never put in the URL); any other failure goes to `/admin?signin=failed`. Email is never read, logged or stored.

**What the endpoints accept** (`lib/admin-auth.js`, one check shared by every admin endpoint):
- `Authorization: Bearer <ADMIN_PASSWORD>` for scripts, compared in constant time. This still needs `ADMIN_PASSWORD` set and needs no extra header. A `?pw=` query parameter is refused (a password in a URL ends up in history and logs). `POST /api/community/delete` accepts only this, never the cookie.
- A valid, unexpired `ff_admin` cookie whose `sub` is **still** in `ADMIN_SUBJECTS` at request time, so removing someone revokes them at once. This works with `ADMIN_PASSWORD` unset. Because a cookie is sent automatically, a cookie-authenticated request (every method, including GET) is accepted only when it carries `X-Requested-With: admin`; a page on another site cannot add that header without a preflight, and no CORS is granted. A missing, expired, tampered, wrongly signed or no-longer-listed cookie is a 401.

**Cookie hardening.** `ff_admin` is signed with a key derived from `AUTH_SECRET` (HMAC of `ff-admin-cookie`) and carries `typ: "admin"`, checked on every request, so a community `ff_session` or sign-in state cookie (signed with `AUTH_SECRET` itself, no `typ`) copied into `ff_admin` is refused even for a listed admin.

**Unconfigured deploy.** If Auth0 is not configured, `/api/auth/login?admin=1` redirects (302) to `/admin?signin=unavailable`, and the card reads "Admin sign-in isn't set up on this site yet. The site owner needs to configure Auth0 and ADMIN_SUBJECTS." (Community login keeps its plain-text 503.)

The old password-for-token exchange (`POST /api/admin/session`, the session token and its `sessionStorage` copy) is gone. On load, the page still removes any password copy an earlier version left in browser storage.

## Pages / Views

### Login screen
- Full-page card on white (local app icon as a brand mark, title "Admin Access", subtitle) with one link-button, "Sign in" (`#loginBtn`, an `<a href="/api/auth/login?admin=1" aria-describedby="loginError">`, keyboard focusable with the dark focus ring for light surfaces). There is no password field.
- Until sign-in the dashboard (`#adminApp`) is not rendered at all (`.admin-app[hidden]` is `display: none`), so no dashboard control sits behind the login screen in the tab order or the accessibility tree
- **No flash after sign-in.** While `js/admin.js` is asking who is signed in (`GET /api/admin/me`) and loading the first data, neither the card nor the dashboard is shown, only a quiet "Checking your sign-in…" note, so a signed-in admin coming back from Auth0 never sees the sign-in link. The card appears only on a real outcome: 401, denied, failed or a failed check. Mechanism: a tiny inline script in `admin.html`'s head (admin.html already carries the inline analytics snippet) adds the class `admin-checking` to `<html>` before first paint; CSS hides the card and shows the note under that class; `admin.js` removes the class when the check resolves. Without JavaScript the script never runs, so the card is simply shown (progressive enhancement). If JavaScript runs but `admin.js` never starts, the same script removes the class after 10 seconds so the page is never blank forever (`admin.js` cancels that timer only when the check resolves, never at the start of boot, so a hung check or an error before it still ends in the card). The first data load (`/api/admin/tracks`) is aborted after 20 seconds (one budget shared across the 7- and 1-day fallback attempts) and ends in "Could not reach the server. Check your connection, then reload the page."; if the safety timer fires while a check is still pending, the card's message reads "Still checking your sign-in… If this stays, reload the page." until the check ends. The "Checking your sign-in…" note is plain visible text without `role="status"` (a live region that is only shown for a moment cannot be announced reliably, and the page is otherwise blank, so it is simply read as content). The `/api/admin/me` call is aborted after 8 seconds and treated as a failed check ("Could not check your sign-in. Reload the page, then sign in."), and an error thrown anywhere in boot shows the card with the same text. A CSS-only fallback was rejected because the reduced-motion rule disables animations and the page would stay hidden.
- On load the page calls `GET /api/admin/me` with `X-Requested-With: admin`: 200 loads tracking data for the current window (see Data API) and shows the map view (or the page named by the hash); 401 shows the card. A reload or Refresh therefore stays signed in for as long as the `ff_admin` cookie lasts (8 hours); nothing is kept in `sessionStorage` or `localStorage`.
- If the `/api/admin/me` check or the first data load fails for a reason other than 401 (a 5xx or no connection), the card reads "Could not check your sign-in. Reload the page, then sign in." (or "Could not reach the server. Check your connection, then reload the page." when there was no answer at all). There is no Try again button: the Sign in link stays available and a reload re-runs the check. Raw server text is never shown.
- A 401 from any admin request mid-session returns to the card with "Admin session expired. Sign in again."
- **Log out** calls `POST /api/admin/logout` (clears `ff_admin`; needs the CSRF header), then shows the card and focuses the sign-in link. If the call fails (network or server error) the admin is still signed in, so the dashboard stays and `#adminRefreshStatus` says "Could not log out. Check your connection and try again." It does not end the Auth0 session or the community sign-in.
- `#loginError` is styled in the danger colour and marked `role="alert"`. Coming back from Auth0 with `?signin=denied` reads "This account isn't on the admin list. Ask an existing admin to add it, or sign in with a different account."; `?signin=failed` reads "Sign-in didn't finish. Try again."; the address is then cleaned to `/admin` (`history.replaceState`), so a reload does not repeat the message. Server errors never show a status line or raw body (they go to the console). A network failure never shows the browser's raw "Failed to fetch". If Auth0 is not configured, the link redirects back to `/admin?signin=unavailable` and the card says admin sign-in isn't set up (see "Unconfigured deploy").

### Map view (canvas)

The map canvas fills the remainder of the page after the top bar. It renders:

- **Base map** — the same local forest context as the user map, using the forest/buffer land, environment, roads, and paths GeoJSON layers
- **Semi-opaque map context** — the forest, forest-edge and environment (water, railway) fills render with reduced opacity so route, location, and tap markers remain visually dominant
- **Roads and paths on top** — drawn above the soft context, outside its reduced opacity. Roads are at full strength, with a dark casing and an opaque stroke, so every road class (including residential, service and alley streets) reads against the pale background at the default view and when zoomed. Paths are the softest, semi-transparent context layer, still distinguishable by dash pattern and hue. Hierarchy by width and colour: motorway > trunk > primary > secondary > tertiary > residential > service > alley. Routes, pings and tap markers are still drawn over them.
- **Layers load independently** — the five GeoJSON layers (forest, forest edge, water and railways, roads, paths) are fetched separately and each paints as soon as it arrives, whether or not the forest and forest edge have settled (until the forest arrives the rough outline stands in for it); the large roads file never blocks the forest, environment or tracks. A status note on the map (a polite live region that is always in the page and only visually hidden when idle) says "Loading <layer names>..." with the friendly names (forest, forest edge, water and railways, roads, paths; "map layers" when more than two are arriving). This replaces the old canvas text "Loading map context...". Its text is rewritten only when the message changes, so a load is announced once. The canvas has the accessible name "Admin map" (`aria-label`, set from JS) and is described by the note (`aria-describedby`). The note and its status line are created empty at init, before the first message, so the first announcement is not missed. Each layer request has a 30 second timeout (`ADMIN_LAYER_TIMEOUT_MS`); one that never answers becomes a failed layer.
- **The view is fitted once** — only the framing waits: the map frames the forest and forest edge once both have settled. Until then it uses the fallback bounds and draws the layers that have already arrived, so if the forest's real extent differs the view shifts once, at that fit (the single accepted shift); a later Retry of the forest or edge never moves the user's view. If forest and edge both fail, the fit happens once, on the first later Retry that succeeds for either of them.
- **Roads and paths draw in order** — roads are sorted once at load from minor (alley, service) to major (motorway) and paths by kind, then drawn in two passes (all casings, then all strokes), so a minor road's casing never cuts a major road's stroke at a crossing. Service roads and alleys are thinner with lighter casings. Paths are the softest line: about 1px, a muted semi-transparent stroke (alpha about 0.6 to 0.7, a lighter green for ordinary trails so it is not the colour of the Forest area swatch) with a thin pale casing, and a dash pattern plus hue per kind (bridleway, byway, permissive, waymarked trail) so kinds stay distinguishable. They sit under routes, pings and tap markers without turning the map into a dark mesh; residential streets and above stay clearly legible.
- **Layer failures are visible** — if a layer answers with an error, is cut off, times out or returns broken data, that layer draws nothing and the status note names it in plain words ("Couldn't load the roads layer.") with a **Retry** button (at least 44 by 44 px) that refetches only the failed layers; after a Retry succeeds the status briefly reads "Roads loaded." (friendly names, capitalised, e.g. "Roads and paths loaded.") so screen readers hear it, then clears itself after about 4 seconds (`ADMIN_LAYER_RECOVERED_MS`; no motion). While a retry is in flight, for any layer, the note reads "Loading <layer>..." and the button stays in place as "Retrying..." (aria-disabled), so keyboard focus is never lost; if Retry disappears while focused, focus moves to the map. A partial retry (one layer fixed, another still failed) shows only the remaining failure. The note and button are not rebuilt while the message is unchanged (other layers finishing does not touch them). If the forest itself failed, the rough forest outline stays drawn so the map still shows where the forest is. The failure is also logged with `console.warn`. The note sits under the map controls, clear of the legend and zoom buttons, and on a phone an open track or tap sheet stops short of it so the note and Retry stay usable.
- **Route lines** — one coloured polyline per user, connecting location pings in timestamp order
- **Direction arrows** — small filled triangles on routes every 5 pings, oriented by the recorded `heading`
- **Last-position dots** — filled circle at each user's most recent ping; larger when that user is selected
- **Tap markers** — yellow bullseye markers at the clicked target location, falling back to user position or nearest location ping when older records lack target coordinates
- **Track start and stop markers** — for the chosen user (Users list) and for the track whose details are open: a green circle at the first ping and a red square at the last, white-outlined and drawn over the last-position dot (shapes differ, so colour is not the only cue). The legend names both. Tracks view only; the heatmap shows neither.

#### Admin map controls

The admin map supports:
- `+` zoom-in button
- `-` zoom-out button
- **Reset** button to restore default zoom and pan
- mouse/touch drag panning
- wheel zoom around the pointer
- redraws while dragging or pinching are coalesced to one per animation frame, and the canvas backing store is resized only when its size or the device pixel ratio changes
- two-finger **pinch** zoom and pan: pointer events on the canvas (`touch-action: none`), zoom anchored at the midpoint of the two fingers and the map following the midpoint as it moves. Pure maths in `pinchViewport` (`js/admin-tools.js`, unit-tested), clamped to the same zoom limits as the buttons. A pinch never counts as a tap (no track or tap details open when the fingers lift), lifting one finger carries on as a one-finger pan from where the other finger is (no jump), a third finger is ignored, and a cancelled or lost pointer ends the gesture so no drag is left stuck. The result is saved like any other change.

The current admin viewport is stored in `localStorage` under `ff-admin-map-viewport` as `{ zoom, panX, panY }`. Refreshing the admin page restores the same zoom and pan for that browser/device. Reset also persists the reset state. Buttons, wheel, drag and pinch all share this one state.

#### Coordinate system
Admin rendering uses a Mercator projection with a fallback Epping Forest bounding box:
```
minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155
```
When base-map GeoJSON layers are available, their projected bounds replace the fallback box.

### Tracks view (default)
Route lines and direction arrows are drawn per user. Selected user's line is thicker (2.5 px vs 1.5 px). All users shown when none is selected. Only the pings in the chosen time frame and beta filter are drawn.

**Track details.** Clicking or tapping a route line (within 8 css px for a mouse, 12 px for touch or pen; the nearest line wins) opens the track details sheet (`#adminTrackDetails`, a sibling of the tap details with the same `.admin-click-details` look: a `role="region"` named by its heading (`aria-labelledby` pointing at the `h2` `#adminTrackDetailsTitle`, "Track details", not a separate `aria-label`), close button "Close track details (Esc)", focus moved to the close button on open). A user's pings are split into **walks** wherever there is a gap of more than 30 minutes (`splitWalks`, pure, unit-tested), so a window of many days is never one long journey. Each walk is drawn as its own line (the path breaks at the same 30-minute gaps, so no false straight line joins one walk's end to the next walk's start) and the hit test uses those same lines, so the empty ground between two walks is not a hit. A click shows the walk under it; the Track details button shows the user's most recent walk. The sheet shows the short user ID, a persistent live region `#adminTrackWalkStatus` ("Walk 2 of 5", updated in place so it is announced) and **Previous walk** and **Next walk** buttons (persistent elements, hidden when there is only one walk; `aria-disabled` at either end so focus stays on the pressed button), then **duration**, **pings** and **walked** distance for that walk as figures, then **Start** and **Stop** rows each with the time and the place: the first and last ping of that walk (time frame, beta filter and user filter applied). The start and stop markers are drawn for the shown walk (a chosen user with no sheet open shows their most recent walk). The place is the nearest named road or path within 80 m from the base map layers, with the coordinates (5 decimal places) always shown; with no named road close by it is the coordinates alone. Distance is the sum of straight-line hops between consecutive pings, skipping any hop of more than 3 minutes (the navigation rules). A tap marker under the pointer wins over a line (the tap details open instead); the two sheets never show together. Escape or the close button hides it and returns focus to the map (or to the Track details control when it was opened from there). The open walk is identified by its time span (start and end), not its position: after a refresh, time frame change or beta toggle it is found again by overlap (a rolling window that trims its first pings still matches it, and the span follows the walk). If it has left the window the latest walk is shown and the status adds "That walk is no longer in this window. Showing the latest."; the notice clears as soon as the walk is back in the window (for example after choosing the wider time frame again), and that walk is then shown normally. If focus is on Previous or Next when a refresh leaves fewer than two walks (the buttons are hidden), focus moves to the sheet's Close button. On opening, the status is written after the sheet is shown and forced (cleared, then set) so it is announced. The delayed write is a single timer that closing the sheet cancels, so closing in the same tick as opening never leaves a stale "Walk N of M" behind. Closing the sheet (including by sign-out or an expired session, which close it too) hides it, empties the status and forgets the remembered walk, so the next open starts from the latest walk. The heading "Track details" comes before the status and buttons in reading order. A walk of a single ping is drawn as a small dot (it is what a tap on it hits) and shows only the green start circle, with no stop square on top of it. The sheet redraws on those changes and closes when its user has no pings left. The footnote reads "A new walk starts after a 30-minute break. Distance is measured between recorded points, ignoring breaks over 3 minutes." The pure summary is `summariseTrack` and the hit test `nearestTrackAt` in `js/admin-tools.js`. None of this is offered on the heatmap view.

**Keyboard route.** Canvas hits are not keyboard reachable, so choosing a user in the Users list shows a **Track details** button (`.admin-track-btn`, `aria-label` "Track details for xxxxxxxx", `aria-controls`, `aria-expanded`) next to that user's row on the Tracks view. It opens the same sheet.

### Heatmap view
A 60 × 45 cell grid over the canvas. Each cell is coloured by `sqrt(count / maxCount)` on a cold-to-hot scale (dark blue → yellow → red). Useful for identifying popular areas and blank spots.

## Sidebar

Lists every user who has at least one location ping or tap event, sorted by most recently seen. Each row shows:
- Coloured user dot (deterministic colour from palette, assigned in order of first seen)
- Truncated anonymous ID (first 8 chars of the UUID)
- Ping count and tap count
- Tooltip with last-seen timestamp

Clicking a row filters the map to that user only and draws that user's start and stop markers; a **Track details** button then appears beside the row (see Tracks view). Clicking again (or the "All users" row) clears the filter. With the beta filter on, the row reads "All beta users" and only beta members are listed; a selected user the filter (or a new time frame) leaves with no data is deselected. The "All users" row's figure is labelled with its unit ("8 users", "1 user"), not a bare number.

After a row is activated the list is redrawn and focus returns to the same row (the "All users" row included). Rows are real `<button>` elements (class `.admin-user-item`, `.selected` for the current filter) with
`aria-pressed` reflecting whether it is the current filter, so Tab, Enter and Space work natively. The selected row has an accent edge.

On phones (720 px wide and under) the sidebar becomes a horizontally scrolling strip of user chips above the map, so the map and Navigation page get the full width; the "Users" heading is then visually hidden. Choosing a chip scrolls it fully into the strip (nearest edge, smooth unless the user prefers reduced motion; a chip already in view does not move), and redrawing the strip keeps its scroll position instead of snapping back to the start. While more chips (or, in the top bar, more buttons) are scrolled out of view at an edge, that edge of the strip and of the phone nav row fades out as a scroll cue (a CSS mask on the scroller, so it never intercepts a tap or hides the focus ring, which is drawn inside the chips and buttons). The cue follows scrolling and resizing and is absent when everything fits and on wide screens.

## Top bar controls

| Control | Behaviour |
|---|---|
| **Tracks** | Switch to route-line view (default) |
| **Heatmap** | Switch to density grid view |
| **Navigation** | Open the Navigation page |
| **Stats** | Open the Stats page |
| **Community** | Open the Community page |
| **Beta** | Open the Beta page |
| **Refresh** | Re-fetch all data from the server, for the chosen time frame |
| **Log out** | Clear the admin cookie on the server and return to the login screen |

The bar has three groups: View (Tracks and Heatmap, a segmented control whose active tab is filled with the accent colour); Pages (Navigation, Stats, Community and Beta, bordered page buttons, see "Top bar grouping"); Refresh and Log out are quiet, borderless utility actions on the right. A small app icon and the title "Epping Forest Finds — User Analytics" sit on the left with the environment badge next to them. All six view and page buttons carry `aria-pressed` (true on the active one), updated whenever the view changes (including Back/Forward and sign-out). The active page button is drawn lit (accent border and tint, plus a short bar under the label so colour is not the only cue) and hover and press still show on it. Below 1280 px wide (laptops, tablets, landscape phones) the bar is two rows so no button ever overlaps another or runs off screen: the icon, title, environment badge and utility actions, then one row holding the six view and page buttons. On phones (720 px and narrower) the same two rows apply and all six buttons fit at 390 px wide without scrolling (the row still scrolls on narrower screens, and its focus ring is drawn inside the buttons so scrolling never clips it). The title is visually hidden on phones only, because it would truncate, but is still read out. Top-bar buttons, the toolbar controls, walk buttons, map controls and the close buttons are at least 44 px to tap on phones (720 px and narrower) and on every coarse-pointer (touch) device whatever its width (a tablet at 1100 to 1279 px included); fine-pointer desktops keep 34 px buttons. Map controls and the user chips are 44 px on phones. On phones the nav row and user strip have `scroll-padding-inline: 28px` and (on phones only) bring a focused or selected control into view with `scrollIntoView`, because the browser alone left a tabbed-to control half cut off at 360 px and 320 px; it stops clear of the 28 px edge fade. Desktop focus scrolling is left to the browser.

**Time frame and beta filter toolbar.** A toolbar (`#adminToolbar`, `role="group"` "Data filters") sits directly under the top bar and refresh strip, above the map and the Navigation and Stats pages; it is hidden on Community and Beta, which do not use these filters. It wraps onto more rows rather than overflow at 390 px, and its controls are 44 px high on phones and touch tablets (34 px on fine-pointer desktops).
- **Time frame** (`#adminWindowSelect`, labelled "Time frame"): 24 hours, 7 days, 30 days (default), 90 days, All. Choosing one re-fetches `GET /api/admin/tracks?days=N` (24 hours is `days=1`, All is `days=all`; 30 days is `days=30`). The choice is kept in the address as `?days=7` (left out for the 30-day default), so a reload or a shared link opens the same window; there is no other storage. Refresh and the 5-minute auto-refresh use the chosen window. The Stats and Navigation subtitles and the Stats "Time window" card say what was loaded ("the last 24 hours", "the last 7 days", "all history"). While a change loads the toolbar has `aria-busy="true"` and `#adminWindowNote` (`role="status"`) says "Loading …". Only the newest request lands: an older, slower answer is dropped, so a quick change of mind is never overwritten.
- **Failures.** A 5xx still falls back to 7 and then 1 days (never to a longer window than asked) and the control then **shows the window that actually loaded**, with the note "Showing the last 7 days: the last 30 days was too much to load."; Refresh asks for the chosen window again. A failed Refresh that overtook a time frame change reverts the control and address too, with ONE note: the refresh strip says which window could not be loaded and which is still shown. A failed change (network or other error) keeps the previous data on screen, puts the control back to the window still shown and says "Could not load the last 90 days. Still showing the last 30 days." A 401 signs out as everywhere else.
- **Beta users filter** (`#adminAudienceAll` "Everyone" and `#adminAudienceBeta` "Beta users only", a segmented pair with `aria-pressed`): narrows locations, taps and navigation events to those marked beta (see Data API "Beta marker"), so the map, tap markers, Users list, Stats and Navigation pages and their subtitles ("… for beta users") all follow. It filters what was already loaded (no new request) and is kept in the address as `?beta=1`. Live-region texts (the filter note, window note, walk status) are only written when their text changes, so an auto-refresh never re-announces them. All failure messages use the "Could not …" form. While it is on, `#adminFilterNote` (`role="status"`) reads "Beta users only: activity from before beta users were marked isn't counted here."; with nothing left it reads "No beta user activity in this window yet. Activity from before beta users were marked isn't counted here.", and the Stats and Navigation empty states say the same. The pressed option carries a check mark as well as the accent fill, so colour is not the only cue.

Disabled controls (Community buttons while an action runs, Refresh while refreshing, the Beta controls while a request runs) show no hover or press change and the not-allowed cursor.

The dashboard's colours, radii, spacing, type sizes and shadows are tokens in `:root` of `css/admin.css`; muted text on the dark shell is at least 4.5:1.

**Tap details overlay.** The tap details (`#adminClickDetails`) and the track details (see Tracks view) are the only overlays left, one at a time: a bottom-left sheet over the map (full width on phones) with a labelled `role="region"` and a close button named "Close tap details (Esc)" (`title` "Esc closes", `aria-keyshortcuts="Escape"`, a small "Esc" cue on mouse-and-keyboard screens). Opening it moves focus to the close button; Escape or the close button hides it and returns focus to the map (including when a refresh removes the tapped target). Opening any page, logging out or an expired session closes it and empties it.

**Top bar grouping.** The nav row has two groups: `role="group"` "View" (segmented, Tracks and Heatmap, the two views of the one map) and `role="group"` "Pages" (Navigation, Stats, Community, Beta, in that order). All four page buttons are styled alike: pressed shows the accent-soft fill, accent border and the bar under the label, with the same hover and press states. Tab order follows the markup: Tracks, Heatmap, then the pages. On phones the Pages group is tightened (2px gaps, 4px side padding) so all six buttons fit at 390 px; narrower, the row scrolls inside itself with the edge fade, never the page.

**Pages.** Navigation, Stats, Community and Beta are page-level views, siblings of the map area inside `.admin-body`, taking the remaining width and scrolling on their own (light surface, the same `admin-nav-view` look). Choosing one hides the whole map area, sets the hash, and moves focus to the page's `<h2 tabindex="-1">` heading (Navigation, Stats, Community, Beta); Back/Forward restore the view and the `aria-pressed` states; leaving a page hands focus to the Tracks or Heatmap button. Navigation and Stats keep the Users list (sidebar, or strip on phones) as the user filter; Community and Beta hide it and use the full width. Community and Beta load their data each time they are entered (not when the already-active button is pressed again). Logging out or an expired session resets to Tracks, clears the hash and empties the Community and Beta pages.

**Refresh failure.** Refresh and the 5-minute auto-refresh share one path. If it fails (a server error or no connection) the data stays on screen and `#adminRefreshStatus` (`role="status"`, a thin warning strip under the top bar, zero height while empty) says "Could not refresh — showing data from HH:MM." with the time of the last successful load; the next success clears it. While a refresh runs the button reads "Refreshing…" (disabled, `aria-busy="true"`). A repeated failure adds the time of the latest attempt, "Could not refresh — showing data from HH:MM. Tried again at HH:MM.", and writes the live region again so it is announced again. Logging out during a refresh resets the button, so it is enabled after the next sign-in whatever the old request does. A 401 still forgets the session and returns to sign-in with "Admin session expired. Sign in again."

Auto-refresh runs every 5 minutes while the tab is visible; it is skipped while the tab is hidden, and returning to a tab whose data is 5 minutes old or more refreshes once.

## Stats page

`#adminStatsPage` (hash `#stats`) replaces the old bottom-right stats bar on the map; the map no longer carries any stats overlay (so there is nothing to offset the tap details or legend from). Heading `<h2 id="adminStatsTitle">Stats</h2>`, subtitle `#adminStatsSub` ("Users, location pings and taps over the last 30 days (or the chosen time frame, or all history), for all users (or beta users, or user xxxxxxxx). Choose a user in the Users list to filter these figures."). It respects the selected user filter like the Navigation page, and is redrawn on Refresh and when the filter changes.

- **Summary cards** (`.nav-card`, responsive grid): Users (distinct users with a ping or tap), Location pings, Taps, Time window ("N days", "24 hours" or "All history"). A partial read adds the note "Partial: too much data for one read, newest shown (back to <day>[, that day only in part])."
- **Navigation summary:** a line "Navigation: N journeys started, M arrived (X%), K km walked." with a link "Open the Navigation page" (`#navigation`), or "No navigation journeys in this window." plus the link. The detail stays on the Navigation page.
- **Trend charts by day**, in the Navigation page's conventions (SVG, `role="img"` with an `aria-label` that summarises the trend, an SVG `<title>` per bar such as "2026-10-22: 2 users", a daily HTML table with a keyboard-focusable scrollable `role="region"` as the text alternative, 3:1 contrast, no animation): Users active by day (full width), Location pings by day and Taps by day (side by side from 1100 px). Each panel's note gives the busiest day and the daily average. An empty window shows "No tracking activity in this window" and no charts.
- **Aggregation:** `groupActivityByDay(locations, clicks)` in `js/navigation-metrics.js` (pure, unit-tested in `test/admin-activity-trends.test.js`) returns `{day, users, pings, taps}` per local calendar day, oldest first. Unlike the journey rows, every day from the first to the last active day is present with zeros, so quiet days show as gaps in the trend. A user counts once a day; events without a readable time are ignored.

## Navigation journeys

The Navigation page (and the navigation summary on the Stats page) summarise walks to a navigation target. They are derived in the browser by `js/navigation-metrics.js` (pure functions, no DOM) from the same filtered location pings the Stats page uses, so selecting a user narrows them too. Nothing new is sent or stored.

- Pings with non-finite coordinates are ignored. Pings are grouped by user and read in time order.
- A journey starts at the first ping whose `navTarget` has finite target coordinates. It continues while later pings carry the same target (matched by id when present, otherwise by coordinates).
- A journey ends when the target is cleared or changes, when the next ping is more than 3 minutes after the previous one (a later ping with a target then starts a new journey), on arrival, or when the data runs out.
- Every location ping is a fresh fix, so arrival is the first journey ping, including the start ping, within 30 m of the target. The walk ends there.
- After a journey arrives, further pings with the same target (same id, else same coordinates) do not start another journey: the walker lingering at the place is one journey. A new journey for that target needs the target to change or clear, or a gap of more than 3 minutes between pings.
- Distance walked is the sum of straight-line distances between consecutive pings in the journey, skipping any pair more than 3 minutes apart. For a journey that did not arrive, the remaining distance is the distance from its last ping to the target.
- Time to arrive is arrival time minus start time, bucketed as under 5 minutes, 5 up to (not including) 15, 15 to 30 inclusive, and over 30.
- The Navigation page shows journeys started, arrived and the completion rate, the time buckets, total distance walked, and the abandoned count with the median remaining distance (n/a when none).

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

**Page, not overlay.** `#adminNavigation` (like `#adminStatsPage`, `#adminCommunity` and `#adminBeta`, see "Pages") is a page-level view: a sibling of the map area inside `.admin-body`, beside the user sidebar (above the user strip on phones), taking the remaining space and scrolling on its own. It never sits on top of the map. While it is shown the whole map area is hidden (`hidden`): the canvas, map controls and legend are not rendered, and the tap details are closed. The canvas does not draw while hidden (a zero-size canvas is skipped); returning to a map view refits the map and the panel inset and redraws.

**Heading.** The page has a heading `<h2 id="adminNavigationTitle" tabindex="-1">Navigation</h2>` and a subtitle (`#adminNavigationSub`) saying what it reflects: "Navigation journeys over the last 30 days (or the chosen time frame, or all history), for all users (or beta users, or user xxxxxxxx). Choose a user in the Users list to filter these figures." The heading and subtitle are outside the re-rendered body, so a refresh does not move focus. Choosing the Navigation tab (or arriving by Back/Forward) moves focus to the heading. The subtitle names a selected user with the same short ID as the sidebar chip, and shows the "Choose a user in the Users list…" hint only while no user is selected. Leaving the page (Back/Forward, or another page) hands focus to the matching view button (Tracks or Heatmap) instead of dropping it to the page body. Clicking the already-active tab, or Tracks with no hash, adds no history entry. The user sidebar or strip stays on screen as the user filter. An empty window shows "No navigation journeys in this window" (adding "for the selected user" when filtered) in a dashed empty-state card; with the beta filter on and no user selected it reads "No beta user navigation journeys in this window yet. Activity from before beta users were marked isn't counted here." 

**Routing.** The view is held in the URL hash: `#tracks`, `#heatmap`, `#navigation`, `#stats`, `#community`, `#beta`; none or an unknown value means Tracks. The tabs set the hash (so Back and Forward step through views, restoring the view and its `aria-pressed` state), and a `hashchange` applies it. The hash is read when the dashboard appears (after the sign-in check on load): opening `/admin#navigation` while signed in lands on the Navigation page. Logging out or an expired session resets to Tracks and clears the hash, so the next sign-in starts on the map. Escape closes the open tap or track details only.

**Polish in this sweep.** Page padding is 24 px (12 px on phones); the page title and subtitle give the page a clear hierarchy; on phones the seven summary cards no longer leave an orphan card beside an empty cell (the last card spans both columns). Card labels wrap rather than clip (no horizontal clipping at 320 or 390 px). **Refresh** keeps keyboard focus: the button is disabled while it runs, so focus is handed back to it when the refresh finishes.

## Navigation page content

A **Navigation** tab in the top bar opens a page (`#adminNavigation`) that shows how navigation journeys trend over time. It uses the same loaded tracking data, the same user and time-window filters as the Stats page, and the same explicit-over-derived journey rule as the navigation block (see "Navigation journeys").

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

**Beta tagging.** When the request carries a valid community `ff_session` cookie whose account is a current beta member (`betaMember` in `lib/beta-access.js`, spec-community.md "Beta access"), the server marks every event in that batch beta. Rules: the mark is a flag only (no account id, `sub`, email or cookie value is ever stored in tracking data); it is set by the server after sanitising, so a `beta` field in a client's event body is dropped like any unknown field and a client cannot tag itself; it is per event, not per `uid`, because a device can become beta later; anonymous requests, cookies that are invalid or expired, signed-in non-members, revoked members and an unreadable community store all store the events untagged exactly as before (the check never fails or delays the POST). Cost: no cookie means no reads; a signed-in request adds about four to five small community-store reads (account, grant, code, revoke), cached for that request only, and runs after the rate limit so a throttled request skips it. At launch scale that is about 27,000 community-store reads an hour for 500 signed-in phones (500 phones x about 12 requests an hour x about 4.5 reads). If that ever matters, the first lever is a short in-memory membership cache per function instance (a minute or so), which would cut it to about one set of reads per signed-in account a minute at worst. The check is bounded to about 1 second: if the community store stalls, that request's events are stored untagged (one lost tag) and the POST still completes. Cross-origin native requests (the Capacitor apps) send no cookie, so their events are never beta.

### `GET /api/admin/me`
Who is signed in to the dashboard. Needs the `ff_admin` cookie and the `X-Requested-With: admin` header. **200** `{ "signedIn": true, "name": "<display name>" }`; **401** `{ "error": "Unauthorized" }` otherwise. Other methods get 405. Never returns the subject id.

### `POST /api/admin/logout`
Clears the `ff_admin` cookie (`Max-Age=0`). Needs the `X-Requested-With: admin` header (401 without it) so another site cannot sign an admin out. 200 `{ "ok": true }`. The community `ff_session` is untouched. Other methods get 405.

### `GET /api/admin/tracks`
Returns stored events from a recent time window. Requires admin access: the password Bearer, or the `ff_admin` cookie with the CSRF header (see Authentication above).

**Query params:**
- `days` — size of the window in days, counted back from now as a rolling window of `days` x 24 hours (`days=1` is the last 24 hours, not just today's UTC date). Defaults to **30** (the dashboard always sends it: `days=1`, `7`, `30`, `90` or `all`, from the Time frame control). `days=all` reads back to the retention period (a year by default). With `TRACKING_RETENTION_DAYS=0` nothing is deleted, but `days=all` still reads back only a year, so one dashboard request stays bounded.

**Response:** events are packed to fit about six times as many into the response — one table of uids (and of navigation targets) and one short array per event. `js/admin.js` `unpackTrackingEvents()` turns them back into the event objects above (the `navigation` table too, and the `beta` index into `event.beta = true`; a response without it, as from an older server, simply has no marked events); a plain array of events (an older server, a test fixture) is used as it is.
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
**Beta marker.** A packed table (`locations`, `clicks` or `navigation`) carries an optional `"beta": [row indexes]`: the positions in that table's `rows` of events posted by a beta member. The key is left out when no row is beta, so old responses and old admin clients (which ignore it) are unchanged. Unpacking sets `event.beta = true` on those rows and leaves `beta` unset on the rest, so a client filters with `event.beta === true`. Example: `"clicks": { "v": 2, "type": "click", "uids": ["..."], "rows": [[...], [...]], "beta": [1] }` marks the second click only. Stored raw batches hold `"beta": true` on the event; daily files and the admin response use the index table; compaction (merge and repack) and the local NDJSON files keep the mark; events stored before this existed simply have none.

A navigation row is `[uid index, time ms, navId, navName, navType, targetLat, targetLng, userLat, userLng, routeM, walkedM, remainingM, reason, kind]`, where `kind` is `start`, `arrive` or `end` (the event type is `navigation_<kind>`). A location row is `[uid index, time ms, lat, lng, heading, target index or -1]`; a click row is `[uid index, time ms, userLat, userLng, targetLat, targetLng, itemType, itemId, itemName, source]`.

The read goes newest day first, three days at a time, and stops when the window ends (a window of N days reads N+1 UTC days: the oldest is read only to reach its events inside the last N x 24 hours, and events older than that are dropped, so the extra day costs one more day of reads per request; `days=all` reads the retention period untrimmed), after about 7 seconds, or at about 4.5 MB of packed events (Netlify refuses a function response over 6 MB). When it stops early it returns what it has (running out of time before the boundary day is read is still early, because that day holds the end of the window; `partial` is false only when every one of the N+1 days was read), newest first, with `meta.partial: true`, `meta.oldestDay` (the earliest UTC day it reached, which can be that extra boundary day) and `meta.oldestDayIncomplete` (true when it stopped inside that day, by time or size, so only that day's newest events are included); the Stats page then says "Partial … (back to <day>)", adding ", that day only in part" when it is incomplete. On a busy deployment a 30-day request can therefore show fewer than 30 days. If the full-window request still fails with a 5xx, the dashboard retries with `days=7`, then `days=1` (only windows shorter than the one asked for), and the Time frame control shows the window it ended up with; if every attempt fails the login error includes the server's status and message. `meta.windowDays` is `null` when `days=all` was requested. The Stats page shows the active window (e.g. "30 days") as a card.

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
| unset (local) | falls back to NDJSON files; the dashboard hides the environment badge (it only names production and previews) |

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
  from = "/api/admin/me"
  to   = "/.netlify/functions/admin-me"
  status = 200
  force  = true

[[redirects]]
  from = "/api/admin/logout"
  to   = "/.netlify/functions/admin-logout"
  status = 200
  force  = true

[[redirects]]
  from = "/api/admin/tracks"
  to   = "/.netlify/functions/track"
  status = 200
  force  = true

[[redirects]]
  from = "/api/beta/codes"
  to   = "/.netlify/functions/beta-codes"
  status = 200
  force  = true

[[redirects]]
  from = "/api/beta/redeem"
  to   = "/.netlify/functions/beta-redeem"
  status = 200
  force  = true
```

`admin.html` is resolved as `/admin` by Netlify's default pretty-URL behaviour (strips `.html`).

The native app calls `/api/track` from another origin (its own bundle). The `native-cors` edge function, declared in `netlify.toml` on `/api/*`, grants CORS to the two native WebView origins only; `/api/admin/*` is excluded, so the admin endpoint is never readable cross-origin. See `spec-native.md` § Networking.

## User colour assignment

Colours are assigned from a fixed 15-colour palette in the order users are first seen in the loaded dataset. The mapping is deterministic within a page load but may differ between loads if the order of events changes.

## Security notes

- Admin access needs `ADMIN_SUBJECTS` (and the Auth0 env vars) or `ADMIN_PASSWORD`; there are no defaults, and an empty allowlist admits nobody
- Raw tracking data is never exposed to end users; the admin endpoint requires authentication
- All events contain only anonymous IDs — no PII is stored or returned
- The admin UI never sees a password or token. The sign-in is an HttpOnly, `SameSite=Strict` cookie that script cannot read; cookie requests need `X-Requested-With: admin` (CSRF guard); the allowlist is re-checked on every request, so removing a subject revokes it immediately; the cookie expires after 8 hours. Auth0 is asked for a fresh login each time (`prompt=login`, `max_age=0`)

## Beta page
**Beta** (`#betaBtn`, hash `#beta`) opens the `#adminBeta` page (heading `<h2 id="adminBetaTitle">Beta</h2>`); there is no overlay panel. Entering it loads `GET /api/beta/codes` (admin cookie plus the `X-Requested-With: admin` header); a 401 returns to sign-in with "Admin session expired. Sign in again.", and a failed load shows "Could not load beta codes. Try again." (or the no-connection wording; never raw HTTP numbers) with a **Retry** button.

The page explains: "Each code is for one person. The first account to open its link claims it. Revoking a claimed code removes that person's beta access." Under it the create form, the `role="status"` line (`#adminBetaStatus`) and three sections (labelled regions; headings carry counts once loaded, an empty section says so): **Beta users (N)**, the people who have claimed a code (name from the note, code, "claimed <date>", Copy link, Share link, Revoke); **Open codes (N)**, not claimed yet; **Revoked (N)**, codes that no longer give access (any "claimed <date>" history, then "revoked <date>"; no buttons). A row with a blank note reads "No name". On wide screens Beta users spans the width and Open codes and Revoked sit side by side. The data is the existing list (status `claimed`, `open` or `revoked`, `note`, `claimedAt`, `revokedAt`); no server change.

**Create code** (with a required name in the field whose visible label reads "Name (required)" and placeholder "e.g. Ann", up to 80 characters; the field is `aria-required` and **Create code** stays disabled until the trimmed name is not empty; older codes with a blank note are left as they are) sends `{action:"create", note}`, puts the new code at the top of Open codes, moves focus to that row's **Copy link** button and says "New code a234e: <origin>/beta/a234e" in the status line. The note field and every **Revoke** and **Share link** button stay disabled until the list has loaded (and while a request is running), so a failed load never allows an action that could be misread as success. While a request is pending the list is not rebuilt (controls are only disabled, or marked `aria-disabled` if one has focus), so the focused **Revoke** button stays in the page and keeps focus until the request finishes. While a create is pending the note field is read-only, and a second activation of any control is ignored.

Open and claimed rows have a **Copy link** button that copies `<origin>/beta/<code>` with `navigator.clipboard` and says "Copied <link>"; if the clipboard is unavailable or refuses, the status line shows "Could not copy automatically. Copy this link: <link>". They also have a **Share link** button (`aria-label` "Share link for <code>"); after a create the status line shows the same button next to the new link. Share uses the native share sheet (`navigator.share`) with the title "Epping Forest Finds beta", the text "Join the Epping Forest Finds beta. Let us know what you like, what you don't like, and anything that isn't working." and the link `<origin>/beta/<code>`; the note is internal and is never shared. A cancelled sheet does nothing and shows no error; a missing or failing sheet falls back to Copy link. Row buttons name their code: "Copy link for <code>", "Revoke code <code>" and, once armed, "Confirm revoke code <code>". **Revoke**: the first press turns the button into **Confirm revoke** and the status line asks "Revoke <code>? Press Confirm revoke to be sure…"; pressing any other row's button or Create disarms it. The second press sends `{action:"revoke", code}`; the row moves to Revoked and focus goes to that row's code, never to the page body. After a 503 or a network error the row stays where it was, focus returns to its Revoke button, and the server's text (for 503, "Storage unavailable: nothing was saved. Try again.") or "Could not revoke the code. Try again." is shown. A failed create reads "Could not create a code. Try again." Status text is cleared and set on the next tick so a repeated message is announced again. Notes and codes are written with `textContent`, never as HTML.

The server requires the name (stored and sent as `note`): a create with a name that is empty after trimming is `400` "Add a name for the person this code is for." and nothing is written. Revoking writes its own record (`beta-revoked/<code>`) that a claim can never overwrite; the list shows a code as revoked when that record exists (or an older code record carries `revokedAt`), never an account. Release step: the Auth0 application's Allowed Logout URLs must include `https://<site>/beta/*`, because the beta page's "Use a different account" logs out with a return path that includes the code.

The routes are `GET`/`POST /api/beta/codes` (admin) and `POST /api/beta/redeem`. See `spec/spec-community.md` (Beta access).

## Planned future features

- Per-user route replay (animated playback)
- Export to CSV / GeoJSON
- Date/time filters for click-detail aggregation

## Community verification usage

The **Community** button in the admin top bar opens the Community page (`#adminCommunity`, hash `#community`, heading `<h2 id="adminCommunityTitle">Community</h2>`; entering it loads the figures) of usage numbers for community reports: shown as a grid of stat cards (people reporting (all time, active in the last 24 h / 7 days), report count, trees questioned / verified, new trees (unconfirmed / confirmed), conflicts awaiting review, points awarded) followed by two panels with label/value tables for reports by type and per day for the last 7 days; the cards sit in a responsive grid (two columns on phones). The rebuild and reward-check buttons sit at the top with their result in a `role="status"` line (the only live region inside the page body), and the report links are styled for the light page. While one runs the result line says "Rebuilding…" or "Checking rewards…" and both buttons are disabled. Results are prefixed with the action so one never silently replaces the other's meaning: "Rebuild: Rebuilt from N reports (M trees on the overlay)." / "Reward check: 2 register rewards and 1 issue reward given.", "Reward check: first check done — today's register is now the baseline. No rewards given yet.", "Reward check: nothing new to reward.", and when GitHub could not be asked "Reward check: issue rewards could not be checked (<short reason>)." (the reason is one line cut to about 40 characters, never the raw error); failures read "Rebuild: Could not rebuild the snapshot (500). Try again." and "Reward check: Could not run the reward check (500). Try again." (or "… Check your connection and try again." with no response). After a successful rebuild the figures and the "As of the last snapshot" line are re-fetched and redrawn in place (`#communityFigures`; the buttons and result line are not replaced, so focus stays on the button). The result line is written once, after both steps: if the figures then fail to refresh it reads the success sentence followed by "The figures below could not be refreshed.", so a screen reader hears it once. Only one action runs at a time even if the admin leaves the page and comes back meanwhile: the fresh buttons come up disabled with the progress text, and the result appears when it finishes. A load error shows "Could not load community stats." (the status number is logged to the console, not shown) in `#adminCommunityStatus`, with a **Retry** button outside the replaced body; a 401 from any Community request returns to sign-in with "Admin session expired. Sign in again." Data comes from `GET /api/community/overlay?admin=1` with `Authorization: Bearer <ADMIN_PASSWORD>` (401 otherwise). The figures are worked out by `communityAdminStats` (`netlify/functions/lib/community-consensus.js`) during each snapshot rebuild and stored as `admin-stats`, so opening the page never reads the whole ledger; the page says which snapshot it shows ("As of the last snapshot, …"), normally under an hour old, and **Rebuild snapshot now** refreshes it. Individual device ids and scores are not shown. See `spec-community.md`.

Resetting Community data is done by a local script (`scripts/reset-community.js`), not an HTTP endpoint or an admin-panel button. By default it clears the local directory `data/tracking/community/<BRANCH>/`, where `BRANCH` is the environment variable and defaults to `dev`. Production is refused unless `--production` is passed, and every run requires typing `RESET ALL COMMUNITY DATA`.

## Community data deletion
`POST /api/community/delete` (`Authorization: Bearer <ADMIN_PASSWORD>` only; the admin cookie is not accepted, routed in `netlify.toml` and `server.js`) deletes one person's Community data on request; it has no button in the dashboard. See `spec-community.md` (Data deletion) and `docs/community-data-deletion.md`.
