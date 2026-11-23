// Weekly report cards: header icons must stay on the title's first line, never alone on a row.
const { test, expect } = require("@playwright/test");

for (const width of [360, 1024]) {
  test(`report card icons stay beside the first line of a long title at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/reports/epping-forest-ledger-2026-11-22.html");
    const measures = await page.evaluate(() => {
      const out = [];
      for (const head of document.querySelectorAll(".card-head")) {
        const h3 = head.querySelector("h3");
        const lh = parseFloat(getComputedStyle(h3).lineHeight) || h3.getBoundingClientRect().height;
        const t = h3.getBoundingClientRect();
        for (const icon of head.querySelectorAll(".pin-chip, .line-icon, .card-subicon")) {
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
    expect(measures.some((m) => /Weaver line/.test(m.title))).toBe(true);
    for (const m of measures) {
      expect(m.centre, `icon for "${m.title}" is on the first title line`).toBeGreaterThanOrEqual(m.titleTop - 1);
      expect(m.centre, `icon for "${m.title}" is on the first title line`).toBeLessThanOrEqual(m.firstLineBottom + 1);
      expect(m.width).toBe(22);
      expect(m.headOverflow).toBe(false);
    }
  });
}
