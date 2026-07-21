// First-visit onboarding: progressive filter selection + location and compass opt-in.
// Runs while map data loads in the background.

const ONBOARDING_KEY = "forest-finds-onboarding-v1";

const ONBOARDING_STEPS = [
  { type: "location" },
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
  return !!localStorage.getItem(ONBOARDING_KEY);
}

// Returns a Promise resolving to { filters: string[], locationPromise: Promise|null }
// locationPromise is a live geolocation request started the moment the user tapped
// "Enable location", so it runs concurrently with the rest of the data loading.
function showOnboarding() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");

    let stepIndex = 0;
    let compassPromptFailed = false;
    let locationPromise = null;
    const total = ONBOARDING_STEPS.length;
    const selected = new Set(["trees", "cows"]);

    overlay.hidden = false;

    function renderProgress() {
      progressEl.innerHTML = ONBOARDING_STEPS.map((_, i) => {
        const cls = i === stepIndex ? "active" : i < stepIndex ? "done" : "";
        return `<span class="onboarding-dot ${cls}"></span>`;
      }).join("");
    }

    function preloadStepImages(idx) {
      if (idx < 0 || idx >= ONBOARDING_STEPS.length) return;
      const s = ONBOARDING_STEPS[idx];
      const srcs = [];
      if (s.type === "welcome") srcs.push("data/icons/trees/logo.png");
      if (s.type === "location") srcs.push("data/icons/pin.png");
      if (s.type === "group") {
        srcs.push(`data/icons/${s.group.icon}.png`);
        s.group.subfilters.forEach((sf) => srcs.push(`data/icons/${sf.icon}.png`));
      }
      srcs.forEach((src) => { const img = new Image(); img.src = src; });
    }

    function renderStep(direction) {
      const step = ONBOARDING_STEPS[stepIndex];
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
        const needsCompassPrompt = canRequestCompassPermission();
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/pin.png" alt="">
          <h2 class="onboarding-step-title">Your location${needsCompassPrompt ? " & compass" : ""}</h2>
          <p class="onboarding-step-subtitle">Enable location to centre the map on you, see distances to each find, and get heading-up compass navigation.</p>
          <p class="onboarding-privacy-note">We collect anonymous usage data (GPS position, navigation, interactions) to improve the app. You can withdraw at any time via Settings → Privacy. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>
        `;
        actionsEl.innerHTML = `
          <button class="button ob-location" type="button">Enable${needsCompassPrompt ? " location &amp; compass" : " location"}</button>
          <button class="onboarding-skip-btn ob-location-skip" type="button">Skip for now</button>
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
      actionsEl.querySelector(".ob-next")?.addEventListener("click", goNext);
      actionsEl.querySelector(".ob-back")?.addEventListener("click", goBack);
      actionsEl.querySelector(".ob-skip")?.addEventListener("click", () => finish());
      actionsEl.querySelector(".ob-location")?.addEventListener("click", async () => {
        // Consent is given by tapping this button — privacy details are shown above.
        if (typeof setTrackingConsent === "function") setTrackingConsent(true);

        // Start location request — browser dialog fires from this tap.
        if (navigator.geolocation) {
          locationPromise = new Promise((res) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => res({ ok: true, position: pos }),
              () => res({ ok: false }),
              { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
          });
        }

        // Request compass in the same tap handler — iOS requires requestPermission()
        // to be called within a user-gesture call stack, which this still satisfies.
        if (canRequestCompassPermission()) {
          try {
            const permission = await DeviceOrientationEvent.requestPermission();
            setCompassPermission(permission === "granted" ? "granted" : "denied");
          } catch {
            setCompassPermission("denied");
          }
        } else {
          setImplicitCompassPermission();
        }

        finish();
      });
      actionsEl.querySelector(".ob-location-skip")?.addEventListener("click", () => {
        setImplicitCompassPermission();
        finish();
      });
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
      return typeof DeviceOrientationEvent !== "undefined" && !canRequestCompassPermission();
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
      localStorage.setItem(ONBOARDING_KEY, "1");
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
