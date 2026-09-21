#!/usr/bin/env node
"use strict";

/**
 * Rasterises data/icons/src/*.svg to the 256x256 PNGs the map draws.
 *
 * The icon set is artwork, not code, so the SVG sources are the editable
 * original and the PNGs are build output committed alongside them. Re-run
 * after editing a source:
 *
 *   npm run gen:icons              # every source
 *   npm run gen:icons -- memorial  # only sources matching "memorial"
 *
 * It also enforces the one rule the renderer cares about. drawPngMapIcon()
 * (js/renderer.js) draws a white pointer whose head has radius R, then paints
 * the artwork centred in that head at 1.75R across. So a pixel at normalised
 * radius p (from the image centre, over the image width) lands at 1.75pR, and
 * anything past p = 1/1.75 spills out of the pointer. Icons are designed to
 * r=128 of the 256 viewBox (p = 0.5, which draws to 0.875R) and this script
 * fails the build past FIT_LIMIT rather than letting a spilling icon ship.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const APP_ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(APP_ROOT, "data/icons/src");
const OUT_DIR = path.join(APP_ROOT, "data/icons");
const SIZE = 256;

// 1/1.75 is the spill point; leave a little room for antialiasing.
const FIT_LIMIT = 0.52;

function chromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith("chromium-")) continue;
    const candidate = path.join(root, entry, "chrome-linux/chrome");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- PNG alpha reader, so the fit check measures the rendered artwork ---

function pngAlpha(buffer) {
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
      if (data[8] !== 8 || data[9] !== 6) throw new Error("expected 8-bit RGBA");
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

// The radius of the furthest visible pixel, over the image width.
function contentRadius(buffer) {
  const { width, height, data } = pngAlpha(buffer);
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

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const sources = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".svg"))
    .filter((f) => !filter.length || filter.some((needle) => f.includes(needle)))
    .sort();

  if (!sources.length) {
    console.error(`No sources in ${SRC_DIR}${filter.length ? ` matching ${filter.join(", ")}` : ""}.`);
    process.exitCode = 1;
    return;
  }

  const { chromium } = require("@playwright/test");
  const executablePath = chromiumExecutable();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });

  const failures = [];
  for (const file of sources) {
    const svg = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
    await page.setContent(
      `<!DOCTYPE html><style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`
    );
    const png = await page.screenshot({ omitBackground: true });
    const radius = contentRadius(png);
    const name = file.replace(/\.svg$/, "");
    const spills = radius > FIT_LIMIT;
    if (spills) failures.push({ name, radius });
    else fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), png);
    console.log(
      `${spills ? "SPILLS" : "  ok  "} ${name.padEnd(28)} content radius ${radius.toFixed(3)} / ${FIT_LIMIT}`
    );
  }

  await browser.close();

  if (failures.length) {
    console.error(
      `\n${failures.length} icon(s) reach outside the pointer and were not written:\n` +
      failures.map((f) => `  ${f.name} (${f.radius.toFixed(3)})`).join("\n") +
      `\nKeep the drawing inside a circle of radius 128 on the 256 viewBox.`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
