#!/usr/bin/env node
"use strict";

/**
 * Rasterises SVG and PNG masters in data/icons/src/ to 256x256 map assets.
 *
 * SVG drawings and illustrated PNG masters are retained as sources; the
 * 256px PNGs are build output committed alongside them. Re-run
 * after editing a source:
 *
 *   npm run gen:icons              # every source
 *   npm run gen:icons -- memorial  # only sources matching "memorial"
 *
 * It also enforces the one rule the renderer cares about, which lives in
 * scripts/lib/icon-fit.js: artwork is drawn at 1.85x the pin head's radius,
 * so content past 1/1.85 of its own half-width spills out of the pointer.
 * Icons are designed to r=128 of the 256 viewBox (0.5, which draws to 0.925R)
 * and this fails the build past FIT_LIMIT rather than letting one ship.
 * scripts/refit-map-icons.js holds the original PNGs to the same ceiling.
 */

const fs = require("node:fs");
const path = require("node:path");

const { FIT_LIMIT, pngContentRadius, chromiumExecutable } = require("./lib/icon-fit");

const APP_ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(APP_ROOT, "data/icons/src");
const OUT_DIR = path.join(APP_ROOT, "data/icons");
const SIZE = 256;
// Illustrated masters are fitted consistently while preserving their proportions.
const RASTER_RADIUS = 0.48;

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const sources = fs.readdirSync(SRC_DIR, { recursive: true })
    .filter((f) => /\.(svg|png)$/.test(f))
    .filter((f) => !filter.length || filter.some((needle) => f.includes(needle)))
    .sort();

  if (!sources.length) {
    console.error(`No sources in ${SRC_DIR}${filter.length ? ` matching ${filter.join(", ")}` : ""}.`);
    process.exitCode = 1;
    return;
  }

  const names = sources.map((file) => file.replace(/\.(svg|png)$/, ""));
  if (new Set(names).size !== names.length) {
    throw new Error("Each icon must have just one SVG or PNG master, not both.");
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
    const source = fs.readFileSync(path.join(SRC_DIR, file));
    const raster = file.endsWith(".png");
    let artwork;
    if (raster) {
      const sourceRadius = pngContentRadius(source);
      if (!sourceRadius) throw new Error(`${file} has no visible artwork`);
      const side = SIZE * RASTER_RADIUS / sourceRadius;
      const offset = (SIZE - side) / 2;
      artwork = `<img src="data:image/png;base64,${source.toString("base64")}" ` +
        `style="position:absolute;left:${offset}px;top:${offset}px;width:${side}px;height:${side}px">`;
    } else {
      artwork = source.toString("utf8");
    }
    await page.setContent(
      `<!DOCTYPE html><style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${artwork}`
    );
    if (raster) await page.locator("img").evaluate((img) => img.decode());
    const png = await page.screenshot({ omitBackground: true });
    const radius = pngContentRadius(png);
    const name = file.replace(/\.(svg|png)$/, "");
    const spills = radius > FIT_LIMIT;
    if (spills) failures.push({ name, radius });
    else {
      const output = path.join(OUT_DIR, `${name}.png`);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, png);
    }
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
