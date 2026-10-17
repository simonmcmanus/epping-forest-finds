"use strict";
// Shared by any generator that templates a page off another HTML file
// (generate-find-pages.js, generate-business-pages.js) -- kept in one place
// so both stay byte-for-byte consistent in how they escape and substitute.

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces the one occurrence of `needle` in `html`, throwing if it's not there exactly once. */
function replaceOnce(html, needle, replacement, label) {
  const count = html.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(
      `[html-template] expected exactly one "${label}" in the template, found ${count} -- ` +
        "the source file changed in a way the generator's template no longer matches."
    );
  }
  return html.replace(needle, replacement);
}

module.exports = { escapeHtml, replaceOnce };
