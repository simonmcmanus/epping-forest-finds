const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FIT_LIMIT, SPILL_POINT, mapIconEntries, pngContentRadius, pngPixels } = require("../scripts/lib/icon-fit.js");

const APP_ROOT = path.join(__dirname, "..");

function loadIconRegistry() {
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP_ROOT, file), "utf8"), context, { filename: file });
  }
  return vm.runInContext("ICON_PATHS", context);
}

const mapIcons = mapIconEntries(loadIconRegistry());

test("every map icon has a transparent background around its artwork", () => {
  for (const [slug, file] of mapIcons) {
    const { width, height, data } = pngPixels(fs.readFileSync(path.join(APP_ROOT, file)));
    let transparent = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        // Ignore barely visible antialiasing residue in illustrated masters.
        if (alpha < 16) transparent++;
        if ((x < width * 0.05 || x >= width * 0.95) &&
            (y < height * 0.05 || y >= height * 0.95)) {
          assert.ok(alpha < 16, `${slug} must have transparent corners`);
        }
      }
    }
    assert.ok(transparent > width * height * 0.2, `${slug} must have empty space around its silhouette`);
  }
});

test("every icon the map draws fits inside the pointer", () => {
  // drawPngMapIcon (js/renderer.js) paints artwork at 1.85x the pin head's
  // radius, so content past 1/1.85 of its own half-width pokes out of the
  // white pointer. The set the app shipped with was drawn without that
  // constraint and 18 of its icons genuinely overflowed -- the restaurant's
  // cutlery, the drinking-water tap, the beer froth. `npm run fit:icons`
  // scales an offender in; this stops one arriving unnoticed.
  assert.ok(FIT_LIMIT < SPILL_POINT, "the ceiling must leave room for the antialiased edge");

  const overflowing = [];
  for (const [slug, file] of mapIcons) {
    const full = path.join(APP_ROOT, file);
    assert.ok(fs.existsSync(full), `${slug} is in the registry but ${file} is missing`);
    const radius = pngContentRadius(fs.readFileSync(full));
    if (radius > FIT_LIMIT) overflowing.push(`${slug} (${radius.toFixed(3)})`);
  }

  assert.deepEqual(
    overflowing,
    [],
    `these reach outside the pointer; run \`npm run fit:icons\`:\n  ${overflowing.join("\n  ")}`
  );
});

test("the map icons are drawn at one consistent weight", () => {
  // They ranged from 0.43 to 0.67 before the refit, so a gate pin read as
  // half again the size of an art pin sitting next to it on the same map.
  const radii = mapIcons.map(([, file]) => pngContentRadius(fs.readFileSync(path.join(APP_ROOT, file))));
  const spread = Math.max(...radii) - Math.min(...radii);
  assert.ok(spread <= 0.1, `map icon sizes span ${spread.toFixed(3)}, which reads as inconsistent artwork`);
});
