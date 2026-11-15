const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");

// Exercise the actual selection + renderer pipeline without publishing a test edition.
const renderPlanningEdition = () => execFileSync("python3", ["-c", `
import json, sys
from datetime import date
from pathlib import Path
from scripts.report.structured_findings import event_findings
from scripts.report.render_report import render_report
entries = json.load(sys.stdin)
findings = event_findings(entries, date(2026, 11, 15))
print(render_report({"date": "2026-11-15", "date_display": "Sunday, 15 November 2026", "findings": findings}, Path.cwd()))
`], {
  cwd: path.join(__dirname, "..", ".."),
  encoding: "utf8",
  input: JSON.stringify([
    { title: "Local winter fair", place: "Epping", body: "Saturday 21 November.", date: "2026-11-21" },
    { title: "Christmas market", place: "Chingford", body: "Saturday 19 December.", date: "2026-12-19" },
    { title: "Winter concert", place: "Loughton", body: "Thursday 14 January.", date: "2027-01-14" },
    { title: "Beyond the planning window", place: "Epping", body: "Friday 15 January.", date: "2027-01-15" },
    { title: "Expired fair", place: "Epping", body: "Saturday 14 November.", date: "2026-11-14" },
  ]),
});

test("readers can plan Christmas events more than a month ahead without confusing them with this week", async ({ page }, testInfo) => {
  const html = renderPlanningEdition();
  await page.route("**/reports/planning-test.html", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/reports/planning-test.html");
  const events = page.locator("#event");
  await expect(events.locator(".event-subgroup-title")).toHaveText(["This week", "Coming up in the next two months"]);
  const groups = events.locator(".cards");
  await expect(groups.nth(0)).toContainText("Local winter fair");
  await expect(groups.nth(0)).not.toContainText("Christmas market");
  await expect(groups.nth(1)).toContainText("Christmas market");
  await expect(groups.nth(1)).toContainText("Winter concert");
  await expect(events).not.toContainText("Beyond the planning window");
  await expect(events).not.toContainText("Expired fair");
  await expect(events.locator(".section-sub")).toContainText("next two months");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await events.screenshot({ path: testInfo.outputPath("event-planning.png") });
});
