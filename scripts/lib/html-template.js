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

// app.html's own default copy inside #consentBanner's .consent-banner-copy -- generic, since the
// shared app shell has no page of its own to be specific about.
const APP_CONSENT_BANNER_TEXT =
  '<p>Shows nearby finds and their distance from you, and understands how people use this site — enabling covers both. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>';

// Swaps that generic copy for a page-specific lead phrase (e.g. "Enable location to get walking
// directions and see what's near pubs and bars") on a generated /nearby/<slug>/ or /find/<slug>/
// page -- the cookie-consent half of the sentence stays the same either way, since enabling the
// one banner covers both regardless of which page asked. Reported directly: the body's own
// separate "Enable location to..." sentence not only repeated what this banner already asks, but
// read as generic boilerplate once the real content (a real nearby list, or a real business) sat
// right below it -- merging the two into the one ask on screen, where it already lives, removes
// the repeat rather than trying to keep both in sync.
function customizeConsentBannerText(html, leadPhrase) {
  return replaceOnce(
    html,
    APP_CONSENT_BANNER_TEXT,
    `<p>${leadPhrase} and help us understand how people use this site. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>`,
    "consent banner default copy"
  );
}

module.exports = { escapeHtml, replaceOnce, showConsentBannerByDefault, customizeConsentBannerText };
