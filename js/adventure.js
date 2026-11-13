// First-location adventure: offer one nearby veteran tree when Community is available. The
// challenge is intentionally local-first so the suggestion still works around the forest with a
// weak connection; the eventual tree check carries the adventure flag to the Community ledger.

const TREE_ADVENTURE_SEEN_KEY = "ff-tree-adventure-seen-v1";
const TREE_ADVENTURE_ACTIVE_KEY = "ff-tree-adventure-active-v1";
const TREE_ADVENTURE_REWARD = 10;
let treeAdventureRetryTimer = null;

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
  return match ? `${match[1]} years old` : null;
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

function treeAdventureTarget() {
  const nearest = state && state.nearestTree;
  if (!nearest || !nearest.tree || typeof communityTreeTarget !== "function") return null;
  const target = communityTreeTarget(nearest.tree);
  return target ? { ...nearest, target } : null;
}

function treeAdventureActiveTarget() {
  const active = treeAdventureRead(TREE_ADVENTURE_ACTIVE_KEY);
  return active && active.status !== "complete" ? active : null;
}

function treeAdventureDismiss() {
  const banner = els.adventureBanner;
  if (!banner) return;
  banner.classList.add("fading-out");
  window.setTimeout(() => {
    banner.hidden = true;
    banner.classList.remove("fading-out");
  }, prefersReducedMotion() ? 0 : 320);
}

function treeAdventureShow(tree, straightLineMetres) {
  const banner = els.adventureBanner;
  if (!banner || !tree || !hasRealLocation() || state.userLocation.isDefault) return;
  const walkMetres = treeAdventureWalkMetres(tree, straightLineMetres);
  const species = tree.commonName || "veteran tree";
  const age = treeAdventureAge(tree);
  const target = communityTreeTarget(tree);
  if (!target) return;

  els.adventureTitle.textContent = "Let’s go on an adventure";
  els.adventureMessage.textContent = `Take a ${treeAdventureWalkLabel(walkMetres)} to the nearest ${species}.`;
  els.adventureMeta.innerHTML = `${age ? `<span>${escapeHtml(age)}</span>` : ""}<span class="adventure-reward">Verify it for +${TREE_ADVENTURE_REWARD} points</span>`;
  treeAdventureWrite(TREE_ADVENTURE_ACTIVE_KEY, { target, shownAt: Date.now() });
  banner.hidden = false;
  banner.classList.remove("fading-out");

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
    if (!treeAdventureRetryTimer) treeAdventureRetryTimer = window.setTimeout(() => {
      treeAdventureRetryTimer = null;
      adventureMaybeShow();
    }, 1200);
    return;
  }
  if (typeof communityEnabled === "function" && !communityEnabled()) return;
  const overlay = document.getElementById("onboardingOverlay");
  if (overlay && (overlay._onboardingActive || !overlay.hidden)) {
    if (!treeAdventureRetryTimer) treeAdventureRetryTimer = window.setTimeout(() => {
      treeAdventureRetryTimer = null;
      adventureMaybeShow();
    }, 800);
    return;
  }
  if (els.consentBanner && !els.consentBanner.hidden) return;
  if (els.locationInviteBanner && !els.locationInviteBanner.hidden) return;
  const nearest = treeAdventureTarget();
  if (!nearest) return;
  try { localStorage.setItem(TREE_ADVENTURE_SEEN_KEY, "1"); } catch {}
  treeAdventureShow(nearest.tree, nearest.metres);
}

function treeAdventureTargetIsActive(target) {
  const active = treeAdventureActiveTarget();
  return Boolean(active && active.target === target);
}
