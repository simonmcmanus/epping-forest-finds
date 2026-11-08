// Epping Forest Finds — Nearby-event alert: the proximity check and the banner shown when a community event is close.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

function eventAlertEnabled() {
  // Matches the "no filters selected shows everything" rule the rest of the Nearby screen
  // follows -- an event alert should not fire for a category the user explicitly turned off.
  return state.overviewFilters.length === 0 || isSubfilterActive("events");
}

function checkEventProximityAlert(latitude, longitude, nowMs = Date.now()) {
  if (!els.eventNearbyBanner || !eventAlertEnabled()) return;
  if (!Array.isArray(state.landmarks) || !state.landmarks.length) return;
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  let nearest = null;
  let nearestMetres = Infinity;
  for (const place of state.landmarks) {
    if (!isEventCategory(place) || !isEventLive(place, nowMs)) continue;
    if (state.eventNearbyAlertedIds.has(place.id)) continue;
    const metres = distanceMetres(latitude, longitude, place.latitude, place.longitude);
    if (metres <= radiusMetres && metres < nearestMetres) {
      nearest = place;
      nearestMetres = metres;
    }
  }
  if (nearest) showEventNearbyBanner(nearest, nearestMetres);
}

function showEventNearbyBanner(event, metres) {
  if (!els.eventNearbyBanner) return;
  // Marked alerted immediately, not on dismiss -- lingering in range (or the next fix landing
  // before the user has reacted) must never re-show the same event a second time this session.
  state.eventNearbyAlertedIds.add(event.id);
  state.eventNearbyBannerEventId = event.id;
  if (els.eventNearbyBannerText) {
    const minutes = Math.max(1, Math.round(metres / walkingDistanceToMetres(1)));
    els.eventNearbyBannerText.textContent = `${event.name} is on now — ${minutes} min walk`;
  }
  els.eventNearbyBanner.classList.remove("fading-out");
  els.eventNearbyBanner.hidden = false;
}

function hideEventNearbyBanner() {
  if (!els.eventNearbyBanner) return;
  hideWithFade(els.eventNearbyBanner);
}

// Bound to the banner's own body (not just the dismiss "x") -- tapping the alert should open
// the event exactly as tapping it in the Nearby list would.
function openEventNearbyBanner() {
  const id = state.eventNearbyBannerEventId;
  hideEventNearbyBanner();
  if (!id) return;
  const event = Array.isArray(state.landmarks)
    ? state.landmarks.find((place) => isEventCategory(place) && place.id === id)
    : null;
  if (event) focusOverviewItem("landmark", placeHashKey(event));
}
