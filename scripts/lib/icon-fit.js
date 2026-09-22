"use strict";

/**
 * The one rule the map pointer imposes on artwork, and the PNG reading needed
 * to check it.
 *
 * drawPngMapIcon() (js/renderer.js) draws a white pointer whose head has
 * radius R, then paints the artwork centred in that head at 1.75R across. So
 * a pixel at normalised radius p -- its distance from the image centre over
 * the image width -- lands at 1.75pR, and anything past p = 1/1.75 spills out
 * of the pointer. Both scripts/generate-map-icons.js (new artwork, from SVG)
 * and scripts/refit-map-icons.js (the original PNGs) measure against that.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// Where the artwork actually overflows the pointer.
const SPILL_POINT = 1 / 1.75;

// What both scripts hold icons to, leaving room for the antialiased edge.
const FIT_LIMIT = 0.52;

// The icons that are app chrome rather than map pins: the nav buttons, the
// filter group and chip icons, and the generated launcher icons. They are
// drawn in a button, a chip, a page's <link> or the manifest, where filling
// their box is right, so the pointer rule does not apply to them.
const UI_ONLY_ICONS = new Set([
  "feedback", "filter", "home", "nearby", "pin", "settings", "tick", "walking",
  "food", "nature", "history", "stories", "campsite", "logo",
]);

/** The registry entries that are drawn inside the map pointer. */
function mapIconEntries(iconPaths) {
  return Object.entries(iconPaths).filter(([slug]) => !UI_ONLY_ICONS.has(slug));
}

/** Decode an 8-bit RGBA PNG far enough to read its alpha channel. */
function pngPixels(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("expected an 8-bit RGBA PNG");
      if (data[12]) throw new Error("interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") break;
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      cur[i] = v;
    }
  }
  return { width, height, data: out };
}

/**
 * The distance from the image centre to its furthest visible pixel, over the
 * image width. Compare against FIT_LIMIT.
 */
function pngContentRadius(buffer) {
  const { width, height, data } = pngPixels(buffer);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 32) continue;
      const r = Math.hypot(x - cx, y - cy) / width;
      if (r > max) max = r;
    }
  }
  return max;
}

/**
 * Playwright's own browser where it is installed, or the one a sandbox
 * provides via PLAYWRIGHT_CHROMIUM_EXECUTABLE / PLAYWRIGHT_BROWSERS_PATH.
 * Returns null to let Playwright pick for itself.
 */
function chromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith("chromium-")) continue;
    const candidate = path.join(root, entry, "chrome-linux/chrome");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  SPILL_POINT,
  FIT_LIMIT,
  UI_ONLY_ICONS,
  mapIconEntries,
  pngPixels,
  pngContentRadius,
  chromiumExecutable,
};
