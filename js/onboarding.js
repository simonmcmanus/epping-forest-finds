// First-visit onboarding: a short guided filter setup, with permissions collected up front.
// The same guided filter steps can also be opened later from Nearby in `filters` mode.
// Runs while map data loads in the background.

const ONBOARDING_KEY = "forest-finds-onboarding-v1";

const ONBOARDING_STEPS = [
  { type: "permissions" },
  { type: "welcome" },
  ...FILTER_GROUPS.map((g) => ({ type: "group", group: g })),
];

if (typeof globalThis !== "undefined") {
  globalThis.ONBOARDING_STEPS = ONBOARDING_STEPS;
}

function canRequestCompassPermission() {
  return typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function";
}

function compassStepMarkup({ blocked = false }) {
  if (blocked) {
    return {
      subtitle: "Compass access was blocked. The map will still load, and nearby guidance will do the best it can without heading data.",
      actionsHtml: `<button class="button ob-compass-finish" type="button">Continue</button>`,
    };
  }
  return {
    subtitle: "Enable compass access to unlock heading-up navigation — the map will rotate to face the direction you're walking.",
    actionsHtml: `
      <button class="button ob-compass-enable" type="button">Enable compass</button>
      <button class="onboarding-skip-btn ob-compass-skip" type="button">Continue without compass</button>
    `,
  };
}

function hasCompletedOnboarding() {
  // Safari private browsing and browsers with storage blocked can throw even for a read.
  // Treat that the same as a first visit so storage policy never aborts app boot before the
  // map has had a chance to render. The completion write below is guarded for the same reason.
  try {
    return !!localStorage.getItem(ONBOARDING_KEY);
  } catch {
    return false;
  }
}

// The combined consent wording is shared with the in-map card (showConsentBanner, js/app.js)
// so the two ways of asking it cannot drift apart.
const COMBINED_CONSENT_TEXT = "Shows nearby finds and their distance from you, and helps us understand how people use this site — enabling covers both.";

function mapSetupIconMarkup() {
  return `<span class="onboarding-step-icon onboarding-map-setup-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 7 8.5-3.5L20.5 7 12 10.5 3.5 7Z"/><path d="m3.5 12 8.5 3.5 8.5-3.5"/><path d="m3.5 17 8.5 3.5 8.5-3.5"/></svg></span>`;
}

// Returns a Promise resolving to { filters: string[]|null, cancelled: boolean, locationPromise: Promise|null }
// locationPromise is a live geolocation request started the moment the user tapped
// "Enable location", so it runs concurrently with the rest of the data loading.
function showOnboarding({ skipPermissions = false, mode = "first-run" } = {}) {
  return new Promise((resolve) => {
    const filterSetupMode = mode === "filters";
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");

    // A usage-analytics answer already given elsewhere (the homepage's cookie banner, say) is
    // omitted from the permissions dialog below; the rest of the guided setup is unchanged.
    const steps = filterSetupMode
      ? [{ type: "filter-intro" }, ...FILTER_GROUPS.map((g) => ({ type: "group", group: g }))]
      : skipPermissions
        ? ONBOARDING_STEPS.filter((step) => step.type !== "permissions")
        : ONBOARDING_STEPS;
    let stepIndex = 0;
    let locationPromise = null;
    const total = steps.length;
    const startingFilters = filterSetupMode
      && typeof state !== "undefined"
      && state
      && Array.isArray(state.overviewFilters)
      ? state.overviewFilters
      : DEFAULT_OVERVIEW_FILTER_KEYS;
    const selected = new Set(sanitizeOverviewFilters(startingFilters));

    overlay.hidden = false;
    overlay._onboardingActive = true;
    const deactivateFocus = typeof activateModalFocus === "function" ? activateModalFocus(overlay) : null;

    function renderProgress() {
      progressEl.innerHTML = steps.map((_, i) => {
        const cls = i === stepIndex ? "active" : i < stepIndex ? "done" : "";
        return `<span class="onboarding-dot ${cls}"></span>`;
      }).join("");
    }

    function preloadStepImages(idx) {
      if (idx < 0 || idx >= steps.length) return;
      const s = steps[idx];
      const srcs = [];
      if (s.type === "welcome" || s.type === "permissions") srcs.push("data/icons/trees/logo.png");
      if (s.type === "permissions") srcs.push("data/icons/pin.png");
      if (s.type === "group") {
        srcs.push(`data/icons/${s.group.icon}.png`);
        s.group.subfilters.forEach((sf) => srcs.push(`data/icons/${sf.icon}.png`));
      }
      srcs.forEach((src) => { const img = new Image(); img.src = src; });
    }

    function renderStep(direction) {
      const step = steps[stepIndex];
      let analyticsUnanswered = false;
      let combinedConsent = false;
      preloadStepImages(stepIndex + 1);

      contentEl.classList.remove("entering-forward", "entering-backward");
      void contentEl.offsetWidth;
      contentEl.classList.add(direction === "back" ? "entering-backward" : "entering-forward");

      if (step.type === "filter-intro") {
        contentEl.innerHTML = `
          ${mapSetupIconMarkup()}
          <h2 class="onboarding-step-title">Choose what appears on the map</h2>
          <p class="onboarding-step-subtitle">Turn categories on or off to control the pins you see and the finds in your Nearby list. Your choices only change what is shown — you can update them any time.</p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-primary">Choose categories</button>
          <button class="onboarding-skip-btn ob-cancel" type="button">Keep current choices</button>
        `;
      } else if (step.type === "welcome") {
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/trees/logo.png" alt="">
          <h2 class="onboarding-step-title">Make the map yours</h2>
          <p class="onboarding-step-subtitle">Take a quick tour of the map setup. Pick the finds you want to see, then you can start exploring.</p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-primary">Set up my map</button>
          <button class="onboarding-skip-btn ob-skip">Explore first</button>
        `;
      } else if (step.type === "group") {
        const { group } = step;
        const chips = group.subfilters.map((sf) => {
          const on = selected.has(sf.key);
          return `<button class="onboarding-chip${on ? "" : " off"}" data-key="${sf.key}" type="button" aria-pressed="${on}">
            <span class="chip-tick">✓</span>
            <img src="data/icons/${sf.icon}.png" alt="" onerror="this.style.display='none'">
            ${sf.label}
          </button>`;
        }).join("");
        const isFirst = stepIndex === steps.findIndex((candidate) => candidate.type === "group");
        const isLast = stepIndex === total - 1;
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/${group.icon}.png" alt="">
          <h2 class="onboarding-step-title">${group.label}</h2>
          <p class="onboarding-step-subtitle">Tap to toggle what you'd like to see on the map.</p>
          <div class="onboarding-chips">${chips}</div>
        `;
        actionsEl.innerHTML = `
          <div class="onboarding-nav">
            ${!isFirst ? `<button class="button ob-back" type="button">← Back</button>` : ""}
            <button class="button ob-next" type="button">${isLast ? "Done" : "Next"}</button>
          </div>
          <button class="onboarding-skip-btn ${filterSetupMode ? "ob-cancel" : "ob-skip"}" type="button">${filterSetupMode ? "Cancel changes" : (!isLast ? "Skip remaining" : "")}</button>
        `;
        if (isLast && !filterSetupMode) actionsEl.querySelector(".ob-cancel")?.remove();
      } else if (step.type === "permissions") {
        const needsCompassPrompt = canRequestCompassPermission() && Native.compassNeedsPrompt;
        analyticsUnanswered = typeof analyticsChoice !== "function" || analyticsChoice() === "undecided";
        combinedConsent = analyticsUnanswered;
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/trees/logo.png" alt="">
          <h2 class="onboarding-step-title">${combinedConsent ? "Allow location &amp; cookies" : "Before we start"}</h2>
          <p class="onboarding-step-subtitle">${combinedConsent
            ? `${COMBINED_CONSENT_TEXT} <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`
            : "Centre the map on you and see real walking distances. You can change this later in Settings → Privacy."}</p>
          <div class="onboarding-permissions">
            <section class="onboarding-permission-option" aria-labelledby="onboarding-location-title">
              <h3 id="onboarding-location-title">${combinedConsent ? "Location and cookies" : "Your location"}</h3>
              <p>${combinedConsent
                ? "Enabling location centres the map and shows walking distances; enabling cookies also shares anonymous usage data with Google Analytics."
                : "Your position is used on this device to draw the map."}</p>
              <div class="onboarding-permission-actions">
                <button class="button ob-location" type="button">${combinedConsent ? "Enable location &amp; cookies" : `Enable${needsCompassPrompt ? " location &amp; compass" : " location"}`}</button>
                <button class="onboarding-skip-btn ob-location-skip" type="button">${combinedConsent ? "Maybe later" : "Skip for now"}</button>
              </div>
              <p class="onboarding-choice-status ob-location-status" aria-live="polite"></p>
            </section>
          </div>
        `;
        actionsEl.innerHTML = "";
      }

      // Chip toggles
      contentEl.querySelectorAll(".onboarding-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const key = chip.dataset.key;
          if (selected.has(key)) {
            selected.delete(key);
            chip.classList.add("off");
            chip.setAttribute("aria-pressed", "false");
          } else {
            selected.add(key);
            chip.classList.remove("off");
            chip.setAttribute("aria-pressed", "true");
          }
        });
      });

      actionsEl.querySelector(".ob-primary")?.addEventListener("click", goNext);
      actionsEl.querySelector(".ob-next")?.addEventListener("click", () => {
        if (stepIndex >= total - 1) finish();
        else goNext();
      });
      actionsEl.querySelector(".ob-back")?.addEventListener("click", goBack);
      actionsEl.querySelector(".ob-skip")?.addEventListener("click", () => finish());
      actionsEl.querySelector(".ob-cancel")?.addEventListener("click", () => finish({ cancelled: true }));
      contentEl.querySelector(".ob-location")?.addEventListener("click", async () => {
        if (typeof rememberLocationChoice === "function") rememberLocationChoice("granted");
        if (analyticsUnanswered && typeof setAnalyticsConsent === "function") setAnalyticsConsent(true);

        const locationButton = contentEl.querySelector(".ob-location");
        const locationSkip = contentEl.querySelector(".ob-location-skip");
        const locationStatus = contentEl.querySelector(".ob-location-status");
        if (locationButton) {
          locationButton.disabled = true;
          locationButton.textContent = combinedConsent ? "Location & cookies enabled" : "Location enabled";
        }
        if (locationSkip) locationSkip.disabled = true;
        if (locationStatus) locationStatus.textContent = "Location request started.";

        // Start location request — the system dialog fires from this tap.
        if (Native.geolocation) {
          locationPromise = new Promise((res) => {
            Native.geolocation.getCurrentPosition(
              (pos) => res({ ok: true, position: pos }),
              (error) => res({ ok: false, code: error && error.code }),
              // Shared with boot()'s own automatic request (js/app.js) so a cold outdoor fix gets
              // the same room to land before this is treated as a failure.
              { enableHighAccuracy: true, timeout: BOOT_GEOLOCATION_TIMEOUT_MS, maximumAge: 30000 }
            );
          });
        }

        // Request compass in the same tap handler — iOS requires requestPermission()
        // to be called within a user-gesture call stack, which this still satisfies.
        if (canRequestCompassPermission() && Native.compassNeedsPrompt) {
          try {
            const permission = await DeviceOrientationEvent.requestPermission();
            setCompassPermission(permission === "granted" ? "granted" : "denied");
          } catch {
            setCompassPermission("denied");
          }
        } else {
          setImplicitCompassPermission();
        }
        goNext();
      });
      contentEl.querySelector(".ob-location-skip")?.addEventListener("click", () => {
        setImplicitCompassPermission();
        // Remembered, so no later launch puts a system location prompt in front of someone who
        // already said not now. Settings → Privacy is the way back.
        if (typeof rememberLocationChoice === "function") rememberLocationChoice("declined");
        if (analyticsUnanswered && typeof setAnalyticsConsent === "function") setAnalyticsConsent(false);
        const locationButton = contentEl.querySelector(".ob-location");
        const locationSkip = contentEl.querySelector(".ob-location-skip");
        const locationStatus = contentEl.querySelector(".ob-location-status");
        if (locationButton) locationButton.disabled = true;
        if (locationSkip) {
          locationSkip.disabled = true;
          locationSkip.textContent = combinedConsent ? "Both skipped" : "Location skipped";
        }
        if (locationStatus) locationStatus.textContent = "Location skipped for now.";
        goNext();
      });

      // Each step replaces contentEl/actionsEl wholesale, which drops focus back to <body> for
      // a keyboard user — move it to the step's heading so screen readers announce the new step
      // and Tab resumes from a sane place, without stealing focus on the very first render
      // (activateModalFocus already placed it on the first control that time).
      if (direction) {
        const heading = contentEl.querySelector("h2");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus();
        }
      }
    }

    function hasGlobalState() {
      return typeof state !== "undefined" && state;
    }

    function setCompassPermission(permission) {
      if (hasGlobalState()) {
        state.compassPermission = permission;
      }
      try {
        localStorage.setItem("forest-finds-compass-permission-v1", permission);
      } catch {}
    }

    function canUseCompassWithoutPrompt() {
      return typeof DeviceOrientationEvent !== "undefined"
        && (!canRequestCompassPermission() || !Native.compassNeedsPrompt);
    }

    function setImplicitCompassPermission() {
      if (canUseCompassWithoutPrompt()) {
        setCompassPermission("granted");
      }
    }

    function goNext() {
      if (stepIndex >= total - 1) {
        finish();
        return;
      }
      stepIndex++;
      renderProgress();
      renderStep("forward");
    }

    function goBack() {
      if (stepIndex <= 0) return;
      stepIndex--;
      renderProgress();
      renderStep("back");
    }

    function finish({ cancelled = false } = {}) {
      if (!filterSetupMode) {
        try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch {}
      }
      if (deactivateFocus) deactivateFocus();
      overlay.classList.add("fading-out");
      overlay.addEventListener("transitionend", () => {
        overlay.hidden = true;
        overlay._onboardingActive = false;
        overlay.classList.remove("fading-out");
      }, { once: true });
      resolve({ filters: cancelled ? null : Array.from(selected), cancelled, locationPromise });
    }

    renderProgress();
    renderStep("forward");
  });
}
