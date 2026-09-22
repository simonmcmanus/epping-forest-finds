const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FIT_LIMIT, SPILL_POINT, pngContentRadius } = require("../scripts/lib/icon-fit.js");

const APP_ROOT = path.join(__dirname, "..");

// App chrome and the generated launcher icons are not drawn in a pointer:
// they sit in the nav bar, the filter panel, a page's <link> or the manifest,
// where filling their box is right. Kept in step with the same list in
// scripts/refit-map-icons.js and scripts/icon-audit.js.
const UI_ONLY = new Set([
  "feedback", "filter", "home", "nearby", "pin", "settings", "tick", "walking",
  "food", "nature", "history", "stories", "campsite", "logo",
]);

function loadIconRegistry() {
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP_ROOT, file), "utf8"), context, { filename: file });
  }
  return vm.runInContext("ICON_PATHS", context);
}

const mapIcons = Object.entries(loadIconRegistry()).filter(([slug]) => !UI_ONLY.has(slug));

test("every icon the map draws fits inside the pointer", () => {
  // drawPngMapIcon (js/renderer.js) paints artwork at 1.75x the pin head's
  // radius, so content past 1/1.75 of its own half-width pokes out of the
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
