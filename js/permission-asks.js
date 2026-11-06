// Permission asks: every ask the app makes for the device (location, motion, notifications), moved here from
// app.js unchanged. Loaded before app.js, which boots the app.

// --- Permission asks -----------------------------------------------------------------------
// Every ask follows the same rules (spec.md "Permissions and consent"): the app asks in its own
// words first, and a system dialog only ever follows a tap on that ask; a "not now" is remembered,
// so no later launch puts a system prompt in front of someone who already refused. The first-visit
// card uses one explicit fast path for location and usage analytics; Settings remains the way to
// review or withdraw either choice later.

// "granted" (asked for location in the app), "declined" (said not now in the app, or refused the
// system dialog), or null (never asked).
function storedLocationChoice() {
  try {
    const stored = localStorage.getItem(LOCATION_CHOICE_KEY);
    if (stored === "granted" || stored === "declined") return stored;
    // Before the choice had a key of its own, the old bundled "Enable location" tap recorded
    // usage consent and nothing else -- read that as having asked for location.
    if (localStorage.getItem("ff-track-v1") === "1") return "granted";
  } catch {}
  return null;
}

function rememberLocationChoice(choice) {
  try { localStorage.setItem(LOCATION_CHOICE_KEY, choice); } catch {}
}

// Whether boot may request a position on its own. Only when that cannot put an unexplained system
// prompt on screen: the permission is already granted (it answers silently), or this person asked
// for location in the app before, so a browser that re-asks every session is answering their own
// request. A permission state of "unknown" counts as a prompt.
function bootMayRequestLocation(permission, choice) {
  if (permission === "granted") return true;
  if (permission === "denied") return false;
  return choice === "granted";
}

function locationInviteMessage() {
  const fallbackWalk = formatWalkingRadius(state.walkingDistanceMinutes);
  return `You're viewing finds within a ${fallbackWalk} walk of High Beach. Share your location for a more custom experience — centred on you, with real distances.`;
}

// Shown in place of an "Enable location" button that could not work: the permission is refused at
// the browser or OS level, where a request fails without ever asking.
function locationBlockedMessage() {
  return Native.isNative
    ? "Location is turned off for Epping Forest Finds. Turn it on in your phone's Settings to centre the map on you."
    : "Location is blocked for this site. Allow it in your browser's site settings to centre the map on you.";
}

// Boot reached here with no real GPS fix -- denied, timed out, unsupported, or skipped in
// onboarding. Every page, including a /nearby/<slug> landing page, gets a usable map straight
// away by standing in at DEFAULT_LOCATION (High Beach), with the same walking-radius-circle
// reveal a real fix gets (revealMapCenteredOnUser) -- a landing page already defaults its radius
// to 30 minutes (LANDING_PAGE_WALKING_DISTANCE_MINUTES, applyRadiusFromQuery), so this just gives
// it an origin to actually measure that radius from instead of listing the whole category
// unsorted. A dismissible, non-blocking invite (offerLocationInvite) nudges toward a real fix for
// the exact same view centred on the user -- skipped when this boot already asked (onboarding's
// own location step, or showConsentBanner's location stage) or this person said not now before.
//
// hasRealLocation() guards applyDefaultLocation() because this path and a real fix can
// genuinely race: showConsentBanner()'s own tap fires locateUser() independently of boot(), and
// the non-blocking loading bar no longer holds up clicks on that banner, so a fast tap can land a
// real fix before boot() reaches this fallback. Without the guard, that real fix was overwritten
// back to the High Beach stand-in the moment boot() got here.
async function revealNoRealLocation({ locationAlreadyAsked, deferLocationInvite = false, locationBlocked = false }) {
  if (!hasRealLocation()) applyDefaultLocation();

  if (!findLandingSlug() && !communityScreenOpen()) selectOverview();
  // A static index's arrows point north until there is a bearing to rotate them by -- the default
  // origin applyDefaultLocation() just set. Only the arrows change; the list itself stays as drawn.
  if (_staticNearbyIndex) updateOverviewDirectionArrows();
  draw();
  if (!communityScreenOpen()) applySelectionFromHash();
  await revealMapCenteredOnUser();

  if (locationAlreadyAsked || deferLocationInvite) return;
  offerLocationInvite({ blocked: locationBlocked });
}

function offerLocationInvite({ blocked = false } = {}) {
  if (!Native.geolocation) {
    const fallbackWalk = formatWalkingRadius(state.walkingDistanceMinutes);
    showLocationInviteBanner(`This browser does not support location access, so you're viewing finds within a ${fallbackWalk} walk of High Beach instead.`, { canRequest: false });
  } else if (blocked) {
    showLocationInviteBanner(locationBlockedMessage(), { canRequest: false });
  } else {
    showLocationInviteBanner(locationInviteMessage(), { canRequest: true });
  }
}

// The permission prompts float over the map as their own layer. Inside the inspector they pushed
// the Nearby list down (the list is a scrolling panel) and, on phones, the transformed sheet would
// trap a fixed child. Boot moves them to <body> once, so they stay put whatever the panel shows.
function floatConsentPrompts() {
  for (const el of [els.consentBanner, els.locationInviteBanner]) {
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  }
}

function hideNoticeCard(banner, { collapse = false } = {}) {
  let finished = false;
  let hideTimer = null;
  let collapseTimer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (hideTimer) clearTimeout(hideTimer);
    if (collapseTimer) clearTimeout(collapseTimer);
    banner.removeEventListener("transitionend", onTransitionEnd);
    banner.hidden = true;
    banner.classList.remove("fading-out", "onboarding-collapsing", "onboarding-collapsed");
    banner.style.removeProperty("--consent-banner-height");
  };
  const onTransitionEnd = (event) => {
    if (event.target !== banner) return;
    if (collapse && event.propertyName !== "max-height") return;
    if (!collapse && event.propertyName !== "opacity") return;
    finish();
  };
  banner.addEventListener("transitionend", onTransitionEnd);
  if (collapse) {
    banner.classList.add("onboarding-collapsing");
    banner.style.setProperty("--consent-banner-height", `${banner.getBoundingClientRect().height}px`);
    void banner.offsetWidth;
    const reducedMotion = prefersReducedMotion();
    // Fade out first (opacity 0.32s in css/loading.css), pause 100ms, then shrink the space.
    const collapseDelay = reducedMotion ? 0 : 420;
    collapseTimer = setTimeout(() => banner.classList.add("onboarding-collapsed"), collapseDelay);
    hideTimer = setTimeout(finish, reducedMotion ? 160 : collapseDelay + 820);
  }
  banner.classList.add("fading-out");
  if (!collapse) hideTimer = setTimeout(finish, 420);
}

// Non-blocking "get a more custom experience" nudge shown after revealNoRealLocation() -- the
// map and Nearby list behind it are already usable, so this never covers the whole screen. Same
// floating treatment as showConsentBanner()'s own card, and never at the same time as it. With canRequest false (location blocked or unsupported)
// it explains instead of offering a button that could not work.
function showLocationInviteBanner(message, { canRequest = true, title = "Get a more custom experience", recordsChoice = true, onClose = null } = {}) {
  const banner = els.locationInviteBanner;
  if (!banner) return;
  if (els.consentBanner && !els.consentBanner.hidden) return;

  if (els.locationInviteTitle) els.locationInviteTitle.textContent = title;
  if (els.locationInviteMessage) els.locationInviteMessage.textContent = message;
  if (els.locationInviteButton) els.locationInviteButton.hidden = !canRequest;
  if (els.locationInviteDismiss) els.locationInviteDismiss.textContent = canRequest ? "Maybe later" : "OK";

  function cleanup() {
    els.locationInviteButton?.removeEventListener("click", onAccept);
    els.locationInviteDismiss?.removeEventListener("click", onDecline);
  }

  function onAccept() {
    cleanup();
    hideNoticeCard(banner);
    rememberLocationChoice("granted");
    locateUser({ initial: false });
  }

  function onDecline() {
    cleanup();
    if (recordsChoice) rememberLocationChoice("declined");
    hideNoticeCard(banner);
    if (onClose) onClose();
    if (canRequest) showHighBeachNotice();
  }

  els.locationInviteButton?.addEventListener("click", onAccept);
  els.locationInviteDismiss?.addEventListener("click", onDecline);

  banner.classList.remove("fading-out");
  banner.hidden = false;
}

// How long the "location is off" notice stays up after "Maybe later" before it clears on its own.
const HIGH_BEACH_NOTICE_MS = 60_000;

// Removes whichever card currently owns the floating #consentBanner: its timer and its button
// handlers. Every card calls this before it takes the banner, so a stale timer cannot hide a newer
// card and a stale "OK" cannot answer a question that is no longer on screen.
let consentCardTeardown = null;
function tearDownConsentCard() {
  const teardown = consentCardTeardown;
  consentCardTeardown = null;
  if (teardown) teardown();
}

// Said in the same floating card once location is refused: the map is set to High Beach, the same
// stand-in a failed request gets. It has one button and clears itself after a minute.
function showHighBeachNotice() {
  const banner = els.consentBanner;
  if (!banner) return;
  tearDownConsentCard();
  let timer = null;
  const dismiss = () => {
    tearDownConsentCard();
    hideNoticeCard(banner);
  };
  consentCardTeardown = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    els.consentBannerDecline?.removeEventListener("click", dismiss);
  };
  banner.setAttribute("aria-label", "Location is off");
  banner.classList.remove("onboarding-invite", "onboarding-attention", "fading-out");
  if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Location is off";
  if (els.consentBannerText) {
    els.consentBannerText.textContent = "We'll set your location as High Beach, so you can still browse finds around the forest. Turn location on any time in Settings.";
  }
  if (els.consentBannerDecline) {
    els.consentBannerDecline.textContent = "OK";
    els.consentBannerDecline.removeAttribute("aria-label");
    els.consentBannerDecline.removeAttribute("title");
    els.consentBannerDecline.addEventListener("click", dismiss);
  }
  if (els.consentBannerAccept) els.consentBannerAccept.hidden = true;
  if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = true;
  banner.hidden = false;
  timer = setTimeout(dismiss, HIGH_BEACH_NOTICE_MS);
}

// iPhone's motion access (needed for the 3D tilt and the compass) can only be requested from a tap.
// A returning visitor whose location is already allowed never meets the first card's tap, so once a
// real fix exists the same floating card offers one tap that turns 3D on. Nothing is asked by itself.
function showMotionPrompt() {
  const banner = els.consentBanner;
  if (!banner || !banner.hidden) return;
  if (!compassPermissionCanBeRequested() || state.compassPermission === "granted") return;
  if (!hasRealLocation()) return;
  try { if (localStorage.getItem(MOTION_CHOICE_KEY) === "declined") return; } catch {}
  if (els.locationInviteBanner && !els.locationInviteBanner.hidden) return;

  tearDownConsentCard();
  consentCardTeardown = () => {
    els.consentBannerAccept?.removeEventListener("click", onAccept);
    els.consentBannerDecline?.removeEventListener("click", onDecline);
  };
  function onAccept() {
    tearDownConsentCard();
    hideNoticeCard(banner);
    // Called straight from the tap so the system prompt is allowed.
    requestCompassPermissionIfNeeded({ fromGesture: true });
  }
  function onDecline() {
    tearDownConsentCard();
    try { localStorage.setItem(MOTION_CHOICE_KEY, "declined"); } catch {}
    hideNoticeCard(banner);
  }

  banner.setAttribute("aria-label", "Turn on 3D view");
  banner.classList.remove("onboarding-invite", "onboarding-attention", "fading-out");
  if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Turn on the 3D view";
  if (els.consentBannerText) {
    els.consentBannerText.textContent = "Tilt your phone up to see the forest in 3D. Your phone will ask once for motion access.";
  }
  if (els.consentBannerAccept) {
    els.consentBannerAccept.textContent = "Turn on 3D view";
    els.consentBannerAccept.hidden = false;
    els.consentBannerAccept.addEventListener("click", onAccept);
  }
  if (els.consentBannerDecline) {
    els.consentBannerDecline.textContent = "Maybe later";
    els.consentBannerDecline.removeAttribute("aria-label");
    els.consentBannerDecline.removeAttribute("title");
    els.consentBannerDecline.addEventListener("click", onDecline);
  }
  if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = true;
  banner.classList.remove("fading-out");
  banner.hidden = false;
}

// The first ask for anyone onboarding did not reach -- a first visit, a landing-page arrival, or a
// returning visitor with a question still unanswered. One non-blocking card in the inspector
// chrome (#consentBanner, app.html, css/loading.css) leaves the map fully usable underneath. On a
// first visit its single explicit action covers location and usage analytics, then offers the
// optional guided map setup in the same slot. Landing-page arrivals use the same combined action
// whenever both choices are still unanswered. On iOS the compass is asked from the same location
// tap (locateUser), because only a user gesture can ask for it.
function showConsentBanner({ askLocation = false, askAnalytics = false, offerOnboarding = false } = {}) {
  const banner = els.consentBanner;
  if (!banner || (!askLocation && !askAnalytics && !offerOnboarding)) return false;
  tearDownConsentCard();
  let stage = askLocation && askAnalytics ? "permissions" : askLocation ? "location" : askAnalytics ? "analytics" : "onboarding";
  let onboardingAttentionTimer = null;
  let onboardingAttentionFallbackTimer = null;
  let onboardingAttentionEndHandler = null;

  function clearOnboardingAttention() {
    if (onboardingAttentionTimer !== null) {
      clearTimeout(onboardingAttentionTimer);
      onboardingAttentionTimer = null;
    }
    if (onboardingAttentionFallbackTimer !== null) {
      clearTimeout(onboardingAttentionFallbackTimer);
      onboardingAttentionFallbackTimer = null;
    }
    if (onboardingAttentionEndHandler) {
      banner.removeEventListener("animationend", onboardingAttentionEndHandler);
      onboardingAttentionEndHandler = null;
    }
    banner.classList.remove("onboarding-attention");
  }

  function renderPermissionsStage() {
    banner.setAttribute("aria-label", "Location and usage analytics");
    banner.classList.remove("onboarding-invite");
    els.filterToggle?.classList.remove("filter-toggle-guidance");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Allow location & cookies";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = `Shows nearby finds, how far away they are and which way to walk, and helps us understand how people use this site — enabling covers both. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) {
      els.consentBannerDecline.textContent = "Maybe later";
      els.consentBannerDecline.removeAttribute("aria-label");
      els.consentBannerDecline.removeAttribute("title");
    }
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Enable location & cookies";
    if (els.consentBannerAccept) els.consentBannerAccept.hidden = false;
    if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = true;
  }

  function renderLocationStage() {
    banner.setAttribute("aria-label", "Location");
    banner.classList.remove("onboarding-invite");
    els.filterToggle?.classList.remove("filter-toggle-guidance");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "See what's near you";
    // Generated landing pages replace the shell's default paragraph with a lead that names the
    // category or place. Keep that useful server-rendered copy when the live page only needs the
    // location question; the first-run combined card supplies its own copy below.
    const pageSpecificCopy = els.consentBannerText
      && /^Enable location to get walking directions/.test(els.consentBannerText.textContent || "");
    if (els.consentBannerText && !pageSpecificCopy) {
      els.consentBannerText.innerHTML = `Enable location to centre the map on you and see real walking distances. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) {
      els.consentBannerDecline.textContent = "Maybe later";
      els.consentBannerDecline.removeAttribute("aria-label");
      els.consentBannerDecline.removeAttribute("title");
    }
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Enable location";
    if (els.consentBannerAccept) els.consentBannerAccept.hidden = false;
    if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = true;
  }

  function renderAnalyticsStage() {
    banner.setAttribute("aria-label", "Usage analytics");
    banner.classList.remove("onboarding-invite");
    els.filterToggle?.classList.remove("filter-toggle-guidance");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Help improve the map?";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = `Share anonymous usage data — which screens you use and where you are while the app is open — and allow Google Analytics cookies. It is never sold or used for advertising. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) {
      els.consentBannerDecline.textContent = "No thanks";
      els.consentBannerDecline.removeAttribute("aria-label");
      els.consentBannerDecline.removeAttribute("title");
    }
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Share usage data";
    if (els.consentBannerAccept) els.consentBannerAccept.hidden = false;
    if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = true;
  }

  function renderOnboardingStage() {
    banner.setAttribute("aria-label", "Map setup");
    banner.classList.add("onboarding-invite");
    els.filterToggle?.classList.add("filter-toggle-guidance");
    // The invitation itself counts as the one-time first-run nudge. Its explicit close and the
    // automatic fade use the same value, so a reload cannot show the notice again.
    try { localStorage.setItem("forest-finds-onboarding-v1", "declined"); } catch {}
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Choose what you see";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = "Tap the layers button below to pick what shows on the map and in Nearby.";
    }
    if (els.consentBannerDecline) {
      els.consentBannerDecline.textContent = "×";
      els.consentBannerDecline.setAttribute("aria-label", "Dismiss map setup hint");
      els.consentBannerDecline.title = "Dismiss map setup hint";
    }
    if (els.consentBannerAccept) els.consentBannerAccept.hidden = true;
    if (els.consentBannerMapSetupArrow) els.consentBannerMapSetupArrow.hidden = false;
    clearOnboardingAttention();
    onboardingAttentionTimer = setTimeout(() => {
      onboardingAttentionTimer = null;
      if (stage !== "onboarding" || banner.hidden) return;
      banner.classList.add("onboarding-attention");
      const finishAttention = () => {
        clearOnboardingAttention();
        if (typeof pulseFilterSetupButton === "function") pulseFilterSetupButton();
        cleanup();
        hideNoticeCard(banner, { collapse: true });
      };
      onboardingAttentionEndHandler = finishAttention;
      banner.addEventListener("animationend", finishAttention, { once: true });
      onboardingAttentionFallbackTimer = setTimeout(finishAttention, 900);
    }, 20_000);
  }

  function cleanup() {
    clearOnboardingAttention();
    els.filterToggle?.classList.remove("filter-toggle-guidance");
    els.consentBannerAccept?.removeEventListener("click", onAccept);
    els.consentBannerDecline?.removeEventListener("click", onDecline);
  }

  function advance() {
    if (offerOnboarding && (stage === "permissions" || stage === "location" || stage === "analytics")) {
      stage = "onboarding";
      renderOnboardingStage();
      return;
    }
    if (stage === "location" && askAnalytics && analyticsChoice() === "undecided") {
      stage = "analytics";
      renderAnalyticsStage();
      return;
    }
    cleanup();
    hideNoticeCard(banner);
  }

  function onAccept() {
    if (stage === "permissions") {
      rememberLocationChoice("granted");
      if (analyticsChoice() === "undecided") setAnalyticsConsent(true);
      locateUser({ initial: false });
    } else if (stage === "location") {
      rememberLocationChoice("granted");
      locateUser({ initial: false });
    } else if (stage === "analytics") {
      setAnalyticsConsent(true);
    } else {
      cleanup();
      banner.classList.remove("fading-out");
      banner.hidden = true;
      showOnboarding().then((onboardResult) => {
        state.overviewFilters = sanitizeOverviewFilters(onboardResult.filters);
        saveFilterState();
        updateFilterUi();
        if (isOverviewScreenActive()) selectOverview();
        requestDraw();
      });
      return;
    }
    advance();
  }

  function onDecline() {
    if (stage === "permissions") {
      rememberLocationChoice("declined");
      if (analyticsChoice() === "undecided") setAnalyticsConsent(false);
    } else if (stage === "location") rememberLocationChoice("declined");
    else if (stage === "analytics") setAnalyticsConsent(false);
    else {
      cleanup();
      banner.classList.remove("fading-out");
      banner.hidden = true;
      try { localStorage.setItem("forest-finds-onboarding-v1", "declined"); } catch {}
      return;
    }
    // Refusing location is explained in place rather than passed over: the map carries on around
    // High Beach, and the notice clears itself after a minute. Guided setup is not offered after
    // it, so the one question is not followed by another card; Map setup stays on the toolbar.
    if (stage === "permissions" || stage === "location") {
      cleanup();
      if (offerOnboarding) {
        try { localStorage.setItem("forest-finds-onboarding-v1", "declined"); } catch {}
      }
      showHighBeachNotice();
      return;
    }
    advance();
  }

  els.consentBannerAccept?.addEventListener("click", onAccept);
  els.consentBannerDecline?.addEventListener("click", onDecline);

  if (stage === "permissions") renderPermissionsStage();
  else if (stage === "location") renderLocationStage();
  else if (stage === "analytics") renderAnalyticsStage();
  else renderOnboardingStage();
  banner.classList.remove("fading-out");
  banner.hidden = false;
  return true;
}
