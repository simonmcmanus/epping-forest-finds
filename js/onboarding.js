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
            <span class="onboarding-selection-item-group">(${group.shown}/${group.total})</span>
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

function onboardingReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Returns a Promise resolving to { filters: string[]|null, cancelled: boolean }.
function showOnboarding({ mode = "first-run" } = {}) {
  return new Promise((resolve) => {
    const filterSetupMode = mode === "filters";
    const overlay = document.getElementById("onboardingOverlay");
    const progressEl = overlay.querySelector(".onboarding-progress");
    const contentEl = overlay.querySelector(".onboarding-content");
    const actionsEl = overlay.querySelector(".onboarding-actions");
    const cardEl = overlay.querySelector(".onboarding-card");
    if (overlay._onboardingHideHandler) {
      overlay.removeEventListener("transitionend", overlay._onboardingHideHandler);
      overlay._onboardingHideHandler = null;
    }
    if (overlay._onboardingHideAnimationHandler && cardEl) {
      cardEl.removeEventListener("animationend", overlay._onboardingHideAnimationHandler);
      overlay._onboardingHideAnimationHandler = null;
    }
    if (overlay._onboardingHideTimer) {
      clearTimeout(overlay._onboardingHideTimer);
      overlay._onboardingHideTimer = null;
    }
    if (typeof overlay._onboardingResizeCleanup === "function") {
      overlay._onboardingResizeCleanup();
      overlay._onboardingResizeCleanup = null;
    }
    overlay.classList.remove("fading-out", "opening", "filter-intro");

    const steps = filterSetupMode
      ? [{ type: "filter-intro" }, ...FILTER_GROUPS.map((g) => ({ type: "group", group: g }))]
      : ONBOARDING_STEPS;
    let stepIndex = 0;
    const total = steps.length;
    let hasRenderedStep = false;
    let cardResizeFrame = null;
    let cardResizeEnd = null;
    const startingFilters = filterSetupMode
      && typeof state !== "undefined"
      && state
      && Array.isArray(state.overviewFilters)
      ? state.overviewFilters
      : DEFAULT_OVERVIEW_FILTER_KEYS;
    const selected = new Set(sanitizeOverviewFilters(startingFilters));
    let finished = false;

    function clearCardResize() {
      if (!cardEl) return;
      if (cardResizeFrame !== null) {
        cancelAnimationFrame(cardResizeFrame);
        cardResizeFrame = null;
      }
      if (cardResizeEnd) {
        cardEl.removeEventListener("transitionend", cardResizeEnd);
        cardResizeEnd = null;
      }
      cardEl.style.removeProperty("height");
    }

    function animateCardResize(previousHeight) {
      if (!cardEl) {
        hasRenderedStep = true;
        return;
      }
      const targetHeight = cardEl.getBoundingClientRect().height;
      if (!hasRenderedStep || onboardingReducedMotion() || Math.abs(targetHeight - previousHeight) < 1) {
        cardEl.style.removeProperty("height");
        hasRenderedStep = true;
        return;
      }

      cardEl.style.height = `${previousHeight}px`;
      cardResizeFrame = requestAnimationFrame(() => {
        cardResizeFrame = null;
        cardResizeEnd = (event) => {
          if (event.target !== cardEl || event.propertyName !== "height") return;
          cardEl.removeEventListener("transitionend", cardResizeEnd);
          cardResizeEnd = null;
          cardEl.style.removeProperty("height");
        };
        cardEl.addEventListener("transitionend", cardResizeEnd);
        cardEl.style.height = `${targetHeight}px`;
      });
      hasRenderedStep = true;
    }
    overlay._onboardingResizeCleanup = clearCardResize;

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
      ? activateModalFocus(overlay, filterSetupMode
        ? { onEscape: () => finish({ cancelled: true }) }
        : {})
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
      const previousCardHeight = hasRenderedStep && cardEl ? cardEl.getBoundingClientRect().height : null;
      overlay.classList.toggle("filter-intro", filterSetupMode && step.type === "filter-intro");
      preloadStepImages(stepIndex + 1);

      contentEl.classList.remove("entering-forward", "entering-backward");
      void contentEl.offsetWidth;
      contentEl.classList.add(direction === "back" ? "entering-backward" : "entering-forward");

      if (step.type === "filter-intro") {
        contentEl.innerHTML = `
          <div class="onboarding-step-heading">
            ${mapSetupIconMarkup()}
            <h2 class="onboarding-step-title">What would you like to see?</h2>
          </div>
          <p class="onboarding-step-subtitle">You can customise what is shown in your Nearby list and on the map. ${mapSetupHiddenCategoryCopy(selected)}</p>
          ${mapSetupSelectionPreviewMarkup(selected)}
        `;
        actionsEl.innerHTML = `
          <button class="button ob-primary" type="button">Choose categories</button>
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
        const isLast = stepIndex === total - 1;
        contentEl.innerHTML = `
          <div class="onboarding-step-heading">
            <img class="onboarding-step-icon" src="data/icons/${group.icon}.png" alt="">
            <h2 class="onboarding-step-title">${group.label}</h2>
          </div>
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
      if (previousCardHeight !== null) animateCardResize(previousCardHeight);
      else hasRenderedStep = true;
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
      if (finished) return;
      finished = true;
      if (!filterSetupMode) {
        try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch {}
      }
      if (deactivateFocus) deactivateFocus();
      overlay.removeEventListener("click", onOverlayClick);
      // Release the guard immediately so a keyboard activation or a route-driven reopen during
      // the fade can start a fresh modal. The next show clears the stale fade/mode classes first.
      overlay._onboardingActive = false;
      overlay.classList.remove("opening");
      overlay.classList.add("fading-out");
      let hideTimer = null;
      let overlayFaded = false;
      let cardFaded = !cardEl;
      const maybeHide = () => {
        if (overlayFaded && cardFaded) hide();
      };
      const onTransitionEnd = (event) => {
        if (event.target === overlay && event.propertyName === "opacity") {
          overlayFaded = true;
          maybeHide();
        }
      };
      const onAnimationEnd = (event) => {
        if (event.target === cardEl && event.animationName === "ob-card-out") {
          cardFaded = true;
          maybeHide();
        }
      };
      const hide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        clearCardResize();
        overlay._onboardingResizeCleanup = null;
        overlay.removeEventListener("transitionend", onTransitionEnd);
        if (cardEl) cardEl.removeEventListener("animationend", onAnimationEnd);
        overlay.hidden = true;
        overlay._onboardingActive = false;
        overlay._onboardingCancel = null;
        overlay._onboardingHideHandler = null;
        overlay._onboardingHideAnimationHandler = null;
        overlay._onboardingHideTimer = null;
        overlay.classList.remove("filter-setup");
        overlay.classList.remove("filter-intro");
        overlay.classList.remove("opening");
        overlay.classList.remove("fading-out");
      };
      overlay._onboardingHideHandler = onTransitionEnd;
      if (onboardingReducedMotion()) {
        hide();
      } else {
        overlay.addEventListener("transitionend", onTransitionEnd);
        if (cardEl) {
          cardEl.addEventListener("animationend", onAnimationEnd);
          overlay._onboardingHideAnimationHandler = onAnimationEnd;
        }
        hideTimer = setTimeout(hide, 520);
        overlay._onboardingHideTimer = hideTimer;
      }
      resolve({ filters: cancelled ? null : Array.from(selected), cancelled });
    }

    overlay._onboardingCancel = filterSetupMode ? () => finish({ cancelled: true }) : null;
    renderProgress();
    renderStep("forward");
  });
}

function dismissOnboarding() {
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay?.classList.contains("filter-setup")) return;
  if (typeof overlay._onboardingCancel === "function") {
    overlay._onboardingCancel();
    overlay._onboardingActive = false;
  }
}
