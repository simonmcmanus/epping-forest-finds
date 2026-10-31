// First-visit onboarding: a short guided filter setup.
// The same guided filter steps can also be opened later from Nearby in `filters` mode.
// Runs while map data loads in the background.

const ONBOARDING_KEY = "forest-finds-onboarding-v1";

const ONBOARDING_STEPS = [
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

function mapSetupIconMarkup() {
  return `<span class="onboarding-step-icon onboarding-map-setup-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 7 8.5-3.5L20.5 7 12 10.5 3.5 7Z"/><path d="m3.5 12 8.5 3.5 8.5-3.5"/><path d="m3.5 17 8.5 3.5 8.5-3.5"/></svg></span>`;
}

function mapSetupSelectionPreviewMarkup(selected) {
  const groups = FILTER_GROUPS.map((group) => {
    const shown = group.subfilters.filter((subfilter) => selected.has(subfilter.key)).length;
    return { ...group, shown, total: group.subfilters.length };
  });
  const selectedCount = groups.reduce((count, group) => count + group.shown, 0);
  return `
    <div class="onboarding-selection-card">
      <div class="onboarding-selection-heading">
        <span class="onboarding-selection-label">Currently set to</span>
        <span class="onboarding-selection-count">${selectedCount} shown</span>
      </div>
      <div class="onboarding-selection-preview" aria-label="Currently shown category groups">
      ${groups.map((group) => `
        <span class="onboarding-selection-item${group.shown ? "" : " is-empty"}"
          role="img"
          aria-label="${group.label}: ${group.shown} of ${group.total} categories shown"
          title="${group.label}: ${group.shown}/${group.total}">
          <span class="onboarding-selection-icon"><img src="data/icons/${group.icon}.png" alt=""></span>
          <span class="onboarding-selection-item-copy">
            <span class="onboarding-selection-item-label">${group.label}</span>
            <span class="onboarding-selection-item-group">${group.shown}/${group.total}</span>
          </span>
        </span>
      `).join("")}
      </div>
    </div>
  `;
}

function mapSetupHiddenCategoryCopy(selected) {
  const total = FILTER_GROUPS.reduce((count, group) => count + group.subfilters.length, 0);
  const hidden = Math.max(0, total - selected.size);
  if (!hidden) return "All categories are currently shown.";
  return `There ${hidden === 1 ? "is" : "are"} ${hidden} categor${hidden === 1 ? "y" : "ies"} not currently shown.`;
}
// Returns a Promise resolving to { filters: string[]|null, cancelled: boolean }.
function showOnboarding({ mode = "first-run" } = {}) {
  return new Promise((resolve) => {
    const filterSetupMode = mode === "filters";
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");

    const steps = filterSetupMode
      ? [{ type: "filter-intro" }, ...FILTER_GROUPS.map((g) => ({ type: "group", group: g }))]
      : ONBOARDING_STEPS;
    let stepIndex = 0;
    const total = steps.length;
    const startingFilters = filterSetupMode
      && typeof state !== "undefined"
      && state
      && Array.isArray(state.overviewFilters)
      ? state.overviewFilters
      : DEFAULT_OVERVIEW_FILTER_KEYS;
    const selected = new Set(sanitizeOverviewFilters(startingFilters));

    const onOverlayClick = (event) => {
      if (filterSetupMode && event.target === overlay) finish({ cancelled: true });
    };
    overlay.addEventListener("click", onOverlayClick);
    overlay.hidden = false;
    overlay.classList.toggle("filter-setup", filterSetupMode);
    overlay.classList.remove("opening");
    void overlay.offsetWidth;
    overlay.classList.add("opening");
    overlay._onboardingActive = true;
    const deactivateFocus = typeof activateModalFocus === "function"
      ? activateModalFocus(overlay, { onEscape: () => finish({ cancelled: true }) })
      : null;

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

      if (step.type === "filter-intro") {
        contentEl.innerHTML = `
          ${mapSetupIconMarkup()}
          <h2 class="onboarding-step-title">What would you like to see?</h2>
          <p class="onboarding-step-subtitle">You can customise what is shown in your Nearby list and on the map. ${mapSetupHiddenCategoryCopy(selected)}</p>
          ${mapSetupSelectionPreviewMarkup(selected)}
        `;
        actionsEl.innerHTML = `
          <button class="button ob-primary" type="button">Make changes</button>
          <button class="onboarding-skip-btn ob-cancel" type="button">No changes</button>
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
        const isLast = stepIndex === total - 1;
        contentEl.innerHTML = `
          <img class="onboarding-step-icon" src="data/icons/${group.icon}.png" alt="">
          <h2 class="onboarding-step-title">${group.label}</h2>
          <p class="onboarding-step-subtitle">Tap to toggle what you'd like to see on the map.</p>
          <div class="onboarding-chips">${chips}</div>
        `;
        actionsEl.innerHTML = `
          <div class="onboarding-nav">
            <button class="button ob-back" type="button">← Back</button>
            <button class="button ob-next" type="button">${isLast ? "Done" : "Next"}</button>
          </div>
          <button class="onboarding-skip-btn ${filterSetupMode ? "ob-cancel" : "ob-skip"}" type="button">${filterSetupMode ? "Cancel changes" : (!isLast ? "Skip remaining" : "")}</button>
        `;
        if (isLast && !filterSetupMode) actionsEl.querySelector(".ob-cancel")?.remove();
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
      overlay.removeEventListener("click", onOverlayClick);
      overlay.classList.remove("opening");
      overlay.classList.add("fading-out");
      let hideTimer;
      const hide = () => {
        clearTimeout(hideTimer);
        overlay.hidden = true;
        overlay._onboardingActive = false;
        overlay.classList.remove("filter-setup");
        overlay.classList.remove("opening");
        overlay.classList.remove("fading-out");
      };
      overlay.addEventListener("transitionend", hide, { once: true });
      hideTimer = setTimeout(hide, 450);
      resolve({ filters: cancelled ? null : Array.from(selected), cancelled });
    }

    renderProgress();
    renderStep("forward");
  });
}
