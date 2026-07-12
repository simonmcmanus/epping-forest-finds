// First-visit onboarding: progressive filter selection + location and compass opt-in.
// Runs while map data loads in the background.

const ONBOARDING_KEY = "forest-finds-onboarding-v1";

const ONBOARDING_STEPS = [
  { type: "welcome" },
  ...FILTER_GROUPS.map((g) => ({ type: "group", group: g })),
  { type: "location" },
  { type: "compass" },
];

function canRequestCompassPermission() {
  return typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function";
}

function compassStepMarkup({ blocked = false, hasCompassSupport = true, needsCompassPrompt = true }) {
  if (blocked) {
    return {
      subtitle: "Compass access was blocked. The map will still load, and nearby guidance will do the best it can without heading data.",
      actionsHtml: `<button class="button ob-compass-finish" type="button">Continue</button>`,
    };
  }
  if (!hasCompassSupport) {
    return {
      subtitle: "Compass access is unavailable on this device or browser. The map will still load, and nearby guidance will do the best it can without heading data.",
      actionsHtml: `<button class="button ob-compass-finish" type="button">Continue</button>`,
    };
  }
  if (!needsCompassPrompt) {
    return {
      subtitle: "This browser can use compass data without an extra permission prompt. Nearby guidance will start working automatically when the device provides heading data.",
      actionsHtml: `<button class="button ob-compass-finish" type="button">Continue</button>`,
    };
  }
  return {
    subtitle: "Enable compass access to unlock the nearby screen and heading-up navigation before the map appears.",
    actionsHtml: `
      <button class="button ob-compass-enable" type="button">Enable compass</button>
      <button class="onboarding-skip-btn ob-compass-skip" type="button">Continue without compass</button>
    `,
  };
}

function hasCompletedOnboarding() {
  return !!localStorage.getItem(ONBOARDING_KEY);
}

// Returns a Promise resolving to { filters: string[], requestLocation: boolean }
function showOnboarding() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");

    let stepIndex = 0;
    // We keep the location opt-in here so boot can request the fix only after
    // the compass step has completed and the onboarding overlay is dismissed.
    let shouldRequestLocation = false;
    let compassPromptFailed = false;
    const total = ONBOARDING_STEPS.length;
    const selected = new Set(FILTER_GROUPS.flatMap((g) => g.subfilters.map((s) => s.key)));

    overlay.hidden = false;

    function renderProgress() {
      progressEl.innerHTML = ONBOARDING_STEPS.map((_, i) => {
        const cls = i === stepIndex ? "active" : i < stepIndex ? "done" : "";
        return `<span class="onboarding-dot ${cls}"></span>`;
      }).join("");
    }

    function renderStep(direction) {
      const step = ONBOARDING_STEPS[stepIndex];

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
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/${group.icon}.png" alt="">
          <h2 class="onboarding-step-title">${group.label}</h2>
          <p class="onboarding-step-subtitle">Tap to toggle what you'd like to see on the map.</p>
          <div class="onboarding-chips">${chips}</div>
        `;
        actionsEl.innerHTML = `
          <div class="onboarding-nav">
            ${!isFirst ? `<button class="button ob-back" type="button">← Back</button>` : ""}
            <button class="button ob-next" type="button">Next</button>
          </div>
          <button class="onboarding-skip-btn ob-skip" type="button">Skip remaining</button>
        `;
      } else if (step.type === "location") {
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/pin.png" alt="">
          <h2 class="onboarding-step-title">Your location</h2>
          <p class="onboarding-step-subtitle">Enable location to centre the map on you, see distances to each find, and get compass directions.</p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-location" type="button">Enable location</button>
          <button class="onboarding-skip-btn ob-location-skip" type="button">Skip for now</button>
        `;
      } else if (step.type === "compass") {
        function renderCompassStep(subtitle, actionsHtml) {
          contentEl.innerHTML = `
            <div class="onboarding-step-icon" aria-hidden="true">🧭</div>
            <h2 class="onboarding-step-title">Compass guidance</h2>
            <p class="onboarding-step-subtitle">${subtitle}</p>
          `;
          actionsEl.innerHTML = actionsHtml;
        }

        const compassMarkup = compassStepMarkup({
          blocked: compassPromptFailed,
          hasCompassSupport: typeof DeviceOrientationEvent !== "undefined",
          needsCompassPrompt: canRequestCompassPermission(),
        });
        renderCompassStep(compassMarkup.subtitle, compassMarkup.actionsHtml);
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
      actionsEl.querySelector(".ob-next")?.addEventListener("click", goNext);
      actionsEl.querySelector(".ob-back")?.addEventListener("click", goBack);
      actionsEl.querySelector(".ob-skip")?.addEventListener("click", () => finish(false));
      actionsEl.querySelector(".ob-location")?.addEventListener("click", async () => {
        if (!hasTrackingConsent()) {
          const consented = await showTrackingConsent();
          if (!consented) {
            shouldRequestLocation = false;
            finish(false);
            return;
          }
        }
        shouldRequestLocation = true;
        // Continue to the compass step; the actual geolocation request happens
        // after onboarding so the map can still load in the background.
        goNext();
      });
      actionsEl.querySelector(".ob-location-skip")?.addEventListener("click", () => finish(false));
      actionsEl.querySelector(".ob-compass-enable")?.addEventListener("click", async () => {
        if (!canRequestCompassPermission()) {
          setImplicitCompassPermission();
          finish(shouldRequestLocation);
          return;
        }

        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          setCompassPermission(permission === "granted" ? "granted" : "denied");
          if (permission === "granted") {
            finish(shouldRequestLocation);
            return;
          }
        } catch {
          setCompassPermission("denied");
        }

        compassPromptFailed = true;
        renderProgress();
        renderStep("forward");
      });
      actionsEl.querySelector(".ob-compass-skip")?.addEventListener("click", () => finish(shouldRequestLocation));
      actionsEl.querySelector(".ob-compass-finish")?.addEventListener("click", () => {
        setImplicitCompassPermission();
        finish(shouldRequestLocation);
      });
    }

    function hasOnboardingState() {
      return typeof state !== "undefined" && state;
    }

    function setCompassPermission(permission) {
      if (hasOnboardingState()) {
        state.compassPermission = permission;
      }
    }

    function setImplicitCompassPermission() {
      if (typeof DeviceOrientationEvent !== "undefined" && !canRequestCompassPermission()) {
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

    function finish(requestLocation) {
      localStorage.setItem(ONBOARDING_KEY, "1");
      overlay.classList.add("fading-out");
      overlay.addEventListener("transitionend", () => {
        overlay.hidden = true;
        overlay.classList.remove("fading-out");
      }, { once: true });
      resolve({ filters: Array.from(selected), requestLocation });
    }

    renderProgress();
    renderStep("forward");
  });
}
