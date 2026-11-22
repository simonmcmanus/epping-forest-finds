'use strict';
// Weekly report cards: header icons must stay on the title's first line, never alone on a row.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const REPORT = pathToFileURL(path.join(__dirname, '..', 'reports', 'epping-forest-ledger-2026-11-22.html')).href;

for (const width of [360, 1024]) {
  test(`report card icons stay beside the first line of a long title at ${width}px`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
      await page.goto(REPORT);
      const m = await page.evaluate(() => {
        const out = [];
        for (const head of document.querySelectorAll('.card-head')) {
          const h3 = head.querySelector('h3');
          const lh = parseFloat(getComputedStyle(h3).lineHeight) || h3.getBoundingClientRect().height;
          const t = h3.getBoundingClientRect();
          for (const icon of head.querySelectorAll('.pin-chip, .line-icon, .card-subicon')) {
            const r = icon.getBoundingClientRect();
            out.push({
              title: h3.textContent,
              centre: r.top + r.height / 2,
              titleTop: t.top,
              firstLineBottom: t.top + lh,
              width: r.width,
              headOverflow: head.scrollWidth > head.clientWidth,
            });
          }
        }
        return out;
      });
      assert.ok(m.some((x) => /Weaver line/.test(x.title)), 'Weaver card icon found');
      for (const x of m) {
        assert.ok(x.centre >= x.titleTop - 1 && x.centre <= x.firstLineBottom + 1,
          `icon for "${x.title}" sits on the first title line (centre ${x.centre}, title ${x.titleTop}-${x.firstLineBottom})`);
        assert.equal(x.width, 22);
        assert.equal(x.headOverflow, false);
      }
    } finally {
      await browser.close();
    }
  });
}
