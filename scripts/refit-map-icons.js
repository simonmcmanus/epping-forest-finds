#!/usr/bin/env node
"use strict";

/**
 * Scales the original icon PNGs down until their artwork fits inside the map
 * pointer, and rewrites them in place.
 *
 * drawPngMapIcon() (js/renderer.js) paints artwork at 1.75x the pin head's
 * radius, so content past 1/1.75 = 0.571 of its own half-width reaches
 * outside the white pointer. The set the app shipped with was drawn without
 * that constraint: 18 of its icons genuinely poked out -- the restaurant's
 * cutlery, the drinking-water tap, the beer froth -- and the rest ranged from
 * 0.43 to 0.67, so they were inconsistent in weight as well.
 *
 * This normalises every icon the map draws in a pointer to FIT_LIMIT, the
 * same ceiling scripts/generate-map-icons.js holds new artwork to. Icons
 * already inside it are left untouched; the rest are scaled about their own
 * centre, which is the only transform that is safe to apply to raster art
 * without a human redrawing it.
 *
 *   npm run fit:icons            # rewrite every icon that needs it
 *   npm run fit:icons -- --check # report only, exit 1 if any overflow
 *   npm run fit:icons -- beer    # only sources matching "beer"
 *
 * Re-running is a no-op: a rescaled icon already measures at the limit.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FIT_LIMIT, mapIconEntries, pngContentRadius, chromiumExecutable } = require("./lib/icon-fit");

const APP_ROOT = path.join(__dirname, "..");
const SIZE = 256;

// Scale to a little under the ceiling, not exactly onto it. The rescale is a
// render, so the antialiased edge lands a pixel or two wide of where the
// arithmetic put it; aiming at the limit itself left icons measuring 0.521
// and every re-run rewrote all of them for nothing.
const REFIT_TARGET = FIT_LIMIT * 0.97;

function loadIconRegistry() {
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP_ROOT, file), "utf8"), context, { filename: file });
  }
  return vm.runInContext("ICON_PATHS", context);
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const filters = args.filter((a) => !a.startsWith("-"));

  const registry = mapIconEntries(loadIconRegistry())
    .filter(([slug]) => !filters.length || filters.some((needle) => slug.includes(needle)))
    .sort(([a], [b]) => a.localeCompare(b));

  const measured = registry.map(([slug, file]) => ({
    slug,
    file,
    radius: pngContentRadius(fs.readFileSync(path.join(APP_ROOT, file))),
  }));
  const overflowing = measured.filter((icon) => icon.radius > FIT_LIMIT);

  if (!overflowing.length) {
    console.log(`All ${measured.length} map icons already fit inside the pointer (<= ${FIT_LIMIT}).`);
    return;
  }

  if (checkOnly) {
    console.error(`${overflowing.length} of ${measured.length} map icons reach outside the pointer:`);
    for (const icon of overflowing) {
      console.error(`  ${icon.slug.padEnd(28)} ${icon.radius.toFixed(3)} / ${FIT_LIMIT}`);
    }
    console.error("\nRun `npm run fit:icons` to scale them in.");
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

  for (const icon of overflowing) {
    const source = fs.readFileSync(path.join(APP_ROOT, icon.file)).toString("base64");
    const scale = REFIT_TARGET / icon.radius;
    await page.setContent(
      `<!DOCTYPE html><style>html,body{margin:0;padding:0;background:transparent}` +
      `img{position:absolute;left:50%;top:50%;width:${SIZE}px;height:${SIZE}px;` +
      `transform:translate(-50%,-50%) scale(${scale});image-rendering:auto}</style>` +
      `<img src="data:image/png;base64,${source}">`
    );
    await page.waitForFunction(() => {
      const img = document.querySelector("img");
      return img && img.complete && img.naturalWidth > 0;
    });
    const png = await page.screenshot({ omitBackground: true });
    const after = pngContentRadius(png);
    fs.writeFileSync(path.join(APP_ROOT, icon.file), png);
    console.log(
      `  ${icon.slug.padEnd(28)} ${icon.radius.toFixed(3)} -> ${after.toFixed(3)}` +
      `  (${Math.round((1 - scale) * 100)}% smaller)`
    );
  }

  await browser.close();
  console.log(`\n${overflowing.length} icon(s) scaled to fit inside the pointer.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
