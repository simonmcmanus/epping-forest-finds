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
  test("opening a place creates no ghost and no header animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    // Any transition left over from boot must finish before the watch starts.
    await expect(page.locator(".inspector-screen-ghost")).toHaveCount(0);

    // Watch for the transition's outgoing copy and for any animation on a title section, from the click on.
    const seen = await page.evaluate(() => new Promise((resolve) => {
      const ghosts = [];
      const observer = new MutationObserver(() => {
        if (document.querySelector(".inspector-screen-ghost")) ghosts.push(true);
      });
      observer.observe(document.getElementById("inspector"), { childList: true, subtree: true });
      document.querySelector("#inspectorBody .nearest-item").click();
      const headerAnimations = () => document.getAnimations().filter((a) => a.effect && a.effect.target
        && a.effect.target.classList && a.effect.target.classList.contains("inspector-title-section")).length;
      const sampled = [headerAnimations()];
      // Let the microtask queue and one frame run, then look again.
      requestAnimationFrame(() => {
        observer.disconnect();
        sampled.push(headerAnimations());
        resolve({ ghosts: ghosts.length, headerAnimations: sampled, title: document.getElementById("inspectorTitle").textContent });
      });
    }));
    expect(seen.ghosts, "no outgoing copy is inserted").toBe(0);
    expect(seen.headerAnimations, "no header animation is created").toEqual([0, 0]);
    expect(seen.title).not.toBe("Nearby");
    await expect(page.locator("#inspectorTitle")).toHaveText(seen.title);
  });
});

test.describe("Header slide when a second tap lands mid-transition", () => {
  test("tapping Settings during the header slide settles on Settings with nothing left animating", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();

    await page.evaluate(() => {
      document.querySelector("#inspectorBody .nearest-item").click();
      // The header slide has just started; a second tap lands before it finishes.
      document.getElementById("settingsToggle").click();
    });
    await expect(page.locator("#inspectorTitle")).toHaveText("Settings");
    await expect(page.locator(".inspector-screen-ghost")).toHaveCount(0);
    // Nothing from the cancelled slide is still animating or leaving the title hidden or moved.
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect
      && a.effect.target && a.effect.target.classList
      && (a.effect.target.classList.contains("inspector-title-section") || a.effect.target.classList.contains("inspector-screen-ghost"))).length)).toBe(0);
    await expect(page.locator(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).toHaveCSS("transform", "none");
    await expect(page.locator(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).toHaveCSS("opacity", "1");
  });
});

test.describe("Header slide is only for Nearby <-> place switches", () => {
  test("Settings opened from a place keeps the sideways slide, not the header slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await listed(page).first().click();
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Nearby");

    const seen = await page.evaluate(() => new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(".inspector-screen-ghost")) return;
        observer.disconnect();
        const targets = document.getAnimations().map((a) => a.effect && a.effect.target).filter(Boolean);
        resolve({
          headerAnimated: targets.some((t) => t.classList && t.classList.contains("inspector-title-section")),
          screenAnimated: targets.some((t) => t.classList && t.classList.contains("inspector-screen")),
        });
      });
      observer.observe(document.getElementById("inspector"), { childList: true, subtree: true });
      document.getElementById("settingsToggle").click();
    }));
    expect(seen.headerAnimated, "no header slide for Settings").toBe(false);
    expect(seen.screenAnimated, "the screen slides sideways for Settings").toBe(true);
    await expect(page.locator("#inspectorTitle")).toHaveText("Settings");
  });
});
