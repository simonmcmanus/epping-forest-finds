#!/usr/bin/env node
/**
 * Renders the homepage and contribute-page icon masters to transparent PNGs.
 *
 *   node scripts/render-home-icons.js            # every master in assets/home/icon-sources/*.svg
 *   node scripts/render-home-icons.js register   # only the named masters
 *
 * Each assets/home/icon-sources/<name>.svg becomes assets/home/<name>.png at 192px,
 * rasterised by headless Chromium so the PNG matches what a browser draws from the
 * SVG. The homepage and /contribute load only the PNGs; the SVG is the master.
 * See spec/spec-marketing.md section 5.1.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const SIZE = 192;
const root = path.join(__dirname, "..");
const sourceDir = path.join(root, "assets", "home", "icon-sources");
const outputDir = path.join(root, "assets", "home");

function masterNames(requested) {
  if (requested.length) return requested;
  return fs.readdirSync(sourceDir).filter(file => file.endsWith(".svg")).map(file => file.slice(0, -4)).sort();
}

async function main() {
  const names = masterNames(process.argv.slice(2));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    for (const name of names) {
      const svg = fs.readFileSync(path.join(sourceDir, name + ".svg"), "utf8");
      await page.setContent(
        `<!doctype html><html><head><style>html,body{margin:0;background:transparent}` +
        `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>${svg}</body></html>`
      );
      await page.screenshot({
        path: path.join(outputDir, name + ".png"),
        omitBackground: true,
        clip: { x: 0, y: 0, width: SIZE, height: SIZE },
      });
      console.log("wrote assets/home/" + name + ".png");
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
