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

// app.html's own default markup for #consentBanner -- hidden, correct for the plain, non-landing
// /nearby screen, which never shows this banner at all.
const APP_CONSENT_BANNER_HIDDEN =
  '<div id="consentBanner" class="consent-banner" role="group" aria-label="Location and cookies" hidden>';

// Every generated page this is called on is always a landing-page arrival (isLandingPageArrival(),
// js/app.js) -- the one case showCombinedConsentBanner() exists for. Un-hiding #consentBanner
// here reserves its layout space from the very first paint for the common case (a first-time
// visitor, cookie consent still undecided), instead of the banner being inserted after boot and
// visibly pushing the Nearby list down the screen the instant JS ran. boot()'s own
// showsCombinedConsentBanner check hides it again, synchronously before anything else runs, for
// every other case (returning visitor, consent already decided, no geolocation support) -- this
// only ever sets the common-case default, never the final answer.
function showConsentBannerByDefault(html) {
  return replaceOnce(
    html,
    APP_CONSENT_BANNER_HIDDEN,
    APP_CONSENT_BANNER_HIDDEN.replace(/ hidden>$/, ">"),
    "consent banner default-hidden state"
  );
}

module.exports = { escapeHtml, replaceOnce, showConsentBannerByDefault };
