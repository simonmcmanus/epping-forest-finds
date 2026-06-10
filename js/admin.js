// Admin map renderer for Epping Forest Finds tracking data.

// Approximate bounding box for Epping Forest area
const BOUNDS = { minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155 };

// Colour palette for distinguishing users (cycles)
const USER_COLOURS = [
  "#4fc97e", "#e05f4f", "#5b8de8", "#e8a93c", "#b45be8",
  "#5ecdc8", "#e87f5b", "#a3c95e", "#e85b9a", "#5bb8e8",
  "#d4e85b", "#7e4fe8", "#e8c35b", "#5be888", "#e85b5b",
];

// ---- Coordinate helpers ----

function latLngToCanvas(lat, lng, canvasW, canvasH) {
  // Mercator-corrected x, linear y (fine for ~15 km area)
  const midLat = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const lngSpan = (BOUNDS.maxLng - BOUNDS.minLng) * cosLat;
  const latSpan = BOUNDS.maxLat - BOUNDS.minLat;
  const x = ((lng - BOUNDS.minLng) * cosLat / lngSpan) * canvasW;
  const y = (1 - (lat - BOUNDS.minLat) / latSpan) * canvasH;
  return { x, y };
}

// ---- User colour assignment ----

const _userColourMap = new Map();
let _colourIndex = 0;

function userColour(uid) {
  if (!_userColourMap.has(uid)) {
    _userColourMap.set(uid, USER_COLOURS[_colourIndex % USER_COLOURS.length]);
    _colourIndex++;
  }
  return _userColourMap.get(uid);
}

function shortUid(uid) {
  return typeof uid === "string" ? uid.slice(0, 8) : "unknown";
}

// ---- State ----

let allData = { locations: [], clicks: [] };
let selectedUid = null; // null = show all users
let viewMode = "tracks"; // "tracks" | "heatmap"

// ---- Rendering ----

function render() {
  const canvas = document.getElementById("adminCanvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const W = canvas.width;
  const H = canvas.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const w = W / dpr;
  const h = H / dpr;

  // Background
  ctx.fillStyle = "#1a2420";
  ctx.fillRect(0, 0, w, h);

  drawForestOutline(ctx, w, h);

  if (viewMode === "heatmap") {
    drawHeatmap(ctx, w, h);
  } else {
    drawTracks(ctx, w, h);
  }
  drawClickMarkers(ctx, w, h);
  drawCurrentPositions(ctx, w, h);
}

function drawForestOutline(ctx, w, h) {
  // Rough polygon approximating Epping Forest shape (simplified keypoints)
  const outline = [
    [51.730, 0.012], [51.720, 0.058], [51.700, 0.080], [51.685, 0.098],
    [51.660, 0.105], [51.645, 0.085], [51.625, 0.070], [51.605, 0.040],
    [51.598, -0.005], [51.610, -0.055], [51.635, -0.075], [51.660, -0.060],
    [51.690, -0.025], [51.710, -0.010], [51.730, 0.012],
  ];
  ctx.beginPath();
  outline.forEach(([lat, lng], i) => {
    const { x, y } = latLngToCanvas(lat, lng, w, h);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(47, 111, 78, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(79, 201, 126, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function filteredLocations() {
  const locs = allData.locations;
  if (!selectedUid) return locs;
  return locs.filter((e) => e.uid === selectedUid);
}

function drawTracks(ctx, w, h) {
  const locs = filteredLocations();
  if (!locs.length) return;

  // Group by uid and sort by timestamp
  const byUser = new Map();
  for (const e of locs) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, []);
    byUser.get(e.uid).push(e);
  }
  for (const events of byUser.values()) {
    events.sort((a, b) => a.ts < b.ts ? -1 : 1);
  }

  // Draw route lines
  for (const [uid, events] of byUser) {
    const colour = userColour(uid);
    ctx.beginPath();
    ctx.strokeStyle = colour + "88";
    ctx.lineWidth = selectedUid === uid ? 2.5 : 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let moved = false;
    for (const e of events) {
      if (e.lat == null || e.lng == null) continue;
      const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
      if (!moved) { ctx.moveTo(x, y); moved = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Direction arrows along route (every 5th point)
    events.forEach((e, i) => {
      if (i === 0 || i % 5 !== 0 || e.heading == null) return;
      const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
      const rad = (e.heading - 90) * Math.PI / 180;
      const len = 6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(-len * 0.6, -len * 0.4);
      ctx.lineTo(-len * 0.6, len * 0.4);
      ctx.closePath();
      ctx.fillStyle = colour + "bb";
      ctx.fill();
      ctx.restore();
    });
  }
}

function drawHeatmap(ctx, w, h) {
  const locs = allData.locations;
  if (!locs.length) return;

  const cellsX = 60;
  const cellsY = 45;
  const cellW = w / cellsX;
  const cellH = h / cellsY;
  const grid = new Array(cellsX * cellsY).fill(0);

  for (const e of locs) {
    if (e.lat == null || e.lng == null) continue;
    const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
    const cx = Math.floor(x / cellW);
    const cy = Math.floor(y / cellH);
    if (cx >= 0 && cx < cellsX && cy >= 0 && cy < cellsY) {
      grid[cy * cellsX + cx]++;
    }
  }

  const maxCount = Math.max(...grid, 1);

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const count = grid[cy * cellsX + cx];
      if (count === 0) continue;
      const t = Math.sqrt(count / maxCount);
      const alpha = 0.15 + t * 0.75;
      // Cold (blue) → warm (yellow) → hot (red)
      const r = Math.round(t < 0.5 ? t * 2 * 200 : 200 + (t - 0.5) * 2 * 55);
      const g = Math.round(t < 0.5 ? 50 + t * 2 * 150 : 200 - (t - 0.5) * 2 * 160);
      const b = Math.round(t < 0.5 ? 200 - t * 2 * 200 : 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.fillRect(cx * cellW, cy * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
}

function drawClickMarkers(ctx, w, h) {
  const clicks = allData.clicks.filter((e) => !selectedUid || e.uid === selectedUid);
  for (const e of clicks) {
    if (e.userLat == null || e.userLng == null) continue;
    const { x, y } = latLngToCanvas(e.userLat, e.userLng, w, h);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 200, 50, 0.55)";
    ctx.fill();
  }
}

function drawCurrentPositions(ctx, w, h) {
  // Show last known position for each user (or selected user)
  const byUser = new Map();
  for (const e of allData.locations) {
    if (!selectedUid || e.uid === selectedUid) {
      if (!byUser.has(e.uid) || e.ts > byUser.get(e.uid).ts) {
        byUser.set(e.uid, e);
      }
    }
  }
  for (const [uid, e] of byUser) {
    if (e.lat == null || e.lng == null) continue;
    const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
    const colour = userColour(uid);
    const isSelected = uid === selectedUid;
    ctx.beginPath();
    ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ---- User list sidebar ----

function buildUserList() {
  const list = document.getElementById("adminUserList");
  if (!list) return;

  const byUser = new Map();
  for (const e of allData.locations) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, { count: 0, last: e.ts });
    const u = byUser.get(e.uid);
    u.count++;
    if (e.ts > u.last) u.last = e.ts;
  }

  // Sort by last seen desc
  const users = [...byUser.entries()].sort((a, b) => b[1].last < a[1].last ? -1 : 1);

  const items = users.map(([uid, info]) => {
    const colour = userColour(uid);
    const lastSeen = new Date(info.last).toLocaleString();
    const div = document.createElement("div");
    div.className = "admin-user-item" + (uid === selectedUid ? " selected" : "");
    div.dataset.uid = uid;
    div.innerHTML = `
      <span class="admin-user-dot" style="background:${colour}"></span>
      <span class="admin-user-label">${shortUid(uid)}</span>
      <span class="admin-user-meta">${info.count} pts</span>
    `;
    div.title = `Last seen: ${lastSeen}`;
    div.addEventListener("click", () => {
      selectedUid = selectedUid === uid ? null : uid;
      buildUserList();
      render();
    });
    return div;
  });

  list.innerHTML = "";
  // "All users" row
  const allRow = document.createElement("div");
  allRow.className = "admin-user-item" + (!selectedUid ? " selected" : "");
  allRow.innerHTML = `<span class="admin-user-dot" style="background:#aaa"></span><span class="admin-user-label">All users</span><span class="admin-user-meta">${users.length}</span>`;
  allRow.addEventListener("click", () => { selectedUid = null; buildUserList(); render(); });
  list.appendChild(allRow);
  items.forEach((el) => list.appendChild(el));
}

function updateStats() {
  const el = document.getElementById("adminStats");
  if (!el) return;
  const locs = filteredLocations();
  const clicks = allData.clicks.filter((e) => !selectedUid || e.uid === selectedUid);
  const uids = new Set(locs.map((e) => e.uid));
  el.innerHTML = `<strong>${uids.size}</strong> user${uids.size !== 1 ? "s" : ""} &nbsp;·&nbsp; <strong>${locs.length}</strong> location pings &nbsp;·&nbsp; <strong>${clicks.length}</strong> taps`;
}

// ---- Data loading ----

async function loadData(password) {
  const url = `/api/admin/tracks?pw=${encodeURIComponent(password)}`;
  console.log("[admin] fetching", url);
  const resp = await fetch(url, { headers: { "Authorization": `Bearer ${password}` } });
  console.log("[admin] response status", resp.status);
  if (resp.status === 401) throw new Error("wrong-password");
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  const data = await resp.json();
  console.log("[admin] data received", data);
  return data;
}

// ---- Boot ----

async function adminBoot() {
  const loginScreen = document.getElementById("loginScreen");
  const adminApp = document.getElementById("adminApp");
  const loginBtn = document.getElementById("loginBtn");
  const loginInput = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const heatmapBtn = document.getElementById("heatmapBtn");
  const tracksBtn = document.getElementById("tracksBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const canvas = document.getElementById("adminCanvas");

  let password = "";

  async function doLogin() {
    const pw = loginInput.value.trim();
    if (!pw) {
      loginError.textContent = "Enter the admin password.";
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
    loginError.textContent = "";
    try {
      allData = await loadData(pw);
      console.log("[admin] login ok, switching screens");
      password = pw;
      loginScreen.hidden = true;
      adminApp.hidden = false;
      console.log("[admin] building UI");
      buildUserList();
      updateStats();
      console.log("[admin] rendering canvas");
      // Defer render one frame so the browser lays out adminApp before
      // we measure the canvas dimensions.
      requestAnimationFrame(render);
      console.log("[admin] done");
    } catch (err) {
      console.error("[admin] login failed:", err);
      if (err.message === "wrong-password") {
        loginError.textContent = "Incorrect password — check ADMIN_PASSWORD in your .env file.";
      } else {
        loginError.textContent = `Cannot reach server: ${err.message}`;
      }
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });
  else loginBtn.addEventListener("click", doLogin);

  heatmapBtn.addEventListener("click", () => {
    viewMode = "heatmap";
    heatmapBtn.classList.add("active");
    tracksBtn.classList.remove("active");
    render();
  });

  tracksBtn.addEventListener("click", () => {
    viewMode = "tracks";
    tracksBtn.classList.add("active");
    heatmapBtn.classList.remove("active");
    render();
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      allData = await loadData(password);
      buildUserList();
      updateStats();
      render();
    } catch {}
    refreshBtn.disabled = false;
  });

  window.addEventListener("resize", () => render());

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    if (!password) return;
    try { allData = await loadData(password); buildUserList(); updateStats(); render(); } catch {}
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", adminBoot);
