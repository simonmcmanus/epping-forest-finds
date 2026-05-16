const http = require("http");
const fs = require("fs");
const path = require("path");

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

function handleStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/") requested = "/index.html";

  const resolved = safeResolve(path.join(ROOT, requested));
  if (!resolved) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const stream = fs.createReadStream(resolved);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": ext === ".json" || ext === ".geojson" ? "no-store" : "public, max-age=300",
    });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `http://${host}`);

  if (req.method === "OPTIONS" && url.pathname === "/api/cows") {
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

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  handleStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Forest Finds server running at http://localhost:${PORT}`);
});
