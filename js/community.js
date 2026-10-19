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
};
const COMMUNITY_OUTCOME_ICON = { waiting: "upload", pending: "clock", confirmed: "check", review: "alert", sent: "check" };

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
  local[key] = { id, status, ts: Date.now(), ...(tagNumber ? { name: `Tree ${tagNumber}` } : {}) };
  communityWriteLocal(local);
  await outboxAdd({ id, url: COMMUNITY_REPORT_URL, payload });
  if (navigator.onLine) outboxFlush();
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
    return `<div class="community-badge community-badge-verified">${communityIcon("shield")}
        <p><strong>Verified by the community</strong><span>${entry.n} ${entry.n === 1 ? "person has" : "people have"} confirmed this tree is here.</span></p></div>`;
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

function communitySectionInnerHtml(target, editing) {
  const local = communityReadLocal()[target];
  const remote = communityOverlay.entries[target];
  if (local && !editing) {
    return `${communityBadgeHtml(remote)}
      <div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>You reported: ${escapeHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status)}</strong>
          <span>Thank you! Other people may take up to a day to see this.</span></p>
        <button class="community-link" type="button" data-action="community-change">Change</button>
      </div>`;
  }
  const [primary, ...others] = COMMUNITY_TREE_CHOICES;
  const chosen = local ? local.status : null;
  return `${communityBadgeHtml(remote)}
      ${communityChoiceHtml(primary, chosen === primary.status)}
      <p class="community-or">Something not right?</p>
      <div class="community-choices">${others.map((c) => communityChoiceHtml(c, chosen === c.status)).join("")}</div>
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
      <div class="community-body">${communitySectionInnerHtml(target, false)}</div>
    </section>`;
}

function communityRefreshSections() {
  document.querySelectorAll(".community-check").forEach((section) => {
    const body = section.querySelector(".community-body");
    if (!body) return;
    body.innerHTML = section.dataset.kind === "place"
      ? communityPlaceInnerHtml(section)
      : communitySectionInnerHtml(section.dataset.communityTarget, section.dataset.editing === "1");
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

async function communityRefreshScore() {
  if (!navigator.onLine) return;
  try {
    const response = await fetch(`${COMMUNITY_OVERLAY_URL}?me=${encodeURIComponent(communityDeviceId())}`);
    if (!response.ok) return;
    const score = await response.json();
    localStorage.setItem(COMMUNITY_SCORE_KEY, JSON.stringify(score));
  } catch {}
}

if (typeof window !== "undefined" && window.addEventListener) {
  // Fetched after first paint so it never competes with the map's own data.
  window.addEventListener("load", () => setTimeout(() => { communityLoadOverlay(); communityRefreshScore(); }, 1000));
  window.addEventListener("outbox:sent", (event) => {
    const detail = event.detail;
    if (!detail || !detail.item) return;
    if (detail.item.url === COMMUNITY_REPORT_URL) communityRefreshScore();
    if (detail.item.url === COMMUNITY_ISSUE_URL && detail.ok && detail.response && detail.response.issueUrl) {
      const local = communityReadLocal();
      const key = Object.keys(local).find((k) => local[k].id === detail.item.id);
      if (key) { local[key].issueUrl = detail.response.issueUrl; communityWriteLocal(local); }
    }
  });
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
        <p><strong>Tree ${escapeHtml(tag)} saved</strong><span>Thank you! It shows for everyone once a second person finds it too, which can take up to a day.</span></p>
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
    const confirmed = local.status === "OPEN_CONFIRMED";
    return `<div class="community-mine">
        <span class="community-mine-icon">${communityIcon("check")}</span>
        <p><strong>You reported: ${escapeHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status)}</strong>
          <span>${confirmed ? "Thank you! Your check counts towards your score." : "Thank you! A person will review this."}</span></p>
        <button class="community-link" type="button" data-action="community-change">Change</button>
      </div>`;
  }
  const [primary, ...others] = COMMUNITY_PLACE_CHOICES;
  return `${communityPlaceChoiceHtml(primary)}
      <p class="community-or">Something not right?</p>
      <div class="community-choices">${others.map(communityPlaceChoiceHtml).join("")}</div>
      <p class="report-note community-status" aria-live="polite"></p>`;
}

function communityPlaceSectionHtml(place) {
  if (!place || !place.name || place.latitude == null || place.longitude == null) return "";
  const target = `place:${placeHashKey(place)}`;
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
  local[target] = { id, status, ts: Date.now(), kind: "place", name };
  communityWriteLocal(local);
  if (status === "OPEN_CONFIRMED") {
    // A confirmation is not actionable, so it never opens an issue: it only counts towards the score.
    const here = typeof hasRealLocation === "function" && hasRealLocation() ? state.userLocation : null;
    await outboxAdd({ id, url: COMMUNITY_REPORT_URL, payload: {
      id, deviceId: communityDeviceId(), kind: "place", target, status, targetLat: lat, targetLon: lon,
      lat: here ? Number(here.latitude.toFixed(6)) : undefined,
      lon: here ? Number(here.longitude.toFixed(6)) : undefined,
    } });
  } else {
    await outboxAdd({ id, url: COMMUNITY_ISSUE_URL, payload: {
      reportType: "place-check",
      placeCheck: { status, key: target, name, category },
      details: note || "",
      location: { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)) },
      locationContext: { type: category, name },
      appVersion: (typeof state !== "undefined" && state.swVersion) || (typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown"),
      userAgent: navigator.userAgent,
      pageUrl: window.location.href,
      requestId: id,
    } });
  }
  if (navigator.onLine) outboxFlush();
}

async function communityHandlePlaceChoice(button) {
  const section = button.closest(".community-check");
  if (!section) return;
  const status = button.dataset.status;
  if (status === "OPEN_CONFIRMED") {
    await communitySubmitPlace(section, status, "");
    delete section.dataset.editing;
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
    const sentForReview = entry.kind === "place" && entry.status !== "OPEN_CONFIRMED";
    const outcome = waitingIds.has(entry.id) ? "waiting" : sentForReview ? "sent" : (outcomes[entry.id] || "pending");
    const name = label.href ? `<a href="${escapeHtml(label.href)}">${escapeHtml(label.text)}</a>` : escapeHtml(label.text);
    return `<li class="community-log-item">
        <span class="community-log-icon">${communityIcon(COMMUNITY_STATUS_ICON[entry.status] || "check")}</span>
        <span class="community-log-main"><span class="community-log-name">${name}</span><span class="community-log-status">${escapeHtml(COMMUNITY_STATUS_TEXT[entry.status] || entry.status)}</span></span>
        <span class="community-pill community-outcome-${outcome}">${communityIcon(COMMUNITY_OUTCOME_ICON[outcome])}${escapeHtml(COMMUNITY_OUTCOME_TEXT[outcome])}</span>${label.issueUrl && /^https:\/\/github\.com\//.test(label.issueUrl) ? `<a class="community-issue-link" href="${escapeHtml(label.issueUrl)}" target="_blank" rel="noopener">View on GitHub</a>` : ""}
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
