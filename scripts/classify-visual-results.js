#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

// Only a completed screenshot comparison with image evidence is advisory.
// A timeout waiting for the page, browser startup or a different assertion is not.
function isPixelDifference(result) {
  if (result.status !== "failed") return false;
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  const images = (result.attachments || []).filter(item => item.contentType === "image/png");
  return errors.length > 0 &&
    images.some(item => /(?:^|[-_])actual(?:[.-]|$)/.test(item.name || "")) &&
    errors.every(error => {
      const message = (error.message || error.value || "").replace(/\u001b\[[0-9;]*m/g, "");
      return /expect\([^\n]*\)\.toHaveScreenshot\(/.test(message) &&
        /\d+ pixels? .*different|Expected an image .*received an image|Expected an image .*received /s.test(message);
    });
}

// A snapshot with no committed baseline yet. Playwright fails that attempt and writes the render as the actual; CI
// generates the baseline in the workspace (--update-snapshots=missing) and the trusted publisher shows the first render
// in the PR description. It is a warning, not a failure, so a new screen does not turn the visual check red.
function isMissingBaseline(result) {
  if (result.status !== "failed") return false;
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  const images = (result.attachments || []).filter(item => item.contentType === "image/png");
  return errors.length > 0 &&
    images.some(item => /(?:^|[-_])actual(?:[.-]|$)/.test(item.name || "")) &&
    errors.every(error => {
      const message = (error.message || error.value || "").replace(/\u001b\[[0-9;]*m/g, "");
      return /A snapshot doesn't exist at [^\n]+, writing actual\./.test(message);
    });
}

function classifyVisualResults(report, exitCode) {
  const blocking = [];
  const differences = [];
  const missing = [];
  let attempts = 0;
  let nonSkippedAttempts = 0;
  if (!report || !Array.isArray(report.suites)) return { blocking: ["Missing or invalid Playwright JSON report"], differences, attempts };
  for (const error of report.errors || []) blocking.push(error.message || error.value || "Playwright global error");
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const name = `${test.projectName || "unknown project"}: ${spec.title || "unnamed test"}`;
          if (!test.results?.length) {
            blocking.push(`${name}: no result`);
            continue;
          }
          for (const result of test.results) {
            attempts++;
            if (result.status !== "skipped") nonSkippedAttempts++;
            if (result.status === "passed" || result.status === "skipped") continue;
            if (isPixelDifference(result)) differences.push(name);
            else if (isMissingBaseline(result)) missing.push(name);
            else blocking.push(`${name}: ${result.status || "missing status"}`);
          }
        }
      }
      visit(suite.suites || []);
    }
  }
  visit(report.suites);
  if (!nonSkippedAttempts) blocking.push("No visual tests ran (all missing or skipped)");
  if (exitCode !== 0 && !blocking.length && !differences.length && !missing.length) blocking.push(`Playwright exited ${exitCode} without a screenshot difference`);
  return { blocking: [...new Set(blocking)], differences: [...new Set(differences)], missing: [...new Set(missing)], attempts };
}

if (require.main === module) {
  const [file, rawExit] = process.argv.slice(2);
  const exitCode = Number(rawExit);
  try {
    if (!file || !Number.isInteger(exitCode) || exitCode < 0) throw new Error("Usage: classify-visual-results.js <report.json> <playwright exit code>");
    const result = classifyVisualResults(JSON.parse(fs.readFileSync(file, "utf8")), exitCode);
    console.log(JSON.stringify(result));
    for (const error of result.blocking) console.error(error);
    if (result.differences.length) console.log(`::warning title=Visual differences need review::${result.differences.length} screenshot comparison(s) differ; inspect the current-head artifacts.`);
    if (result.missing.length) console.log(`::warning title=New visual snapshots need review::${result.missing.length} snapshot(s) have no committed baseline yet; their first render is in the PR description.`);
    process.exitCode = result.blocking.length ? 1 : 0;
  } catch (error) {
    console.error(`Visual result classification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { classifyVisualResults, isPixelDifference };
