"use strict";

// Google Analytics (gtag.js) consent banner, shared by every page on the site. Separate from,
// and independent of, the in-app location/usage-tracking consent in js/tracker.js: that one is
// a contextual browser-permission prompt tied to a feature (location), this one is the PECR/UK
// GDPR cookie consent gate that must run before GA's non-essential cookies (_ga, _ga_*) are set,
// on every page that loads the tag -- including the homepage, which has no other consent UI.
//
// Google Consent Mode v2's `analytics_storage` default is set to "denied" inline, before this
// file loads (see the gtag snippet in each page's <head> / generator) -- this file only decides
// whether to show the banner and relays the visitor's choice to gtag.
(function () {
  const CONSENT_KEY = "ff-cookie-consent";

  function getStoredConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch {
      return null;
    }
  }

  function updateGtagConsent(granted) {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: granted ? "granted" : "denied" });
    }
  }

  function setConsent(granted) {
    try {
      localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
    } catch {}
    updateGtagConsent(granted);
    const banner = document.getElementById("cookieConsentBanner");
    if (banner) banner.remove();
  }

  function injectStyle() {
    if (document.getElementById("cookieConsentStyle")) return;
    const style = document.createElement("style");
    style.id = "cookieConsentStyle";
    style.textContent = `
#cookieConsentBanner{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:560px;
margin:0 auto;padding:14px 16px;border-radius:12px;background:#17221e;color:#eef2ea;
font:14px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);
display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
#cookieConsentBanner p{margin:0;flex:1 1 240px}
#cookieConsentBanner a{color:#9fd8b6;text-decoration:underline}
#cookieConsentBanner .cookie-consent-actions{display:flex;gap:8px;flex:0 0 auto}
#cookieConsentBanner button{border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
#cookieConsentBanner button[data-action="accept"]{background:#2f6f4e;color:#fff}
#cookieConsentBanner button[data-action="decline"]{background:transparent;color:#eef2ea;
border:1px solid rgba(238,242,234,.4)}
`;
    document.head.appendChild(style);
  }

  function renderBanner() {
    const existing = document.getElementById("cookieConsentBanner");
    if (existing) return;
    injectStyle();
    const banner = document.createElement("div");
    banner.id = "cookieConsentBanner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<p>We use Google Analytics to understand how people use this site. ' +
      '<a href="/terms.html" target="_blank" rel="noopener">Privacy &amp; terms</a></p>' +
      '<div class="cookie-consent-actions">' +
      '<button type="button" data-action="decline">Decline</button>' +
      '<button type="button" data-action="accept">Accept</button>' +
      "</div>";
    document.body.appendChild(banner);
    banner.querySelector('[data-action="accept"]').addEventListener("click", () => setConsent(true));
    banner.querySelector('[data-action="decline"]').addEventListener("click", () => setConsent(false));
  }

  function init() {
    const stored = getStoredConsent();
    if (stored === "granted") {
      updateGtagConsent(true);
      return;
    }
    if (stored === "denied") return;
    renderBanner();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }

  // Exposed so a page can offer a "manage cookie preferences" control (see terms.html, and
  // Settings → Privacy in the app) without duplicating the banner/consent logic.
  window.ForestFindsCookieConsent = {
    get: getStoredConsent,
    set: setConsent,
    showBanner: renderBanner,
  };
})();
