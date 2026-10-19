// Community verification (see spec/spec-community.md): people confirm or question a tree, and the
// result is an annotation on top of the City of London data -- never an edit to it.
// A report shows for its author at once (local, optimistic); everyone else sees it after the daily
// server update (/api/community/overlay). Reports travel through the offline outbox (js/outbox.js).
const COMMUNITY_DEVICE_KEY = "ff-community-device-v1";
const COMMUNITY_LOCAL_KEY = "ff-community-local-v1";
const COMMUNITY_SCORE_KEY = "ff-community-score-v1";
const COMMUNITY_REPORT_URL = "/api/community/report";
const COMMUNITY_OVERLAY_URL = "/api/community/overlay";

// Statuses per kind. `needsPosition` reports use the reporter's own GPS as the corrected / new spot.
const COMMUNITY_TREE_CHOICES = [
  { status: "VERIFIED", label: "It's here, tag matches" },
  { status: "NO_TAG_LIKELY_SAME", label: "No tag, but it looks right" },
  { status: "NO_TAG_UNSURE", label: "No tag, and I doubt it's the same tree" },
  { status: "DIFFERENT_TREE", label: "A different tree is here" },
  { status: "NOT_HERE", label: "There's no tree here" },
  { status: "MOVED", label: "I'm at the tag, but the map shows it elsewhere", needsPosition: true },
];
const COMMUNITY_STATUS_TEXT = {
  VERIFIED: "Verified here",
  NO_TAG_LIKELY_SAME: "No tag found (looks right)",
  NO_TAG_UNSURE: "No tag found (doubtful)",
  DIFFERENT_TREE: "A different tree is here",
  NOT_HERE: "No tree found here",
  MOVED: "Tag found at a different spot",
  NEW_TREE: "New tree",
};

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

function communityReadScore() {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_SCORE_KEY)) || null; } catch { return null; }
}

// Builds, saves locally (optimistic) and queues one report. Resolves the stored local record.
async function communitySubmitReport({ kind = "tree", target, status, targetLat, targetLon, newLat, newLon, note }) {
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
  };
  const local = communityReadLocal();
  const key = target || `new:${payload.lat},${payload.lon}`;
  local[key] = { id, status, ts: Date.now() };
  communityWriteLocal(local);
  await outboxAdd({ id, url: COMMUNITY_REPORT_URL, payload });
  if (navigator.onLine) outboxFlush();
  return local[key];
}

function communityBadgeHtml(entry) {
  if (!entry) return "";
  if (entry.s === "questioned") {
    return `<p class="community-badge community-badge-questioned">Questioned by the community: ${escapeHtml(COMMUNITY_STATUS_TEXT[entry.st] || "needs checking")} (${entry.n} people). The official record is unchanged.</p>`;
  }
  if (entry.s === "verified" || entry.s === "confirmed") {
    return `<p class="community-badge community-badge-verified">Verified by ${entry.n} ${entry.n === 1 ? "person" : "people"} in the community.</p>`;
  }
  return "";
}

function communitySectionInnerHtml(target) {
  const local = communityReadLocal()[target];
  const remote = communityOverlay.entries[target];
  const score = communityReadScore();
  const mine = local
    ? `<p class="community-mine">You reported: <strong>${escapeHtml(COMMUNITY_STATUS_TEXT[local.status] || local.status)}</strong>. Thank you! Other people may take up to a day to see this.</p>`
    : "";
  const buttons = COMMUNITY_TREE_CHOICES.map((c) =>
    `<button class="button button-ghost community-choice${local && local.status === c.status ? " is-chosen" : ""}" type="button" data-action="community-report" data-status="${c.status}"${c.needsPosition ? ' data-needs-position="1"' : ""}>${escapeHtml(c.label)}</button>`
  ).join("");
  const scoreLine = score
    ? `<p class="report-note community-score">Your community score: <strong>${score.points}</strong> ${score.points === 1 ? "point" : "points"} · ${score.verified} verified</p>`
    : "";
  return `${communityBadgeHtml(remote)}${mine}
      <div class="community-choices">${buttons}</div>
      <p class="report-note community-status" aria-live="polite"></p>${scoreLine}`;
}

// The "Help check this tree" block on a tree's detail screen (js/inspector.js showTreeDetails).
function communitySectionHtml(tree) {
  const target = communityTreeTarget(tree);
  if (!target || tree.latitude == null || tree.longitude == null) return "";
  return `<section class="community-check" data-community-target="${escapeHtml(target)}" data-lat="${tree.latitude}" data-lon="${tree.longitude}">
      <h3 class="detail-section-heading">Help check this tree</h3>
      <div class="community-body">${communitySectionInnerHtml(target)}</div>
    </section>`;
}

function communityRefreshSections() {
  document.querySelectorAll(".community-check").forEach((section) => {
    const body = section.querySelector(".community-body");
    if (body) body.innerHTML = communitySectionInnerHtml(section.dataset.communityTarget);
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
    communityRefreshSections();
  } catch {}
}

if (typeof window !== "undefined" && window.addEventListener) {
  // Fetched after first paint so it never competes with the map's own data.
  window.addEventListener("load", () => setTimeout(() => { communityLoadOverlay(); communityRefreshScore(); }, 1000));
  window.addEventListener("outbox:sent", (event) => {
    if (event.detail && event.detail.item && event.detail.item.url === COMMUNITY_REPORT_URL) communityRefreshScore();
  });
}

// "Add a tree that's missing from the map" on the Feedback screen: the reporter's own GPS is the
// tree's position, so it needs a real location. It only appears for other people once a second
// device has found it too (spec-community.md, Consensus).
function communityAddTreeHtml() {
  const score = communityReadScore();
  const scoreLine = score
    ? `<p class="report-note community-score">Your community score: <strong>${score.points}</strong> ${score.points === 1 ? "point" : "points"} · ${score.verified} verified</p>`
    : "";
  return `<div class="community-new-tree">
      <button id="communityAddTree" class="button button-ghost" type="button">Add a tree that's missing from the map</button>
      <p id="communityAddTreeStatus" class="report-note" aria-live="polite">Stand next to the tree first: we use your location.</p>${scoreLine}
    </div>`;
}

async function communityAddTreeHere() {
  const statusEl = document.getElementById("communityAddTreeStatus");
  if (!(typeof hasRealLocation === "function" && hasRealLocation())) {
    if (statusEl) statusEl.textContent = "Turn on location and stand next to the tree, so we can record where it is.";
    return;
  }
  const lat = Number(state.userLocation.latitude.toFixed(6));
  const lon = Number(state.userLocation.longitude.toFixed(6));
  await communitySubmitReport({ kind: "tree", status: "NEW_TREE", target: undefined, targetLat: lat, targetLon: lon });
  if (statusEl) statusEl.textContent = "Saved. Thank you! It will be added to the community layer once a second person finds it too, and may take up to a day to show for others.";
}
