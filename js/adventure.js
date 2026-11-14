// First-location adventure: offer one nearby veteran tree when Community is available. The
// challenge is intentionally local-first so the suggestion still works around the forest with a
// weak connection; the eventual tree check carries the adventure flag to the Community ledger.

const TREE_ADVENTURE_SEEN_KEY = "ff-tree-adventure-seen-v1";
const TREE_ADVENTURE_ACTIVE_KEY = "ff-tree-adventure-active-v1";
const TREE_ADVENTURE_REWARD = 10;
let treeAdventureRetryTimer = null;
let treeAdventureTargetItem = null;
let treeAdventureArrowAngle = null;

function treeAdventureRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function treeAdventureWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function treeAdventureSeen() {
  try { return localStorage.getItem(TREE_ADVENTURE_SEEN_KEY) === "1"; } catch { return false; }
}

function treeAdventureAge(tree) {
  if (typeof estimateTreeAgeFromGirth !== "function") return null;
  const estimated = estimateTreeAgeFromGirth(tree);
  const match = estimated && String(estimated).match(/~(\d+) years/);
  return match ? match[1] : null;
}

function treeAdventureWalkMetres(tree, straightLineMetres) {
  if (typeof selectedRouteMetres === "function") {
    const routed = selectedRouteMetres(tree);
    if (Number.isFinite(routed)) return routed;
  }
  return straightLineMetres;
}

function treeAdventureWalkLabel(metres) {
  if (!Number.isFinite(metres)) return "A short walk";
  const minutes = Math.max(1, Math.round(metres / (5000 / 60)));
  return `${minutes} min walk`;
}

function treeAdventureTag(tree) {
  if (typeof treeTagLabel === "function") return treeTagLabel(tree);
  if (!tree || tree.tagNumber == null) return null;
  const tag = String(tree.tagNumber).trim();
  return tag && tag !== "0" ? tag : null;
}

function treeAdventureTarget() {
  if (!state || !state.userLocation || typeof communityTreeTarget !== "function") return null;
  const candidates = typeof nearestTreesTo === "function"
    ? nearestTreesTo(state.userLocation.latitude, state.userLocation.longitude, 50)
    : (state.nearestTree ? [state.nearestTree] : []);
  const nearest = candidates.find(({ tree }) => treeAdventureTag(tree)) || null;
  if (!nearest || !nearest.tree) return null;
  const target = communityTreeTarget(nearest.tree);
  return target ? { ...nearest, target } : null;
}

function treeAdventureActiveTarget() {
  const active = treeAdventureRead(TREE_ADVENTURE_ACTIVE_KEY);
  return active && active.status !== "complete" ? active : null;
}

function treeAdventureRetry(delay = 800) {
  if (treeAdventureRetryTimer) return;
  treeAdventureRetryTimer = window.setTimeout(() => {
    treeAdventureRetryTimer = null;
    adventureMaybeShow();
  }, delay);
}

function treeAdventureDismiss() {
  const banner = els.adventureBanner;
  if (!banner) return;
  banner.classList.add("fading-out");
  window.setTimeout(() => {
    banner.hidden = true;
    banner.classList.remove("fading-out");
    treeAdventureTargetItem = null;
    treeAdventureArrowAngle = null;
  }, prefersReducedMotion() ? 0 : 320);
}

// Keep the invitation's small arrow on the same projected ground plane as the map and the
// selected-location compass arrow. This makes it useful in 3D/heading-up mode instead of being
// a decorative, north-up glyph that disagrees with the direction the map is showing.
function updateTreeAdventureDirection() {
  const arrow = els.adventureDirection;
  const banner = els.adventureBanner;
  if (!arrow || !banner || banner.hidden || !treeAdventureTargetItem || !state.userLocation
      || state.userLocation.isDefault || typeof bearingDegrees !== "function"
      || typeof directionArrowTransform !== "function") {
    if (arrow) arrow.hidden = true;
    treeAdventureArrowAngle = null;
    return;
  }
  const target = communityTreeTarget(treeAdventureTargetItem);
  if (!target) {
    arrow.hidden = true;
    treeAdventureArrowAngle = null;
    return;
  }
  const bearing = bearingDegrees(
    state.userLocation.latitude,
    state.userLocation.longitude,
    target.latitude,
    target.longitude,
  );
  const relative = Number.isFinite(state.compassHeading)
    ? shortestCompassDelta(state.compassHeading, bearing)
    : bearing;
  const projected = typeof directionArrowAngleForWorldPoint === "function"
    ? directionArrowAngleForWorldPoint(target.point, relative, treeAdventureArrowAngle)
    : relative;
  const unwrapped = unwrapAngle(treeAdventureArrowAngle, projected);
  const tilted = typeof tiltActive === "function" && tiltActive();
  treeAdventureArrowAngle = tilted
    ? smoothDirectionArrowAngle(treeAdventureArrowAngle, unwrapped)
    : unwrapped;
  arrow.hidden = false;
  arrow.classList.toggle("adventure-direction--tilted", tilted);
  arrow.style.transform = directionArrowTransform(treeAdventureArrowAngle);
  arrow.setAttribute("aria-label", "Direction to the suggested tree");
}

function treeAdventureShow(tree, straightLineMetres) {
  const banner = els.adventureBanner;
  if (!banner || !tree || !hasRealLocation() || state.userLocation.isDefault) return;
  if (typeof communityNudgeDismiss === "function") communityNudgeDismiss();
  treeAdventureTargetItem = tree;
  treeAdventureArrowAngle = null;
  const walkMetres = treeAdventureWalkMetres(tree, straightLineMetres);
  const species = tree.commonName || "veteran tree";
  const age = treeAdventureAge(tree);
  const tag = treeAdventureTag(tree);
  const target = communityTreeTarget(tree);
  if (!target) return;

  els.adventureTitle.textContent = "Find the nearest veteran tree";
  els.adventureMessage.textContent = `Take a ${treeAdventureWalkLabel(walkMetres)} to this ${species}.`;
  if (els.adventureTag) {
    els.adventureTag.hidden = !tag;
    els.adventureTag.innerHTML = tag
      ? `<span>Look for this tag on the tree</span><strong>${escapeHtml(tag)}</strong>`
      : "";
  }
  els.adventureMeta.innerHTML = `${age ? `<span class="adventure-age"><small>Estimated age</small><strong>${escapeHtml(age)} years</strong></span>` : ""}<span class="adventure-reward">+${TREE_ADVENTURE_REWARD} points when verified</span>`;
  treeAdventureWrite(TREE_ADVENTURE_ACTIVE_KEY, { target, shownAt: Date.now() });
  banner.hidden = false;
  banner.classList.remove("fading-out");
  updateTreeAdventureDirection();

  const start = () => {
    treeAdventureDismiss();
    treeAdventureWrite(TREE_ADVENTURE_ACTIVE_KEY, { target, startedAt: Date.now() });
    if (typeof focusOverviewItem === "function") focusOverviewItem("tree", treeHashKey(tree));
  };
  const dismiss = () => {
    treeAdventureWrite(TREE_ADVENTURE_ACTIVE_KEY, { target, status: "dismissed", dismissedAt: Date.now() });
    treeAdventureDismiss();
  };
  els.adventureStart.onclick = start;
  els.adventureDismiss.onclick = dismiss;
}

function adventureMaybeShow() {
  if (treeAdventureSeen() || !hasRealLocation() || state.userLocation.isDefault || isFarFromForest() || !state.nearestTree) return;
  if (typeof communityFeaturesKnown === "function" && !communityFeaturesKnown()) {
    treeAdventureRetry(1200);
    return;
  }
  if (typeof communityEnabled === "function" && !communityEnabled()) return;
  const overlay = document.getElementById("onboardingOverlay");
  if (overlay && (overlay._onboardingActive || !overlay.hidden)) {
    treeAdventureRetry();
    return;
  }
  if (els.consentBanner && !els.consentBanner.hidden) {
    treeAdventureRetry();
    return;
  }
  if (els.locationInviteBanner && !els.locationInviteBanner.hidden) {
    treeAdventureRetry();
    return;
  }
  const nearest = treeAdventureTarget();
  if (!nearest) return;
  try { localStorage.setItem(TREE_ADVENTURE_SEEN_KEY, "1"); } catch {}
  treeAdventureShow(nearest.tree, nearest.metres);
}

function treeAdventureTargetIsActive(target) {
  const active = treeAdventureActiveTarget();
  return Boolean(active && active.target === target);
}
