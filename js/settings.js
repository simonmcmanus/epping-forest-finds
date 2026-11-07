// Epping Forest Finds — Settings: the settings screen's markup, its location and native data rows, the account and tester rows, and its handlers.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

function openSettings() {
  if (typeof dismissOnboarding === "function") dismissOnboarding();
  if (typeof trackGaScreenView === "function") trackGaScreenView("Settings");
  // Without this the walk-radius slider here showed the tapped group's borrowed radius as if it
  // were the user's own setting.
  exitClusterExpansion();
  state.selected = { type: "settings", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("settings", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  setNavScreenActive(els.settingsToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Settings";
  els.inspectorType.textContent = "App preferences";
  transitionInspectorBody(settingsFormHtml(), "forward");
  bindSettingsHandlers();
  fillTesterId();
  fillSettingsAccount();
  setInspectorMinimized(false);
  updateCompassOverlay();
  syncHashFromSelection();
  requestDraw();
}

// window.ForestFindsCookieConsent (cookie-consent.js) is the one store of truth for the GA
// cookie banner's choice -- read through it rather than localStorage directly so Settings always
// agrees with whatever the banner itself last recorded.
function analyticsStatusLabel() {
  const choice = analyticsChoice();
  return choice === "granted" ? "on" : choice === "denied" ? "off" : "not yet decided";
}

function locationStatusLabel() {
  return hasRealLocation() ? "on" : "off";
}

// The one place a person who said not now can turn location on later, so no ask ever has to be
// repeated unprompted. A permission refused below the app is explained rather than re-requested.
function setupSettingsLocationRow() {
  const button = document.getElementById("settingsLocateButton");
  const note = document.getElementById("locationBlockedNote");
  if (!button) return;
  if (!Native.geolocation) {
    button.hidden = true;
    return;
  }
  Native.locationPermissionState().then((permission) => {
    if (permission !== "denied" || hasRealLocation() || !button.isConnected) return;
    locationRequestRefusal = "denied";
    syncSettingsLocationRow();
  });
  button.addEventListener("click", () => {
    rememberLocationChoice("granted");
    button.disabled = true;
    button.textContent = "Getting your location…";
    locateUser({ initial: false });
  });
}

// The native app's own update line: its data comes from the binary plus whatever the website has
// published since (Native.data), and is checked once a day without anyone asking.
function nativeDataHtml() {
  const checked = Native.data.lastChecked();
  const when = checked ? new Date(checked).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "not yet";
  return `<div class="settings-refresh">
        <h4 class="settings-section-title">Map data</h4>
        <p class="settings-description">Showing map data ${escapeHtml(String(Native.data.activeVersion || ""))}. Last checked for updates: ${escapeHtml(when)}. New data is used the next time the app starts.</p>
        <button id="nativeDataCheckButton" class="settings-btn" type="button">Check for map updates</button>
        <p id="nativeDataStatus" class="report-note" role="status" aria-live="polite" hidden></p>
      </div>`;
}

function setupNativeDataRow() {
  const button = document.getElementById("nativeDataCheckButton");
  const status = document.getElementById("nativeDataStatus");
  if (!button || !Native.data) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Checking…";
    const result = await Native.data.checkForUpdates({ force: true });
    button.disabled = false;
    button.textContent = "Check for map updates";
    if (status) {
      status.textContent = NATIVE_DATA_STATUS_TEXT[result.status] || NATIVE_DATA_STATUS_TEXT.failed;
      status.hidden = false;
    }
  });
}

// Keeps an open Settings screen's location row in step with a request that has just answered. A
// refusal (locationRequestRefusal, js/permission-asks.js) is said on the row: a denied permission
// takes the button away, since asking again cannot succeed, and a failed request keeps it.
function syncSettingsLocationRow() {
  const status = document.getElementById("locationStatus");
  if (status) status.textContent = locationStatusLabel();
  const button = document.getElementById("settingsLocateButton");
  if (!button) return;
  const refusal = hasRealLocation() ? null : locationRequestRefusal;
  button.disabled = false;
  button.textContent = "Use my location";
  button.hidden = hasRealLocation() || refusal === "denied";
  const note = document.getElementById("locationBlockedNote");
  if (note) {
    note.textContent = refusal === "denied" ? locationBlockedMessage()
      : refusal === "failed" ? LOCATION_FAILED_MESSAGE
      : "";
    note.hidden = !refusal;
  }
}

function settingsFormHtml() {
  const minutes = state.walkingDistanceMinutes;
  const online = navigator.onLine;
  // The floor keeps the slider from being dragged down to a radius with nothing in it (see
  // walkingRadiusFloorMinutes, js/nav.js); a native <input type="range"> min attribute
  // enforces it directly, so there's no separate clamp to keep in sync here.
  // Snapped up onto the value grid (ceilWalkingMinutes): a range input steps from its own
  // min, so a raw floor like 0.41 would put every reachable value off the grid the label and
  // the pinch gesture use.
  const floorMinutes = ceilWalkingMinutes(walkingRadiusFloorMinutes(state.userLocation));
  // A floor below a minute means something is close enough to be worth the finer step.
  const stepMinutes = floorMinutes < 1 ? WALKING_RADIUS_FINE_STEP_MINUTES : WALKING_RADIUS_STEP_MINUTES;
  const sliderValue = clamp(minutes, floorMinutes, WALKING_RADIUS_MAX_MINUTES);
  // Reused for the datalist's <option> grid (the slider's real, browser-enforced snap points)
  // and for the decorative tick marks below the track, which only mirror that grid visually --
  // native range+datalist tick rendering is lost entirely once appearance:none re-skins the
  // track and thumb (see .walk-radius-range), so the preset stops need their own markup to be
  // seen at all.
  const reachablePresets = WALKING_RADIUS_PRESET_MINUTES.filter(
    (m) => m >= floorMinutes && m <= WALKING_RADIUS_MAX_MINUTES
  );
  const ticks = reachablePresets.map((m) => `<option value="${m}"></option>`).join("");
  const trackSpan = WALKING_RADIUS_MAX_MINUTES - floorMinutes;
  const tickMarks = reachablePresets
    .map((m) => {
      const pct = trackSpan > 0 ? ((m - floorMinutes) / trackSpan) * 100 : 0;
      return `<span class="walk-radius-tick" style="left:${pct.toFixed(2)}%"></span>`;
    })
    .join("");
  return `<div class="settings-form">
    <p class="settings-intro">A little more you. Make Forest Finds fit the way you explore.</p>
    <section class="settings-section settings-walking">
      <h3 class="settings-section-title">Walking radius</h3>
      <p class="settings-description">Set your pace. Nearby finds and the circle on your map follow this walking time.</p>
      <label for="settingsWalkMins" class="settings-label">Walking time
        <span class="walk-radius-row">
          <span class="walk-radius-track-wrap">
            <input type="range" id="settingsWalkMins" class="walk-radius-range"
              min="${floorMinutes}" max="${WALKING_RADIUS_MAX_MINUTES}" step="${stepMinutes}"
              value="${sliderValue}" list="walkRadiusTicks" aria-valuetext="${formatWalkingRadius(sliderValue)}">
            <span class="walk-radius-ticks" aria-hidden="true">${tickMarks}</span>
          </span>
          <span class="walk-radius-value" id="settingsWalkMinsValue" aria-hidden="true">${formatWalkingRadius(sliderValue)}</span>
        </span>
        <datalist id="walkRadiusTicks">${ticks}</datalist>
      </label>
      <div class="settings-presets" role="group" aria-label="Walking time presets">${reachablePresets.map((m) => `<button type="button" class="settings-btn" data-walk-minutes="${m}" aria-pressed="${sliderValue === m}">${formatWalkingRadius(m)}</button>`).join("")}</div>
      <p class="source-note walk-radius-floor-note" id="settingsWalkMinsFloorNote" aria-live="polite"${sliderValue > floorMinutes ? " hidden" : ""}>This is as close as it gets — nothing closer to show nearby.</p>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">Reminders</h3>
      <label class="community-nudge-setting settings-switch"><span><strong>Tree check reminders</strong><span class="settings-description">A gentle nudge to check trees you’re standing next to.</span></span><input type="checkbox" id="communityNudgeToggle"${communityNudgesOn() ? " checked" : ""}></label>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">About</h3>
      <p class="settings-description">App version: <span id="appVersionDisplay" class="app-version-display">${state.swVersion || APP_VERSION}</span></p>
      ${Native.isNative ? "" : appUpdateStatusHtml()}
      <p class="settings-description">Tester ID: <code id="testerIdDisplay" class="tester-id">…</code> <button type="button" id="testerIdCopy" class="settings-btn" hidden>Copy</button><br><span class="report-note">Give this to Simon to try early features.</span></p>
      <p class="settings-description">Vibe coded by <a href="https://simonmcmanus.com" target="_blank" rel="noopener noreferrer">Simon McManus</a></p>
      <p id="dataUpdateNote" class="report-note"${state.dataUpdateAvailable ? "" : " hidden"}>New map data has been downloaded. <button id="dataUpdateReloadButton" class="inline-text-button" type="button">Reload now</button> to see it.</p>
      ${Native.data ? nativeDataHtml() : ""}
      <div class="settings-refresh"${Native.isNative ? " hidden" : ""}>
        <h4 class="settings-section-title">Keep things fresh</h4>
        <div class="settings-refresh-row">
          <button id="refreshDataButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh data</button>
          <button id="refreshAppButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh app</button>
          <button id="refreshAllButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh both</button>
        </div>
        <p class="settings-description"><strong>Data</strong> updates trees, paths and places. <strong>App</strong> reloads the app itself. <strong>Both</strong> refreshes everything. Your preferences stay with you.</p>
        <p id="refreshStatus" class="report-note" role="status" aria-live="polite" hidden></p>
        <p id="refreshOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>Refreshing needs an internet connection — you\'re offline right now.</p>
      </div>
    </section>
    <section class="settings-section" id="settingsAccount">
      <h3 class="settings-section-title">Account</h3>
      <div id="settingsAccountBody">${settingsAccountHtml(typeof communityReadAccount === "function" ? communityReadAccount() : null)}</div>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">Privacy</h3>
      <p class="settings-description">Location: <strong id="locationStatus">${locationStatusLabel()}</strong>. Used on this device to centre the map on you and measure distances.</p>
      <p id="locationBlockedNote" class="report-note" hidden></p>
      <button id="settingsLocateButton" class="settings-btn" type="button"${hasRealLocation() ? " hidden" : ""}>Use my location</button>
      <p class="settings-description">Usage analytics: <strong id="analyticsStatus">${analyticsStatusLabel()}</strong>. Anonymous usage data, including your position while the app is open, and Google Analytics cookies. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>
      ${trackerExistingUserId() ? `<p class="settings-description">Your anonymous ID, for a data access or deletion request: <code id="analyticsIdDisplay">${escapeHtml(trackerExistingUserId())}</code></p>` : ""}
      <button id="analyticsToggle" class="settings-btn" type="button">${analyticsChoice() === "granted" ? "Turn off usage analytics" : "Turn on usage analytics"}</button>
    </section>
  </div>`;
}

// The Settings sign-in control. Drawn at once from the last known account (so the screen never flashes an
// empty section), then corrected once /api/auth/me has answered. A sign-in is a full page load through the
// provider and comes back to Settings.
function settingsAccountHtml(account, note = "") {
  const noteHtml = note ? `<p class="report-note" role="status">${escapeHtml(note)}</p>` : "";
  // Sign-in is a cookie session set by a redirect through the provider back to this site, which a
  // page served from the app bundle can never come back from (spec-native.md "Not in the first release").
  if (Native.isNative) {
    return `<p class="settings-description">Signing in is not available in the app yet. Your Community points are kept on this device.</p>${noteHtml}`;
  }
  if (account && account.signedIn) {
    return `<p class="settings-description">Signed in as <strong>${escapeHtml(account.name)}</strong>. Your points follow you to any device you sign in on.</p>
      <a id="settingsSignOut" class="settings-btn settings-btn-link" href="/api/auth/logout?return=/settings">Sign out</a>
      <p class="settings-description">Used a different login on another device? Sign in with it here to bring its points and devices into this account.</p>
      <a id="settingsMerge" class="settings-btn settings-btn-link" href="/api/auth/login?return=/settings&amp;merge=1">Merge another sign-in</a>${noteHtml}`;
  }
  return `<p class="settings-description">Sign in to keep your Community points on any device. You can still use the app without signing in.</p>
    <a id="settingsSignIn" class="settings-btn settings-btn-link" href="/api/auth/login?return=/settings">Sign in</a>${noteHtml}`;
}

function takeMergeOutcome() {
  try {
    const match = /(?:^|;\s*)ff_merge_result=([a-z]+)/.exec(document.cookie || "");
    if (match) {
      document.cookie = "ff_merge_result=; Path=/; Max-Age=0";
      if (SETTINGS_MERGE_MESSAGES[match[1]]) settingsMergeOutcome = match[1];
    }
  } catch {}
  return settingsMergeOutcome;
}

async function fillSettingsAccount() {
  if (!document.getElementById("settingsAccountBody") || typeof communityRefreshAccount !== "function") return;
  const merge = takeMergeOutcome();
  let result = "failed";
  try { result = await communityRefreshAccount(); } catch {}
  const body = document.getElementById("settingsAccountBody");
  if (!body) return; // the screen was left while we waited
  const account = communityReadAccount();
  let note = result === "failed" && account && account.signedIn ? "Couldn't check who is signed in just now." : "";
  if (merge) note = SETTINGS_MERGE_MESSAGES[merge];
  body.innerHTML = settingsAccountHtml(account, note);
  // Merged devices change the points: bring this device's score and log up to date.
  if (merge === "merged") { try { await Promise.all([communityRefreshScore(true), communityRefreshLog()]); } catch {} }
}

async function fillTesterId() {
  const display = document.getElementById("testerIdDisplay");
  if (!display) return;
  let id = "";
  try { id = await communityTesterId(communityPrimaryDeviceId()); } catch {}
  if (!id) { display.textContent = "unavailable"; return; }
  display.textContent = id;
  const copy = document.getElementById("testerIdCopy");
  if (!copy) return;
  copy.hidden = false;
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(id); copy.textContent = "Copied"; } catch { copy.textContent = "Select and copy it"; }
  });
}

function bindSettingsHandlers() {
  refreshSettingsVersionDisplay();
  const range = document.getElementById("settingsWalkMins");
  if (range) {
    // If the floor has grown since this radius was last set (e.g. the user has moved
    // somewhere sparser), the browser silently clamps the slider's own displayed value to
    // its new min -- reconcile state.walkingDistanceMinutes to match so the ring, list, and
    // camera fit all agree with what's actually shown.
    const floorMinutes = Number(range.min);
    if (state.walkingDistanceMinutes < floorMinutes) {
      applyWalkingRadiusChange(floorMinutes, { animate: false });
    }

    const valueLabel = document.getElementById("settingsWalkMinsValue");
    const floorNote = document.getElementById("settingsWalkMinsFloorNote");

    // applyWalkingRadiusChange (js/nav.js) is the shared path the pinch-to-resize gesture
    // uses: it re-derives the nearest list and re-fits the camera through
    // ensureOverviewTargetsVisible, so the new radius is framed by whichever fit is
    // actually active (heading-up/3D included). This used to run its own flat, centred
    // moveCamera, which the next compass frame then re-fitted on top of.
    // "input" fires continuously while dragging -- animate:false snaps the camera straight
    // to each intermediate fit rather than queuing an animation per tick; "change" fires
    // once on release for the smooth settling motion (default animate:true).
    range.addEventListener("input", () => {
      // Snapped to the same grid the pinch gesture applies, so a fine-step slider (offered
      // when something sits less than a minute away) still lands on whole half-minutes once
      // it is dragged up past a minute.
      const value = roundWalkingMinutes(Number(range.value));
      const label = formatWalkingRadius(value);
      if (valueLabel) valueLabel.textContent = label;
      range.setAttribute("aria-valuetext", label);
      document.querySelectorAll("[data-walk-minutes]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.walkMinutes) === value));
      });
      if (floorNote) floorNote.hidden = value > floorMinutes;
      applyWalkingRadiusChange(value, { animate: false });
    });
    range.addEventListener("change", () => {
      refreshNearbyRadiusView();
    });
    document.querySelectorAll("[data-walk-minutes]").forEach((button) => {
      button.addEventListener("click", () => {
        range.value = button.dataset.walkMinutes;
        range.dispatchEvent(new Event("input", { bubbles: true }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  for (const scope of Object.keys(REFRESH_SCOPES)) {
    const button = document.getElementById(REFRESH_SCOPES[scope].buttonId);
    if (button) button.addEventListener("click", () => refreshCachedState(scope));
  }

  const dataReloadButton = document.getElementById("dataUpdateReloadButton");
  if (dataReloadButton) dataReloadButton.addEventListener("click", () => location.reload());

  const analyticsToggle = document.getElementById("analyticsToggle");
  if (analyticsToggle) {
    analyticsToggle.addEventListener("click", () => {
      const granting = analyticsChoice() !== "granted";
      setAnalyticsConsent(granting);
      analyticsToggle.textContent = granting ? "Turn off usage analytics" : "Turn on usage analytics";
      const status = document.getElementById("analyticsStatus");
      if (status) status.textContent = analyticsStatusLabel();
    });
  }
  setupSettingsLocationRow();
  setupNativeDataRow();
  // Settings HTML is rebuilt fresh every time the screen opens (see openSettings above),
  // so remove before re-adding — otherwise every open leaks another window-level listener.
  window.removeEventListener("online", updateRefreshButtonsOnlineState);
  window.removeEventListener("offline", updateRefreshButtonsOnlineState);
  window.addEventListener("online", updateRefreshButtonsOnlineState);
  window.addEventListener("offline", updateRefreshButtonsOnlineState);
  updateRefreshButtonsOnlineState();
}
