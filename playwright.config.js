const { defineConfig, devices } = require("@playwright/test");

// Escape hatch for sandboxes that cannot reach Playwright's browser CDN
// (cdn.playwright.dev) and so cannot run `npx playwright install`, but do have a
// Chromium build on disk already. Unset everywhere else — local Macs and CI both
// download and use Playwright's own pinned browser exactly as before, so this
// changes nothing about the baseline the committed snapshots were generated
// against. A mismatched Chromium build renders text slightly differently, so
// treat toHaveScreenshot() failures under this var as environmental, not real.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const launchOptions = chromiumExecutablePath
  ? {
      executablePath: chromiumExecutablePath,
      // Chromium's own background traffic (component updates, autofill, safebrowsing)
      // goes nowhere behind a sandbox egress proxy and just adds hundreds of rejected
      // connections and retry latency to every run.
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    }
  : {};

module.exports = defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  workers: 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  // GitHub-hosted runners only get 2 vCPUs; 4 workers there oversubscribes
  // the CPU and slows each page's animation-frame loop enough that the
  // default 5s toHaveScreenshot() stability check can time out waiting for
  // a stable frame, before it ever compares pixels. Rather than cutting
  // parallelism (and CI wall-clock time) to fix that, just give screenshot
  // assertions more real time to converge under contention; other
  // assertions keep the fast default everywhere.
  expect: {
    toHaveScreenshot: { timeout: process.env.CI ? 15_000 : 5_000 },
  },

  // Flat, screenshot-name-only path (not derived from the spec file path or
  // test title). Renaming/splitting/moving a spec file must never rename its
  // snapshot files — that turns a real visual diff into an unreviewable
  // delete+create pair in git. The `{arg}` passed to toHaveScreenshot() is
  // the only thing that identifies a snapshot, so it must stay unique
  // project-wide and stable across refactors.
  snapshotPathTemplate: "test/e2e/__screenshots__/{arg}{-projectName}{-platform}{ext}",

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    // Suppress service-worker registration so tests always hit real routes
    serviceWorkers: "block",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], launchOptions },
      // Only run specs that have mobile snapshots or mobile-specific behaviour.
      // 13 (3D tilt) is included because tilt is driven by device orientation and only
      // ever happens on a phone — the desktop profile would exercise it at a viewport
      // shape it never actually sees.
      testMatch: ["**/0[12345]-*.spec.js", "**/09-*.spec.js", "**/13-*.spec.js"],
    },
  ],

  webServer: {
    command: "node server.js",
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
