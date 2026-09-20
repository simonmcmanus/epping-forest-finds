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
  // One worker per available core. GitHub-hosted runners have 2 vCPUs, and the CI job runs one
  // Playwright project per runner (see the `project` matrix in .github/workflows/ci.yml), so 2
  // there and 4 on a typical dev machine. Four workers on two vCPUs was the single biggest
  // source of red CI: every worker got half a core, the app's boot-and-draw cycle stretched
  // past the waits the specs bound it with, and whole spec files failed together in `beforeEach`
  // while the same suite passed locally. That looked like flakiness and was really starvation.
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  // Everything a spec waits on gets more real time under CI, not just screenshots. A runner is
  // slower than a dev machine even with the contention above fixed, and an assertion's timeout
  // is a bound on how long the UI may take to get somewhere -- not a behaviour being tested. A
  // genuinely broken UI still fails, on the 60s test timeout; all a tight bound bought was a
  // red suite on a loaded machine. Specs therefore state *what* they wait for and leave *how
  // long* to this, rather than each hard-coding its own few seconds.
  expect: {
    timeout: process.env.CI ? 20_000 : 5_000,
    // maxDiffPixelRatio, not an exact match: the baselines CI compares against are PNGs CI
    // generated itself on the same runner image, and they still came back 28 pixels apart on a
    // ~334k-pixel screenshot -- canvas antialiasing and font hinting are not bit-deterministic
    // under load. 0.1% leaves better than ten times the headroom that noise needs while still
    // catching any diff big enough to see.
    toHaveScreenshot: { timeout: process.env.CI ? 15_000 : 5_000, maxDiffPixelRatio: 0.001 },
  },

  // Flat, screenshot-name-only path (not derived from the spec file path or
  // test title). Renaming/splitting/moving a spec file must never rename its
  // snapshot files — that turns a real visual diff into an unreviewable
  // delete+create pair in git. The `{arg}` passed to toHaveScreenshot() is
  // the only thing that identifies a snapshot, so it must stay unique
  // project-wide and stable across refactors.
  snapshotPathTemplate: "test/e2e/__screenshots__/{arg}{-projectName}{-platform}{ext}",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080",
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
