# Native App Wrapper Specification (iOS / Android)

Ship Epping Forest Finds as a native app on the App Store and Google Play by wrapping the existing static client in a thin native shell, without rewriting the app or introducing a client build step for the web version.

The wrapper exists to buy things the mobile web cannot give a field navigation app: a location permission that is granted once and persists, a true-north heading that does not silently stall, a screen that stays awake while walking, and fully offline data from first launch. It is not a distribution trick — see [Store Submission Requirements](#store-submission-requirements).

## Detailed Specs

This spec sits alongside the existing set (see [spec.md](spec.md) § Detailed Specs). It owns everything inside `native/`, the `js/native.js` capability layer, and the native branches of permission, heading, and data-resolution behaviour. Behaviour that is identical on web and native stays specified in its existing home:

- Heading consumption, calibration gating, and staleness recovery — [spec.md](spec.md) § Compass and Direction Guidance
- Data loading and the `AppData` interface — [spec-data-fetching.md](spec-data-fetching.md)
- Drawing and interaction — [spec-data-rendering.md](spec-data-rendering.md)
- Tracking consent and event schema — [spec.md](spec.md) § User Tracking & Analytics

## Chosen Approach: Capacitor

The client is vanilla HTML/CSS/JS with relative asset paths, a 2D canvas renderer, and no bundler. Capacitor loads exactly those files as local app assets from a native WebView (`WKWebView` on iOS, Android System WebView), and exposes native code through a plugin bridge. Nothing about the existing client has to change in order to render.

Alternatives considered and rejected:

- **PWA install only.** Zero effort, but it cannot deliver the four reasons this project exists: iOS gives no Screen Wake Lock, no background location, a `DeviceOrientationEvent.requestPermission()` grant that is re-prompted and lost across relaunches, and no store presence.
- **React Native / Flutter.** A full rewrite of a working, tuned canvas renderer. The rendering work in `js/renderer.js` and the tilt projection in particular are the product; re-implementing them is the opposite of low-risk.
- **Tauri mobile.** Same shape as Capacitor but a far smaller mobile plugin ecosystem and less settled mobile tooling; no advantage here given the app ships no Rust.

Capacitor is also reversible: the web deploy on Netlify stays the canonical build, and the native projects consume it. If the native apps are abandoned, deleting `native/` leaves the PWA untouched.

## Project Layout

```
native/
  capacitor.config.ts      # webDir, appId, scheme, plugin config
  package.json             # Capacitor CLI + plugins (native-only; not the web app's deps)
  www/                     # generated — synced copy of the shipped client (gitignored)
  ios/                     # generated Xcode project, committed
  android/                 # generated Gradle project, committed
  plugins/forest-heading/  # first-party heading plugin (Swift + Kotlin)
  scripts/
    sync-www.js            # copies client files into native/www per an allowlist
    build-data-manifest.js # emits data/manifest.json (shared with the web build)
js/native.js               # the only client-side native entry point
```

`native/` holds its own `package.json` so the root project keeps its "no client build step, no external JS dependencies" constraint (see [spec.md](spec.md) § Technical Constraints) — Capacitor's dependencies are a native build-time concern and must never become a requirement for running the web app from the folder.

`native/scripts/sync-www.js` copies by **explicit allowlist**, not by copying the repo root. It ships `index.html`, `terms.html`, `js/`, `css/`, `assets/`, `tree-icon.svg`, and `data/` (minus the exclusions in [Data Bundling](#data-bundling)), and never ships `node_modules/`, `test/`, `scripts/`, `spec/`, `admin.html`, `js/admin.js`, `netlify/`, `server.js`, `reports/`, or the working `*.backup*` files. A blind directory copy would put the admin dashboard and the 1.1MB source zip inside a public app binary; the allowlist is a security boundary, not a size optimisation.

The generated `ios/` and `android/` projects are committed because they carry hand-edited native configuration (entitlements, `Info.plist` strings, `AndroidManifest.xml`, the foreground service, signing config) that `npx cap add` cannot regenerate.

## Runtime Capability Layer (`js/native.js`)

All native awareness in the client lives in one new file, loaded first in `index.html`'s script order (before `js/categories.js`). It exposes a single global, `Native`, and nothing else in the client may test for Capacitor directly.

```
Native.isNative          // boolean — Capacitor native platform, or the test shim
Native.platform          // "ios" | "android" | "web"
Native.apiBase           // "" on web; absolute origin on native
Native.heading           // null on web; { start(cb), stop(), available() } on native
Native.location          // null on web; wraps the native geolocation plugin
Native.keepAwake         // { enable(), disable() } — no-op on web
Native.haptics           // { impact(style) } — no-op on web
Native.share             // { share({title, text, url}) } — falls back to Web Share
Native.data              // { resolve(path), checkForUpdates(), currentDataVersion() }
Native.appVersion        // { native, data } — feeds the Settings "About" display
```

Every accessor is safe to call on web and returns a no-op or a `null` capability rather than throwing. This is what keeps the change surface small: the rest of the client gains `if (Native.heading)`-shaped branches at a handful of call sites instead of platform checks scattered through `index.html`.

`Native.isNative` is true when `window.Capacitor?.isNativePlatform()` is true **or** when `window.__FORCE_NATIVE_SHIM__` is set — see [Testing](#testing).

## Changes to the Existing Client

The full set of edits to shipped client code. Anything beyond this list is a sign the wrapper is leaking into the app and should be pushed back into `js/native.js`.

1. **`index.html`** — add `<script src="js/native.js">` as the first script. Boot and wiring only, per the project structure rule.
2. **`js/nav.js:134-160`** — skip service worker registration entirely when `Native.isNative`. A cache-first service worker in front of local app assets adds a redundant cache layer, a second source of truth for asset freshness, and a broken update-prompt flow (there is no new SW to wait on). The native update story is the app store plus data deltas; see [Versioning](#versioning-and-the-update-story).
3. **`js/nav.js:88-95`** — the existing `getRegistrations()` cleanup path must also be skipped on native.
4. **`js/loader.js`** — every data URL passes through `Native.data.resolve(path)` before `loadJson`/`loadTreeChunks`. On web this is the identity function, so the web behaviour and its timeouts are bit-identical.
5. **`js/tracker.js:7`** — `TRACK_URL` becomes `` `${Native.apiBase}/api/track` ``.
6. **`index.html:1809`** — the `report-missing-data` function call gains the same `Native.apiBase` prefix.
7. **Cow proxy fetch** — same prefix (it is the one endpoint that must stay network-live; see [spec.md](spec.md) § Offline, Caching, and Refresh).
8. **`js/onboarding.js:155-165`** — the permission step branches: on native, request through `Native.location` and (where required) `Native.heading`, and skip the `DeviceOrientationEvent.requestPermission()` gesture gate entirely, which does not apply.
9. **Heading subscription in `index.html` (~2977-3030)** — when `Native.heading` is available, subscribe to it instead of `deviceorientation` for the heading value. `beta` for tilt still comes from `deviceorientation`, which works normally in both WebViews.
10. **Settings "About"** — version display reads `Native.appVersion` on native instead of the service worker `CACHE_NAME`.
11. **`css/base.css`** — safe-area insets and the status bar overlay; see [Native UX Polish](#native-ux-polish).

Note that (9) makes the compass staleness recovery machinery in [spec.md](spec.md) § Compass and Direction Guidance **inert on native** rather than removed: a native heading stream does not stop when the screen sleeps or the app backgrounds, so `recoverStalledCompass` has nothing to recover. It must stay in place and keep working for the web build, and the watchdog must not thrash a native subscription — `recoverStalledCompass` returns early when `Native.heading` is the active source.

## Permissions Model

The point of the wrapper. Each permission is requested at the moment the feature is first used, never on cold start, and every request is preceded by the existing in-app onboarding explanation so the system dialog is never the user's first sight of the ask.

### iOS

`Info.plist` usage descriptions, written in product language rather than technical language:

- `NSLocationWhenInUseUsageDescription` — "Shows where you are on the forest map and points you toward trees and places nearby."
- `NSLocationAlwaysAndWhenInUseUsageDescription` — "Keeps recording your walk when your phone is in your pocket or the screen is off." Requested only when the user starts a recorded walk, never at launch, and never for analytics.
- `NSMotionUsageDescription` — "Uses the compass so the map turns as you turn."

Background location additionally needs the `location` value in `UIBackgroundModes` and must be gated behind an explicit, user-initiated recording action.

### Android

`AndroidManifest.xml`:

- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION` — requested separately and only after foreground location is granted, per the Android runtime flow
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` — required to show the foreground service notification on Android 13+

No permission is needed for the compass on Android; the rotation vector sensor is unrestricted. This is a strict improvement over the web path, which needs a user gesture on iOS and gives inconsistent results elsewhere.

### Hard constraint: background location is for the user, not for analytics

`js/tracker.js` currently records location events for analytics under its own consent flow. Background location must **not** be wired to it. Both stores reject background location whose only beneficiary is the developer, and Play requires a written and video justification for the permission that has to describe a user-facing feature. Background location is therefore permitted only in service of a user-started walk recording whose result the user can see, and the tracker's analytics consent stays a separate, independently revocable decision with foreground-only scope. If walk recording is not built, `ACCESS_BACKGROUND_LOCATION` and `UIBackgroundModes` must be dropped from the manifests rather than requested speculatively.

## Native Heading Plugin (`forest-heading`)

A first-party plugin, ~80 lines of Swift and ~80 of Kotlin. It exists because `webkitCompassHeading` is magnetic-north only, unsmoothed, and — as documented at length in [spec.md](spec.md) § Compass and Direction Guidance — stops firing on iOS and does not reliably resume.

**API surface**

- `available()` → `{ available: boolean }`. False where there is no magnetometer, so the client falls back to the existing `deviceorientation` path rather than to nothing.
- `start()` → begins emitting a `heading` event.
- `stop()` → ends the subscription; called on app pause so the sensor is not held while backgrounded and no recording is active.
- `heading` event payload: `{ trueHeading, magneticHeading, accuracy, timestamp }`. `trueHeading` is `-1` when unavailable (no location fix yet), in which case the client uses `magneticHeading` — matching current behaviour — and upgrades to true heading silently once a fix lands.

**iOS** — `CLLocationManager.startUpdatingHeading()`, delivering `newHeading.trueHeading` (falling back to `magneticHeading`) and `headingAccuracy`. `headingOrientation` is kept in sync with the interface orientation so a rotated device is not reported 90° off. `locationManagerShouldDisplayHeadingCalibration` returns `true`, which hands the calibration dance to the OS — a better version of the app's own "move your phone" prompt, and the reason the calibration gate can relax on native.

**Android** — `SensorManager` `TYPE_ROTATION_VECTOR` at `SENSOR_DELAY_GAME`, converted via `getRotationMatrixFromVector` + `remapCoordinateSystem` for display rotation + `getOrientation`, then declination-corrected with `GeomagneticField` to produce true heading. Accuracy is reported from `onAccuracyChanged`.

**Client integration** — the native heading feeds the *existing* smoothing filter and animation loop unchanged. The exponential filter, the heading-up rotation, the radar cone, and the tilt projection all consume the same smoothed value they do today. The native plugin replaces the *source*, not the pipeline.

**Calibration gate on native** — the gate in [spec.md](spec.md) § Compass and Direction Guidance stays, because a settling magnetometer is a physical fact on both platforms, but it is driven by the plugin's reported `accuracy` where that is meaningful rather than purely by sample spread: a heading arriving with good reported accuracy may be trusted immediately instead of waiting for four agreeing samples. `COMPASS_CALIBRATION_MAX_WAIT_MS` remains the safety valve. The spread-based gate stays the fallback when accuracy is unreported or poor.

## Native UX Polish

- **Keep awake** — `@capacitor-community/keep-awake` enabled while heading-up navigation to a selected target is active or a walk is recording, disabled otherwise and on app pause. iOS Safari has no equivalent at all, so this is the single most visible field improvement. It must be disabled on pause even mid-navigation, or a backgrounded app holds the screen on and drains the battery.
- **Haptics** — `@capacitor/haptics`. A light impact on arriving at a selected target (reusing the existing arrival threshold), and a selection tick on picking an item from the nearest list. Nothing else; haptics on every interaction reads as noise.
- **Share** — `@capacitor/share` for a native share sheet on a selected tree or place, sharing the existing URL hash deep link so the recipient lands on the same selection in the web app. `Native.share` falls back to `navigator.share` then to clipboard, so the web build gains the same feature for free.
- **Status bar and safe areas** — status bar in overlay mode with the manifest's `#24382f` theme, and `env(safe-area-inset-*)` applied to the inspector panel, filter panel, and settings sheet. The canvas itself deliberately extends under the insets; only interactive chrome is inset.
- **Overscroll** — disable WebView bounce/rubber-banding and pull-to-refresh. On the web these routinely hijack a map drag; removing them is a correctness fix for the gesture handling, not cosmetics.
- **Android back button** — mapped to the existing URL-hash navigation state (see [spec.md](spec.md) § URL hash / navigation state) so back closes the inspector, then the filter panel, then exits — rather than immediately backgrounding the app from a deep selection.
- **Splash screen** — native splash held until the client signals first meaningful paint, so the app never shows a white WebView. With data bundled locally the existing loading screen becomes brief but is kept: tree parsing still takes real time.
- **Deep links** — universal links / app links on the production domain so shared URLs open the app when installed. Requires `apple-app-site-association` and `assetlinks.json` served from the Netlify site.
- **Orientation** — portrait only, matching `manifest.webmanifest`.

## Data Bundling

All datasets ship inside the app binary, so the app is fully offline on first launch with no cache warm-up and no network dependency for anything except live cows.

`data/` is 67MB raw and needs preparation, not raw inclusion:

- Coordinate precision reduced to 6 decimal places (≈11cm — far beyond what a consumer GPS fix or this renderer can distinguish).
- Whitespace stripped from all GeoJSON/JSON.
- Excluded from the bundle: `local-landmarks.geojson.backup`, `*.overpassql`, `data/README.md`, `data/tracking/`, and `epping_forest_folklore_locations_v14_external_links.json` where it is superseded.
- `local-roads.geojson` and `local-environment-buildings.geojson` — currently opportunistic in the service worker — are bundled too; they exist to be available offline, and on native there is no reason to defer them.

**Size gate.** Apple applies a cellular-download threshold that has been raised several times; the current value must be verified at implementation time rather than assumed, and the prepared bundle size recorded against it in this spec. If the prepared bundle exceeds it, the fallback is to leave the tree chunks beyond the first N out of the binary and let the delta mechanism below fetch them on first launch — the machinery is identical, only the starting state differs. Android App Bundles have ample headroom at this size.

### Delta Updates

Data is refreshed weekly (per the existing `data-bump.yml` workflow). Waiting on an app store review to ship a data refresh is unacceptable, so data updates travel out-of-band.

- `native/scripts/build-data-manifest.js` (run in the same CI job as `data-bump.yml`) emits `data/manifest.json`: `{ dataVersion, generatedAt, files: { "<path>": { bytes, sha256 } } }`. The web build publishes it too, so there is one manifest and one hashing implementation for both platforms.
- The manifest as built at binary time ships in the bundle as the baseline.
- On launch, when online and at most once per 24h, `Native.data.checkForUpdates()` fetches `${apiBase}/data/manifest.json`, diffs it against the effective local manifest, and downloads only changed files into `Directory.Data` via `@capacitor/filesystem`, verifying each `sha256` before it is adopted.
- Downloads are atomic per file (temp name, verify, rename) and the local manifest is only updated after a file is successfully adopted, so an interrupted update leaves a consistent mix of bundled and updated files rather than a corrupt dataset.
- `Native.data.resolve(path)` returns the `Filesystem` URI for any path present in the local override manifest, and the bundled asset path otherwise. This is the single integration point in `js/loader.js`.
- The check never blocks first paint or data load. An update found on launch N is used on launch N+1. Swapping data underneath a loaded map mid-session would invalidate the built route graph and every cluster, for no user benefit.
- Downloads are skipped on metered connections unless the user explicitly asks, via a Settings action that also reports the current data version and pending update size.

## Networking

- `Native.apiBase` is the production origin, injected at sync time from a single config value so it is not duplicated across call sites. Debug builds may point it at a dev tunnel.
- The three endpoints reached over the network on native are `/api/track`, `/api/cows`, and `/.netlify/functions/report-missing-data`.
- Those functions need `Access-Control-Allow-Origin` for the native WebView origins (`capacitor://localhost` on iOS, `https://localhost` on Android) plus preflight handling. `netlify.toml` and the function handlers are updated together; the admin routes are **not** CORS-opened.
- Every one of the three must already fail gracefully offline — the tracker has an offline queue, cows degrade to cached values. Native does not change that, but it does make offline the normal case rather than the exception, so the degraded paths carry more weight and need the [testing](#testing) coverage below.

## Versioning and the Update Story

The service-worker `CACHE_NAME` bump rule (see [agents.md](agents.md) § Technical Constraints) governs the web build and stays exactly as it is — including the automated bump workflows, which are unaffected by anything in this spec. On native there is no service worker, so:

- App code version is the native app version (`CFBundleShortVersionString` / `versionName`), derived from the same release that produced the web deploy, and changed only by shipping a build.
- Data version is `dataVersion` from the manifest, and moves independently.
- The Settings "About" display shows both: `v1.4.0 (data v37)`. Bug reports submitted from native must include both values, since "which app version" is no longer a single number.
- The web build's update flow — waiting service worker, red dot, tap to update — is inapplicable and must not render on native.

## Testing

The existing suites are the baseline and must keep passing unchanged; the web build's behaviour is not permitted to shift.

**Unit (`node --test test/forest-finds.test.js`)**

- `js/native.js` on web: `isNative` false, `apiBase` empty, every capability a safe no-op, `Native.data.resolve` the identity function.
- Manifest diffing: no-op when identical, correct change set on modified/added/removed files, rejection of a file whose `sha256` does not match, correct behaviour on a partially-applied update.
- URL construction for all three endpoints under both empty and populated `apiBase`.

**BDD browser (`npm run test:e2e`)**

- `window.__FORCE_NATIVE_SHIM__` plus a stubbed `Native.heading` lets the native branches run in Playwright: heading-up rotation driven by a native heading stream, service worker registration skipped, native version string in Settings, `recoverStalledCompass` staying inert. This covers the *client* branches — the part that can regress from ordinary web-side edits — without a device.
- New journeys go in `test/e2e/` per the existing one-file-per-journey convention, and screenshots follow the flat `__screenshots__/` rule.

**Manual device checklist** — required before each store submission, since no automated suite covers the native half:

- Cold launch offline, airplane mode, fresh install: full map and tree data available.
- Compass: true heading correct against a known bearing; heading survives screen off → on, backgrounding for 5+ minutes, and a phone call.
- Location permission granted once persists across relaunch; denial leaves a usable north-up map rather than a broken screen.
- Screen stays awake through a navigation session and releases on background.
- Android back button walks the navigation stack; deep link opens a selection.
- A data delta lands, verifies, and is in effect on the following launch; a delta interrupted mid-download leaves the app working.
- Both platforms on the oldest supported OS version, and one small-screen and one tall device (the tilt horizon calculation in [spec-data-rendering.md](spec-data-rendering.md) is screen-height dependent).

## Store Submission Requirements

### Apple guideline 4.2 (minimum functionality)

A WebView wrapper with no native value is rejected under 4.2. The mitigation is that this app's native features are the reason for the app, and the review notes must say so concretely: bundled offline datasets with no network requirement, `CLLocationManager` true heading driving a live heading-up map, persistent while-in-use location, screen wake lock during navigation, haptics, and native share. This is why the heading plugin and offline bundle are in the first shipped version rather than deferred — submitting a bare shell first and adding native features later inverts the risk.

Also required: `PrivacyInfo.xcprivacy` declaring precise location collection, its purpose, and whether it is linked to the user (it is — `js/tracker.js` attaches a persistent UID) and used for tracking; App Store screenshots at all required sizes; an age rating; and a privacy policy URL. `terms.html` covers consent in-app but a hosted privacy policy is a separate submission field.

### Google Play

Data safety form matching the tracker's actual behaviour, a prominent-disclosure dialog before any location collection begins (the existing consent modal satisfies this if it is shown before the first location request, which must be verified in the native ordering), and — if and only if walk recording ships — the background location permission declaration with its written and video justification. Target API level must meet the current Play requirement at submission time.

### Both

- The admin dashboard must not be reachable from the app binary. Excluded by the sync allowlist; verify by inspecting the built `www/`.
- Account deletion / data deletion path, since the tracker stores a persistent UID server-side.

## Non-Goals

- No change to the web build's behaviour, dependencies, or "no client build step" constraint.
- No framework, no bundler, no TypeScript in the client. `native/` may use TypeScript for its own config, as Capacitor expects.
- No native UI. Every pixel the user sees stays in the canvas renderer and the existing DOM; the shell contributes no native screens, navigation, or widgets.
- No push notifications.
- No native map SDK. The renderer is the product.
- No offline tile downloads — there are no raster tiles; the map is drawn from vector data.
- No iPad or tablet layout work beyond not being broken; portrait phone remains the target.

## Phasing

Each phase is independently shippable and leaves the web build untouched.

1. **Shell.** `native/`, sync script, `js/native.js` with all capabilities stubbed, service worker skip, `apiBase` wiring and function CORS. Runs on a device showing the current app, fetching data over the network. Proves the shell before any native code exists.
2. **Offline data.** Prepared bundle, `Native.data.resolve` hook in `js/loader.js`, manifest generation. Cold launch works in airplane mode.
3. **Heading.** The `forest-heading` plugin on both platforms, client integration, calibration gate relaxation, recovery made inert. The largest single UX change.
4. **Permissions and polish.** Native permission flow in onboarding, keep-awake, safe areas, status bar, overscroll, back button, splash, haptics, share, deep links.
5. **Delta updates.** Update check, download, verification, Settings surface.
6. **Submission.** Privacy manifests, data safety, store assets, manual checklist, review notes.

Walk recording and background location are deliberately outside this sequence: they are a product feature with their own spec needs, and everything above ships without them.
