// Community verification (see spec/spec-community.md): people confirm or question a tree, and the
// result is an annotation on top of the City of London data -- never an edit to it.
// A report shows for its author at once (local, optimistic); everyone else sees it after the daily
// server update (/api/community/overlay). Reports travel through the offline outbox (js/outbox.js).
const COMMUNITY_DEVICE_KEY = "ff-community-device-v1";
const COMMUNITY_LOCAL_KEY = "ff-community-local-v1";
const COMMUNITY_SCORE_KEY = "ff-community-score-v1";
const COMMUNITY_LOG_KEY = "ff-community-log-v1";
const COMMUNITY_REPORT_URL = "/api/community/report";
const COMMUNITY_OVERLAY_URL = "/api/community/overlay";
const COMMUNITY_ACCOUNT_KEY = "ff-community-account-v1";
const COMMUNITY_LINKED_KEY = "ff-community-linked-v1";
const COMMUNITY_ACCOUNT_DEVICES_KEY = "ff-community-account-devices-v1";
const COMMUNITY_OVERLAY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

// Line icons in the same style as the main nav (24px grid, 2px round stroke, currentColor).
const COMMUNITY_ICONS = {
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.3 2-2.3 3.4"/><path d="M12 17h.01"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M17.5 18a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 9.04 4.5 4.5 0 0 0 7 18"/><path d="M12 12v7m0-7-2.5 2.5M12 12l2.5 2.5"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 4 6c0 4 3 6 8 6Z"/><path d="M12 14c0-3 2.5-5 8-5 0 3.5-3 5-8 5Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15Z"/><path d="M5 19c2-5 5-8 9-10"/>',
  tree: '<path d="M12 21v-6"/><path d="M12 15a5.5 5.5 0 0 0 4-9.3A5 5 0 0 0 7.5 5 5 5 0 0 0 8 15Z"/>',
};

function communityIcon(name, className = "community-icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${COMMUNITY_ICONS[name] || ""}</svg>`;
}

// Shared reward vocabulary: a rank medal (one look per rank, drawn in CSS) and a gold "+N" points chip,
// the only gold on the check UI so that gold always means reward.
function communityMedalHtml(rank) {
  const tier = String((rank && rank.name) || "Seedling").toLowerCase().replace(/[^a-z]/g, "");
  return `<span class="community-medal community-medal-${tier}" aria-hidden="true">${communityIcon((rank && rank.icon) || "sprout", "community-icon community-medal-icon")}</span>`;
}

function communityPointsChipHtml(points, { upTo = false } = {}) {
  const n = Math.max(0, Math.floor(Number(points) || 0));
  return `<span class="community-points-chip${n ? "" : " is-zero"}">${upTo ? "up to " : ""}+${n}</span>`;
}

// `needsPosition` reports use the reporter's own GPS as the corrected / new spot.
const COMMUNITY_TREE_CHOICES = [
  { status: "VERIFIED", label: "Verify", hint: "The tree and tag match", icon: "check" },
  { status: "NO_TAG_LIKELY_SAME", label: "No tag", hint: "Looks right", icon: "tag" },
  { status: "NO_TAG_UNSURE", label: "No tag", hint: "Looks wrong", icon: "help" },
  { status: "DIFFERENT_TREE", label: "Different tree", hint: "Not the one shown", icon: "swap" },
  { status: "NOT_HERE", label: "No tree", hint: "Nothing here", icon: "cross" },
  { status: "MOVED", label: "Tag found", hint: "Map is wrong", icon: "locate", needsPosition: true },
];
const COMMUNITY_STATUS_TEXT = {
  VERIFIED: "Verified here",
  NO_TAG_LIKELY_SAME: "No tag found (looks right)",
  NO_TAG_UNSURE: "No tag found (doubtful)",
  DIFFERENT_TREE: "A different tree is here",
  NOT_HERE: "No tree found here",
  MOVED: "Tag found at a different spot",
  NEW_TREE: "Added from your location",
  FEEDBACK: "Feedback sent",
  OPEN_CONFIRMED: "Confirmed still right",
  CLOSED: "Reported closed",
  RENAMED: "Reported renamed",
  DETAILS_CHANGED: "Reported wrong details",
  WRONG_CATEGORY: "Reported wrong type",
  NEW_PLACE: "Reported a missing place",
};
const COMMUNITY_STATUS_ICON = {
  VERIFIED: "check",
  NO_TAG_LIKELY_SAME: "tag",
  NO_TAG_UNSURE: "help",
  DIFFERENT_TREE: "swap",
  NOT_HERE: "cross",
  MOVED: "locate",
  NEW_TREE: "plus",
  FEEDBACK: "edit",
  OPEN_CONFIRMED: "check",
  CLOSED: "cross",
  RENAMED: "tag",
  DETAILS_CHANGED: "edit",
  WRONG_CATEGORY: "swap",
  NEW_PLACE: "plus",
};

const COMMUNITY_RANKS = [
  { min: 0, name: "Seedling", icon: "sprout" },
  { min: 5, name: "Sapling", icon: "leaf" },
  { min: 20, name: "Woodward", icon: "tree" },
  { min: 50, name: "Warden", icon: "shield" },
];
const COMMUNITY_OUTCOME_TEXT = {
  waiting: "Waiting to send",
  pending: "Awaiting a second opinion",
  confirmed: "Confirmed by others",
  review: "Being reviewed",
  sent: "Sent for review",
  checked: "Checked",
  validated: "Confirmed by the City of London",
  fixed: "Fixed",
  far: "0 points: outside the 10 m check zone",
  failed: "Couldn't send",
};
const COMMUNITY_OUTCOME_ICON = { waiting: "upload", pending: "clock", confirmed: "check", review: "alert", sent: "check", checked: "check", validated: "shield", fixed: "check", far: "alert", failed: "alert" };

// Places (pubs, cafes, shops...): confirmations are a quiet check-in; any change is filed as a
// GitHub issue for a person to review -- never applied automatically.
const COMMUNITY_ISSUE_URL = "/.netlify/functions/report-missing-data";
const COMMUNITY_PLACE_CHOICES = [
  { status: "OPEN_CONFIRMED", label: "Confirm", hint: "Still here and correct", icon: "check" },
  { status: "CLOSED", label: "Closed", hint: "No longer open", icon: "cross", notePlaceholder: "Anything we should know? (optional)" },
  { status: "MOVED", label: "Moved", hint: "Different location", icon: "locate", notePlaceholder: "Where is it now? (optional)" },
  { status: "RENAMED", label: "Name changed", hint: "It has a new name", icon: "tag", noteRequired: true, notePlaceholder: "What is it called now?" },
  { status: "DETAILS_CHANGED", label: "Wrong details", hint: "Hours, phone, website…", icon: "edit", noteRequired: true, notePlaceholder: "What should it say? (hours, website, phone…)" },
  { status: "WRONG_CATEGORY", label: "Wrong type", hint: "Different kind of place", icon: "swap", notePlaceholder: "What type of place is it? (optional)" },
];

let communityOverlay = { generatedAt: 0, entries: {} };

function communityRandomId(length = 24) {
  const bytes = new Uint8Array(length);
  (window.crypto || crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

// Where this browser cannot keep an id (private window, blocked storage) a fresh one on every call would
// split one session across many identities, so the first one is kept for the life of the page.
let communityVolatileDeviceId = null;

// The id this browser made for itself the first time. Reports made before anyone signs in belong to it.
function communityPrimaryDeviceId() {
  try {
    const existing = localStorage.getItem(COMMUNITY_DEVICE_KEY);
    if (existing) return existing;
  } catch {}
  if (communityVolatileDeviceId) return communityVolatileDeviceId;
  const id = communityRandomId();
  let kept = false;
  try {
    localStorage.setItem(COMMUNITY_DEVICE_KEY, id);
    kept = localStorage.getItem(COMMUNITY_DEVICE_KEY) === id;
  } catch {}
  if (!kept) communityVolatileDeviceId = id;
  return id;
}

// One browser can be used by more than one person. Each signed-in account gets the device id it linked on
// this browser ({account hash: device id}); an account that finds the browser's own id already linked to
// someone else is given a new one (see communityRefreshAccountOnce), so two accounts never share a device
// id, a local history or a score.
// Mappings that could not be saved (blocked or full storage) are kept for the life of the page, and the account
// card says that this browser will not remember them.
let communityAccountDevicesMemory = {};
let communityAccountDevicesUnsaved = false;

function communityAccountDevices() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COMMUNITY_ACCOUNT_DEVICES_KEY)) || {}; } catch {}
  return { ...saved, ...communityAccountDevicesMemory };
}

function communitySaveAccountDevice(account, deviceId) {
  const devices = communityAccountDevices();
  devices[account] = deviceId;
  let kept = false;
  try {
    localStorage.setItem(COMMUNITY_ACCOUNT_DEVICES_KEY, JSON.stringify(devices));
    kept = (JSON.parse(localStorage.getItem(COMMUNITY_ACCOUNT_DEVICES_KEY)) || {})[account] === deviceId;
  } catch {}
  if (!kept) {
    communityAccountDevicesMemory[account] = deviceId;
    communityAccountDevicesUnsaved = true;
  }
}

// The id reports and score requests use right now: the signed-in account's own device id on this browser,
// otherwise the browser's primary one.
function communityDeviceId() {
  const primary = communityPrimaryDeviceId();
  const account = communityReadAccount();
  if (account && account.signedIn && account.account) {
    const own = communityAccountDevices()[account.account];
    if (own) return own;
  }
  return primary;
}

// --- Feature gate: Community is shown to the testers on the server's list (everyone while it is empty) ---
// The answer is kept on the device so the app works offline; until the first answer arrives it is off.
const COMMUNITY_FEATURES_KEY = "ff-features-v1";
let communityFeaturesMemory;

function communityFeatureCache() {
  if (communityFeaturesMemory !== undefined) return communityFeaturesMemory;
  try { return JSON.parse(localStorage.getItem(COMMUNITY_FEATURES_KEY)) || null; } catch { return null; }
}

function communityEnabled() {
  const cache = communityFeatureCache();
  return Boolean(cache && cache.community);
}

function communityFeaturesKnown() {
  return Boolean(communityFeatureCache());
}

// The short, non-secret name a tester gives the admin: a hash, so the device id (which is also the points
// recovery code) never has to be shared.
async function communityTesterId(value) {
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
  } catch { return ""; }
}

let communityFeaturesInflight = null;

function communityRefreshFeatures() {
  if (communityFeaturesInflight) return communityFeaturesInflight;
  communityFeaturesInflight = (async () => {
    try {
      if (!navigator.onLine) return communityEnabled();
      const id = await communityTesterId(communityPrimaryDeviceId());
      const response = await fetch(`/api/features?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!response.ok) return communityEnabled();
      const data = await response.json();
      communityFeaturesMemory = { community: Boolean(data && data.community), at: Date.now() };
      try { localStorage.setItem(COMMUNITY_FEATURES_KEY, JSON.stringify(communityFeaturesMemory)); } catch {}
      if (typeof applyFeatureGates === "function") applyFeatureGates();
    } catch {}
    return communityEnabled();
  })().finally(() => { communityFeaturesInflight = null; });
  return communityFeaturesInflight;
}

// Per-device storage: the primary device keeps the original keys, any other device id its own.
function communityScoped(key) {
  const id = communityDeviceId();
  return id === communityPrimaryDeviceId() ? key : `${key}:${id}`;
}

// False when the id only lives in this page (nothing was saved), so it is lost when the tab closes.
function communityDeviceIdIsDurable() {
  communityPrimaryDeviceId();
  return communityVolatileDeviceId === null;
}

function communityTreeTarget(tree) {
  const id = tree.recordNumber ?? tree.id;
  return id == null ? null : `tree:${id}`;
}

function communityReadLocal() {
  try { return JSON.parse(localStorage.getItem(communityScoped(COMMUNITY_LOCAL_KEY))) || {}; } catch { return {}; }
}

function communityWriteLocal(map) {
  try { localStorage.setItem(communityScoped(COMMUNITY_LOCAL_KEY), JSON.stringify(map)); } catch {}
}

// Always numbers, whatever was stored: the score comes from the network.
function communityReadScore() {
  try {
    const raw = JSON.parse(localStorage.getItem(communityScoped(COMMUNITY_SCORE_KEY)));
    if (!raw || typeof raw !== "object") return null;
    return { points: Number(raw.points) || 0, verified: Number(raw.verified) || 0, confirmed: Number(raw.confirmed) || 0, generatedAt: Number(raw.generatedAt) || 0 };
  } catch { return null; }
}

// Points the user has earned on this device that the server's score does not include yet. Only what
// is certain at the moment of reporting is counted (a verify, a new tree); corrections and second
// opinions pay out only when others agree, so they wait for the server. A report stops counting
// once a score computed after it (generatedAt) arrives, unless it is still in the outbox, because
// that score cannot have seen it. Reports made from too far away or refused never count.
// Mirrors POINTS in netlify/functions/lib/community-points.js (a unit test keeps them equal).
const COMMUNITY_POINTS = { verify: 1, newTree: 1 };

function communityPendingScore(local, generatedAt = 0, waitingIds = new Set()) {
  const pending = { points: 0, verified: 0 };
  for (const entry of Object.values(local || {})) {
    if (!entry || entry.counted || entry.far || entry.failed || entry.kind === "place" || entry.kind === "feedback") continue;
    if (!(Number(entry.ts) > generatedAt || waitingIds.has(entry.id))) continue;
    if (entry.status === "VERIFIED") {
      pending.points += COMMUNITY_POINTS.verify;
      pending.verified += 1;
    } else if (entry.status === "NEW_TREE") {
      pending.points += COMMUNITY_POINTS.newTree;
    }
  }
  return pending;
}

// --- Badges and streaks: derived on the device from the score and the local log, nothing stored ---
// Thresholds are the only configuration (documented in docs/community-points.md).
const COMMUNITY_BADGES = [
  { id: "first-check", name: "First check", icon: "check", metric: "verified", goal: 1, how: "Verify a tree from within 10 m.", test: (m) => m.verified >= 1 },
  { id: "ten-checks", name: "Ten checks", icon: "shield", metric: "verified", goal: 10, how: "Verify ten trees.", test: (m) => m.verified >= 10 },
  { id: "fifty-checks", name: "Fifty checks", icon: "shield", metric: "verified", goal: 50, how: "Verify fifty trees.", test: (m) => m.verified >= 50 },
  { id: "second-opinion", name: "Second opinion", icon: "swap", metric: "confirmed", goal: 1, how: "Have a check of yours confirmed by someone else.", test: (m) => m.confirmed >= 1 },
  { id: "tree-finder", name: "Tree finder", icon: "plus", metric: "treesAdded", goal: 1, how: "Add a tree that is missing from the map.", test: (m) => m.treesAdded >= 1 },
  { id: "place-spotter", name: "Place spotter", icon: "locate", metric: "placesReported", goal: 1, how: "Report a change to a place, or a missing one.", test: (m) => m.placesReported >= 1 },
  { id: "week-streak", name: "Week streak", icon: "clock", metric: "bestStreak", goal: 7, how: "Check or report something seven days in a row.", test: (m) => m.bestStreak >= 7 },
];

function communityLocalDay(ts) {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// Days in a row (local time) with at least one report on this device. The streak is still alive
// when the last report was yesterday, so it only breaks after a full day with nothing.
function communityStreaks(local, now = Date.now()) {
  const days = [...new Set(Object.values(local || {}).filter((e) => e && Number(e.ts) > 0 && !e.counted && e.kind !== "feedback").map((e) => communityLocalDay(e.ts)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i += 1) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const today = communityLocalDay(now);
  let current = 0;
  if (days.length && days[days.length - 1] >= today - 1) {
    current = 1;
    for (let i = days.length - 1; i > 0 && days[i - 1] === days[i] - 1; i -= 1) current += 1;
  }
  return { current, best };
}

function communityBadges(score, local, now = Date.now()) {
  const entries = Object.values(local || {}).filter(Boolean);
  const streaks = communityStreaks(local, now);
  const metrics = {
    verified: Number(score && score.verified) || 0,
    confirmed: Number(score && score.confirmed) || 0,
    treesAdded: entries.filter((e) => e.status === "NEW_TREE" && !e.far && !e.failed).length,
    placesReported: entries.filter((e) => e.kind === "place" && e.status !== "OPEN_CONFIRMED" && !e.failed).length,
    bestStreak: streaks.best,
  };
  return { earned: COMMUNITY_BADGES.filter((b) => b.test(metrics)), locked: COMMUNITY_BADGES.filter((b) => !b.test(metrics)), streak: streaks.current, metrics };
}

// The last seven days (oldest first, today last), each marked when this device made a report that day.
function communityWeekDays(local, now = Date.now()) {
  const reported = new Set(Object.values(local || {}).filter((e) => e && Number(e.ts) > 0 && !e.counted && e.kind !== "feedback").map((e) => communityLocalDay(e.ts)));
  const today = communityLocalDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const day = today - 6 + i;
    return { day, done: reported.has(day), today: day === today, label: new Date(now - (6 - i) * 86400000).toLocaleDateString("en-GB", { weekday: "short" }) };
  });
}

// Streaks are built and tested but switched off for now. Badges show only as small earned icons in the hero.
const COMMUNITY_GAMIFICATION_ON = false;

// Earned badges as icon-only chips beside the rank name; nothing at all when none are earned.
function communityBadgeChipsHtml(score, local) {
  const { earned } = communityBadges(score, local);
  if (!earned.length) return "";
  return `<span class="community-badge-chips" role="group" aria-label="Badges earned">${earned.map((b) => `<button type="button" class="community-badge-chip" data-action="community-badge" data-badge="${b.id}" aria-pressed="false" aria-label="${escapeHtml(b.name)}" title="${escapeHtml(b.name)}">${communityIcon(b.icon)}</button>`).join("")}</span>`;
}

// Progress towards a badge as { have, goal }, capped at the goal.
function communityBadgeProgress(badge, metrics) {
  return { have: Math.min(badge.goal, Number(metrics && metrics[badge.metric]) || 0), goal: badge.goal };
}

function communityBadgeDetailHtml(badge, metrics) {
  const { have, goal } = communityBadgeProgress(badge, metrics);
  const earned = have >= goal;
  return `<strong>${escapeHtml(badge.name)}${earned ? " · earned" : ""}</strong><span>${escapeHtml(badge.how)}${earned ? "" : ` You're at ${have} of ${goal}.`}</span>`;
}

// Tapping a badge explains how it is earned, in place under the scroller; tapping it again closes it.
function communityShowBadgeDetail(button) {
  const host = button.closest(".community-badges");
  const detail = host && host.querySelector(".community-badge-detail");
  const badge = COMMUNITY_BADGES.find((b) => b.id === button.dataset.badge);
  if (!detail || !badge) return;
  const open = button.getAttribute("aria-pressed") !== "true";
  host.querySelectorAll("[data-action='community-badge']").forEach((b) => b.setAttribute("aria-pressed", "false"));
  button.setAttribute("aria-pressed", String(open));
  detail.hidden = !open;
  if (open) {
    const local = communityReadLocal();
    const score = communityDisplayScore(communityReadScore(), local, new Set());
    detail.innerHTML = communityBadgeDetailHtml(badge, communityBadges(score, local).metrics);
  }
}

function communityDisplayScore(score, local, waitingIds) {
  const base = score || { points: 0, verified: 0, confirmed: 0, generatedAt: 0 };
  const pending = communityPendingScore(local, base.generatedAt || 0, waitingIds);
  return { ...base, points: base.points + pending.points, verified: base.verified + pending.verified, pendingPoints: pending.points };
}

// Builds, saves locally (optimistic) and queues one report. Resolves the stored local record.
async function communitySubmitReport({ kind = "tree", target, status, targetLat, targetLon, newLat, newLon, note, tagNumber, accuracy, photo }) {
  const here = typeof hasRealLocation === "function" && hasRealLocation() ? state.userLocation : null;
  const id = communityRandomId();
  const payload = {
    id,
    deviceId: communityDeviceId(),
    kind,
    target,
    status,
    targetLat,
    targetLon,
    lat: here ? Number(here.latitude.toFixed(6)) : undefined,
    lon: here ? Number(here.longitude.toFixed(6)) : undefined,
    newLat,
    newLon,
    note,
    tagNumber,
    accuracy,
    ...(photo ? { photo } : {}),
  };
  const local = communityReadLocal();
  const key = target || `new:${tagNumber || `${payload.lat},${payload.lon}`}`;
  const markLat = Number.isFinite(Number(targetLat)) ? Number(targetLat) : payload.lat;
  const markLon = Number.isFinite(Number(targetLon)) ? Number(targetLon) : payload.lon;
  // Made from too far away (or with no position), it is still saved, but it will not score.
  const far = kind === "tree" && Number.isFinite(Number(targetLat)) && Number.isFinite(Number(targetLon)) && communityRange(Number(targetLat), Number(targetLon)).state !== "near";
  local[key] = { id, status, ts: Date.now(), lat: markLat, lon: markLon, ...(far ? { far: true } : {}), ...(tagNumber ? { name: `Tree ${tagNumber}` } : {}) };
  communityWriteLocal(local);
  communityRefreshVerifiedSlots();
  // The local record above is what the screen shows; queueing (an IndexedDB write) can be slow, so it
  // never holds the optimistic state back.
  outboxAdd({ id, url: COMMUNITY_REPORT_URL, payload })
    .then(() => { if (navigator.onLine) outboxFlush(); })
    .catch(() => {});
  if (typeof requestDraw === "function") requestDraw();
  return local[key];
}

// --- "Help check this tree" on a tree's detail screen ---

function communityBadgeHtml(entry) {
  if (!entry) return "";
  if (entry.s === "questioned") {
    return `<div class="community-badge community-badge-questioned">${communityIcon("alert")}
        <p><strong>Questioned by the community</strong><span>${escapeHtml(COMMUNITY_STATUS_TEXT[entry.st] || "Needs checking")} (${escapeHtml(entry.n)} people). The official record is unchanged.</span></p></div>`;
  }
  return "";
}

// The verified marker for a tree sits in its top row, beside the walking-distance pill. Its detail
// opens in flow under that row when tapped (never over the page). Both are rendered into slots that
// communityRefreshVerifiedSlots() fills once the overlay arrives.
function communityVerifiedEntry(target) {
  const entry = target && communityOverlay.entries[target];
  const shared = entry && (entry.s === "verified" || entry.s === "confirmed") ? entry : null;
  const mine = target && communityReadLocal()[target];
  // A local report remains visible until the matching community status exists. The snapshot can
  // be newer than the report without containing it yet (for example, one report is not consensus).
  // A questioned/mixed server result still wins, so one local check cannot hide disagreement.
  // A recognised questioned entry is rendered by communityProblemEntry() first. For any other
  // stale or unfamiliar entry, keep the reporter's own optimistic confirmation visible.
  if (entry && !shared && entry.s === "questioned") return null;
  if (!mine || mine.status !== "VERIFIED") return shared;
  if (!shared) return { s: "verified", n: 1, optimistic: true };
  const pending = mine.ts > (communityOverlay.generatedAt || 0);
  return pending ? { ...shared, n: shared.n + 1, optimistic: true } : shared;
}

function communityProblemEntry(target) {
  const entry = target && communityOverlay.entries[target];
  const shared = entry && entry.s === "questioned" ? entry : null;
  const mine = target && communityReadLocal()[target];
  // Keep the reporter's own problem visible even after a newer snapshot that has not reached
  // consensus. If the server has a shared result, use its count and status.
  // A recognised verified entry is rendered by communityVerifiedEntry() after this check. For
  // any other stale or unfamiliar entry, keep the reporter's own optimistic problem visible.
  if (entry && !shared && (entry.s === "verified" || entry.s === "confirmed")) return null;
  if (!shared && mine && mine.status && mine.status !== "VERIFIED") {
    return { s: "questioned", st: mine.status, n: 1, optimistic: true };
  }
  return shared;
}

function communityVerifiedChipHtml(target) {
  const problem = communityProblemEntry(target);
  if (problem) {
    const label = problem.optimistic
      ? "You reported a problem with this tree"
      : `Problem reported by ${problem.n} ${problem.n === 1 ? "person" : "people"}`;
    return `<button type="button" class="community-verified-chip community-status-problem-chip" aria-expanded="false" aria-controls="communityVerifiedDetail" aria-label="${escapeHtml(label)}">${communityIcon("alert")}<strong>${escapeHtml(problem.n)}</strong></button>`;
  }
  const entry = communityVerifiedEntry(target);
  if (!entry) return "";
  const label = entry.optimistic
    ? "You verified this tree"
    : `Verified by ${entry.n} ${entry.n === 1 ? "person" : "people"}`;
  return `<button type="button" class="community-verified-chip" aria-expanded="false" aria-controls="communityVerifiedDetail" aria-label="${escapeHtml(label)}">${communityIcon("shield")}<strong>${escapeHtml(entry.n)}</strong></button>`;
}

function communityVerifiedDetailHtml(target) {
  const problem = communityProblemEntry(target);
  if (problem) {
    if (problem.optimistic) return `<p class="community-verified-detail" id="communityVerifiedDetail">Your problem report is saved. Other people will see it once the server has processed it.</p>`;
    const status = COMMUNITY_STATUS_TEXT[problem.st] || "a possible problem";
    return `<p class="community-verified-detail" id="communityVerifiedDetail">${escapeHtml(problem.n)} ${problem.n === 1 ? "person has" : "people have"} reported ${escapeHtml(status.toLowerCase())}. The official record is unchanged.</p>`;
  }
  const entry = communityVerifiedEntry(target);
  if (!entry) return "";
  if (entry.optimistic) return `<p class="community-verified-detail" id="communityVerifiedDetail">Your check is saved. It will count for the community once the server has processed it.</p>`;
  return `<p class="community-verified-detail" id="communityVerifiedDetail">${escapeHtml(entry.n)} ${entry.n === 1 ? "person has" : "people have"} confirmed this tree is where the map says it is. Community checks never change the official record.</p>`;
}

function communityVerifiedSlotsHtml(tree) {
  const target = communityTreeTarget(tree);
  if (!target || !communityEnabled()) return { chip: "", detail: "", pointer: "" };
  const hasCard = tree.latitude != null && tree.longitude != null;
  return {
    chip: `<span class="community-verified-slot" data-verified-target="${escapeHtml(target)}">${communityVerifiedChipHtml(target)}</span>`,
    detail: `<div class="community-verified-detail-slot" data-verified-target="${escapeHtml(target)}">${communityVerifiedDetailHtml(target)}</div>`,
    pointer: hasCard ? communityPointerSlotHtml(target, "tree", communityInitialTier(target, Number(tree.latitude), Number(tree.longitude), "tree")) : "",
  };
}

function communityRefreshVerifiedSlots() {
  // A tree detail can be rendered before the optimistic report has been written (or while the
  // feature gate is finishing). Keep the header slot in sync with the place flow so a newly
  // reported tree never leaves its status stranded in the check card.
  communityLiveAll(".community-check:not(.community-check-place)[data-community-target]").forEach((section) => {
    const target = section.dataset.communityTarget;
    if (!communityVerifiedChipHtml(target)) return;
    const detailHost = section.closest(".tree-detail") || section.parentElement;
    const topActions = detailHost && detailHost.querySelector(".detail-top-row .detail-top-actions");
    if (!topActions) return;
    let chipSlot = [...topActions.querySelectorAll(".community-verified-slot")]
      .find((slot) => slot.dataset.verifiedTarget === target);
    if (!chipSlot) {
      chipSlot = document.createElement("span");
      chipSlot.className = "community-verified-slot";
      chipSlot.dataset.verifiedTarget = target;
      const pointerSlot = topActions.querySelector(".community-pointer-slot");
      topActions.insertBefore(chipSlot, pointerSlot ? pointerSlot.nextSibling : topActions.firstChild);
    }
    let detailSlot = [...detailHost.querySelectorAll(".community-verified-detail-slot")]
      .find((slot) => slot.dataset.verifiedTarget === target);
    if (!detailSlot) {
      detailSlot = document.createElement("div");
      detailSlot.className = "community-verified-detail-slot";
      detailSlot.dataset.verifiedTarget = target;
      const usualSlot = detailHost.querySelector(".community-slot-usual");
      detailHost.insertBefore(detailSlot, usualSlot && usualSlot.parentElement === detailHost ? usualSlot : null);
    }
  });
  communityLiveAll(".community-verified-slot").forEach((slot) => {
    slot.innerHTML = communityVerifiedChipHtml(slot.dataset.verifiedTarget);
  });
  communityLiveAll(".community-verified-detail-slot").forEach((slot) => {
    slot.innerHTML = communityVerifiedDetailHtml(slot.dataset.verifiedTarget);
  });
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("click", (event) => {
    const chip = event.target && event.target.closest ? event.target.closest(".community-verified-chip") : null;
    if (!chip) return;
    const detail = chip.closest(".detail-top-row").parentElement.querySelector(".community-verified-detail-slot .community-verified-detail, .community-place-status-detail-slot .community-verified-detail");
    if (!detail) return;
    const open = chip.getAttribute("aria-expanded") !== "true";
    chip.setAttribute("aria-expanded", String(open));
    detail.classList.toggle("is-open", open);
  });
}

function communityChoiceHtml(choice, chosen) {
  const attrs = `data-action="community-report" data-status="${choice.status}"${choice.needsPosition ? ' data-needs-position="1"' : ""}`;
  const copy = `<span class="community-verify-copy"><strong>${escapeHtml(choice.label)}</strong>${choice.hint ? `<small>${escapeHtml(choice.hint)}</small>` : ""}</span>`;
  if (choice.status === "VERIFIED") {
    return `<button class="community-verify${chosen ? " is-chosen" : ""}" type="button" ${attrs}>${communityIcon(choice.icon, "community-icon community-verify-icon")}${copy}</button>`;
  }
  return `<button class="community-chip${chosen ? " is-chosen" : ""}" type="button" ${attrs}><span class="community-chip-icon">${communityIcon(choice.icon)}</span><span class="community-chip-label"><strong>${escapeHtml(choice.label)}</strong>${choice.hint ? `<small>${escapeHtml(choice.hint)}</small>` : ""}</span></button>`;
}

// "Something not right?" is a disclosure: the alternatives stay folded until asked for (or while changing an
// earlier answer), so the one-tap verify is the whole card at rest.
function communityMoreHtml(choicesHtml, open) {
  return `<button type="button" class="community-or community-more" data-action="community-more" aria-expanded="${open}"><span>Something not right?</span>${communityIcon("chevron")}</button>
      <div class="community-choices"${open ? "" : " hidden"}>${choicesHtml}</div>`;
}

function communityToggleMore(button) {
  const section = button.closest(".community-check");
  const choices = button.nextElementSibling;
  if (!section || !choices) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  choices.hidden = !open;
  if (open) section.dataset.more = "1"; else delete section.dataset.more;
  communitySchedulePresentation();
}

// How far the reader is from a tree, for the "you need to be close to earn points" note. A check only
// earns points when it is made within COMMUNITY_NEAR_METRES (the server's NEAR_METRES) of the tree, but
// reporting from anywhere is allowed.
const COMMUNITY_NEAR_METRES = 10;

function communityRange(lat, lon) {
  if (!(typeof hasRealLocation === "function" && hasRealLocation()) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { state: "none" };
  const here = communityFixLatLon();
  const metres = distanceMetres(here.latitude, here.longitude, lat, lon);
  return { state: metres <= COMMUNITY_NEAR_METRES ? "near" : "far", metres };
}

// Where the reader is for distance purposes. The You marker eases toward each fix (js/location-smoothing.js),
// so while it is still gliding the fix itself is the truer position and the card should not trail it.
function communityFixLatLon() {
  const raw = state.rawUserLocation;
  return state.locationGlide && raw && Number.isFinite(raw.latitude) && Number.isFinite(raw.longitude) ? raw : state.userLocation;
}

// The points a check earns, given where it was made (server rules: community-points.js). A verify
// earns 1 now and 1 more when someone else confirms; a "this is wrong" report earns 2 only if others
// agree; nothing counts from outside the zone.
function communityPointsText(status, rangeState) {
  if (rangeState !== "near") return "You'll get 0 points from this check";
  if (!status || status === "VERIFIED") return "You'll get 1 point from this check";
  return "You'll get up to 2 points from this check";
}

// The "+N" chip that goes with communityPointsText: what the check earns right now.
function communityPointsChipFor(status, rangeState) {
  if (rangeState !== "near") return communityPointsChipHtml(0);
  return !status || status === "VERIFIED" ? communityPointsChipHtml(1) : communityPointsChipHtml(2, { upTo: true });
}

function communityRangeNoteHtml(lat, lon, status) {
  const range = communityRange(lat, lon);
  // Outside the zone the note also carries the live distance. It is shown while approaching (the card
  // header says it already when the card is quiet) and patched in place on every fix.
  const distance = range.state === "far" ? `<span class="community-range-distance" data-community-distance="tree">${escapeHtml(communityDistanceText(range.metres, "tree"))}</span>` : "";
  return `<div class="community-range community-range-${range.state}" data-range-key="${range.state}|${status || ""}">${communityIcon(range.state === "near" ? "check" : "locate")}<div><strong>${escapeHtml(communityPointsText(status, range.state))}</strong>${distance}</div></div>`;
}

// Called with each GPS fix so the note follows the reader as they walk up to the tree. The note is only
// rebuilt when what it says changes (inside or outside the zone, or the points); the distance inside it
// is patched in place by communityPatchDistance.
function communityUpdateRangeNotes() {
  communityLiveAll(".community-check[data-community-target]").forEach((section) => {
    const note = section.querySelector(".community-range");
    if (!note || section.dataset.kind === "place") return;
    const chosen = section.querySelector(".is-chosen");
    const lat = Number(section.dataset.lat);
    const lon = Number(section.dataset.lon);
    const status = chosen ? chosen.dataset.status : null;
    const key = `${communityRange(lat, lon).state}|${status || ""}`;
    if (note.dataset.rangeKey !== key) note.outerHTML = communityRangeNoteHtml(lat, lon, status);
  });
}

// "You reported: ..." as one quiet line; the thank-you and points detail opens on demand.
function communityMineHtml(title, status) {
  const confirmed = status === "VERIFIED" || status === "OPEN_CONFIRMED";
  const icon = COMMUNITY_STATUS_ICON[status] || (confirmed ? "check" : "alert");
  const reviewNote = !confirmed && (status === "CLOSED" || status === "MOVED" || status === "RENAMED" || status === "DETAILS_CHANGED" || status === "WRONG_CATEGORY")
    ? "A person will review this"
    : "";
  const placeConfirmedNote = status === "OPEN_CONFIRMED" ? "You have verified this location" : "";
  return `<div class="community-mine community-mine-compact community-local-status${confirmed ? " community-local-status-confirmed" : " community-local-status-problem"}${status === "OPEN_CONFIRMED" ? " community-place-confirmed-marker" : ""}">
      <div class="community-place-status-summary"><span class="community-mine-icon">${communityIcon(icon)}</span><span class="community-place-status-copy"><strong>${placeConfirmedNote || "Your report"}</strong><small>You reported: ${escapeHtml(title)}</small>${reviewNote ? `<small>${reviewNote}</small>` : ""}</span></div>
      <button class="community-link" type="button" data-action="community-change">Change</button>
    </div>`;
}

function communitySectionInnerHtml(target, editing, lat, lon, more = false) {
  const local = communityReadLocal()[target];
  const remote = communityOverlay.entries[target];
  if (local && !editing) {
    return `${communityBadgeHtml(remote)}${communityMineHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status, local.status)}`;
  }
  const [primary, ...others] = COMMUNITY_TREE_CHOICES;
  const chosen = local ? local.status : null;
  return `${communityBadgeHtml(remote)}
      ${communityChoiceHtml(primary, chosen === primary.status)}
      ${communityMoreHtml(others.map((c) => communityChoiceHtml(c, chosen === c.status)).join(""), Boolean(local) || more)}
      ${communityRangeNoteHtml(lat, lon, chosen)}
      <p class="report-note community-status" aria-live="polite"></p>`;
}

// --- The check card by proximity ---
// A walker far from a tree or place sees a quiet one-line disclosure; approaching, the full card; at the
// location (tree 10 m, place 40 m) the card is promoted to the top of the detail. Exactly one of the two
// slots holds the card, and the other always holds a pointer to it while the check is unanswered: a chip
// in the top row when the card is lower down, a placeholder row in the usual slot when it is at the top.

const COMMUNITY_APPROACH_METRES = 150;        // inside this the quiet row opens out into the full card
const COMMUNITY_APPROACH_EXIT_METRES = 180;   // ...and it only goes quiet again beyond this
const COMMUNITY_PLACE_NEAR_METRES = 40;       // places are buildings, and GPS is poor beside them
const COMMUNITY_NEAR_EXIT_MARGIN_METRES = 8;  // once at the location, stay there until this much further out
const COMMUNITY_CARD_MOTION_MS = 280;
const COMMUNITY_CARD_EASE = "cubic-bezier(0.22, 0.8, 0.24, 1)";
const COMMUNITY_CARD_IDLE_MS = 8000;           // focus left on Verify by a tap stops blocking a move after this long untouched
const COMMUNITY_CARD_PRESS_QUIET_MS = 1500;   // a press on the card or its pointers freezes its position this long
const COMMUNITY_HINT_GAP_MS = 30000;          // the verify cue replays at most this often
const COMMUNITY_NUDGE_PULSE_MS = 2600;

function communityNearMetres(kind) {
  return kind === "place" ? COMMUNITY_PLACE_NEAR_METRES : COMMUNITY_NEAR_METRES;
}

// The tier of an unanswered check, with no DOM: "far", "approaching" or "near". `previous` is the tier
// last computed for this card (hysteresis, so GPS jitter at an edge cannot flap it); `metres` is the
// distance, or nothing when there is no real location. `accurate` is whether the fix is good enough to
// stand at a tree (the nudge's rule): without it a card is never promoted to near, but one already near
// stays near (only distance past the exit margin demotes it).
function communityProximityTier(previous, metres, kind = "tree", accurate = true) {
  if (!Number.isFinite(metres)) return "far";
  const near = communityNearMetres(kind);
  if (metres <= near) return accurate || previous === "near" ? "near" : "approaching";
  if (previous === "near" && metres <= near + COMMUNITY_NEAR_EXIT_MARGIN_METRES) return "near";
  const awake = previous === "near" || previous === "approaching";
  return metres <= (awake ? COMMUNITY_APPROACH_EXIT_METRES : COMMUNITY_APPROACH_METRES) ? "approaching" : "far";
}

function communityMetresTo(lat, lon) {
  const range = communityRange(lat, lon);
  return range.state === "none" ? null : range.metres;
}

// The tier a card opens in (no history yet); "" when the check is already answered.
function communityInitialTier(target, lat, lon, kind) {
  if (communityReadLocal()[target]) return "";
  return communityProximityTier("far", communityMetresTo(lat, lon), kind, communityCurrentFix().ok);
}

function communityDistanceText(metres, kind = "place") {
  if (!Number.isFinite(metres)) return "";
  const away = `${formatDistance(metres)} away`;
  return kind === "tree" ? `${away} \u00b7 get within ${COMMUNITY_NEAR_METRES} m for the point` : away;
}

// The supporting line of the far row. Verifying works from anywhere; only a tree's point needs closeness.
function communityQuietSub(metres, kind = "tree") {
  if (kind === "place") {
    return Number.isFinite(metres) ? `${formatDistance(metres)} away \u00b7 confirm it when you visit` : "Turn on location to see how far it is";
  }
  return Number.isFinite(metres) ? `${formatDistance(metres)} away \u00b7 points need you within ${COMMUNITY_NEAR_METRES} m` : "Turn on location to earn points";
}

// The small chip in the top row that leads to the card while it is lower down.
function communityPointerSlotHtml(target, kind, tier) {
  const shown = tier === "far" || tier === "approaching";
  const label = `Check this ${kind === "place" ? "place" : "tree"}: go to the check`;
  return `<span class="community-pointer-slot${shown ? " is-shown" : ""}" data-pointer-for="${escapeHtml(target)}"><span class="community-pointer-inner"><button type="button" class="community-check-pointer" data-action="community-goto-check" aria-label="${escapeHtml(label)}">${communityIcon("shield")}<span class="community-check-pointer-label">Check</span></button></span></span>`;
}

// The row left in the usual slot while the card is promoted: the far row's call to action, pointing up to the card.
function communityPlaceholderHtml(target, tier, kind = "tree") {
  const noun = kind === "place" ? "place" : "tree";
  return `<div class="community-placeholder${tier === "near" ? " is-shown" : ""}" data-placeholder-for="${escapeHtml(target)}"><div class="community-placeholder-inner"><button type="button" class="community-row-btn community-placeholder-btn" data-action="community-goto-check"><span class="community-head-icon">${communityIcon("shield")}</span><span class="community-quiet-copy"><strong class="community-quiet-title">Help check this ${noun}</strong><small>You're at the ${noun}</small></span>${communityIcon("chevron", "community-icon community-quiet-chevron")}</button></div></div>`;
}

function communityCardHtml({ kind, target, lat, lon, tier, reported, sectionClass = "", attrs = "", title, sub, body }) {
  const foldId = `communityFold-${String(target).replace(/[^a-z0-9]/gi, "")}`;
  const tierAttrs = tier ? ` data-tier="${tier}" data-tier-raw="${tier}"` : "";
  return `<section class="community-check${sectionClass}${reported ? " community-check-reported" : ""}"${attrs} data-community-target="${escapeHtml(target)}" data-lat="${escapeHtml(lat)}" data-lon="${escapeHtml(lon)}"${tierAttrs}>
      <button type="button" class="community-row-btn community-quiet-toggle" data-action="community-fold" aria-expanded="false" aria-controls="${foldId}">
        <span class="community-head-icon">${communityIcon("shield")}</span>
        <span class="community-quiet-copy"><strong class="community-quiet-title">${escapeHtml(title)}</strong><small data-community-sub>${escapeHtml(communityQuietSub(communityMetresTo(Number(lat), Number(lon)), kind))}</small></span>
        ${communityIcon("chevron", "community-icon community-quiet-chevron")}
      </button>
      <div class="community-head${reported ? " community-head-reported" : ""}">
        <span class="community-head-icon">${communityIcon("shield")}</span>
        <div><span class="community-here-cue">You're at the ${kind === "place" ? "place" : "tree"}</span><h3 class="community-title">${escapeHtml(title)}</h3><p class="community-sub">${escapeHtml(sub)}</p></div>
      </div>
      <div class="community-fold" id="${foldId}"><div class="community-fold-inner"><div class="community-body">${body}</div></div></div>
    </section>`;
}

// What a detail screen renders for one check: the card, its tier and where it goes. null when there is none.
function communityCardParts(kind, item) {
  if (!communityEnabled() || !item) return null;
  if (kind === "place") {
    if (!item.name || item.latitude == null || item.longitude == null) return null;
    const target = `place:${placeHashKey(item)}`;
    const tier = communityInitialTier(target, Number(item.latitude), Number(item.longitude), "place");
    const reported = Boolean(communityReadLocal()[target]);
    const category = item.categoryLabel || "Local place";
    return { target, tier, kind, html: communityCardHtml({
      kind, target, lat: item.latitude, lon: item.longitude, tier, reported,
      sectionClass: " community-check-place",
      attrs: ` data-kind="place" data-name="${escapeHtml(item.name)}" data-category="${escapeHtml(category)}" data-slug="${escapeHtml(item.findSlug || "")}"`,
      title: "Help check this place", sub: "Is this listing still right?",
      body: communityPlaceInnerHtml({ dataset: { communityTarget: target, lat: String(item.latitude), lon: String(item.longitude) } }),
    }) };
  }
  const target = communityTreeTarget(item);
  if (!target || item.latitude == null || item.longitude == null) return null;
  const tier = communityInitialTier(target, Number(item.latitude), Number(item.longitude), "tree");
  const reported = Boolean(communityReadLocal()[target]);
  return { target, tier, kind, html: communityCardHtml({
    kind, target, lat: item.latitude, lon: item.longitude, tier, reported,
    title: "Help check this tree", sub: "Is it where the map says it is?",
    body: communitySectionInnerHtml(target, false, Number(item.latitude), Number(item.longitude)),
  }) };
}

// The slot directly under the detail's top row, which holds the card once the walker is at the location.
function communityTopSlotHtml(item, kind = "tree") {
  const parts = communityCardParts(kind, item);
  if (!parts) return "";
  return `<div class="community-slot community-slot-top" data-community-slot="top">${parts.tier === "near" ? parts.html : ""}</div>`;
}

// The usual slot (above Nearest): the card, or a placeholder pointing to it when it is at the top.
function communityUsualSlotHtml(item, kind = "tree") {
  const parts = communityCardParts(kind, item);
  if (!parts) return "";
  return `<div class="community-slot community-slot-usual" data-community-slot="usual">${communityPlaceholderHtml(parts.target, parts.tier, kind)}${parts.tier === "near" ? "" : parts.html}</div>`;
}

// The block on a tree's detail screen (js/inspector.js showTreeDetails).
function communitySectionHtml(tree) {
  return communityUsualSlotHtml(tree, "tree");
}

// The panel slide clones the outgoing screen as an inert ghost (.inspector-screen-ghost). Nothing here ever
// reads or changes it: every document-wide scan goes through these.
function communityLiveAll(selector) {
  return [...document.querySelectorAll(selector)].filter((node) => !node.closest(".inspector-screen-ghost"));
}

function communityLive(selector) {
  return communityLiveAll(selector)[0] || null;
}

function communitySlideActive() {
  return document.querySelectorAll(".inspector-screen-ghost").length > 0;
}

function communityRefreshSections() {
  communityLiveAll(".community-check").forEach((section) => {
    const body = section.querySelector(".community-body");
    if (!body) return;
    const target = section.dataset.communityTarget;
    const editing = section.dataset.editing === "1";
    const reported = Boolean(communityReadLocal()[target]) && !editing;
    body.innerHTML = section.dataset.kind === "place"
      ? communityPlaceInnerHtml(section)
      : communitySectionInnerHtml(target, editing, Number(section.dataset.lat), Number(section.dataset.lon), section.dataset.more === "1");
    section.classList.toggle("community-check-reported", reported);
    section.querySelector(".community-head")?.classList.toggle("community-head-reported", reported);
  });
  communityUpdatePresentation();
}

function communityReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Never move or fold the card while it is being used. A change waits and is applied once it is idle.
// Focus on the card or on one of its pointers counts as use while it is real: keyboard focus, a field being
// typed in, or a pointer interaction within the last COMMUNITY_CARD_IDLE_MS. Focus a tap merely left on a
// button does not hold the card in place for ever.
function communityCardBusy(section, answered = false) {
  if (section.dataset.pending) return true;
  if (!answered && section.dataset.more === "1") return true;
  const now = Date.now();
  if (now - Number(section.dataset.pressAt || 0) < COMMUNITY_CARD_PRESS_QUIET_MS) return true;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  const article = section.closest(".tree-detail, .place-detail");
  const pointer = active.closest && active.closest("[data-action='community-goto-check']");
  if (!section.contains(active) && !(pointer && article && article.contains(pointer))) return false;
  if (active.matches && active.matches("input, textarea, select")) return true;
  let keyboard = false;
  try { keyboard = Boolean(active.matches && active.matches(":focus-visible")); } catch {}
  return keyboard || now - Number(section.dataset.touchAt || 0) < COMMUNITY_CARD_IDLE_MS;
}

// When a busy card is waiting: how long until a timed freeze (a press, or focus a tap left behind) ends, or
// -1 when only an event (focus leaving, the alternatives folding) can end it.
function communityBusyRetryDelay(section) {
  const now = Date.now();
  const press = COMMUNITY_CARD_PRESS_QUIET_MS - (now - Number(section.dataset.pressAt || 0));
  if (press > 0) return press + 50;
  const active = document.activeElement;
  if (active && active !== document.body && section.contains(active) && !(active.matches && active.matches("input, textarea, select"))) {
    const idle = COMMUNITY_CARD_IDLE_MS - (now - Number(section.dataset.touchAt || 0));
    if (idle > 0) return idle + 50;
  }
  return -1;
}

let communityPresentationTimer = null;
// The slide wait is capped: a ghost that never goes away must not stop the card from presenting.
const COMMUNITY_SLIDE_WAIT_MAX_MS = 600;
let communitySlideWaitSince = 0;
function communitySlideWaiting() {
  if (!communitySlideActive()) { communitySlideWaitSince = 0; return false; }
  if (!communitySlideWaitSince) communitySlideWaitSince = Date.now();
  if (Date.now() - communitySlideWaitSince > COMMUNITY_SLIDE_WAIT_MAX_MS) { communitySlideWaitSince = 0; return false; }
  return true;
}

// Re-run the presentation soon (a press window ended, focus left the card, the alternatives were folded).
function communitySchedulePresentation(delay = 0) {
  clearTimeout(communityPresentationTimer);
  communityPresentationTimer = setTimeout(communityUpdatePresentation, delay);
}

// Called with every GPS fix and after the card's own content changes. It does nothing when neither the tier
// nor the rounded distance changed, so a fix costs no layout.
function communityUpdatePresentation(local = communityReadLocal()) {
  if (typeof document === "undefined" || !document.querySelectorAll || !communityEnabled()) return;
  communityEnsureAnnouncer();
  // The incoming screen is still sliding in: presenting now would write scrollTop that the slide then resets.
  // Wait for the slide to end, then present once, so the move is one continuous motion with the right end state.
  if (communitySlideWaiting()) { communitySchedulePresentation(60); return; }
  const accurate = communityCurrentFix().ok;
  communityLiveAll(".community-check[data-community-target]").forEach((section) => communityPresentSection(section, local, accurate));
  communityWatchPointerRows();
  communityHintSync();
}

// The Check chip shows its label only while the top row still fits on one line; otherwise it is icon-only
// (same accessible name). Decided by probing the row with the chip fully open and its label showing, without
// transitions, so the answer does not depend on where the chip's own open/close animation is. It runs when the
// row is first seen, when its content changes (the distance pill, the verified chip) and when the width changes,
// not on a GPS fix that leaves the row unchanged.
function communityFitPointerRow(row) {
  const slot = row.querySelector(".community-pointer-slot");
  const pill = row.querySelector('[data-live-field="distance"]');
  const actions = row.querySelector(".detail-top-actions");
  if (!slot || !pill || !actions) return;
  const previous = slot.style.transition;
  slot.style.transition = "none";
  row.classList.remove("community-pointer-compact");
  row.classList.add("community-fit-probe");
  const empty = pill.getBoundingClientRect().height === 0;
  const wraps = !empty && actions.getBoundingClientRect().top >= pill.getBoundingClientRect().bottom - 0.5;
  row.classList.remove("community-fit-probe");
  row.classList.toggle("community-pointer-compact", wraps);
  row.getBoundingClientRect(); // settle the end state with transitions off, so nothing animates from the probe
  slot.style.transition = previous;
}

function communityWatchPointerRows() {
  communityLiveAll(".detail-top-row").forEach((row) => {
    if (row.dataset.pointerFit || !row.querySelector(".community-pointer-slot")) return;
    row.dataset.pointerFit = "1";
    communityFitPointerRow(row);
    if (typeof MutationObserver === "function") {
      new MutationObserver(() => requestAnimationFrame(() => { if (row.isConnected) communityFitPointerRow(row); }))
        .observe(row, { childList: true, characterData: true, subtree: true });
    }
  });
}

if (typeof window !== "undefined" && window.addEventListener) {
  let communityFitFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(communityFitFrame);
    communityFitFrame = requestAnimationFrame(() => communityLiveAll(".detail-top-row[data-pointer-fit]").forEach(communityFitPointerRow));
  });
}

function communityPatchDistance(section, metres) {
  section.querySelectorAll("[data-community-distance]").forEach((el) => {
    const text = communityDistanceText(metres, el.dataset.communityDistance === "tree" ? "tree" : "place");
    if (el.textContent !== text) el.textContent = text;
  });
  const sub = section.querySelector("[data-community-sub]");
  const quiet = communityQuietSub(metres, section.dataset.kind === "place" ? "place" : "tree");
  if (sub && sub.textContent !== quiet) sub.textContent = quiet;
}

function communityPresentSection(section, local = communityReadLocal(), accurate = communityCurrentFix().ok) {
  const target = section.dataset.communityTarget;
  const kind = section.dataset.kind === "place" ? "place" : "tree";
  const answered = Boolean(local[target]);
  const metres = communityMetresTo(Number(section.dataset.lat), Number(section.dataset.lon));
  communityPatchDistance(section, metres);
  let want = "";
  if (answered) delete section.dataset.tierRaw;
  else {
    want = communityProximityTier(section.dataset.tierRaw || "far", metres, kind, accurate);
    section.dataset.tierRaw = want;
  }
  const have = section.dataset.tier || "";
  if (want === "near") communityDismissNudgeFor(target); // the card itself is the prompt now
  if (want === have) {
    if (want === "near") communityAnnounceArrival(section, kind);
    return;
  }
  // Answering only removes the tier and the pointers: the summary stays where it is, so it is never held.
  if (!answered && communityCardBusy(section, answered)) {
    // Frozen while in use. Focus and the alternatives wake this up again; presses and idle focus are timed.
    const retry = communityBusyRetryDelay(section);
    if (retry >= 0) communitySchedulePresentation(retry);
    return;
  }
  communityApplyTier(section, want);
  if (want === "near") communityAnnounceArrival(section, kind);
}

// A nudge card about this target is redundant once its check card is promoted to the top.
function communityDismissNudgeFor(target) {
  const nudge = document.getElementById("communityNudge");
  if (nudge && nudge.dataset.communityTarget === target) communityNudgeDismiss();
}

function communityAnnounceArrival(section, kind) {
  if (section.dataset.announced) return;
  section.dataset.announced = "1";
  communityAnnounce(kind === "place" ? "You're at this place. You can confirm it now." : "You're at this tree. You can verify it now.");
}

let communityAnnounceTimer = null;

function communityEnsureAnnouncer() {
  let el = document.getElementById("communityAnnounce");
  if (!el && document.body) {
    el = document.createElement("div");
    el.id = "communityAnnounce";
    el.className = "community-announce";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

// The region already exists (empty) before the first message, and the text goes in on a later tick, so a
// screen reader that attached to the region late still reads it.
function communityAnnounce(text) {
  const el = communityEnsureAnnouncer();
  if (!el) return;
  clearTimeout(communityAnnounceTimer);
  el.textContent = "";
  communityAnnounceTimer = setTimeout(() => {
    el.textContent = text;
    communityAnnounceTimer = setTimeout(() => { el.textContent = ""; }, 8000);
  }, 60);
}

// Created empty at load, long before the first message.
if (typeof document !== "undefined" && typeof document.getElementById === "function" && typeof document.createElement === "function") {
  if (document.body) communityEnsureAnnouncer();
  else if (document.addEventListener) document.addEventListener("DOMContentLoaded", communityEnsureAnnouncer);
}

function communityCardSlot(article, name) {
  return article.querySelector(`[data-community-slot="${name}"]`);
}

// Elements whose position changes when the card moves slots: the detail's own blocks, but not the slots
// (they are empty or hold the card, which is animated itself).
function communityFlipTargets(article, section) {
  const out = [];
  const add = (el) => {
    if (el === section || el.classList.contains("community-slot") || el.querySelector(".community-slot")) return;
    out.push(el);
  };
  [...article.children].forEach(add);
  const facts = article.querySelector(":scope > .tree-facts");
  if (facts) [...facts.children].forEach(add);
  return out;
}

function communityScrollAnchor(targets, first, view, article, scroller) {
  // A reader at the very top has nothing to keep in place: the top row stays put and the card arrives under it.
  if (!view || !scroller || scroller.scrollTop <= 0) return null;
  const visible = targets.filter((el) => {
    const r = first.get(el);
    return r && r.height > 0 && r.bottom > view.top && r.top < view.bottom;
  });
  const usual = communityCardSlot(article, "usual");
  const after = visible.find((el) => usual && (usual.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  return after || visible[0] || null;
}

function communitySyncPointers(article, section, want) {
  const target = section.dataset.communityTarget;
  const own = (el) => el.dataset.pointerFor === target || el.dataset.placeholderFor === target;
  if (!article) return;
  const active = document.activeElement;
  const held = active && active.closest && active.closest(".community-pointer-slot, .community-placeholder");
  article.querySelectorAll(".community-pointer-slot").forEach((el) => { if (own(el)) el.classList.toggle("is-shown", want === "far" || want === "approaching"); });
  article.querySelectorAll(".community-placeholder").forEach((el) => { if (own(el)) el.classList.toggle("is-shown", want === "near"); });
  // A pointer being hidden never takes keyboard focus with it: it goes to the card's own button (or the
  // other pointer) instead.
  if (held && own(held) && !held.classList.contains("is-shown")) {
    const verify = want ? section.querySelector(".community-verify") : null;
    const other = article.querySelector(".community-pointer-slot.is-shown button, .community-placeholder.is-shown button");
    const to = (verify && verify.offsetParent !== null && verify) || other || section.querySelector(".community-change, [data-action='community-change']");
    if (to) to.focus({ preventScroll: true });
  }
}

function communityApplyTier(section, want) {
  communityHintSettle();
  const have = section.dataset.tier || "";
  const article = section.closest(".tree-detail, .place-detail");
  const toTop = want === "near";
  const slot = section.parentElement && section.parentElement.dataset.communitySlot;
  const destination = article && communityCardSlot(article, toTop ? "top" : "usual");
  // An answered card (want "") stays in whichever slot it is in until the detail is next rendered.
  const needsMove = Boolean(want) && Boolean(destination) && slot !== (toTop ? "top" : "usual");
  const unfolded = section.dataset.unfolded === "1";
  const opening = have === "far" && want !== "far" && !unfolded;
  const apply = () => {
    if (want) section.dataset.tier = want; else delete section.dataset.tier;
    if (needsMove) {
      // Moving a node drops focus from inside it; put it back where it was.
      const held = document.activeElement;
      const keep = held && held !== document.body && section.contains(held) ? held : null;
      destination.appendChild(section);
      if (keep && document.activeElement !== keep) keep.focus({ preventScroll: true });
    }
    communitySyncPointers(article, section, want);
  };
  const scroller = article && article.closest(".inspector-scroll");
  const view = scroller ? scroller.getBoundingClientRect() : null;
  if (!article || !section.isConnected || communityReducedMotion()) {
    communityRunInstant(article, apply);
    return;
  }
  const fadeIn = () => {
    if (!section.animate) return;
    if (opening) section.querySelector(".community-fold-inner")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: COMMUNITY_CARD_MOTION_MS, easing: COMMUNITY_CARD_EASE });
    if (needsMove && toTop) {
      article.querySelectorAll(".community-placeholder.is-shown .community-placeholder-btn").forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: COMMUNITY_CARD_MOTION_MS, easing: COMMUNITY_CARD_EASE }));
    }
  };
  if (needsMove) {
    communityFlip(article, section, scroller, view, apply);
    fadeIn();
    return;
  }
  // No slot change: the fold and pointers animate in CSS. A card entirely above the reader's position
  // changes at once instead, with the scroll position compensated, so what they are reading stays put.
  const placeholder = want ? null : article.querySelector(`.community-placeholder.is-shown[data-placeholder-for="${CSS.escape(section.dataset.communityTarget)}"]`);
  const before = (placeholder || section).getBoundingClientRect();
  if (view && before.bottom <= view.top) {
    const targets = communityFlipTargets(article, section);
    const first = new Map(targets.map((el) => [el, el.getBoundingClientRect()]));
    const anchor = communityScrollAnchor(targets, first, view, article, scroller);
    communityRunInstant(article, () => {
      apply();
      if (anchor) {
        const dy = anchor.getBoundingClientRect().top - first.get(anchor).top;
        if (Math.abs(dy) > 0.5) scroller.scrollTop += dy;
      }
    });
    return;
  }
  apply();
  fadeIn();
}

// Apply a change with every community transition switched off for this one frame, then restore them.
function communityRunInstant(article, change) {
  if (!article) { change(); return; }
  article.classList.add("community-instant");
  try {
    change();
    void article.offsetHeight;
  } finally {
    article.classList.remove("community-instant");
  }
}

// FLIP: measure, move the node, then play the difference back as a transform over COMMUNITY_CARD_MOTION_MS.
function communityFlip(article, section, scroller, view, apply) {
  const targets = communityFlipTargets(article, section);
  const first = new Map();
  targets.concat(section).forEach((el) => first.set(el, el.getBoundingClientRect()));
  const anchor = communityScrollAnchor(targets, first, view, article, scroller);
  const plays = [];
  article.classList.add("community-instant");
  try {
    apply();
    if (scroller && anchor) {
      const dy = anchor.getBoundingClientRect().top - first.get(anchor).top;
      if (Math.abs(dy) > 0.5) scroller.scrollTop += dy;
    }
    targets.concat(section).forEach((el) => {
      const a = first.get(el);
      const b = el.getBoundingClientRect();
      if (!a || (!a.width && !a.height) || (!b.width && !b.height)) return;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      if (view && ((a.bottom < view.top - 80 && b.bottom < view.top - 80) || (a.top > view.bottom + 80 && b.top > view.bottom + 80))) return;
      plays.push([el, dx, dy]);
    });
    void article.offsetHeight;
  } finally {
    article.classList.remove("community-instant");
  }
  plays.forEach(([el, dx, dy]) => {
    if (el.animate) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: COMMUNITY_CARD_MOTION_MS, easing: COMMUNITY_CARD_EASE });
  });
}

// --- Quiet row: fold / unfold, and the pointers back to the card ---

function communityToggleFold(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  if (open) section.dataset.unfolded = "1"; else delete section.dataset.unfolded;
}

function communityUnfold(section) {
  section.dataset.unfolded = "1";
  const toggle = section.querySelector(".community-quiet-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
}

function communityHighlight(section) {
  // Never alongside the nudge's pulse or the ring on Verify: the highlight takes over.
  section.classList.remove("community-nudge-pulse");
  section.querySelectorAll(".community-verify-hint").forEach((el) => el.classList.remove("community-verify-hint"));
  section.classList.remove("community-highlight");
  void section.offsetWidth;
  section.classList.add("community-highlight");
  const clear = () => section.classList.remove("community-highlight");
  section.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 1800);
}

// Focus a button that may have only just been unfolded: the fold is `visibility: hidden` until its style has
// been applied, which a forced style flush does; if the browser still refuses, try again on the next frames.
function communityFocusWhenReady(button, tries = 6) {
  if (!button) return;
  void button.offsetHeight;
  button.focus({ preventScroll: true });
  if (document.activeElement === button || tries <= 0 || typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => communityFocusWhenReady(button, tries - 1));
}

// The pointer chip and the placeholder: bring the card into view, open it if it is the quiet row, put
// focus on Verify/Confirm and highlight it briefly.
function communityGotoCheck(trigger, waited = 0) {
  // Not while the screen is still sliding in: the slide resets the scroll position at its end (waits at most ~600 ms).
  if (communitySlideActive() && waited < COMMUNITY_SLIDE_WAIT_MAX_MS) {
    setTimeout(() => { if (trigger.isConnected) communityGotoCheck(trigger, waited + 60); }, 60);
    return;
  }
  const article = trigger.closest(".tree-detail, .place-detail");
  const section = article && article.querySelector(".community-check");
  if (!section) return;
  section.dataset.pressAt = String(Date.now());
  section.dataset.touchAt = section.dataset.pressAt;
  if (section.dataset.tier === "far") communityUnfold(section);
  const scroller = section.closest(".inspector-scroll");
  if (scroller) {
    const view = scroller.getBoundingClientRect();
    const box = section.getBoundingClientRect();
    const top = Math.max(0, scroller.scrollTop + (box.top - view.top) - 12);
    scroller.scrollTo({ top, behavior: communityReducedMotion() ? "auto" : "smooth" });
  }
  communityFocusWhenReady(section.querySelector(".community-verify"));
  communityHighlight(section);
}

// --- The cue on Verify/Confirm when the walker is at the location and the button is on screen ---
// A soft ring pulse, about two cycles, then rest. It replays at most every COMMUNITY_HINT_GAP_MS and when the
// button comes back into view after being hidden; never while the card is in use, never once answered, and
// never alongside the nudge's pulse on the card (they share one quiet window).

const communityHint = { observer: null, section: null, button: null, visible: false, want: false, lastAt: 0, quietUntil: 0, notBefore: 0, settleTimer: null };

// While the card is mid-move its on-screen position is the animation's, not its real one. Wait it out, then
// look again (observing afresh makes the observer report the settled geometry).
function communityHintSettle() {
  communityHint.visible = false;
  communityHint.notBefore = Date.now() + COMMUNITY_CARD_MOTION_MS + 80;
  clearTimeout(communityHint.settleTimer);
  communityHint.settleTimer = setTimeout(() => {
    const { observer, button } = communityHint;
    if (!observer || !button || !button.isConnected) return;
    observer.unobserve(button);
    observer.observe(button);
  }, COMMUNITY_CARD_MOTION_MS + 100);
}

function communityHintPlaying() {
  return Boolean(communityHint.button && communityHint.button.classList.contains("community-verify-hint"));
}

function communityHintSync() {
  if (typeof IntersectionObserver === "undefined") return;
  const section = communityLive('.community-check[data-tier="near"]');
  const button = section ? section.querySelector(".community-verify") : null;
  if (button !== communityHint.button) {
    if (communityHint.observer) communityHint.observer.disconnect();
    communityHint.button = button;
    communityHint.visible = false;
    if (section !== communityHint.section) communityHint.want = Boolean(section);
    communityHint.section = section;
    if (button) {
      if (!communityHint.observer) {
        communityHint.observer = new IntersectionObserver((entries) => {
          if (Date.now() < communityHint.notBefore) return;
          const entry = entries[entries.length - 1];
          const visible = entry.isIntersecting && entry.intersectionRatio >= 0.6;
          if (visible && !communityHint.visible) communityHint.want = true;
          communityHint.visible = visible;
          communityHintMaybePlay();
        }, { threshold: [0, 0.6, 1] });
      }
      communityHint.observer.observe(button);
    }
  }
  communityHintMaybePlay();
}

function communityHintMaybePlay() {
  const { button } = communityHint;
  if (!communityHint.want || !communityHint.visible || !button || !button.isConnected || Date.now() < communityHint.notBefore) return;
  const section = button.closest(".community-check");
  if (!section || section.dataset.tier !== "near") return;
  if (communityReducedMotion()) { communityHint.want = false; return; }
  if (communityCardBusy(section)) return;
  if (section.classList.contains("community-highlight")) { communitySchedulePresentation(400); return; }
  const now = Date.now();
  if (now < communityHint.quietUntil || section.classList.contains("community-nudge-pulse")) {
    communitySchedulePresentation(Math.max(200, communityHint.quietUntil - now + 50));
    return;
  }
  communityHint.want = false;
  if (communityHint.lastAt && now - communityHint.lastAt < COMMUNITY_HINT_GAP_MS) return;
  communityHint.lastAt = now;
  button.dataset.hintPlays = String(Number(button.dataset.hintPlays || 0) + 1);
  button.classList.add("community-verify-hint");
  const rest = () => button.classList.remove("community-verify-hint");
  button.addEventListener("animationend", rest, { once: true });
  setTimeout(rest, 3600);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("click", (event) => {
    const el = event.target;
    if (!el || !el.closest) return;
    const fold = el.closest("[data-action='community-fold']");
    if (fold) { communityToggleFold(fold); return; }
    const go = el.closest("[data-action='community-goto-check']");
    if (go) communityGotoCheck(go);
  });
  // A press on the card or one of its pointers freezes the card where it is for a moment.
  document.addEventListener("pointerdown", (event) => {
    const el = event.target;
    if (!el || !el.closest) return;
    const pointer = el.closest("[data-action='community-goto-check']");
    const section = pointer
      ? (pointer.closest(".tree-detail, .place-detail") || document).querySelector(".community-check")
      : el.closest(".community-check");
    if (section) { section.dataset.pressAt = String(Date.now()); section.dataset.touchAt = section.dataset.pressAt; }
  }, true);
  // Keyboard use of the card or a pointer is the same kind of interaction as a press.
  document.addEventListener("keydown", (event) => {
    const el = event.target;
    if (!el || !el.closest) return;
    const pointer = el.closest("[data-action='community-goto-check']");
    const section = pointer
      ? (pointer.closest(".tree-detail, .place-detail") || document).querySelector(".community-check")
      : el.closest(".community-check");
    if (section) { section.dataset.pressAt = String(Date.now()); section.dataset.touchAt = section.dataset.pressAt; }
  }, true);
  document.addEventListener("focusout", (event) => {
    if (event.target && event.target.closest && event.target.closest(".community-check, [data-action='community-goto-check']")) communitySchedulePresentation();
  }, true);
}

// After an answer: focus follows to the summary's Change button when it was inside the card, and the
// saved message is announced once (the summary itself is not a live region).
function communityAnswered(section, hadFocus) {
  const entry = communityReadLocal()[section.dataset.communityTarget];
  if (hadFocus) {
    const change = section.querySelector("[data-action='community-change']");
    if (change) change.focus({ preventScroll: true });
  }
  if (entry) communityAnnounce(`Saved. You reported: ${COMMUNITY_STATUS_TEXT[entry.status] || entry.status}. Thanks for checking.`);
}

async function communityHandleChoice(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const hadFocus = section.contains(document.activeElement);
  const statusEl = section.querySelector(".community-status");
  const status = button.dataset.status;
  const target = section.dataset.communityTarget;
  const targetLat = Number(section.dataset.lat);
  const targetLon = Number(section.dataset.lon);
  let newLat;
  let newLon;
  if (button.dataset.needsPosition) {
    if (!(typeof hasRealLocation === "function" && hasRealLocation())) {
      if (statusEl) statusEl.textContent = "Turn on location and stand at the tag so we can record where it really is.";
      return;
    }
    const here = communityFixLatLon();
    newLat = Number(here.latitude.toFixed(6));
    newLon = Number(here.longitude.toFixed(6));
  }
  await communitySubmitReport({ kind: "tree", target, status, targetLat, targetLon, newLat, newLon });
  delete section.dataset.editing;
  communityRefreshSections();
  communityRefreshVerifiedSlots();
  communityAnswered(section, hadFocus);
}

function communityHandleChange(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  section.dataset.editing = "1";
  const hadFocus = section.contains(document.activeElement);
  communityRefreshSections();
  if (hadFocus) communityFocusWhenReady(section.querySelector(".is-chosen") || section.querySelector(".community-verify"));
}

let communityOverlayInflight = null;
let communityOverlayRefreshBound = false;

function communityApplyOverlay(data) {
  if (!data || typeof data.entries !== "object") return;
  communityOverlay = { generatedAt: data.generatedAt || 0, entries: data.entries };
  communityRefreshSections();
  communityRefreshVerifiedSlots();
  if (typeof requestDraw === "function") requestDraw();
}

function communityLoadOverlay() {
  if (communityOverlayInflight) return communityOverlayInflight;
  communityOverlayInflight = (async () => {
    try {
      const response = await fetch(COMMUNITY_OVERLAY_URL);
      if (!response.ok) return;
      const data = await response.json();
      communityApplyOverlay(data);
    } catch {}
  })().finally(() => { communityOverlayInflight = null; });
  return communityOverlayInflight;
}

// A shared #addedtree=<tag> link can only be resolved once the overlay is here, so boot waits for it
// (bounded: a slow or missing overlay must never hold up the map).
async function communityEnsureOverlay(timeoutMs = 4000) {
  if (communityOverlay.generatedAt) return;
  await Promise.race([communityLoadOverlay(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function setupCommunityOverlayRefresh() {
  if (communityOverlayRefreshBound) return;
  communityOverlayRefreshBound = true;
  const refreshWhenVisible = () => {
    if (document.visibilityState !== "hidden" && navigator.onLine) communityLoadOverlay();
  };
  document.addEventListener("visibilitychange", refreshWhenVisible);
  window.addEventListener("online", refreshWhenVisible);
  setInterval(refreshWhenVisible, COMMUNITY_OVERLAY_REFRESH_INTERVAL_MS);
}

// The score is kept on the device; opening the app only re-asks the server if it is over an hour
// old. Sending a report and opening the Community screen always refresh it (force).
const COMMUNITY_SCORE_AT_KEY = "ff-community-score-at-v1";
const COMMUNITY_SCORE_MAX_AGE_MS = 60 * 60 * 1000;

async function communityRefreshScore(force = true) {
  if (!navigator.onLine) return;
  if (!(await communityWhenIdentityKnown())) return;
  try {
    if (!force) {
      const at = Number(localStorage.getItem(communityScoped(COMMUNITY_SCORE_AT_KEY))) || 0;
      if (Date.now() - at < COMMUNITY_SCORE_MAX_AGE_MS) return;
    }
    localStorage.setItem(communityScoped(COMMUNITY_SCORE_AT_KEY), String(Date.now()));
    const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(communityDeviceId())}`);
    if (!response.ok) return;
    const score = await response.json();
    localStorage.setItem(communityScoped(COMMUNITY_SCORE_KEY), JSON.stringify(score));
  } catch {}
}

// Put a refused report back on the outbox and try it again.
async function communityRetry(button) {
  const local = communityReadLocal();
  const key = Object.keys(local).find((k) => local[k].id === button.dataset.id);
  if (!key || !local[key].retry) return;
  const item = local[key].retry;
  delete local[key].failed;
  delete local[key].retry;
  communityWriteLocal(local);
  await outboxAdd(item);
  communityOpenContributions();
  if (navigator.onLine) outboxFlush();
}

// --- Recovery code: the device id is the whole identity, so show it and let it be restored ---
const COMMUNITY_RECOVERY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function communityRecoveryCode() {
  return communityDeviceId().replace(/(.{4})(?=.)/g, "$1-");
}

// Accepts the code as shown (grouped with dashes, any case or spacing) or as a raw id. Device ids
// are always 24 lowercase letters and digits (communityRandomId), so anything else is not a code.
function communityParseRecoveryCode(input) {
  const compact = String(input || "").replace(/[\s-]+/g, "").toLowerCase();
  return /^[a-z0-9]{24}$/.test(compact) ? compact : null;
}

function communityRecoveryHtml() {
  return `<details class="community-recover">
      <summary>${communityIcon("shield")}<span>Or back up with a code instead</span></summary>
      ${communityDeviceIdIsDurable() ? "" : `<p class="community-log-error">This browser can't save your Community code, so your points are lost when you close this page. Sign in or copy the code below to keep them.</p>`}
      <p class="community-recover-text">Your points belong to a code kept on this device. Save it somewhere safe and you can get them back on a new phone or after clearing your browser. Anyone with the code can act as you, so keep it private.</p>
      <div class="community-recover-code"><code id="communityRecoveryCode">${escapeHtml(communityRecoveryCode())}</code><button type="button" class="community-chip" data-action="community-copy-code">Copy</button></div>
      <label class="community-recover-label" for="communityRestoreInput">Restore from a code</label>
      <div class="community-recover-row"><input id="communityRestoreInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"><button type="button" class="community-chip" data-action="community-restore">Restore</button></div>
      <p class="community-recover-status" id="communityRecoveryStatus" role="status"></p>
    </details>`;
}

// Adopt the reports the server holds for the restored id, so the log shows them again.
async function communityAdoptServerReports(deviceId) {
  const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(deviceId)}&list=1`);
  if (!response.ok) return 0;
  const data = await response.json();
  const local = {};
  for (const r of data.reports || []) {
    const key = r.target || (r.tagNumber ? `new:${r.tagNumber}` : null);
    if (!key || local[key]) continue;
    local[key] = { id: r.id, status: r.status, ts: r.ts, lat: r.lat, lon: r.lon, counted: true, ...(r.kind === "place" ? { kind: "place" } : {}), ...(r.tagNumber ? { name: `Tree ${r.tagNumber}` } : {}) };
  }
  communityWriteLocal({ ...local, ...communityReadLocal() });
  return Object.keys(local).length;
}

async function communityRestore() {
  const status = document.getElementById("communityRecoveryStatus");
  const say = (text) => { if (status) status.textContent = text; };
  const code = communityParseRecoveryCode((document.getElementById("communityRestoreInput") || {}).value);
  if (!code) return say("That doesn't look like a recovery code. It has 24 letters and numbers.");
  if (!navigator.onLine) return say("Connect to the internet to restore your progress.");
  try {
    const adopted = await communityAdoptServerReports(code);
    localStorage.setItem(COMMUNITY_DEVICE_KEY, code);
    localStorage.removeItem(COMMUNITY_SCORE_KEY);
    localStorage.removeItem(COMMUNITY_LOG_KEY);
    const message = adopted ? `Restored. ${adopted} ${adopted === 1 ? "report" : "reports"} found.` : "Restored. This code has no reports yet.";
    say(message);
    // The account card holds this section and is redrawn for the new id, so say it again once it is back
    // (open, with the new code) or the confirmation would vanish the moment it appeared.
    await communityOpenContributions();
    const details = document.querySelector(".community-recover");
    if (details) details.open = true;
    const after = document.getElementById("communityRecoveryStatus");
    if (after) after.textContent = message;
  } catch {
    say("Couldn't restore right now. Please try again.");
  }
}

async function communityCopyCode() {
  const status = document.getElementById("communityRecoveryStatus");
  try {
    await navigator.clipboard.writeText(communityRecoveryCode());
    if (status) status.textContent = "Copied.";
  } catch {
    if (status) status.textContent = "Select the code and copy it.";
  }
}

// --- Nudges: when you are standing next to an unchecked tree ---
const COMMUNITY_NUDGE_OFF_KEY = "ff-community-nudges-off-v1";
const COMMUNITY_NUDGE_SEEN_KEY = "ff-community-nudge-seen-v1";
const COMMUNITY_NUDGE_METRES = 10;          // same as the server's NEAR_METRES (community-points.js): closer than this counts as a check
const COMMUNITY_NUDGE_TREE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const COMMUNITY_NUDGE_GLOBAL_GAP_MS = 10 * 60 * 1000; // at most one prompt in this time
let communityNudgeLastAt = 0;
let communityNudgeTimer = null;


function communityNudgesOn() {
  try { return localStorage.getItem(COMMUNITY_NUDGE_OFF_KEY) !== "1"; } catch { return true; }
}

function communityNudgeSeen() {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_NUDGE_SEEN_KEY)) || {}; } catch { return {}; }
}

function communityNudgeDismiss() {
  clearTimeout(communityNudgeTimer);
  const el = document.getElementById("communityNudge");
  if (el) el.remove();
}

// The decision, with no DOM: what should happen for this GPS fix? Returns "card" (offer on any
// screen), "pulse" (draw the eye on the tree's own page) or "none".
function communityNudgeDecision({ on, fixOk, isDefault, nearest, target, alreadyReported, seenAt, now, onThisTree, lastCardAt }) {
  if (!on || !fixOk || isDefault) return "none";
  if (!nearest || !(nearest.metres <= COMMUNITY_NUDGE_METRES) || !target || alreadyReported) return "none";
  if (seenAt && now - seenAt < COMMUNITY_NUDGE_TREE_COOLDOWN_MS) return "none";
  if (onThisTree) return "pulse";
  if (now - lastCardAt < COMMUNITY_NUDGE_GLOBAL_GAP_MS) return "none";
  return "card";
}

const communityPulseTimers = new WeakMap();

// The card's pulse, once, however many fixes ask for it: a later request restarts the pulse and its single
// timer, so an earlier request's timer can never cut the newer pulse short. The ring on Verify is stopped and
// held back for the pulse's duration.
function communityNudgePulse(section, now) {
  clearTimeout(communityPulseTimers.get(section));
  if (communityHint.button && section.contains(communityHint.button)) communityHint.button.classList.remove("community-verify-hint");
  section.classList.remove("community-nudge-pulse");
  void section.offsetWidth;
  section.classList.add("community-nudge-pulse");
  communityHint.quietUntil = now + COMMUNITY_NUDGE_PULSE_MS;
  communityPulseTimers.set(section, setTimeout(() => section.classList.remove("community-nudge-pulse"), COMMUNITY_NUDGE_PULSE_MS));
}

// Called with every fresh GPS fix. Quiet unless the fix is real and accurate, the tree is close,
// and this device has not already checked it or been nudged about it today.
let communityNudgeSlideRetry = null;

function communityNudgeCheck(now = Date.now(), slideWaited = 0) {
  if (!communityEnabled()) return;
  const local = communityReadLocal(); // once per fix: the cards and the nudge share it
  communityUpdatePresentation(local);
  communityUpdateRangeNotes();
  const nearest = state.nearestTree;
  const tree = nearest && nearest.tree;
  const target = tree ? communityTreeTarget(tree) : null;
  const seen = communityNudgeSeen();
  const onThisTree = Boolean(tree && state.selected && state.selected.type === "tree" && state.selected.item === tree);
  const decision = communityNudgeDecision({
    on: communityNudgesOn(),
    fixOk: communityCurrentFix().ok,
    isDefault: Boolean(state.userLocation && state.userLocation.isDefault),
    nearest, target,
    alreadyReported: Boolean(target && local[target]),
    seenAt: target ? seen[target] : 0,
    now, onThisTree,
    lastCardAt: communityNudgeLastAt,
  });
  if (decision === "none") return;
  if (decision === "pulse") {
    communityNudgeDismiss(); // a card from the overview is moot once you are on the tree itself
    if (communitySlideActive()) {
      // The screen is still sliding in and the card is not settled: look again once it has (at most about 600 ms),
      // rather than dropping the pulse for good. Not marked as seen until it is shown.
      if (slideWaited < COMMUNITY_SLIDE_WAIT_MAX_MS) {
        clearTimeout(communityNudgeSlideRetry);
        communityNudgeSlideRetry = setTimeout(() => communityNudgeCheck(Date.now(), slideWaited + 60), 60);
      }
      return;
    }
    const section = communityLive(".community-check");
    if (!section || section.dataset.communityTarget !== target) return;
    // One cue at a time: the nudge pulse takes the slot. A ring already playing on Verify yields, and a ring
    // that is due waits out the pulse's quiet window. Only a highlight (the user just pressed a pointer) is left alone.
    if (!section.classList.contains("community-highlight")) communityNudgePulse(section, now);
  } else {
    communityNudgeShow(tree, nearest.metres);
    communityNudgeLastAt = now;
  }
  seen[target] = now;
  try { localStorage.setItem(COMMUNITY_NUDGE_SEEN_KEY, JSON.stringify(seen)); } catch {}
}

function communityNudgeShow(tree, metres) {
  communityNudgeDismiss();
  const tag = typeof treeTagLabel === "function" ? treeTagLabel(tree) : null;
  const name = tag ? `tree ${escapeHtml(tag)}` : "a veteran tree";
  const el = document.createElement("div");
  el.id = "communityNudge";
  el.className = "community-nudge";
  el.dataset.communityTarget = communityTreeTarget(tree);
  el.setAttribute("role", "status");
  const species = typeof treeSpeciesIconHtml === "function" ? treeSpeciesIconHtml(tree.commonName, tree.latinName, "community-nudge-art") : "";
  el.innerHTML = `<span class="community-nudge-icon">${species || communityIcon("shield")}</span>
    <div class="community-nudge-text"><em class="community-nudge-eyebrow">Nearby tree</em><strong>You're next to ${name}</strong><span>Tap to confirm · ${Math.max(1, Math.round(metres))} m away</span></div>
    ${communityPointsChipHtml(1)}
    <button type="button" class="community-nudge-go" data-community-nudge-go>Check it</button>
    <button type="button" class="community-nudge-close" data-community-nudge-close aria-label="Not now">${communityIcon("x")}</button>`;
  el.querySelector("[data-community-nudge-go]").addEventListener("click", () => {
    communityNudgeDismiss();
    focusOverviewItem("tree", treeHashKey(tree));
  });
  el.querySelector("[data-community-nudge-close]").addEventListener("click", communityNudgeDismiss);
  document.body.appendChild(el);
  communityNudgeTimer = setTimeout(communityNudgeDismiss, 20000);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("change", (event) => {
    const box = event.target && event.target.id === "communityNudgeToggle" ? event.target : null;
    if (!box) return;
    try { localStorage.setItem(COMMUNITY_NUDGE_OFF_KEY, box.checked ? "0" : "1"); } catch {}
    if (!box.checked) communityNudgeDismiss();
  });
}

if (typeof window !== "undefined" && window.addEventListener) {
  if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "COMMUNITY_UPDATED") communityApplyOverlay(event.data.data);
    });
  }
  // Fetched after first paint so it never competes with the map's own data.
  window.addEventListener("load", () => setTimeout(() => {
    setupCommunityOverlayRefresh();
    communityLoadOverlay();
    communityRefreshScore(false);
  }, 1000));
  // The log shows "Waiting to send" while a report is queued, so redraw it whenever the queue changes
  // (a send finishing included); otherwise it keeps saying so until the screen is reopened.
  window.addEventListener("outbox:change", () => {
    if (document.getElementById("communityContributions") && typeof communityRenderContributions === "function") communityRenderContributions();
  });
  window.addEventListener("outbox:sent", (event) => {
    const detail = event.detail;
    if (!detail || !detail.item) return;
    if (detail.item.url === COMMUNITY_REPORT_URL) communityRefreshScore();
    // Every queued report type (tree report, place check, feedback) is in the log under its own id.
    const local = communityReadLocal();
    const key = Object.keys(local).find((k) => local[k].id === detail.item.id);
    if (!key) return;
    if (detail.ok) {
      if (detail.response && detail.response.issueUrl) local[key].issueUrl = detail.response.issueUrl;
      delete local[key].failed;
      delete local[key].retry;
      communityWriteLocal(local);
    } else {
      // The server refused it (not just offline): say so instead of claiming it was sent, and keep
      // the payload so "Send again" can queue it once more.
      local[key].failed = String((detail.response && detail.response.error) || "The server refused the report.").slice(0, 200);
      local[key].retry = { id: detail.item.id, url: detail.item.url, payload: detail.item.payload };
      communityWriteLocal(local);
    }
  });
}

// The short summary at the top of the Community screen, linking on to the full explainer page
// (community/index.html, a static public page).
const COMMUNITY_EXPLAINER_URL = "/contribute";

// --- "Add a missing tree" on the Community screen ---
// A new tree needs its tag number (what identifies it) and a close, accurate GPS fix (where it is),
// so the form says so, shows the live accuracy, and only enables Submit once both are true.
const COMMUNITY_MAX_ACCURACY_METRES = 30;
let communityLocationTimer = null;

// Where the Feedback screen shows the add-a-tree / add-a-place forms once their type is picked.
function communityAddFormHostHtml() {
  return `<section class="community-add-tree community-add-place"><div id="communityAddBody" hidden></div></section>`;
}

// The Feedback screen's type picker: the type decides which form is shown (the ordinary feedback form, or
// the tree or place form with its own location check).
function communitySetReportType(type) {
  clearInterval(communityLocationTimer);
  communityLocationTimer = null;
  clearInterval(communityPlaceLocationTimer);
  communityPlaceLocationTimer = null;
  const select = document.getElementById("reportType");
  if (select) select.value = type;
  const form = document.getElementById("reportForm");
  const body = document.getElementById("communityAddBody");
  if (form) form.hidden = type !== "feedback";
  if (body) {
    body.hidden = type === "feedback";
    if (type === "feedback") body.innerHTML = "";
  }
  if (type === "tree") communityStartAddTree();
  else if (type === "place") communityStartAddPlace();
}

function communityAddTreeFormHtml() {
  return `<form class="community-new-form" id="communityAddTreeForm" novalidate>
      <div id="communityLocationStatus" class="community-location" aria-live="polite"></div>
      <label class="community-field"><span class="community-field-label">Tag number</span>
        <input id="communityTagInput" class="report-textarea community-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="Printed on the tree's tag, e.g. 11383" required>
      </label>
      <label class="community-field"><span class="community-field-label">Anything else? <span class="community-optional">(optional)</span></span>
        <input id="communityTreeNote" class="report-textarea community-input" type="text" autocomplete="off" maxlength="120" placeholder="Species, size, what's nearby…">
      </label>
      ${reportPhotoFieldHtml("communityTreePhoto", "A photo of the tag helps us check the number. It is kept for the review and not published.")}
      <p id="communityAddTreeStatus" class="report-note community-status" aria-live="polite"></p>
      <div class="community-note-actions">
        <button class="community-link" type="button" data-action="community-add-cancel">Cancel</button>
        <button id="communityAddTreeSubmit" class="community-send" type="submit" disabled>Submit tree</button>
      </div>
    </form>`;
}

// The fix the new tree would be recorded at, and whether it is good enough.
function communityCurrentFix() {
  const real = typeof hasRealLocation === "function" && hasRealLocation();
  if (!real) return { ok: false, reason: "none" };
  // The latest fix's own accuracy: the You marker (userLocation) is still gliding toward it and reports the one before.
  const latest = state.locationGlide && state.rawUserLocation ? state.rawUserLocation : state.userLocation;
  const accuracy = Number(latest.accuracy);
  if (!Number.isFinite(accuracy)) return { ok: false, reason: "unknown" };
  if (accuracy > COMMUNITY_MAX_ACCURACY_METRES) return { ok: false, reason: "poor", accuracy };
  return { ok: true, accuracy };
}

function communityUpdateAddTreeState() {
  const status = document.getElementById("communityLocationStatus");
  const submit = document.getElementById("communityAddTreeSubmit");
  if (!status || !submit) { clearInterval(communityLocationTimer); communityLocationTimer = null; return; }
  const fix = communityCurrentFix();
  const messages = {
    none: "Turn on location, then stand right next to the tree.",
    unknown: "Waiting for a GPS fix…",
    poor: `GPS is only accurate to ${fix.accuracy ? Math.round(fix.accuracy) : "?"} m. Step into the open and wait a moment.`,
  };
  status.className = `community-location ${fix.ok ? "is-good" : "is-wait"}`;
  status.innerHTML = fix.ok
    ? `${communityIcon("check")}<span>Using your location · accurate to ${Math.round(fix.accuracy)} m</span>`
    : `${communityIcon("locate")}<span>${messages[fix.reason]}</span>`;
  const tag = (document.getElementById("communityTagInput") || {}).value || "";
  submit.disabled = !(fix.ok && tag.trim());
}

function communityStartAddTree() {
  const body = document.getElementById("communityAddBody");
  if (!body) return;
  body.innerHTML = communityAddTreeFormHtml();
  communityUpdateAddTreeState();
  clearInterval(communityLocationTimer);
  communityLocationTimer = setInterval(communityUpdateAddTreeState, 1500);
  const input = document.getElementById("communityTagInput");
  if (input) input.addEventListener("input", communityUpdateAddTreeState);
  bindReportPhotoInput(document.getElementById("communityTreePhoto"));
  const form = document.getElementById("communityAddTreeForm");
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); communitySubmitNewTree(); });
}

function communityCancelAddTree() {
  communitySetReportType("feedback");
}

async function communitySubmitNewTree() {
  const statusEl = document.getElementById("communityAddTreeStatus");
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const tag = ((document.getElementById("communityTagInput") || {}).value || "").trim();
  const note = ((document.getElementById("communityTreeNote") || {}).value || "").trim();
  if (!tag) return say("Please enter the tree's tag number.");
  let photo = null;
  try {
    photo = await prepareReportPhoto(document.getElementById("communityTreePhoto")?.files?.[0]);
  } catch (error) {
    return say(error.message || "Could not prepare that photo.");
  }
  if (normalizeTreeNumber(tag) === "0" || !normalizeTreeNumber(tag)) return say("That isn't a usable tag number. Look for the number printed on the tag.");
  const fix = communityCurrentFix();
  const here = communityFixLatLon();
  if (!fix.ok || !here) return say("We need a close, accurate location. Stand next to the tree and wait for a better GPS fix.");
  const known = (state.trees || []).find((tree) => tree.tagNumber != null && normalizeTreeNumber(tree.tagNumber) === normalizeTreeNumber(tag));
  if (known) {
    return say(`Tag ${tag} is already on the map (${treeDisplayName(known)}). Open that tree and check it instead.`);
  }
  const lat = Number(here.latitude.toFixed(6));
  const lon = Number(here.longitude.toFixed(6));
  await communitySubmitReport({ kind: "tree", status: "NEW_TREE", target: undefined, targetLat: lat, targetLon: lon, tagNumber: tag, accuracy: Math.round(fix.accuracy), note, photo });
  clearInterval(communityLocationTimer);
  communityLocationTimer = null;
  const body = document.getElementById("communityAddBody");
  if (body) {
    body.innerHTML = `<div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>Tree ${escapeHtml(tag)} saved</strong><span>Thank you! It shows for everyone once a second person finds it too, which can take an hour or two.</span></p>
      </div>`;
  }
  communityOpenContributions();
}

// Shown wherever a report is about to become a public GitHub issue (feedback, place changes, new places).
// Keep the wording in step with "Where reports go" in terms.html (#community-reports).
function communityPublicNoticeHtml() {
  return `<p class="report-note community-public-notice">When you send this it is published on a <strong>public GitHub page</strong>: what you write, any photo, a map position, the app version, this page's address and your browser details. Your name and Community ID are never included, so please keep personal details out of your note. <a href="/terms.html#community-reports" target="_blank" rel="noopener">Privacy &amp; Terms</a></p>`;
}

// --- Add a missing place: a form like "Add a missing tree", filed as a place-check issue for review ---
const COMMUNITY_NEW_PLACE_TYPES = ["Pub", "Café", "Restaurant", "Shop", "Toilets", "Car park", "Visitor attraction", "Other"];

function communityAddPlaceFormHtml() {
  return `<form class="community-new-form" id="communityAddPlaceForm" novalidate>
      <div id="communityPlaceLocationStatus" class="community-location" aria-live="polite"></div>
      <label class="community-field"><span class="community-field-label">Name</span>
        <input id="communityPlaceName" class="report-textarea community-input" type="text" autocomplete="off" maxlength="120" placeholder="What is it called?" required>
      </label>
      <label class="community-field"><span class="community-field-label">Type of place</span>
        <select id="communityPlaceType" class="report-textarea community-input">${COMMUNITY_NEW_PLACE_TYPES.map((t) => `<option>${escapeHtml(t)}</option>`).join("")}</select>
      </label>
      <label class="community-field"><span class="community-field-label">Anything else? <span class="community-optional">(optional)</span></span>
        <input id="communityPlaceNote" class="report-textarea community-input" type="text" autocomplete="off" maxlength="200" placeholder="Opening hours, website, what's nearby…">
      </label>
      ${reportPhotoFieldHtml("communityPlacePhoto", "A photo of the entrance or sign helps us check the place. It is published with the review, like your note.")}
      ${communityPublicNoticeHtml()}
      <p id="communityAddPlaceStatus" class="report-note community-status" aria-live="polite"></p>
      <div class="community-note-actions">
        <button class="community-link" type="button" data-action="community-addplace-cancel">Cancel</button>
        <button id="communityAddPlaceSubmit" class="community-send" type="submit" disabled>Submit place</button>
      </div>
    </form>`;
}

let communityPlaceLocationTimer = null;

function communityUpdateAddPlaceState() {
  const status = document.getElementById("communityPlaceLocationStatus");
  const submit = document.getElementById("communityAddPlaceSubmit");
  if (!status || !submit) { clearInterval(communityPlaceLocationTimer); communityPlaceLocationTimer = null; return; }
  const fix = communityCurrentFix();
  const messages = {
    none: "Turn on location, then stand at the place.",
    unknown: "Waiting for a GPS fix…",
    poor: `GPS is only accurate to ${fix.accuracy ? Math.round(fix.accuracy) : "?"} m. Step into the open and wait a moment.`,
  };
  status.className = `community-location ${fix.ok ? "is-good" : "is-wait"}`;
  status.innerHTML = fix.ok
    ? `${communityIcon("check")}<span>Using your location · accurate to ${Math.round(fix.accuracy)} m</span>`
    : `${communityIcon("locate")}<span>${messages[fix.reason]}</span>`;
  const name = (document.getElementById("communityPlaceName") || {}).value || "";
  submit.disabled = !(fix.ok && name.trim());
}

function communityStartAddPlace() {
  const body = document.getElementById("communityAddBody");
  if (!body) return;
  body.innerHTML = communityAddPlaceFormHtml();
  communityUpdateAddPlaceState();
  clearInterval(communityPlaceLocationTimer);
  communityPlaceLocationTimer = setInterval(communityUpdateAddPlaceState, 1500);
  const input = document.getElementById("communityPlaceName");
  if (input) input.addEventListener("input", communityUpdateAddPlaceState);
  bindReportPhotoInput(document.getElementById("communityPlacePhoto"));
  const form = document.getElementById("communityAddPlaceForm");
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); communitySubmitNewPlace(); });
}

function communityCancelAddPlace() {
  communitySetReportType("feedback");
}

async function communitySubmitNewPlace() {
  const statusEl = document.getElementById("communityAddPlaceStatus");
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const name = ((document.getElementById("communityPlaceName") || {}).value || "").trim();
  const category = ((document.getElementById("communityPlaceType") || {}).value || "Other").trim();
  const note = ((document.getElementById("communityPlaceNote") || {}).value || "").trim();
  if (!name) return say("Please enter the place's name.");
  let photo = null;
  try {
    photo = await prepareReportPhoto(document.getElementById("communityPlacePhoto")?.files?.[0]);
  } catch (error) {
    return say(error.message || "Could not prepare that photo.");
  }
  const fix = communityCurrentFix();
  const here = communityFixLatLon();
  if (!fix.ok || !here) return say("We need a close, accurate location. Stand at the place and wait for a better GPS fix.");
  const lat = Number(here.latitude.toFixed(6));
  const lon = Number(here.longitude.toFixed(6));
  const key = `new:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const id = communityRandomId();
  const local = communityReadLocal();
  local[key] = { id, status: "NEW_PLACE", ts: Date.now(), kind: "place", name, lat, lon };
  communityWriteLocal(local);
  outboxAdd({ id, url: COMMUNITY_ISSUE_URL, payload: {
    reportType: "place-check",
    placeCheck: { status: "NEW_PLACE", key, name, category },
    details: note,
    location: { latitude: lat, longitude: lon },
    locationContext: { type: category, name },
    deviceId: communityDeviceId(),
    appVersion: (typeof state !== "undefined" && state.swVersion) || (typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown"),
    userAgent: navigator.userAgent,
    pageUrl: window.location.href,
    requestId: id,
    ...(photo ? { photo } : {}),
  } }).then(() => { if (navigator.onLine) outboxFlush(); }).catch(() => {});
  clearInterval(communityPlaceLocationTimer);
  communityPlaceLocationTimer = null;
  const body = document.getElementById("communityAddBody");
  if (body) {
    body.innerHTML = `<div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>${escapeHtml(name)} sent for review</strong><span>Thank you! A person will check it before it goes on the map.</span></p>
      </div>`;
  }
  if (typeof requestDraw === "function") requestDraw();
  communityOpenContributions();
}

// --- "Help check this place" on a place's detail screen (js/inspector.js showLandmarkDetails) ---

function communityPlaceChoiceHtml(choice) {
  const attrs = `data-action="community-place-choose" data-status="${choice.status}"`;
  const copy = `<span class="community-verify-copy"><strong>${escapeHtml(choice.label)}</strong>${choice.hint ? `<small>${escapeHtml(choice.hint)}</small>` : ""}</span>`;
  if (choice.status === "OPEN_CONFIRMED") {
    return `<button class="community-verify" type="button" ${attrs}>${communityIcon(choice.icon, "community-icon community-verify-icon")}${copy}</button>`;
  }
  return `<button class="community-chip" type="button" ${attrs}><span class="community-chip-icon">${communityIcon(choice.icon)}</span><span class="community-chip-label"><strong>${escapeHtml(choice.label)}</strong>${choice.hint ? `<small>${escapeHtml(choice.hint)}</small>` : ""}</span></button>`;
}

function communityPlaceInnerHtml(section) {
  const target = section.dataset.communityTarget;
  const pending = COMMUNITY_PLACE_CHOICES.find((c) => c.status === section.dataset.pending);
  if (pending) {
    return `<div class="community-note">
        <p class="community-note-title">${communityIcon(pending.icon)}<span>${escapeHtml(pending.label)}</span></p>
        <textarea class="report-textarea community-note-input" rows="3" maxlength="400" placeholder="${escapeHtml(pending.notePlaceholder || "")}"></textarea>
        ${reportPhotoFieldHtml(`communityPlacePhoto-${section.dataset.communityTarget.replace(/[^a-z0-9]/gi, "")}`, "A photo helps us check. It is published with the review, like your note.")}
        ${communityPublicNoticeHtml()}
        <p class="report-note community-status" aria-live="polite"></p>
        <div class="community-note-actions">
          <button class="community-link" type="button" data-action="community-cancel-note">Cancel</button>
          <button class="community-send" type="button" data-action="community-send-place">Send report</button>
        </div>
      </div>`;
  }
  const local = communityReadLocal()[target];
  if (local && section.dataset.editing !== "1") {
    return communityMineHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status, local.status);
  }
  const [primary, ...others] = COMMUNITY_PLACE_CHOICES;
  return `${communityPlaceChoiceHtml(primary)}
      ${communityMoreHtml(others.map(communityPlaceChoiceHtml).join(""), section.dataset.editing === "1" || section.dataset.more === "1")}
      <p class="community-distance-line" data-community-distance="place">${escapeHtml(communityDistanceText(communityMetresTo(Number(section.dataset.lat), Number(section.dataset.lon))))}</p>
      <p class="report-note community-status" aria-live="polite"></p>`;
}

// --- Community reports on a place: the open and closed GitHub issues people have filed about it ---

const COMMUNITY_REPO = "simonmcmanus/epping-forest-finds";
const communityPlaceIssueCache = new Map();

function communityPlaceIssuesUrl(placeKey) {
  return `https://github.com/${COMMUNITY_REPO}/issues?q=${encodeURIComponent(`is:issue label:place-check "place-key:${placeKey}"`)}`;
}

function communityPlaceIssueStatusHtml(key, found) {
  const count = `${found.total} ${found.total === 1 ? "report" : "reports"}`;
  const openText = found.open ? `${found.open} open` : "none open";
  const titles = (found.items || []).map((item) => item.title).filter(Boolean).slice(0, 3);
  const reportsHtml = titles.length
    ? `<ul>${titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`
    : `<p>The community has raised ${escapeHtml(count)} about this place.</p>`;
  return `<details class="community-place-status community-place-issues">
      <summary class="community-place-status-summary">${communityIcon("alert")}<span class="community-place-status-copy"><strong>Community reports</strong><small>${escapeHtml(`${count} · ${openText}`)}</small></span>${communityIcon("chevron")}</summary>
      <div class="community-place-status-detail">${reportsHtml}<a class="community-link" href="${escapeHtml(communityPlaceIssuesUrl(key))}" target="_blank" rel="noopener">View reports</a></div>
    </details>`;
}

function communityPlaceStatusHtml(target) {
  const found = communityPlaceIssueCache.get(target);
  if (found && found.total) return communityPlaceIssueStatusHtml(target, found);
  return "";
}

function communityPlaceStatusChipHtml(target) {
  const found = communityPlaceIssueCache.get(target);
  if (found && found.total) {
    return `<button type="button" class="community-verified-chip community-status-problem-chip" aria-expanded="false" aria-controls="communityPlaceStatusDetail" aria-label="Community reports about this location">${communityIcon("alert")}<strong>${escapeHtml(found.total)}</strong></button>`;
  }
  const local = target && communityReadLocal()[target];
  if (!local) return "";
  const confirmed = local.status === "OPEN_CONFIRMED";
  const label = confirmed ? "You verified this location" : "You reported a problem with this location";
  return `<button type="button" class="community-verified-chip${confirmed ? "" : " community-status-problem-chip"}" aria-expanded="false" aria-controls="communityPlaceStatusDetail" aria-label="${escapeHtml(label)}">${communityIcon(confirmed ? "shield" : "alert")}<strong>1</strong></button>`;
}

function communityPlaceStatusDetailHtml(target) {
  const found = communityPlaceIssueCache.get(target);
  if (found && found.total) {
    return `<p class="community-verified-detail" id="communityPlaceStatusDetail">${escapeHtml(found.total)} ${found.total === 1 ? "person has" : "people have"} reported a problem with this location. The official record is unchanged.</p>`;
  }
  const local = target && communityReadLocal()[target];
  if (!local) return "";
  const title = COMMUNITY_STATUS_TEXT[local.status] || local.status;
  return `<p class="community-verified-detail" id="communityPlaceStatusDetail">You reported ${escapeHtml(title.toLowerCase())}. Your report is saved on this device.</p>`;
}

function communityPlaceStatusSlotsHtml(place) {
  if (!communityEnabled() || !place || place.latitude == null || place.longitude == null) return { chip: "", detail: "", pointer: "" };
  const target = `place:${placeHashKey(place)}`;
  return {
    pointer: place.name ? communityPointerSlotHtml(target, "place", communityInitialTier(target, Number(place.latitude), Number(place.longitude), "place")) : "",
    chip: `<span class="community-place-status-chip-slot" data-place-key="${escapeHtml(target)}">${communityPlaceStatusChipHtml(target)}</span>`,
    detail: `<div class="community-place-status-detail-slot" data-place-key="${escapeHtml(target)}">${communityPlaceStatusDetailHtml(target)}</div>`,
  };
}

// Public repo, so the search needs no token. Any failure leaves the line hidden: it is extra
// information, never something the place page should wait on or report as an error.
async function loadCommunityPlaceIssues(place) {
  const key = `place:${placeHashKey(place)}`;
  const host = document.querySelector(`.community-place-status-slot[data-place-key="${CSS.escape(key)}"]`);
  if (!host) return;
  let found = communityPlaceIssueCache.get(key);
  if (!found) {
    try {
      const query = `repo:${COMMUNITY_REPO} is:issue label:place-check in:body "place-key:${key}"`;
      const response = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=30`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      found = { total: data.total_count || 0, open: items.filter((item) => item.state === "open").length, items };
      communityPlaceIssueCache.set(key, found);
    } catch {
      return;
    }
  }
  host.innerHTML = communityPlaceStatusHtml(key);
  communityRefreshPlaceConfirmation(key);
}

function communityPlaceSectionHtml(place) {
  return communityUsualSlotHtml(place, "place");
}

function communityPlaceTopSlotHtml(place) {
  return communityTopSlotHtml(place, "place");
}

function communityPlaceConfirmationHtml(place) {
  if (!communityEnabled() || !place || place.latitude == null || place.longitude == null) return "";
  const target = `place:${placeHashKey(place)}`;
  return `<div class="community-place-status-slot" data-place-key="${escapeHtml(target)}">${communityPlaceStatusHtml(target)}</div>`;
}

function communityRefreshPlaceConfirmation(target) {
  communityLiveAll(".community-place-status-slot").forEach((slot) => {
    if (slot.dataset.placeKey === target) slot.innerHTML = communityPlaceStatusHtml(target);
  });
  communityLiveAll(".community-place-status-chip-slot").forEach((slot) => {
    if (slot.dataset.placeKey === target) slot.innerHTML = communityPlaceStatusChipHtml(target);
  });
  communityLiveAll(".community-place-status-detail-slot").forEach((slot) => {
    if (slot.dataset.placeKey === target) slot.innerHTML = communityPlaceStatusDetailHtml(target);
  });
}

async function communitySubmitPlace(section, status, note, photo = null) {
  const target = section.dataset.communityTarget;
  const lat = Number(section.dataset.lat);
  const lon = Number(section.dataset.lon);
  const name = section.dataset.name || "";
  const category = section.dataset.category || "";
  const id = communityRandomId();
  const local = communityReadLocal();
  // The place's own /find/<slug>/ page is what the log links to; kept with the report so it survives a reload.
  const slug = section.dataset.slug || "";
  local[target] = { id, status, ts: Date.now(), kind: "place", name, lat, lon, ...(slug ? { slug } : {}) };
  communityWriteLocal(local);
  // Confirming a place scores nothing and is not actionable, so it never leaves the device: it only
  // hides the check card for that place. Only a report that something is wrong is filed (as an issue,
  // for a person to review) and can score, once it is confirmed.
  if (status !== "OPEN_CONFIRMED") {
    outboxAdd({ id, url: COMMUNITY_ISSUE_URL, payload: {
      reportType: "place-check",
      placeCheck: { status, key: target, name, category },
      details: note || "",
      location: { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)) },
      locationContext: { type: category, name },
      deviceId: communityDeviceId(),
      appVersion: (typeof state !== "undefined" && state.swVersion) || (typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown"),
      userAgent: navigator.userAgent,
      pageUrl: window.location.href,
      requestId: id,
      ...(photo ? { photo } : {}),
    } }).then(() => { if (navigator.onLine) outboxFlush(); }).catch(() => {});
  }
  if (typeof requestDraw === "function") requestDraw();
}

async function communityHandlePlaceChoice(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const status = button.dataset.status;
  const hadFocus = section.contains(document.activeElement);
  if (status === "OPEN_CONFIRMED") {
    await communitySubmitPlace(section, status, "");
    // Confirming again from Change is idempotent: replace the local record, then leave edit mode
    // so the form closes back to the compact confirmed state rather than staying open.
    delete section.dataset.pending;
    delete section.dataset.editing;
    communityRefreshSections();
    communityRefreshPlaceConfirmation(section.dataset.communityTarget);
    communityAnswered(section, hadFocus);
    return;
  } else {
    section.dataset.pending = status;
  }
  communityRefreshSections();
  const input = section.querySelector(".community-note-input");
  if (input) input.focus();
}

async function communitySendPlace(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const choice = COMMUNITY_PLACE_CHOICES.find((c) => c.status === section.dataset.pending);
  if (!choice) return;
  const input = section.querySelector(".community-note-input");
  const note = input ? input.value.trim() : "";
  const statusEl = section.querySelector(".community-status");
  const hadFocus = section.contains(document.activeElement);
  if (choice.noteRequired && !note) {
    if (statusEl) statusEl.textContent = "Please add a few words so we can check it.";
    return;
  }
  let photo = null;
  try {
    photo = await prepareReportPhoto(section.querySelector(".report-photo-input")?.files?.[0]);
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || "Could not prepare that photo.";
    return;
  }
  await communitySubmitPlace(section, choice.status, note, photo);
  delete section.dataset.pending;
  delete section.dataset.editing;
  communityRefreshSections();
  communityRefreshPlaceConfirmation(section.dataset.communityTarget);
  communityAnswered(section, hadFocus);
}

function communityCancelNote(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  delete section.dataset.pending;
  communityRefreshSections();
}

// Feedback and bug reports are part of the log too: they earn a point once they are fixed.
function communityNoteFeedback(payload) {
  if (!payload || !payload.requestId || payload.reportType === "place-check") return;
  const local = communityReadLocal();
  const text = String(payload.details || "").trim().replace(/\s+/g, " ");
  local[`feedback:${payload.requestId}`] = { id: payload.requestId, status: "FEEDBACK", ts: Date.now(), kind: "feedback", name: text.length > 42 ? `${text.slice(0, 41)}…` : text || "Feedback" };
  communityWriteLocal(local);
}

// --- Highlights on the map: everything the user has marked, drawn while the Community screen is open ---
// (drawCommunityMarks, js/renderer.js). Green: verified or confirmed. Amber: reported as wrong, closed,
// moved or changed. Blue: a tree the user added.
const COMMUNITY_MARK_STYLE = {
  verified: { color: "#2f8a4f", halo: "rgba(47, 138, 79, 0.25)", label: "Verified" },
  questioned: { color: "#d68a0c", halo: "rgba(214, 138, 12, 0.28)", label: "Reported wrong" },
  added: { color: "#2b6cb0", halo: "rgba(43, 108, 176, 0.25)", label: "Added by you" },
};
let communityTreeByRecord = null;

function communityRecordCoords(record) {
  if (!communityTreeByRecord || communityTreeByRecord.size === 0) {
    communityTreeByRecord = new Map();
    for (const tree of (typeof state !== "undefined" && state.trees) || []) {
      const rn = tree.recordNumber ?? tree.id;
      if (rn != null) communityTreeByRecord.set(String(rn), tree);
    }
  }
  const tree = communityTreeByRecord.get(String(record));
  return tree ? { lat: tree.latitude, lon: tree.longitude } : null;
}

function communityMarkKind(entry) {
  if (entry.status === "NEW_TREE") return "added";
  return entry.status === "VERIFIED" || entry.status === "OPEN_CONFIRMED" ? "verified" : "questioned";
}

// The shared verdict on the tree whose page is open (from the overlay, so everyone's reports show), drawn
// on its own pin. Questioned and verified only: a tree with no community entry gets no mark.
function communitySelectedTreeMarks() {
  const item = state.selected && state.selected.item;
  if (!item || item.latitude == null || item.longitude == null) return [];
  const key = communityTreeTarget(item);
  const entry = key && communityOverlay.entries[key];
  if (!entry || !["verified", "confirmed", "questioned"].includes(entry.s)) return [];
  return [{ lat: Number(item.latitude), lon: Number(item.longitude), kind: entry.s === "questioned" ? "questioned" : "verified", key }];
}

// [{ lat, lon, kind, status, key }] for every report this device has made that has a position.
function communityMapMarks() {
  const marks = [];
  for (const [key, entry] of Object.entries(communityReadLocal())) {
    let lat = Number(entry.lat);
    let lon = Number(entry.lon);
    if (!(Number.isFinite(lat) && Number.isFinite(lon)) && key.startsWith("tree:")) {
      const found = communityRecordCoords(key.slice(5));
      if (found) { lat = Number(found.lat); lon = Number(found.lon); }
    }
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) continue;
    marks.push({ lat, lon, kind: communityMarkKind(entry), status: entry.status, key });
  }
  return marks;
}

// Trees other walkers have added (not in the City of London register yet), from the shared overlay.
// These remain available for shared links and detail routes; map highlights are limited to the
// Community screen so they do not sit over the ordinary map's labels and pins.
function communityOverlayNewTreeMarks() {
  const marks = [];
  for (const [key, entry] of Object.entries(communityOverlay.entries || {})) {
    if (!key.startsWith("new:tree:") || !entry || (entry.s !== "new" && entry.s !== "new-confirmed")) continue;
    const lat = Number(entry.lat);
    const lon = Number(entry.lon);
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) continue;
    marks.push({ lat, lon, kind: "added", status: entry.st || "NEW_TREE", key, tag: entry.tag || "", n: Number(entry.n) || 0, confirmed: entry.s === "new-confirmed" });
  }
  return marks;
}

// A walker-added tree as a selectable item (same fields as a register tree where it matters:
// latitude/longitude/point), for the map tap, the #addedtree=<tag> route and its detail screen.
function communityAddedTreeItem(mark) {
  return {
    tag: mark.tag,
    name: `Tree ${mark.tag}`,
    latitude: mark.lat,
    longitude: mark.lon,
    point: projectLonLat(mark.lon, mark.lat),
    people: mark.n,
    confirmed: mark.confirmed,
  };
}

function communityFindAddedTree(tag) {
  const wanted = String(tag || "").trim().toLowerCase();
  const mark = communityOverlayNewTreeMarks().find((m) => m.tag && String(m.tag).toLowerCase() === wanted);
  return mark ? communityAddedTreeItem(mark) : null;
}

function showAddedTreeDetails(item) {
  setInspectorSelectionChrome({ emoji: appIconHtml("tree", "app-icon title-icon"), showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = item.name;
  els.inspectorType.textContent = "Added by walkers";
  const distance = typeof distanceFromUser === "function" ? distanceFromUser(item) : null;
  const pill = distance != null ? `<span data-live-field="distance">${walkInfoExpandableHtml(distance)}</span>` : "";
  const topRow = `<div class="detail-top-row">${pill}${openInMapsHtml(item.latitude, item.longitude, item.name)}</div>`;
  const seen = item.confirmed ? `Found by ${item.people} people` : "Found by 1 person";
  const rows = [["Tag number", item.tag], ["Status", item.confirmed ? "Confirmed by a second walker" : "Waiting for a second walker"], ["Seen", seen], ["Official register", "Not on the City of London register yet"]];
  const cta = `<div class="community-new-tree community-added-tree-cta">
      <span class="community-new-icon">${communityIcon("plus")}</span>
      <div class="community-new-text">
        <p class="community-new-title">Found this tree too?</p>
        <p class="report-note">Stand next to it and add it from where you are. A second sighting confirms it.</p>
      </div>
      <button class="community-add" type="button" data-action="community-confirm-added" data-tag="${escapeHtml(item.tag)}">${communityIcon("plus")}<span>I found it</span></button>
    </div>`;
  const nearbyHtml = nearbySectionsHtml({ latitude: item.latitude, longitude: item.longitude, name: item.name || "this tree", subfilterKey: "trees" });
  transitionInspectorBody(`<article class="place-detail place-detail--added-tree">${topRow}${detailsHtml(rows)}${cta}${nearbyHtml}</article>`, "forward");
}

// "I found it too": the Feedback screen's add-a-tree form, with the tag filled in.
function communityConfirmAddedTree(tag) {
  openReportModal();
  communitySetReportType("tree");
  const input = document.getElementById("communityTagInput");
  if (input) {
    input.value = tag;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.scrollIntoView({ block: "center" });
  }
}

// World points the Community screen's camera should keep in view: marks within reach of the walking
// radius, the same limit the Nearby camera applies to far-off matches, so one mark across the country
// cannot shrink the map to a speck.
function communityFitPoints() {
  const origin = typeof nearbyOrigin === "function" ? nearbyOrigin() : null;
  const ratio = typeof NEARBY_OUT_OF_RADIUS_FIT_MAX_RATIO === "number" ? NEARBY_OUT_OF_RADIUS_FIT_MAX_RATIO : 12;
  const reach = typeof walkingDistanceToMetres === "function" ? walkingDistanceToMetres(state.walkingDistanceMinutes) * ratio : Infinity;
  return communityMapMarks()
    .filter((mark) => !origin || distanceMetres(origin.latitude, origin.longitude, mark.lat, mark.lon) <= reach)
    .map((mark) => projectLonLat(mark.lon, mark.lat));
}

function communityLegendHtml(marks) {
  const kinds = ["verified", "questioned", "added"].filter((kind) => marks.some((m) => m.kind === kind));
  if (!kinds.length) return "";
  return `<p class="community-legend" aria-label="Highlighted on the map">On the map: ${kinds.map((kind) => `<span class="community-legend-item"><span class="community-dot" style="background:${COMMUNITY_MARK_STYLE[kind].color}"></span>${COMMUNITY_MARK_STYLE[kind].label}</span>`).join("")}</p>`;
}

// --- "Your contributions": rank, score and a log of the user's own reports (Settings screen) ---

function communityRank(points) {
  let current = COMMUNITY_RANKS[0];
  for (const rank of COMMUNITY_RANKS) if (points >= rank.min) current = rank;
  const next = COMMUNITY_RANKS.find((rank) => rank.min > points) || null;
  return { name: current.name, icon: current.icon, min: current.min, next };
}

function communityReadLog() {
  try { return JSON.parse(localStorage.getItem(communityScoped(COMMUNITY_LOG_KEY))) || {}; } catch { return {}; }
}

function communityTargetLabel(key, entry) {
  if (key.startsWith("feedback:")) return { text: (entry && entry.name) || "Feedback", href: null };
  if (key.startsWith("place:")) {
    // "place:id:<osm or manual id>" selects the place on the map (the same route as #place=id:...).
    // Coordinate-only keys have no id to select by, so they stay plain text.
    // A place with its own /find/<slug>/ page links there, the same as the rest of the app; older entries
    // without a slug fall back to the map selection.
    const placeId = key.startsWith("place:id:") ? key.slice("place:".length) : null;
    const href = entry && entry.slug ? `/find/${entry.slug}/` : placeId ? `/nearby#place=${placeId}` : null;
    return { text: (entry && entry.name) || "Place", href, issueUrl: entry && entry.issueUrl };
  }
  if (key.startsWith("tree:") && typeof findTreeByHashKey === "function") {
    const tree = findTreeByHashKey(`r${key.slice(5)}`);
    if (tree) return { text: treeDisplayName(tree), href: `/nearby#tree=r${key.slice(5)}` };
    return { text: `Tree #${key.slice(5)}`, href: null };
  }
  return { text: (entry && entry.name) || "New tree", href: null };
}

// The whole screen is drawn once, as a skeleton with every element in place and empty values that shimmer
// while `is-loading`. The functions below only write text, attributes and classes into it, so nothing
// moves when the data arrives.
function communityContributionsHtml() {
  return `<section class="community-contributions">
      <h3 class="community-sr">Your contributions</h3>
      <div id="communityContributions" class="community-hero is-loading" aria-busy="true">
        <div data-hero="volatile"></div>
        <p class="settings-description" data-hero="note" hidden></p>
        <div class="community-rank-card">
          <span class="community-rank-icon" data-hero="medal">${communityMedalHtml(COMMUNITY_RANKS[0])}</span>
          <div class="community-rank-text">
            <p class="community-rank"><strong data-hero="rank"></strong></p>
            <p class="community-rank-points" data-hero="rank-points"></p>
          </div>
          <div class="community-points-big" aria-hidden="true"><strong data-hero="points"></strong><span data-hero="points-label"></span></div>
        </div>
        <div class="community-badges community-hero-badges" data-hero="badges" hidden>
          <div data-hero="chips"></div>
          <p class="community-badge-detail" role="status" hidden></p>
        </div>
        <div class="community-progress" role="progressbar" aria-label="Progress to the next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-hero="bar"><span style="width:0%"></span></div>
        <div class="community-stats">
          <div>${communityIcon("shield")}<strong data-hero="verified"></strong><span>Verified</span></div>
          <div>${communityIcon("swap")}<strong data-hero="confirmed"></strong><span>Confirmed by others</span></div>
          <div>${communityIcon("edit")}<strong data-hero="reports"></strong><span>Your reports</span></div>
        </div>
      </div>
    </section>`;
}

function communityLogSectionHtml() {
  return `<section class="settings-section community-reports">
      <details id="communityReportsDetails">
        <summary class="settings-section-title">Your reports<span id="communityReportsCount"></span>${communityIcon("chevron", "community-icon community-mine-chevron")}</summary>
        <div id="communityLog" class="is-loading">
          <div data-log="legend"></div>
          <div data-log="filters"></div>
          <div data-log="body"><div class="community-skel-rows" aria-hidden="true"><span></span><span></span></div></div>
        </div>
      </details>
    </section>`;
}

// What a walker can do right now. The first row goes to the map, where a tree's own page has the check.
function communityActionsHtml() {
  const located = typeof hasRealLocation === "function" && hasRealLocation();
  return `<section class="community-actions">
      <div class="community-action-card">
        <a class="community-action-row" href="/nearby/trees">
          <span class="community-action-icon">${communityIcon("locate")}</span>
          <span class="community-action-text"><strong>Check trees near you</strong><span>${located ? "Walk up to a tree and tap Verify to earn a point" : "Turn on location to earn points for checks"}</span></span>
          ${communityIcon("chevron")}
        </a>
        <a class="community-intro" href="${COMMUNITY_EXPLAINER_URL}" target="_blank" rel="noopener"><span>Help keep the map right: check, add and fix data to earn points.</span> <u>How it works</u></a>
      </div>
    </section>`;
}

// Everything the screen shows from the user's own history is cleared whenever the hero goes back to its
// loading skeleton (or shows a note), so a previous person's rows never show beside "Loading".
function communityHeroEl(name) {
  return document.querySelector(`#communityContributions [data-hero="${name}"]`);
}

function communityResetHosts(note = "") {
  const hero = document.getElementById("communityContributions");
  if (hero) {
    hero.classList.add("is-loading");
    hero.classList.toggle("has-note", Boolean(note));
    hero.setAttribute("aria-busy", note ? "false" : "true");
    for (const name of ["rank", "rank-points", "points", "points-label", "verified", "confirmed", "reports", "chips"]) {
      const el = communityHeroEl(name);
      if (el) el.textContent = "";
    }
    const noteEl = communityHeroEl("note");
    if (noteEl) { noteEl.textContent = note; noteEl.hidden = !note; }
    const volatile = communityHeroEl("volatile");
    if (volatile) volatile.innerHTML = "";
    const badgesEl = communityHeroEl("badges");
    if (badgesEl) badgesEl.hidden = true;
  }
  const log = document.getElementById("communityLog");
  if (log) {
    log.classList.add("is-loading");
    log.querySelector('[data-log="legend"]').innerHTML = "";
    log.querySelector('[data-log="filters"]').innerHTML = "";
    log.querySelector('[data-log="body"]').innerHTML = `<div class="community-skel-rows" aria-hidden="true"><span></span><span></span></div>`;
  }
  const badgesHost = document.getElementById("communityBadgesHost");
  if (badgesHost) badgesHost.innerHTML = "";
}

let communityLogFilter = "all";
const COMMUNITY_ATTENTION_OUTCOMES = ["failed", "waiting", "review"];
// "Completed" rather than "Confirmed": it holds every finished outcome (confirmed by others, City-validated, fixed, checked in).
const COMMUNITY_DONE_OUTCOMES = ["confirmed", "validated", "fixed", "checked"];

function communityRelativeDay(ts, now = Date.now()) {
  const days = communityLocalDay(now) - communityLocalDay(ts);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

async function communityRenderContributions() {
  const host = document.getElementById("communityContributions");
  if (!host) return;
  // Not drawn from storage until we know whose it is (see communityOpenContributions), whoever asks.
  if (!communityIdentitySettled && navigator.onLine && !communityIdentityFailed) return;
  const remembered = communityReadAccount();
  if (communityIdentityFailed && remembered && remembered.signedIn) {
    communityResetHosts("Couldn't check who is signed in just now. Reload to try again.");
    return;
  }
  const waitingIds = new Set((await outboxList()).map((item) => item.id));
  const local = communityReadLocal();
  const score = communityDisplayScore(communityReadScore(), local, waitingIds);
  const rank = communityRank(score.points);
  const outcomes = communityReadLog();
  const span = rank.next ? rank.next.min - rank.min : 1;
  const progress = rank.next ? Math.min(100, Math.round(((score.points - rank.min) / span) * 100)) : 100;
  const toNext = rank.next ? `${rank.next.min - score.points} to ${escapeHtml(rank.next.name)}` : "Top rank";
  const entries = Object.entries(local).map(([key, entry]) => {
    const outcome = waitingIds.has(entry.id) ? "waiting"
      : entry.failed ? "failed"
      : entry.kind === "feedback" ? (outcomes[entry.id] === "fixed" ? "fixed" : "sent")
      : entry.kind === "place" && entry.status === "OPEN_CONFIRMED" ? "checked"
      : entry.kind === "place" ? (outcomes[entry.id] === "confirmed" ? "confirmed" : "sent")
      : (outcomes[entry.id] || (entry.far ? "far" : "pending"));
    return { key, entry, outcome };
  }).sort((a, b) => (COMMUNITY_ATTENTION_OUTCOMES.includes(b.outcome) - COMMUNITY_ATTENTION_OUTCOMES.includes(a.outcome)) || b.entry.ts - a.entry.ts);
  const attention = entries.filter((e) => COMMUNITY_ATTENTION_OUTCOMES.includes(e.outcome)).length;
  const filter = ["attention", "done"].includes(communityLogFilter) ? communityLogFilter : "all";
  const shown = entries.filter((e) => filter === "all" || (filter === "attention" ? COMMUNITY_ATTENTION_OUTCOMES : COMMUNITY_DONE_OUTCOMES).includes(e.outcome));
  const rows = shown.map(({ key, entry, outcome }) => {
    const label = communityTargetLabel(key, entry);
    const name = label.href ? `<a href="${escapeHtml(label.href)}">${escapeHtml(label.text)}</a>` : escapeHtml(label.text);
    return `<li class="community-log-item">
        <span class="community-log-icon">${communityIcon(COMMUNITY_STATUS_ICON[entry.status] || "check")}</span>
        <span class="community-log-main"><span class="community-log-name">${name}</span><span class="community-log-status">${escapeHtml(COMMUNITY_STATUS_TEXT[entry.status] || entry.status)}${entry.ts ? ` · ${escapeHtml(communityRelativeDay(entry.ts))}` : ""}</span></span>
        <span class="community-pill community-outcome-${outcome}">${communityIcon(COMMUNITY_OUTCOME_ICON[outcome])}${escapeHtml(COMMUNITY_OUTCOME_TEXT[outcome])}</span>${label.issueUrl && /^https:\/\/github\.com\//.test(label.issueUrl) ? `<a class="community-issue-link" href="${escapeHtml(label.issueUrl)}" target="_blank" rel="noopener">View on GitHub</a>` : ""}${entry.failed ? `<span class="community-log-error"><span>${escapeHtml(entry.failed)}</span> <button type="button" class="community-link" data-action="community-retry" data-id="${escapeHtml(entry.id)}">Send again</button></span>` : ""}
      </li>`;
  }).join("");
  const volatileNote = waitingIds.size && typeof outboxIsDurable === "function" && !outboxIsDurable();
  const filters = entries.length >= 3
    ? `<div class="community-filter" role="group" aria-label="Filter your reports">${[["all", "All"], ["attention", `Needs attention${attention ? ` (${attention})` : ""}`], ["done", "Completed"]].map(([id, text]) => `<button type="button" class="community-filter-btn${filter === id ? " is-active" : ""}" data-action="community-log-filter" data-filter="${id}" aria-pressed="${filter === id}">${text}</button>`).join("")}</div>`
    : "";
  const empty = `<div class="community-empty">${typeof appIconHtml === "function" ? appIconHtml("tree", "app-icon community-empty-art") : ""}<p><strong>No reports yet</strong><span>Open a tree or a place and tap “Help check”. You get a point for each tree you check, and another when someone else agrees.</span></p></div>`;
  const setHero = (name, value) => { const el = communityHeroEl(name); if (el) el.textContent = value; };
  const pointsWord = score.points === 1 ? "point" : "points";
  setHero("note", "");
  const noteEl = communityHeroEl("note");
  if (noteEl) noteEl.hidden = true;
  const volatileEl = communityHeroEl("volatile");
  if (volatileEl) volatileEl.innerHTML = volatileNote ? `<p class="community-log-error">This browser can't save waiting reports. Keep the app open until they are sent.</p>` : "";
  const medalEl = communityHeroEl("medal");
  if (medalEl) medalEl.innerHTML = communityMedalHtml(rank);
  setHero("rank", rank.name);
  const chipsEl = communityHeroEl("chips");
  if (chipsEl) {
    chipsEl.innerHTML = communityBadgeChipsHtml(score, local);
    const badgesEl = communityHeroEl("badges");
    if (badgesEl) {
      badgesEl.hidden = !chipsEl.innerHTML;
      const detail = badgesEl.querySelector(".community-badge-detail");
      if (detail) detail.hidden = true;
    }
  }
  host.classList.remove("is-loading", "has-note");
  host.setAttribute("aria-busy", "false");
  setHero("rank-points", `${score.points} ${pointsWord} · ${rank.next ? `${rank.next.min - score.points} to ${rank.next.name}` : "Top rank"}`);
  setHero("points", String(score.points));
  setHero("points-label", pointsWord);
  setHero("verified", String(score.verified));
  setHero("confirmed", String(score.confirmed));
  setHero("reports", String(entries.length));
  const bar = communityHeroEl("bar");
  if (bar) {
    bar.setAttribute("aria-valuenow", String(progress));
    bar.setAttribute("aria-valuetext", `${rank.name}, ${progress}% of the way to ${rank.next ? rank.next.name : "the top rank"}`);
    bar.firstElementChild.style.width = `${progress}%`;
  }
  const badgesHost = document.getElementById("communityBadgesHost");
  if (badgesHost) badgesHost.innerHTML = "";
  const countHost = document.getElementById("communityReportsCount");
  if (countHost) countHost.textContent = entries.length ? ` (${entries.length})` : "";
  // A report that failed to send, is waiting or is under review has an action or an answer in it, so it is
  // never left behind a closed section: open it once, and leave it however the walker sets it after that.
  const reportsDetails = document.getElementById("communityReportsDetails");
  if (reportsDetails && attention > 0 && !reportsDetails.dataset.autoOpened) {
    reportsDetails.open = true;
    reportsDetails.dataset.autoOpened = "1";
  }
  const logHost = document.getElementById("communityLog");
  if (logHost) {
    logHost.classList.remove("is-loading");
    logHost.querySelector('[data-log="legend"]').innerHTML = communityLegendHtml(communityMapMarks());
    logHost.querySelector('[data-log="filters"]').innerHTML = filters;
    logHost.querySelector('[data-log="body"]').innerHTML = rows ? `<ul class="community-log">${rows}</ul>` : entries.length ? `<p class="community-empty community-empty-filter">${filter === "attention" ? "Nothing needs attention. Reports that fail to send or wait for review show here." : "No completed reports yet. They appear once others agree or a report is fixed."}</p>` : empty;
  }
}

// Reports the server holds for this person (this device and, when signed in, every device on the account)
// are shown in the log too. Only well-formed fields are kept; a report still waiting to send, one that failed,
// or one on this device that is as new or newer always wins over the server's copy.
const COMMUNITY_REMOTE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function communityMergeRemoteReports(local, remote, waitingIds = new Set()) {
  const merged = { ...local };
  let changed = false;
  for (const r of Array.isArray(remote) ? remote : []) {
    if (!r || typeof r !== "object" || !COMMUNITY_REMOTE_ID_RE.test(String(r.id || ""))) continue;
    if (!Object.prototype.hasOwnProperty.call(COMMUNITY_STATUS_TEXT, r.status)) continue;
    const kind = r.kind === "place" || r.kind === "feedback" ? r.kind : "tree";
    const target = typeof r.target === "string" && /^(tree|place):\S{1,74}$/.test(r.target) ? r.target : null;
    const tag = typeof r.tagNumber === "string" || typeof r.tagNumber === "number" ? String(r.tagNumber).trim().slice(0, 20) : "";
    const key = target || (kind === "feedback" ? `feedback:${r.id}` : tag ? `new:${tag}` : null);
    const ts = Number(r.ts);
    if (!key || !Number.isFinite(ts)) continue;
    const existing = merged[key];
    if (existing && (existing.id === r.id || waitingIds.has(existing.id) || existing.failed || Number(existing.ts) >= ts)) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    merged[key] = {
      id: r.id,
      status: r.status,
      ts,
      ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
      ...(kind === "place" ? { kind: "place" } : kind === "feedback" ? { kind: "feedback", name: "Feedback" } : {}),
      ...(tag && !target ? { name: `Tree ${tag}` } : {}),
      counted: true,
      remote: true,
    };
    changed = true;
  }
  return { local: merged, changed };
}

// Entries that came from the server rather than from this device. Dropped when the signed-in account
// changes, so one person's history is never shown to the next person to use the same browser.
function communityClearRemoteEntries() {
  const local = communityReadLocal();
  let changed = false;
  for (const [key, entry] of Object.entries(local)) {
    if (entry && entry.remote) { delete local[key]; changed = true; }
  }
  if (changed) communityWriteLocal(local);
  try { localStorage.removeItem(communityScoped(COMMUNITY_LOG_KEY)); } catch {}
}

async function communityRefreshLog() {
  if (!navigator.onLine) return;
  if (!(await communityWhenIdentityKnown())) return;
  try {
    const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(communityDeviceId())}&list=1`);
    if (!response.ok) return;
    const data = await response.json();
    const outcomes = {};
    for (const report of data.reports || []) outcomes[report.id] = report.outcome;
    localStorage.setItem(communityScoped(COMMUNITY_LOG_KEY), JSON.stringify(outcomes));
    const waiting = new Set((await outboxList()).map((item) => item.id));
    const merged = communityMergeRemoteReports(communityReadLocal(), data.reports, waiting);
    if (merged.changed) {
      communityWriteLocal(merged.local);
      communityMarksChanged();
    }
  } catch {}
}

// Marks arrived after the screen opened (another device's history): draw them, and for someone away from the
// forest, whose camera frames only their own marks, frame the new ones.
function communityMarksChanged() {
  if (!(state.selected && state.selected.type === "community")) return;
  if (typeof communityFramesOwnMarksOnly === "function" && communityFramesOwnMarksOnly() && typeof fitCommunityOwnMarks === "function") {
    fitCommunityOwnMarks({ animate: true });
  }
  if (typeof requestDraw === "function") requestDraw();
}

// --- Sign-in: optional. Points work anonymously; an account lets them follow the person across devices ---
function communityAccountHtml() {
  return `<section class="community-account" id="communityAccount" aria-live="polite">
      <p class="community-account-line is-loading" data-account="line"><span class="community-skel-text" aria-hidden="true"></span></p>
      <div data-account="note"></div>
      <div data-account="recover" hidden>${communityRecoveryHtml()}</div>
    </section>`;
}

// Who is signed in, as last told by /api/auth/me. Kept in memory as well as in storage: where storage is
// blocked the page must still know which account it is acting for, or it would file reports under the wrong id.
let communityAccountMemory;

function communityReadAccount() {
  if (communityAccountMemory !== undefined) return communityAccountMemory;
  try { return JSON.parse(localStorage.getItem(COMMUNITY_ACCOUNT_KEY)) || null; } catch { return null; }
}

const COMMUNITY_SIGNIN_DISMISSED_KEY = "ff-community-signin-dismissed-v1";

function communityDismissSignin() {
  try { localStorage.setItem(COMMUNITY_SIGNIN_DISMISSED_KEY, "1"); } catch {}
  communityRenderAccount(communityReadAccount());
}

// Writes into the account section drawn once by communityAccountHtml: the sentence, any note, and whether the
// backup disclosure applies (signed out only). `null` puts it back to its loading state.
function communityRenderAccount(account, note = "") {
  const host = document.getElementById("communityAccount");
  if (!host) return;
  const line = host.querySelector('[data-account="line"]');
  const noteEl = host.querySelector('[data-account="note"]');
  const recover = host.querySelector('[data-account="recover"]');
  noteEl.innerHTML = note ? `<p class="community-account-note" role="status">${escapeHtml(note)}</p>` : "";
  line.classList.remove("is-loading");
  line.classList.toggle("community-account-quiet", !(account && account.signedIn));
  // No sign-in inside the native app: see settingsAccountHtml (js/app.js).
  line.innerHTML = account && account.signedIn
    ? `<span class="community-account-copy">Signed in as <strong>${escapeHtml(account.name)}</strong>.</span><a href="/api/auth/logout?return=/community">Sign out</a>`
    : (Native.isNative ? "" : `<a href="/api/auth/login?return=/community">Sign in to take your points with you</a>`);
  recover.hidden = Boolean(account && account.signedIn);
}

function communityResetAccount() {
  const host = document.getElementById("communityAccount");
  if (!host) return;
  const line = host.querySelector('[data-account="line"]');
  line.classList.add("is-loading");
  line.classList.remove("community-account-quiet");
  line.innerHTML = `<span class="community-skel-text" aria-hidden="true"></span>`;
  host.querySelector('[data-account="note"]').innerHTML = "";
  host.querySelector('[data-account="recover"]').hidden = true;
}

// Learn who is signed in, and link this device to that account once. A 409 is shown, not retried.
// One refresh at a time: the Community screen can be opened twice in quick succession, and two refreshes
// would both see "not linked yet" and post the link twice.
let communityAccountInflight = null;

function communityRefreshAccount() {
  if (communityAccountInflight) return communityAccountInflight;
  communityAccountInflight = communityRefreshAccountOnce().then((result) => {
    communityIdentityFailed = result === "failed";
    if (!communityIdentityFailed) communityIdentitySettled = true;
    return result;
  }).finally(() => { communityAccountInflight = null; });
  return communityAccountInflight;
}

// Until /api/auth/me has answered once on this page, the stored account may be a previous person's, so
// nothing that names a device on the network goes out yet: a request must never carry the last account's id
// while someone else is signing in. A failed answer does not count as one: while a signed-in account is
// remembered and the check keeps failing, those requests stay unsent (an anonymous browser has no one to leak).
let communityIdentitySettled = false;
let communityIdentityFailed = false;
async function communityWhenIdentityKnown() {
  if (!communityIdentitySettled) await communityRefreshAccount();
  const known = communityReadAccount();
  return !(communityIdentityFailed && known && known.signedIn);
}

async function communityPostLink(deviceId) {
  const response = await fetch("/api/auth/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  return { ok: response.ok, status: response.status, error: response.ok ? "" : (await response.json().catch(() => ({}))).error || "" };
}

const COMMUNITY_NATIVE_ACCOUNT_NOTE = "Your points stay on this device. Signing in isn't available in the app yet.";

// Resolves "ok" once /api/auth/me has answered (and the device is linked), "offline" when there is no network
// (the last known account stands), or "failed" when the network is there but who is signed in could not be found out.
async function communityRefreshAccountOnce() {
  // The app has no sign-in (its cookie redirect cannot come back into the shell, and /api/auth/* is not
  // open to it), so there is no one to ask about: it is always this device, anonymously.
  if (Native.isNative) {
    communityAccountMemory = { signedIn: false };
    communityRenderAccount(communityAccountMemory, COMMUNITY_NATIVE_ACCOUNT_NOTE);
    return "ok";
  }
  if (!navigator.onLine) return "offline";
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) return "failed";
    const account = await response.json();
    const previous = communityReadAccount();
    // Signed out, or a different account on this browser: nothing of the last account's server history or
    // link stays behind. Cleared while the stored account still names the previous one, so it is that
    // account's own device scope that is cleaned.
    const switched = previous && previous.signedIn && (!account.signedIn || (previous.account && previous.account !== account.account));
    if (switched) communityClearRemoteEntries();
    communityAccountMemory = account;
    try { localStorage.setItem(COMMUNITY_ACCOUNT_KEY, JSON.stringify(account)); } catch {}
    if (switched || !account.signedIn) localStorage.removeItem(COMMUNITY_LINKED_KEY);

    let note = "";
    if (account.signedIn && account.account) {
      const devices = communityAccountDevices();
      let deviceId = devices[account.account] || communityPrimaryDeviceId();
      if (localStorage.getItem(COMMUNITY_LINKED_KEY) !== `${deviceId}|${account.account}`) {
        let linked = await communityPostLink(deviceId);
        if (!linked.ok && linked.status === 409 && !devices[account.account]) {
          // This browser's own id already belongs to another account. Rather than show that account's
          // history and score to this one (or file this one's reports under it), this account gets a new
          // device id of its own on this browser, with its own local history.
          deviceId = communityRandomId();
          linked = await communityPostLink(deviceId);
          if (linked.ok) note = "Someone else's account already uses this browser's earlier reports, so you're starting fresh here.";
        }
        if (linked.ok) {
          communitySaveAccountDevice(account.account, deviceId);
          try { localStorage.setItem(COMMUNITY_LINKED_KEY, `${deviceId}|${account.account}`); } catch {}
        } else {
          note = linked.error || "Couldn't link this device right now.";
        }
      }
      if (communityAccountDevicesUnsaved && communityAccountDevices()[account.account]) {
        note = `${note ? `${note} ` : ""}This browser can't save your sign-in here, so history made on it won't be remembered after you close this page. Your account's other devices are not affected.`;
      }
    }
    communityRenderAccount(account, note);
    return "ok";
  } catch {
    return "failed";
  }
}

// Who is signed in decides which device's history and score belong on this screen, so nothing is drawn from
// storage until that is known: otherwise a second person on a shared browser could see the first person's
// rows for a moment. Offline there is nothing to ask and the last known account stands. If the network is there
// but the answer is not, a signed-in browser shows no history at all; an anonymous one carries on as normal.
async function communityOpenContributions() {
  if (!navigator.onLine) communityRenderAccount(communityReadAccount());
  else {
    // A screen that is already drawn (reopened, or the account changed in another tab) still shows the last
    // account until this answers: put it back to a neutral state first.
    communityResetAccount();
    communityResetHosts();
  }
  const identity = await communityRefreshAccount();
  const known = communityReadAccount();
  if (identity === "failed" && known && known.signedIn) {
    communityResetHosts("Couldn't check who is signed in just now. Reload to try again.");
    communityResetAccount();
    return;
  }
  await communityRenderContributions();
  await Promise.all([communityRefreshScore(), communityRefreshLog()]);
  await communityRenderContributions();
}
