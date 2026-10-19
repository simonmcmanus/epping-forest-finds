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
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15Z"/><path d="M5 19c2-5 5-8 9-10"/>',
  tree: '<path d="M12 21v-6"/><path d="M12 15a5.5 5.5 0 0 0 4-9.3A5 5 0 0 0 7.5 5 5 5 0 0 0 8 15Z"/>',
};

function communityIcon(name, className = "community-icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${COMMUNITY_ICONS[name] || ""}</svg>`;
}

// `needsPosition` reports use the reporter's own GPS as the corrected / new spot.
const COMMUNITY_TREE_CHOICES = [
  { status: "VERIFIED", label: "It's here, and the tag matches", icon: "check" },
  { status: "NO_TAG_LIKELY_SAME", label: "No tag, but it looks right", icon: "tag" },
  { status: "NO_TAG_UNSURE", label: "No tag, and I doubt it", icon: "help" },
  { status: "DIFFERENT_TREE", label: "A different tree is here", icon: "swap" },
  { status: "NOT_HERE", label: "There's no tree here", icon: "cross" },
  { status: "MOVED", label: "Tag found, map is wrong", icon: "locate", needsPosition: true },
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
  far: "Not close enough for points",
  failed: "Couldn't send",
};
const COMMUNITY_OUTCOME_ICON = { waiting: "upload", pending: "clock", confirmed: "check", review: "alert", sent: "check", checked: "check", validated: "shield", fixed: "check", far: "alert", failed: "alert" };

// Places (pubs, cafes, shops...): confirmations are a quiet check-in; any change is filed as a
// GitHub issue for a person to review -- never applied automatically.
const COMMUNITY_ISSUE_URL = "/.netlify/functions/report-missing-data";
const COMMUNITY_PLACE_CHOICES = [
  { status: "OPEN_CONFIRMED", label: "Yes, it's still here and correct", icon: "check" },
  { status: "CLOSED", label: "It's closed", icon: "cross", notePlaceholder: "Anything we should know? (optional)" },
  { status: "MOVED", label: "It has moved", icon: "locate", notePlaceholder: "Where is it now? (optional)" },
  { status: "RENAMED", label: "The name has changed", icon: "tag", noteRequired: true, notePlaceholder: "What is it called now?" },
  { status: "DETAILS_CHANGED", label: "Details are wrong", icon: "edit", noteRequired: true, notePlaceholder: "What should it say? (hours, website, phone…)" },
  { status: "WRONG_CATEGORY", label: "Wrong type of place", icon: "swap", notePlaceholder: "What type of place is it? (optional)" },
];

let communityOverlay = { generatedAt: 0, entries: {} };

function communityRandomId(length = 24) {
  const bytes = new Uint8Array(length);
  (window.crypto || crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function communityDeviceId() {
  try {
    const existing = localStorage.getItem(COMMUNITY_DEVICE_KEY);
    if (existing) return existing;
  } catch {}
  const id = communityRandomId();
  try { localStorage.setItem(COMMUNITY_DEVICE_KEY, id); } catch {}
  return id;
}

function communityTreeTarget(tree) {
  const id = tree.recordNumber ?? tree.id;
  return id == null ? null : `tree:${id}`;
}

function communityReadLocal() {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_LOCAL_KEY)) || {}; } catch { return {}; }
}

function communityWriteLocal(map) {
  try { localStorage.setItem(COMMUNITY_LOCAL_KEY, JSON.stringify(map)); } catch {}
}

// Always numbers, whatever was stored: the score comes from the network.
function communityReadScore() {
  try {
    const raw = JSON.parse(localStorage.getItem(COMMUNITY_SCORE_KEY));
    if (!raw || typeof raw !== "object") return null;
    return { points: Number(raw.points) || 0, verified: Number(raw.verified) || 0, confirmed: Number(raw.confirmed) || 0 };
  } catch { return null; }
}

// Builds, saves locally (optimistic) and queues one report. Resolves the stored local record.
async function communitySubmitReport({ kind = "tree", target, status, targetLat, targetLon, newLat, newLon, note, tagNumber, accuracy }) {
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
  };
  const local = communityReadLocal();
  const key = target || `new:${tagNumber || `${payload.lat},${payload.lon}`}`;
  const markLat = Number.isFinite(Number(targetLat)) ? Number(targetLat) : payload.lat;
  const markLon = Number.isFinite(Number(targetLon)) ? Number(targetLon) : payload.lon;
  // Made from too far away (or with no position), it is still saved, but it will not score.
  const far = kind === "tree" && Number.isFinite(Number(targetLat)) && Number.isFinite(Number(targetLon)) && communityRange(Number(targetLat), Number(targetLon)).state !== "near";
  local[key] = { id, status, ts: Date.now(), lat: markLat, lon: markLon, ...(far ? { far: true } : {}), ...(tagNumber ? { name: `Tree ${tagNumber}` } : {}) };
  communityWriteLocal(local);
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
        <p><strong>Questioned by the community</strong><span>${escapeHtml(COMMUNITY_STATUS_TEXT[entry.st] || "Needs checking")} (${entry.n} people). The official record is unchanged.</span></p></div>`;
  }
  if (entry.s === "verified" || entry.s === "confirmed") {
    // A summary the reader can see at a glance, with the detail behind a tap.
    const people = `${entry.n} ${entry.n === 1 ? "person has" : "people have"}`;
    return `<details class="community-badge community-badge-verified">
        <summary>${communityIcon("shield")}<strong>Verified by ${entry.n === 1 ? "1 person" : `${entry.n} people`}</strong><span class="community-badge-more">Tap for details</span></summary>
        <p>${people} confirmed this tree is where the map says it is. Community checks never change the official record.</p></details>`;
  }
  return "";
}

function communityChoiceHtml(choice, chosen) {
  const attrs = `data-action="community-report" data-status="${choice.status}"${choice.needsPosition ? ' data-needs-position="1"' : ""}`;
  if (choice.status === "VERIFIED") {
    return `<button class="community-verify${chosen ? " is-chosen" : ""}" type="button" ${attrs}>${communityIcon(choice.icon, "community-icon community-verify-icon")}<span>${escapeHtml(choice.label)}</span></button>`;
  }
  return `<button class="community-chip${chosen ? " is-chosen" : ""}" type="button" ${attrs}><span class="community-chip-icon">${communityIcon(choice.icon)}</span><span class="community-chip-label">${escapeHtml(choice.label)}</span></button>`;
}

// How far the reader is from a tree, for the "you need to be close to earn points" note. A check only
// earns points when it is made within COMMUNITY_NEAR_METRES (the server's NEAR_METRES) of the tree, but
// reporting from anywhere is allowed.
const COMMUNITY_NEAR_METRES = 10;

function communityRange(lat, lon) {
  if (!(typeof hasRealLocation === "function" && hasRealLocation()) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { state: "none" };
  const metres = distanceMetres(state.userLocation.latitude, state.userLocation.longitude, lat, lon);
  return { state: metres <= COMMUNITY_NEAR_METRES ? "near" : "far", metres };
}

// The points a check earns, given where it was made (server rules: community-points.js). A verify
// earns 1 now and 1 more when someone else confirms; a "this is wrong" report earns 2 only if others
// agree; nothing counts from outside the zone.
function communityPointsText(status, rangeState) {
  if (rangeState === "none") return "Points need your location";
  if (rangeState === "far") return "Points: 0 from this check";
  if (!status || status === "VERIFIED") return "Points: +1 now, +1 more if someone else confirms";
  return "Points: up to +2 if others agree";
}

function communityRangeNoteHtml(lat, lon, status) {
  const range = communityRange(lat, lon);
  const heading = range.state === "near" ? "Inside the 10 m check zone"
    : range.state === "far" ? "Outside the 10 m check zone"
    : "Location is off";
  const text = range.state === "near" ? "You're close enough for this to earn points."
    : range.state === "far" ? `You're about ${Math.round(range.metres)} m away. You can still report this, but you need to be within ${COMMUNITY_NEAR_METRES} m of the tree to earn points.`
    : `You can report this from anywhere. To earn points, turn on location and stand within ${COMMUNITY_NEAR_METRES} m of the tree.`;
  return `<div class="community-range community-range-${range.state}">${communityIcon(range.state === "near" ? "check" : "locate")}<div><strong>${heading}</strong><span>${escapeHtml(text)}</span><span class="community-range-points">${escapeHtml(communityPointsText(status, range.state))}</span></div></div>`;
}

// Called with each GPS fix so the note follows the reader as they walk up to the tree.
function communityUpdateRangeNotes() {
  document.querySelectorAll(".community-check[data-community-target]").forEach((section) => {
    const note = section.querySelector(".community-range");
    if (!note || section.dataset.kind === "place") return;
    const chosen = section.querySelector(".is-chosen");
    note.outerHTML = communityRangeNoteHtml(Number(section.dataset.lat), Number(section.dataset.lon), chosen ? chosen.dataset.status : null);
  });
}

function communitySectionInnerHtml(target, editing, lat, lon) {
  const local = communityReadLocal()[target];
  const remote = communityOverlay.entries[target];
  if (local && !editing) {
    return `${communityBadgeHtml(remote)}
      <div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>You reported: ${escapeHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status)}</strong>
          <span>Thank you! Other people may take an hour or two to see this.${local.far ? ` It only earns points when you report within ${COMMUNITY_NEAR_METRES} m of the tree.` : ""}</span>
          <span class="community-range-points community-earned-${local.far ? "far" : "near"}">${escapeHtml(communityPointsText(local.status, local.far ? "far" : "near"))}</span></p>
        <button class="community-link" type="button" data-action="community-change">Change</button>
      </div>`;
  }
  const [primary, ...others] = COMMUNITY_TREE_CHOICES;
  const chosen = local ? local.status : null;
  return `${communityBadgeHtml(remote)}
      ${communityChoiceHtml(primary, chosen === primary.status)}
      <p class="community-or">Something not right?</p>
      <div class="community-choices">${others.map((c) => communityChoiceHtml(c, chosen === c.status)).join("")}</div>
      ${communityRangeNoteHtml(lat, lon, chosen)}
      <p class="report-note community-status" aria-live="polite"></p>`;
}

// The block on a tree's detail screen (js/inspector.js showTreeDetails).
function communitySectionHtml(tree) {
  const target = communityTreeTarget(tree);
  if (!target || tree.latitude == null || tree.longitude == null) return "";
  return `<section class="community-check" data-community-target="${escapeHtml(target)}" data-lat="${tree.latitude}" data-lon="${tree.longitude}">
      <div class="community-head">
        <span class="community-head-icon">${communityIcon("shield")}</span>
        <div><h3 class="community-title">Help check this tree</h3><p class="community-sub">Is it where the map says it is?</p></div>
      </div>
      <div class="community-body">${communitySectionInnerHtml(target, false, Number(tree.latitude), Number(tree.longitude))}</div>
    </section>`;
}

function communityRefreshSections() {
  document.querySelectorAll(".community-check").forEach((section) => {
    const body = section.querySelector(".community-body");
    if (!body) return;
    body.innerHTML = section.dataset.kind === "place"
      ? communityPlaceInnerHtml(section)
      : communitySectionInnerHtml(section.dataset.communityTarget, section.dataset.editing === "1", Number(section.dataset.lat), Number(section.dataset.lon));
  });
}

async function communityHandleChoice(button) {
  const section = button.closest(".community-check");
  if (!section) return;
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
    newLat = Number(state.userLocation.latitude.toFixed(6));
    newLon = Number(state.userLocation.longitude.toFixed(6));
  }
  await communitySubmitReport({ kind: "tree", target, status, targetLat, targetLon, newLat, newLon });
  delete section.dataset.editing;
  communityRefreshSections();
}

function communityHandleChange(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  section.dataset.editing = "1";
  communityRefreshSections();
}

async function communityLoadOverlay() {
  try {
    const response = await fetch(COMMUNITY_OVERLAY_URL);
    if (!response.ok) return;
    const data = await response.json();
    if (data && typeof data.entries === "object") {
      communityOverlay = { generatedAt: data.generatedAt || 0, entries: data.entries };
      communityRefreshSections();
    }
  } catch {}
}

// The score is kept on the device; opening the app only re-asks the server if it is over an hour
// old. Sending a report and opening the Community screen always refresh it (force).
const COMMUNITY_SCORE_AT_KEY = "ff-community-score-at-v1";
const COMMUNITY_SCORE_MAX_AGE_MS = 60 * 60 * 1000;

async function communityRefreshScore(force = true) {
  if (!navigator.onLine) return;
  try {
    if (!force) {
      const at = Number(localStorage.getItem(COMMUNITY_SCORE_AT_KEY)) || 0;
      if (Date.now() - at < COMMUNITY_SCORE_MAX_AGE_MS) return;
    }
    localStorage.setItem(COMMUNITY_SCORE_AT_KEY, String(Date.now()));
    const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(communityDeviceId())}`);
    if (!response.ok) return;
    const score = await response.json();
    localStorage.setItem(COMMUNITY_SCORE_KEY, JSON.stringify(score));
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

// Accepts the code as shown (grouped with dashes, any case or spacing) or a raw id.
function communityParseRecoveryCode(input) {
  const text = String(input || "").trim().replace(/\s+/g, "");
  if (COMMUNITY_RECOVERY_RE.test(text) && !text.includes("-")) return text;
  const compact = text.replace(/-/g, "").toLowerCase();
  if (/^[a-z0-9]{24}$/.test(compact)) return compact;
  return COMMUNITY_RECOVERY_RE.test(text) ? text : null;
}

function communityRecoveryHtml() {
  return `<details class="community-recover">
      <summary>${communityIcon("shield")}<span>Back up or restore your progress</span></summary>
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
    local[key] = { id: r.id, status: r.status, ts: r.ts, lat: r.lat, lon: r.lon, ...(r.kind === "place" ? { kind: "place" } : {}), ...(r.tagNumber ? { name: `Tree ${r.tagNumber}` } : {}) };
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
    say(adopted ? `Restored. ${adopted} ${adopted === 1 ? "report" : "reports"} found.` : "Restored. This code has no reports yet.");
    const shown = document.getElementById("communityRecoveryCode");
    if (shown) shown.textContent = communityRecoveryCode();
    communityOpenContributions();
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

// The decision, with no DOM: what should happen for this GPS fix? Returns "card" (offer on the
// overview), "pulse" (draw the eye on the tree's own page) or "none".
function communityNudgeDecision({ on, fixOk, isDefault, nearest, target, alreadyReported, seenAt, now, onThisTree, lastCardAt, overviewActive }) {
  if (!on || !fixOk || isDefault) return "none";
  if (!nearest || !(nearest.metres <= COMMUNITY_NUDGE_METRES) || !target || alreadyReported) return "none";
  if (seenAt && now - seenAt < COMMUNITY_NUDGE_TREE_COOLDOWN_MS) return "none";
  if (onThisTree) return "pulse";
  if (now - lastCardAt < COMMUNITY_NUDGE_GLOBAL_GAP_MS || !overviewActive) return "none";
  return "card";
}

// Called with every fresh GPS fix. Quiet unless the fix is real and accurate, the tree is close,
// and this device has not already checked it or been nudged about it today.
function communityNudgeCheck(now = Date.now()) {
  // A card is only an offer on the Nearby overview; once you have gone to another screen, drop it.
  communityUpdateRangeNotes();
  if (document.getElementById("communityNudge") && typeof isOverviewScreenActive === "function" && !isOverviewScreenActive()) communityNudgeDismiss();
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
    alreadyReported: Boolean(target && communityReadLocal()[target]),
    seenAt: target ? seen[target] : 0,
    now, onThisTree,
    lastCardAt: communityNudgeLastAt,
    overviewActive: typeof isOverviewScreenActive !== "function" || isOverviewScreenActive(),
  });
  if (decision === "none") return;
  if (decision === "pulse") {
    communityNudgeDismiss(); // a card from the overview is moot once you are on the tree itself
    const section = document.querySelector(".community-check");
    if (!section || section.dataset.communityTarget !== target) return;
    section.classList.add("community-nudge-pulse");
    setTimeout(() => section.classList.remove("community-nudge-pulse"), 2600);
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
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="community-nudge-icon">${communityIcon("shield")}</span>
    <div class="community-nudge-text"><strong>You're next to ${name}</strong><span>Is it where the map says? About ${Math.max(1, Math.round(metres))} m away.</span></div>
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
  // Fetched after first paint so it never competes with the map's own data.
  window.addEventListener("load", () => setTimeout(() => { communityLoadOverlay(); communityRefreshScore(false); }, 1000));
  // The log shows "Waiting to send" while a report is queued, so redraw it whenever the queue changes
  // (a send finishing included); otherwise it keeps saying so until the screen is reopened.
  window.addEventListener("outbox:change", () => {
    if (document.getElementById("communityContributions") && typeof communityRenderContributions === "function") communityRenderContributions();
  });
  window.addEventListener("outbox:sent", (event) => {
    const detail = event.detail;
    if (!detail || !detail.item) return;
    if (detail.item.url === COMMUNITY_REPORT_URL) communityRefreshScore();
    if (detail.item.url === COMMUNITY_ISSUE_URL) {
      const local = communityReadLocal();
      const key = Object.keys(local).find((k) => local[k].id === detail.item.id);
      if (key && detail.ok && detail.response && detail.response.issueUrl) {
        local[key].issueUrl = detail.response.issueUrl;
        delete local[key].failed;
        delete local[key].retry;
        communityWriteLocal(local);
      } else if (key && !detail.ok) {
        // The server refused it (not just offline): say so instead of claiming it was sent.
        local[key].failed = String((detail.response && detail.response.error) || "The server refused the report.").slice(0, 200);
        local[key].retry = { id: detail.item.id, url: detail.item.url, payload: detail.item.payload };
        communityWriteLocal(local);
      }
    }
  });
}

// The short summary at the top of the Community screen, linking on to the full explainer page
// (community/index.html, a static public page).
const COMMUNITY_EXPLAINER_URL = "/contribute";

function communityIntroHtml() {
  return `<a class="community-intro" href="${COMMUNITY_EXPLAINER_URL}" target="_blank" rel="noopener">
      <span class="community-intro-icon">${communityIcon("shield")}</span>
      <span class="community-intro-text"><strong>Help keep the map right</strong><span>Check, add and fix data to earn points</span></span>
      ${communityIcon("chevron")}
    </a>`;
}

// --- "Add a missing tree" on the Community screen ---
// A new tree needs its tag number (what identifies it) and a close, accurate GPS fix (where it is),
// so the form says so, shows the live accuracy, and only enables Submit once both are true.
const COMMUNITY_MAX_ACCURACY_METRES = 30;
let communityLocationTimer = null;

function communityAddTreeHtml() {
  return `<section class="settings-section community-add-tree">
      <h3 class="settings-section-title">Add a missing tree</h3>
      <div id="communityAddTreeBody">${communityAddTreeIdleHtml()}</div>
    </section>`;
}

function communityAddTreeIdleHtml() {
  return `<div class="community-new-tree">
      <span class="community-new-icon">${typeof appIconHtml === "function" ? appIconHtml("tree", "app-icon community-new-art") : ""}</span>
      <div class="community-new-text">
        <p class="community-new-title">Found a tree that's not on the map?</p>
        <p class="report-note">You'll need its tag number, and to be standing right next to it.</p>
      </div>
      <button class="community-add" type="button" data-action="community-add-start">${communityIcon("plus")}<span>Start</span></button>
    </div>`;
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
  const accuracy = Number(state.userLocation.accuracy);
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
  const body = document.getElementById("communityAddTreeBody");
  if (!body) return;
  body.innerHTML = communityAddTreeFormHtml();
  communityUpdateAddTreeState();
  clearInterval(communityLocationTimer);
  communityLocationTimer = setInterval(communityUpdateAddTreeState, 1500);
  const input = document.getElementById("communityTagInput");
  if (input) input.addEventListener("input", communityUpdateAddTreeState);
  const form = document.getElementById("communityAddTreeForm");
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); communitySubmitNewTree(); });
}

function communityCancelAddTree() {
  clearInterval(communityLocationTimer);
  communityLocationTimer = null;
  const body = document.getElementById("communityAddTreeBody");
  if (body) body.innerHTML = communityAddTreeIdleHtml();
}

async function communitySubmitNewTree() {
  const statusEl = document.getElementById("communityAddTreeStatus");
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const tag = ((document.getElementById("communityTagInput") || {}).value || "").trim();
  const note = ((document.getElementById("communityTreeNote") || {}).value || "").trim();
  const fix = communityCurrentFix();
  if (!tag) return say("Please enter the tree's tag number.");
  if (normalizeTreeNumber(tag) === "0" || !normalizeTreeNumber(tag)) return say("That isn't a usable tag number. Look for the number printed on the tag.");
  if (!fix.ok) return say("We need a close, accurate location. Stand next to the tree and wait for a better GPS fix.");
  const known = (state.trees || []).find((tree) => tree.tagNumber != null && normalizeTreeNumber(tree.tagNumber) === normalizeTreeNumber(tag));
  if (known) {
    return say(`Tag ${tag} is already on the map (${treeDisplayName(known)}). Open that tree and check it instead.`);
  }
  const lat = Number(state.userLocation.latitude.toFixed(6));
  const lon = Number(state.userLocation.longitude.toFixed(6));
  await communitySubmitReport({ kind: "tree", status: "NEW_TREE", target: undefined, targetLat: lat, targetLon: lon, tagNumber: tag, accuracy: Math.round(fix.accuracy), note });
  clearInterval(communityLocationTimer);
  communityLocationTimer = null;
  const body = document.getElementById("communityAddTreeBody");
  if (body) {
    body.innerHTML = `<div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>Tree ${escapeHtml(tag)} saved</strong><span>Thank you! It shows for everyone once a second person finds it too, which can take an hour or two.</span></p>
      </div>`;
  }
  communityOpenContributions();
}

// --- "Help check this place" on a place's detail screen (js/inspector.js showLandmarkDetails) ---

function communityPlaceChoiceHtml(choice) {
  const attrs = `data-action="community-place-choose" data-status="${choice.status}"`;
  if (choice.status === "OPEN_CONFIRMED") {
    return `<button class="community-verify" type="button" ${attrs}>${communityIcon(choice.icon, "community-icon community-verify-icon")}<span>${escapeHtml(choice.label)}</span></button>`;
  }
  return `<button class="community-chip" type="button" ${attrs}><span class="community-chip-icon">${communityIcon(choice.icon)}</span><span class="community-chip-label">${escapeHtml(choice.label)}</span></button>`;
}

function communityPlaceInnerHtml(section) {
  const target = section.dataset.communityTarget;
  const pending = COMMUNITY_PLACE_CHOICES.find((c) => c.status === section.dataset.pending);
  if (pending) {
    return `<div class="community-note">
        <p class="community-note-title">${communityIcon(pending.icon)}<span>${escapeHtml(pending.label)}</span></p>
        <textarea class="report-textarea community-note-input" rows="3" maxlength="400" placeholder="${escapeHtml(pending.notePlaceholder || "")}"></textarea>
        <p class="report-note community-status" aria-live="polite"></p>
        <div class="community-note-actions">
          <button class="community-link" type="button" data-action="community-cancel-note">Cancel</button>
          <button class="community-send" type="button" data-action="community-send-place">Send report</button>
        </div>
      </div>`;
  }
  const local = communityReadLocal()[target];
  if (local && section.dataset.editing !== "1") {
    return `<div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>You reported: ${escapeHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status)}</strong>
          <span>Thank you! A person will review this. You earn points if it's confirmed.</span></p>
        <button class="community-link" type="button" data-action="community-change">Change</button>
      </div>`;
  }
  const [primary, ...others] = COMMUNITY_PLACE_CHOICES;
  return `${communityPlaceChoiceHtml(primary)}
      <p class="community-or">Something not right?</p>
      <div class="community-choices">${others.map(communityPlaceChoiceHtml).join("")}</div>
      <p class="report-note community-status" aria-live="polite"></p>`;
}

// --- Community reports on a place: the open and closed GitHub issues people have filed about it ---

const COMMUNITY_REPO = "simonmcmanus/epping-forest-finds";
const communityPlaceIssueCache = new Map();

function communityPlaceIssuesUrl(placeKey) {
  return `https://github.com/${COMMUNITY_REPO}/issues?q=${encodeURIComponent(`is:issue label:place-check "place-key:${placeKey}"`)}`;
}

// A hidden line under the place's card, filled in by loadCommunityPlaceIssues once GitHub answers.
function communityPlaceIssuesHtml(place) {
  if (!place || place.latitude == null) return "";
  const key = `place:${placeHashKey(place)}`;
  return `<p class="community-place-issues" data-place-key="${escapeHtml(key)}" hidden></p>`;
}

// Public repo, so the search needs no token. Any failure leaves the line hidden: it is extra
// information, never something the place page should wait on or report as an error.
async function loadCommunityPlaceIssues(place) {
  const key = `place:${placeHashKey(place)}`;
  const host = document.querySelector(`.community-place-issues[data-place-key="${CSS.escape(key)}"]`);
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
      found = { total: data.total_count || 0, open: items.filter((item) => item.state === "open").length };
      communityPlaceIssueCache.set(key, found);
    } catch {
      return;
    }
  }
  if (!found.total) return;
  const count = `${found.total} ${found.total === 1 ? "issue" : "issues"}`;
  const openText = found.open ? `${found.open} still open` : "all closed";
  host.innerHTML = `${communityIcon("alert")}<span><strong>The community has raised ${count} about this place</strong> (${openText}).</span> <a class="community-link" href="${escapeHtml(communityPlaceIssuesUrl(key))}" target="_blank" rel="noopener">See them on GitHub</a>`;
  host.hidden = false;
}

function communityPlaceSectionHtml(place) {
  if (!place || !place.name || place.latitude == null || place.longitude == null) return "";
  const target = `place:${placeHashKey(place)}`;
  const earlier = communityReadLocal()[target];
  if (earlier && earlier.status === "OPEN_CONFIRMED") return ""; // already confirmed on this device: no card
  const category = place.categoryLabel || "Local place";
  return `<section class="community-check community-check-place" data-kind="place" data-community-target="${escapeHtml(target)}" data-lat="${place.latitude}" data-lon="${place.longitude}" data-name="${escapeHtml(place.name)}" data-category="${escapeHtml(category)}">
      <div class="community-head">
        <span class="community-head-icon">${communityIcon("shield")}</span>
        <div><h3 class="community-title">Help check this place</h3><p class="community-sub">Is this listing still right?</p></div>
      </div>
      <div class="community-body">${communityPlaceInnerHtml({ dataset: { communityTarget: target } })}</div>
    </section>`;
}

async function communitySubmitPlace(section, status, note) {
  const target = section.dataset.communityTarget;
  const lat = Number(section.dataset.lat);
  const lon = Number(section.dataset.lon);
  const name = section.dataset.name || "";
  const category = section.dataset.category || "";
  const id = communityRandomId();
  const local = communityReadLocal();
  local[target] = { id, status, ts: Date.now(), kind: "place", name, lat, lon };
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
    } }).then(() => { if (navigator.onLine) outboxFlush(); }).catch(() => {});
  }
  if (typeof requestDraw === "function") requestDraw();
}

async function communityHandlePlaceChoice(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const status = button.dataset.status;
  if (status === "OPEN_CONFIRMED") {
    await communitySubmitPlace(section, status, "");
    section.remove(); // checked: nothing more to ask about this place
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
  if (choice.noteRequired && !note) {
    const statusEl = section.querySelector(".community-status");
    if (statusEl) statusEl.textContent = "Please add a few words so we can check it.";
    return;
  }
  await communitySubmitPlace(section, choice.status, note);
  delete section.dataset.pending;
  delete section.dataset.editing;
  communityRefreshSections();
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
  try { return JSON.parse(localStorage.getItem(COMMUNITY_LOG_KEY)) || {}; } catch { return {}; }
}

function communityTargetLabel(key, entry) {
  if (key.startsWith("feedback:")) return { text: (entry && entry.name) || "Feedback", href: null };
  if (key.startsWith("place:")) return { text: (entry && entry.name) || "Place", href: null, issueUrl: entry && entry.issueUrl };
  if (key.startsWith("tree:") && typeof findTreeByHashKey === "function") {
    const tree = findTreeByHashKey(`r${key.slice(5)}`);
    if (tree) return { text: treeDisplayName(tree), href: `/nearby#tree=r${key.slice(5)}` };
    return { text: `Tree #${key.slice(5)}`, href: null };
  }
  return { text: (entry && entry.name) || "New tree", href: null };
}

function communityContributionsHtml() {
  return `<section class="settings-section community-contributions">
      <h3 class="settings-section-title">Your contributions</h3>
      <div id="communityContributions"><p class="settings-description">Loading…</p></div>
    </section>`;
}

async function communityRenderContributions() {
  const host = document.getElementById("communityContributions");
  if (!host) return;
  const score = communityReadScore() || { points: 0, verified: 0, confirmed: 0 };
  const rank = communityRank(score.points);
  const waitingIds = new Set((await outboxList()).map((item) => item.id));
  const outcomes = communityReadLog();
  const entries = Object.entries(communityReadLocal()).sort((a, b) => b[1].ts - a[1].ts);
  const span = rank.next ? rank.next.min - rank.min : 1;
  const progress = rank.next ? Math.min(100, Math.round(((score.points - rank.min) / span) * 100)) : 100;
  const toNext = rank.next ? `${rank.next.min - score.points} to ${escapeHtml(rank.next.name)}` : "Top rank";
  const rows = entries.map(([key, entry]) => {
    const label = communityTargetLabel(key, entry);
    const isPlace = entry.kind === "place";
    const outcome = waitingIds.has(entry.id) ? "waiting"
      : entry.failed ? "failed"
      : entry.kind === "feedback" ? (outcomes[entry.id] === "fixed" ? "fixed" : "sent")
      : isPlace && entry.status === "OPEN_CONFIRMED" ? "checked"
      : isPlace ? (outcomes[entry.id] === "confirmed" ? "confirmed" : "sent")
      : (outcomes[entry.id] || (entry.far ? "far" : "pending"));
    const name = label.href ? `<a href="${escapeHtml(label.href)}">${escapeHtml(label.text)}</a>` : escapeHtml(label.text);
    return `<li class="community-log-item">
        <span class="community-log-icon">${communityIcon(COMMUNITY_STATUS_ICON[entry.status] || "check")}</span>
        <span class="community-log-main"><span class="community-log-name">${name}</span><span class="community-log-status">${escapeHtml(COMMUNITY_STATUS_TEXT[entry.status] || entry.status)}</span></span>
        <span class="community-pill community-outcome-${outcome}">${communityIcon(COMMUNITY_OUTCOME_ICON[outcome])}${escapeHtml(COMMUNITY_OUTCOME_TEXT[outcome])}</span>${label.issueUrl && /^https:\/\/github\.com\//.test(label.issueUrl) ? `<a class="community-issue-link" href="${escapeHtml(label.issueUrl)}" target="_blank" rel="noopener">View on GitHub</a>` : ""}${entry.failed ? `<span class="community-log-error"><span>${escapeHtml(entry.failed)}</span> <button type="button" class="community-link" data-action="community-retry" data-id="${escapeHtml(entry.id)}">Send again</button></span>` : ""}
      </li>`;
  }).join("");
  host.innerHTML = `<div class="community-rank-card">
        <span class="community-rank-icon">${communityIcon(rank.icon)}</span>
        <div class="community-rank-text">
          <p class="community-rank"><strong>${escapeHtml(rank.name)}</strong></p>
          <p class="community-rank-points">${score.points} ${score.points === 1 ? "point" : "points"} · ${toNext}</p>
        </div>
      </div>
      <div class="community-progress" role="progressbar" aria-label="Progress to the next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
      ${communityLegendHtml(communityMapMarks())}
      <div class="community-stats">
        <div><strong>${score.verified}</strong><span>Verified</span></div>
        <div><strong>${score.confirmed}</strong><span>Confirmed by others</span></div>
        <div><strong>${entries.length}</strong><span>Your reports</span></div>
      </div>
      ${rows
        ? `<ul class="community-log">${rows}</ul>`
        : `<div class="community-empty">${typeof appIconHtml === "function" ? appIconHtml("tree", "app-icon community-empty-art") : ""}<p><strong>No reports yet</strong><span>Open a tree or a place and tap “Help check”. You get a point for each tree you check, and another when someone else agrees.</span></p></div>`}`;
}

async function communityRefreshLog() {
  if (!navigator.onLine) return;
  try {
    const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(communityDeviceId())}&list=1`);
    if (!response.ok) return;
    const data = await response.json();
    const outcomes = {};
    for (const report of data.reports || []) outcomes[report.id] = report.outcome;
    localStorage.setItem(COMMUNITY_LOG_KEY, JSON.stringify(outcomes));
  } catch {}
}

async function communityOpenContributions() {
  await communityRenderContributions();
  await Promise.all([communityRefreshScore(), communityRefreshLog()]);
  await communityRenderContributions();
}
