const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  workers: 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

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
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      // Only run specs that have mobile snapshots or mobile-specific behaviour
      testMatch: ["**/0[12345]-*.spec.js", "**/09-*.spec.js"],
    },
  ],

  webServer: {
    command: "node server.js",
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
