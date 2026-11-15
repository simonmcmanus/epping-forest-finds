// @ts-check
// Switching between the Nearby list and a place's panel: the outgoing header slides up off the top of
// the panel while the incoming header slides down into place. Reduced-motion readers get the change
// with no movement.
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const listed = (page) => page.locator("#inspectorBody .nearest-item");

/**
 * Triggers a control and scrubs the two header animations the moment the transition inserts its outgoing
 * copy: they are paused at 0%, 50% and 100% of their timing and each header's top edge is read there,
 * then the animations are released. Scrubbing is deterministic, so the result does not depend on how
 * many frames the browser renders. Back goes through browser history, so the transition starts in a
 * later task; the observer covers both cases.
 */
function scrubHeaderSlide(page, selector) {
  return page.evaluate((sel) => new Promise((resolve) => {
    const top = (el) => el.getBoundingClientRect().top;
    const scrub = () => {
      const outHeader = document.querySelector(".inspector-screen-ghost .inspector-title-section");
      const inHeader = document.querySelector(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section");
      const anims = document.getAnimations().filter((a) => a.effect
        && (a.effect.target === outHeader || a.effect.target === inHeader));
      const at = (fraction) => {
        for (const a of anims) {
          a.pause();
          a.currentTime = a.effect.getTiming().duration * fraction;
        }
        return { out: outHeader ? top(outHeader) : null, inc: inHeader ? top(inHeader) : null };
      };
      const result = {
        scrollTop: top(document.querySelector(".inspector-scroll")),
        title: document.getElementById("inspectorTitle").textContent,
        animated: anims.length,
        start: at(0),
        mid: at(0.5),
        end: at(1),
      };
      for (const a of anims) a.play();
      return result;
    };
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".inspector-screen-ghost")) return;
      observer.disconnect();
      resolve(scrub());
    });
    observer.observe(document.getElementById("inspector"), { childList: true, subtree: true });
    document.querySelector(sel).click();
  }), selector);
}

test.describe("Nearby <-> place header slide", () => {
  test("opening a place slides the old header off the top and the new one down", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();

    const r = await scrubHeaderSlide(page, "#inspectorBody .nearest-item");
    expect(r.animated, "both headers are animated").toBe(2);
    // Incoming: starts above the panel's top edge (clipped), comes down, and lands in place.
    expect(r.start.inc).toBeLessThan(r.scrollTop);
    expect(r.start.inc).toBeLessThan(r.mid.inc);
    expect(r.mid.inc).toBeLessThan(r.end.inc);
    // Outgoing: leaves upward from where the Nearby header sat.
    expect(r.end.out).toBeLessThan(r.mid.out);
    expect(r.mid.out).toBeLessThan(r.start.out);
    expect(r.title).not.toBe("Nearby");

    await expect(page.locator(".inspector-screen-ghost")).toHaveCount(0);
    await expect(page.locator("#inspectorTitle")).toHaveText(r.title);
  });

  test("Back from a place slides its header off the top and the Nearby header down", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await listed(page).first().click();
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Nearby");

    const r = await scrubHeaderSlide(page, "#inspectorBack");
    expect(r.animated, "both headers are animated").toBe(2);
    expect(r.start.inc).toBeLessThan(r.scrollTop);
    expect(r.start.inc).toBeLessThan(r.mid.inc);
    expect(r.mid.inc).toBeLessThan(r.end.inc);
    expect(r.end.out).toBeLessThan(r.mid.out);
    expect(r.mid.out).toBeLessThan(r.start.out);
    await expect(page.locator(".inspector-screen-ghost")).toHaveCount(0);
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
  });
});

test.describe("Nearby <-> place header slide with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("opening a place swaps the panel at once, with no slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await listed(page).first().click();
    await expect(page.locator(".inspector-screen-ghost")).toHaveCount(0);
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Nearby");
    await expect(page.locator(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).toHaveCSS("transform", "none");
  });
});
