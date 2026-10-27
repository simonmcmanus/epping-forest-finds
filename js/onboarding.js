// First-visit onboarding: progressive filter selection + location and compass opt-in.
// Runs while map data loads in the background.

const ONBOARDING_KEY = "forest-finds-onboarding-v1";

const ONBOARDING_STEPS = [
  { type: "location" },
  { type: "analytics" },
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

// The analytics question's own wording, shared with the in-map card (showConsentBanner, js/app.js)
// so the two ways of asking it cannot drift apart.
const ANALYTICS_ASK_TEXT = "Share anonymous usage data — which screens you use and where you are while the app is open — and allow analytics cookies. It is never sold or used for advertising.";

// Returns a Promise resolving to { filters: string[], locationPromise: Promise|null }
// locationPromise is a live geolocation request started the moment the user tapped
// "Enable location", so it runs concurrently with the rest of the data loading.
function showOnboarding() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");

    // A question already answered elsewhere (usage analytics declined on the homepage's cookie
    // banner, say) is not asked again here.
    const steps = ONBOARDING_STEPS.filter((step) => step.type !== "analytics"
      || typeof analyticsChoice !== "function" || analyticsChoice() === "undecided");
    let stepIndex = 0;
    let locationPromise = null;
    const total = steps.length;
    const selected = new Set(["trees", "cows", "events", "pubs"]);

    overlay.hidden = false;
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
      if (s.type === "welcome") srcs.push("data/icons/trees/logo.png");
      if (s.type === "location") srcs.push("data/icons/pin.png");
      if (s.type === "analytics") srcs.push("data/icons/trees/logo.png");
      if (s.type === "group") {
        srcs.push(`data/icons/${s.group.icon}.png`);
        s.group.subfilters.forEach((sf) => srcs.push(`data/icons/${sf.icon}.png`));
      }
      srcs.forEach((src) => { const img = new Image(); img.src = src; });
    }

    function renderStep(direction) {
      const step = steps[stepIndex];
      preloadStepImages(stepIndex + 1);

      contentEl.classList.remove("entering-forward", "entering-backward");
      void contentEl.offsetWidth;
      contentEl.classList.add(direction === "back" ? "entering-backward" : "entering-forward");

      if (step.type === "welcome") {
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/trees/logo.png" alt="">
          <h2 class="onboarding-step-title">Epping Forest Finds</h2>
          <p class="onboarding-step-subtitle">Let's personalise your map. Choose what you'd like to explore — you can always change this later.</p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-primary">Get started</button>
          <button class="onboarding-skip-btn ob-skip">Skip setup</button>
        `;
      } else if (step.type === "group") {
        const { group } = step;
        const chips = group.subfilters.map((sf) => {
          const on = selected.has(sf.key);
          return `<button class="onboarding-chip${on ? "" : " off"}" data-key="${sf.key}" type="button">
            <span class="chip-tick">✓</span>
            <img src="data/icons/${sf.icon}.png" alt="" onerror="this.style.display='none'">
            ${sf.label}
          </button>`;
        }).join("");
        const isFirst = stepIndex === 1;
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
          ${!isLast ? `<button class="onboarding-skip-btn ob-skip" type="button">Skip remaining</button>` : ""}
        `;
      } else if (step.type === "location") {
        const needsCompassPrompt = canRequestCompassPermission() && Native.compassNeedsPrompt;
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/pin.png" alt="">
          <h2 class="onboarding-step-title">Your location${needsCompassPrompt ? " & compass" : ""}</h2>
          <p class="onboarding-step-subtitle">Enable location to centre the map on you, see distances to each find, and get heading-up compass navigation.</p>
          <p class="privacy-note">Your position is used on this device to draw the map. You can change this anytime in Settings → Privacy.</p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-location" type="button">Enable${needsCompassPrompt ? " location &amp; compass" : " location"}</button>
          <button class="onboarding-skip-btn ob-location-skip" type="button">Skip for now</button>
        `;
      } else if (step.type === "analytics") {
        // Its own question, with refusing exactly as easy as agreeing: nothing else in the app
        // depends on the answer, so it is never folded into the location step above.
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/trees/logo.png" alt="">
          <h2 class="onboarding-step-title">Help improve the map?</h2>
          <p class="onboarding-step-subtitle">${ANALYTICS_ASK_TEXT}</p>
          <p class="privacy-note">You can change this anytime in Settings → Privacy. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>
        `;
        actionsEl.innerHTML = `
          <div class="onboarding-nav">
            <button class="button ob-analytics-decline" type="button">No thanks</button>
            <button class="button ob-analytics-accept" type="button">Share usage data</button>
          </div>
        `;
      }

      // Chip toggles
      contentEl.querySelectorAll(".onboarding-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const key = chip.dataset.key;
          if (selected.has(key)) {
            selected.delete(key);
            chip.classList.add("off");
          } else {
            selected.add(key);
            chip.classList.remove("off");
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
      actionsEl.querySelector(".ob-location")?.addEventListener("click", async () => {
        // Location only: usage analytics is the next step's separate question.
        if (typeof rememberLocationChoice === "function") rememberLocationChoice("granted");

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

        // Location is now the first step — continue to welcome + filter personalisation.
        goNext();
      });
      actionsEl.querySelector(".ob-location-skip")?.addEventListener("click", () => {
        setImplicitCompassPermission();
        // Remembered, so no later launch puts a system location prompt in front of someone who
        // already said not now. Settings → Privacy is the way back.
        if (typeof rememberLocationChoice === "function") rememberLocationChoice("declined");
        goNext();
      });
      actionsEl.querySelector(".ob-analytics-accept")?.addEventListener("click", () => {
        if (typeof setAnalyticsConsent === "function") setAnalyticsConsent(true);
        goNext();
      });
      actionsEl.querySelector(".ob-analytics-decline")?.addEventListener("click", () => {
        if (typeof setAnalyticsConsent === "function") setAnalyticsConsent(false);
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
      if (stepIndex >= total - 1) return;
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

    function finish() {
      try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch {}
      if (deactivateFocus) deactivateFocus();
      overlay.classList.add("fading-out");
      overlay.addEventListener("transitionend", () => {
        overlay.hidden = true;
        overlay.classList.remove("fading-out");
      }, { once: true });
      resolve({ filters: Array.from(selected), locationPromise });
    }

    renderProgress();
    renderStep("forward");
  });
}
