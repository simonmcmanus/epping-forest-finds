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
    const radius = pngContentRadius(png);
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
