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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

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
  ".webp": "image/webp",
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

// Like Netlify, every static file carries a validator and a matching If-None-Match gets a bodyless 304,
// so the service worker's background data sync (conditional requests, sw.js syncData) costs locally
// what it costs in production instead of re-downloading every dataset in full. Cache-Control stays
// no-store, so the browser itself never sends one.
function streamFile(res, filePath, type, req = null, stats = null) {
  const etag = stats ? `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"` : null;
  if (etag && req && req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...(etag ? { ETag: etag } : {}),
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
// bump — that bump only ever happens in CI (see cache-version-bump.yml), so it never
// fires while iterating locally before a commit/push. A
// production deploy (Netlify) serves sw.js as a static file, untouched by this function.
//
// The imported version markers prefix cache names with "dev-" here so the About screen's app-version display — and any bug
// report submitted while testing locally, see appVersion in js/app.js — reads e.g.
// "dev-v274" instead of a bare version number that never changes between local edits.
function injectDevFlag(source) {
  // Anchored on the IS_DEV declaration, not on APP_CACHE_NAME below it: sw.js reads
  // `self.__DEV__` once, at the top, into `const IS_DEV`. Injecting after that line set the flag
  // too late to be seen, so IS_DEV was false even locally and the dev server's whole
  // network-first path never ran -- local edits were served from the production cache-first
  // strategy until the cache happened to be cleared by hand.
  return source.replace(/^const IS_DEV/m, "self.__DEV__ = true;\nconst IS_DEV");
}

function handleStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/") requested = "/index.html";

  const resolved = safeResolve(path.join(ROOT, requested));
  if (!resolved) {
    send(res, 403, "Forbidden");
    return;
  }

  // The page loads the data version marker the worker imports. Flag it as local for the page too, so
  // both name the data cache identically ("forest-finds-data-dev-vN"): a first visit hands its map
  // downloads to the worker's data cache by that name (js/loader.js), and a mismatch would put them
  // where the worker never looks. The app marker is left alone: the page only displays it.
  if (requested === "/js/data-cache-version.js") {
    fs.readFile(resolved, "utf8", (err, source) => {
      if (err) {
        send(res, 404, "Not found");
        return;
      }
      send(res, 200, `globalThis.__DEV__ = true;\n${source}`, MIME[".js"]);
    });
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
    streamFile(res, resolved, type, req, stats);
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

  // Mirrors the /app -> /nearby redirect in netlify.toml. /app carries no content of its
  // own any more, so this is an ordinary redirect, not a rewrite.
  if (url.pathname === "/app") {
    res.writeHead(301, { Location: `/nearby${url.search}`, "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (url.pathname === "/report") {
    res.writeHead(301, { Location: "/feedback" + url.search, "Cache-Control": "no-store" });
    res.end();
    return;
  }

  // Mirrors the screen-path -> app.html rewrites in netlify.toml (bare /nearby is handled above). The alpha gate is NOT
  // mirrored: it is a Netlify edge function, so local dev and the e2e suite always reach the
  // app. See spec/spec-alpha-access.md section 3.4.
  // Bare /nearby mirrors netlify.toml's rewrite to the generated static index, falling back to
  // app.html until `npm run build` has written it.
  if (url.pathname === "/nearby") {
    const indexFile = path.join(ROOT, "nearby-index.html");
    const file = fs.existsSync(indexFile) ? indexFile : path.join(ROOT, "app.html");
    if (!fs.existsSync(file)) { send(res, 404, "App not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (["/nearby/search", "/nearby/filter", "/settings", "/feedback", "/community"].includes(url.pathname)) {
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

  // Community reports/overlay: same function modules Netlify runs, with the request body passed
  // through (the generic proxy below only forwards the query string).
  const COMMUNITY_FUNCTION_ROUTES = {
    "/api/community/report": "community-report",
    "/api/community/overlay": "community-overlay",
    "/api/community/validate": "community-validate",
    "/api/community/rebuild": "community-rebuild",
    "/api/community/delete": "community-delete",
    "/reports/tree-report": "tree-report",
    "/reports/tree-report/": "tree-report",
    "/api/auth/login": "auth-login",
    "/api/auth/callback": "auth-callback",
    "/api/auth/me": "auth-me",
    "/api/auth/link": "auth-link",
    "/api/auth/logout": "auth-logout",
    "/api/features": "features",
    // Tracking runs the real function too; with no Blobs context it falls back to data/tracking/*.ndjson.
    "/api/track": "track",
    "/api/admin/tracks": "track",
  };
  if (COMMUNITY_FUNCTION_ROUTES[url.pathname]) {
    const fnName = COMMUNITY_FUNCTION_ROUTES[url.pathname];
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const fn = require(path.join(ROOT, "netlify", "functions", fnName + ".js"));
      fn.handler({ httpMethod: req.method, headers: req.headers, queryStringParameters: Object.fromEntries(url.searchParams), body })
        .then((result) => {
          // Redirects set cookies through multiValueHeaders, which the headers object alone would drop.
          const headers = { ...(result.headers || { "Content-Type": "application/json" }) };
          for (const [name, values] of Object.entries(result.multiValueHeaders || {})) headers[name] = values;
          res.writeHead(result.statusCode, headers);
          res.end(result.body || "");
        })
        .catch((err) => send(res, 500, JSON.stringify({ error: String(err.message) }), "application/json; charset=utf-8"));
    });
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
    // Forward the request body and headers like Netlify does (a POST function such as
    // report-missing-data reads both), once the whole body has arrived.
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        // Clear require cache so changes are picked up on restart
        delete require.cache[require.resolve(resolved)];
        const fn = require(resolved);
        const qs = Object.fromEntries(url.searchParams.entries());
        fn.handler({ httpMethod: req.method, headers: req.headers, queryStringParameters: qs, body })
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
    });
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
