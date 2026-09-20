const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env if present (no dotenv dependency needed)
try {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, "utf8").split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1])) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    });
  }
} catch {}

const TRACKING_DIR = path.join(__dirname, "data", "tracking");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function ensureTrackingDir() {
  if (!fs.existsSync(TRACKING_DIR)) fs.mkdirSync(TRACKING_DIR, { recursive: true });
}

function appendNdjson(filename, objects) {
  ensureTrackingDir();
  const lines = objects.map((o) => JSON.stringify(o)).join("\n") + "\n";
  fs.appendFileSync(path.join(TRACKING_DIR, filename), lines, "utf8");
}

function readNdjson(filename) {
  const file = path.join(TRACKING_DIR, filename);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function checkAdminAuth(req, url) {
  if (!ADMIN_PASSWORD) return false;
  const authHeader = req.headers.authorization || "";
  if (authHeader === `Bearer ${ADMIN_PASSWORD}`) return true;
  if (url.searchParams.get("pw") === ADMIN_PASSWORD) return true;
  return false;
}

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.cwd();
const COW_SOURCE_BASE = "https://account.nofence.no/api/open/data/?center=";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function streamFile(res, filePath, type) {
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  stream.pipe(res);
}

function safeResolve(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

async function handleCowProxy(req, res, url) {
  const center = url.searchParams.get("center");
  if (!center) {
    send(res, 400, JSON.stringify({ error: "Missing center query param" }), "application/json; charset=utf-8");
    return;
  }

  try {
    const upstream = await fetch(`${COW_SOURCE_BASE}${encodeURIComponent(center)}`);
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  } catch (error) {
    send(res, 502, JSON.stringify({ error: "Cow data proxy failed" }), "application/json; charset=utf-8");
  }
}

// Flags the service worker as running under this local dev server, so sw.js can switch
// to a network-first fetch strategy instead of its production cache-first one. Local edits
// to cached files (JS, CSS, data) then show up on refresh without needing a CACHE_NAME
// bump — that bump only ever happens in CI (see .github/workflows/sw-bump.yml and
// sw-release.yml), so it never fires while iterating locally before a commit/push. A
// production deploy (Netlify) serves sw.js as a static file, untouched by this function.
//
// Also prefixes CACHE_NAME with "dev-" (mirroring the branch prefix sw-bump.yml already
// applies for preview builds) so the About screen's app-version display — and any bug
// report submitted while testing locally, see appVersion in js/app.js — reads e.g.
// "dev-v274" instead of a bare version number that never changes between local edits.
function injectDevFlag(source) {
  // Anchored on the IS_DEV declaration, not on APP_CACHE_NAME below it: sw.js reads
  // `self.__DEV__` once, at the top, into `const IS_DEV`. Injecting after that line set the flag
  // too late to be seen, so IS_DEV was false even locally and the dev server's whole
  // network-first path never ran -- local edits were served from the production cache-first
  // strategy until the cache happened to be cleared by hand.
  return source
    .replace(/^const IS_DEV/m, "self.__DEV__ = true;\nconst IS_DEV")
    // Both caches, so neither local store can collide with a real one (the app cache alone was
    // being prefixed, leaving the data cache sharing production's name).
    .replace(/"forest-finds-/g, '"forest-finds-dev-');
}

function handleStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/") requested = "/index.html";

  const resolved = safeResolve(path.join(ROOT, requested));
  if (!resolved) {
    send(res, 403, "Forbidden");
    return;
  }

  if (requested === "/sw.js") {
    fs.readFile(resolved, "utf8", (err, source) => {
      if (err) {
        send(res, 404, "Not found");
        return;
      }
      send(res, 200, injectDevFlag(source), MIME[".js"]);
    });
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }

    if (stats.isDirectory()) {
      // Mirror Netlify's static-hosting behaviour in production: a directory request
      // (e.g. /reports or /reports/) serves that directory's index.html if present, so
      // local dev matches what's actually deployed instead of 404ing.
      const indexPath = path.join(resolved, "index.html");
      fs.stat(indexPath, (indexErr, indexStats) => {
        if (indexErr || !indexStats.isFile()) {
          send(res, 404, "Not found");
          return;
        }
        streamFile(res, indexPath, MIME[".html"]);
      });
      return;
    }

    if (!stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    streamFile(res, resolved, type);
  });
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `http://${host}`);

  if (req.method === "OPTIONS" && (url.pathname === "/api/cows" || url.pathname === "/api/track")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/cows") {
    handleCowProxy(req, res, url);
    return;
  }

  if (url.pathname === "/api/track" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const events = Array.isArray(payload.events) ? payload.events : [];
        const locationEvents = events.filter((e) => e && e.type === "location");
        const clickEvents = events.filter((e) => e && e.type === "click");
        if (locationEvents.length) appendNdjson("location.ndjson", locationEvents);
        if (clickEvents.length) appendNdjson("click.ndjson", clickEvents);
        send(res, 200, JSON.stringify({ ok: true, stored: events.length }), "application/json; charset=utf-8");
      } catch {
        send(res, 400, JSON.stringify({ error: "Invalid JSON" }), "application/json; charset=utf-8");
      }
    });
    return;
  }

  if (url.pathname === "/api/admin/tracks" && req.method === "GET") {
    if (!checkAdminAuth(req, url)) {
      send(res, 401, JSON.stringify({ error: "Unauthorized" }), "application/json; charset=utf-8");
      return;
    }
    const locations = readNdjson("location.ndjson");
    const clicks = readNdjson("click.ndjson");
    send(res, 200, JSON.stringify({ locations, clicks, meta: { storeName: "local", context: "local" } }), "application/json; charset=utf-8");
    return;
  }

  // Mirrors the /app -> /app.html rewrite in netlify.toml. The alpha gate is
  // NOT mirrored: it is a Netlify edge function, so local dev and the e2e
  // suite always reach the app. See spec/spec-alpha-access.md section 3.4.
  if (url.pathname === "/app") {
    const appFile = path.join(ROOT, "app.html");
    if (!fs.existsSync(appFile)) { send(res, 404, "App not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(appFile).pipe(res);
    return;
  }

  if (url.pathname === "/admin") {
    const adminFile = path.join(ROOT, "admin.html");
    if (!fs.existsSync(adminFile)) { send(res, 404, "Admin not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(adminFile).pipe(res);
    return;
  }

  // Proxy Netlify functions locally
  if (url.pathname.startsWith("/.netlify/functions/")) {
    const fnName = url.pathname.replace("/.netlify/functions/", "");
    const fnPath = path.join(ROOT, "netlify", "functions", fnName + ".js");
    const resolved = path.resolve(fnPath);
    if (!resolved.startsWith(path.join(ROOT, "netlify", "functions"))) {
      send(res, 403, "Forbidden");
      return;
    }
    try {
      // Clear require cache so changes are picked up on restart
      delete require.cache[require.resolve(resolved)];
      const fn = require(resolved);
      const qs = Object.fromEntries(url.searchParams.entries());
      fn.handler({ httpMethod: req.method, queryStringParameters: qs })
        .then((result) => {
          res.writeHead(result.statusCode, result.headers || { "Content-Type": "application/json" });
          res.end(result.body || "");
        })
        .catch((err) => {
          send(res, 500, JSON.stringify({ error: String(err.message) }), "application/json; charset=utf-8");
        });
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err.message) }), "application/json; charset=utf-8");
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  handleStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Forest Finds server running at http://localhost:${PORT}`);
    if (ADMIN_PASSWORD) {
      console.log(`Admin dashboard: http://localhost:${PORT}/admin  (password set ✓)`);
    } else {
      console.log(`Admin dashboard: disabled — set ADMIN_PASSWORD in .env to enable`);
    }
  });
}

module.exports = { _private: { injectDevFlag }, server };
