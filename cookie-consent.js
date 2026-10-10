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

  // Colours and shapes borrowed from the rest of the site's shared visual language rather than
  // invented fresh: the card look of css/loading.css's .location-gate-card (white surface, the
  // same rgba(36,56,47,.15) border, the app's own --shadow value), and the pill buttons used by
  // both assets/home/home.css's .cta-btn and css/inspector.css's .settings-refresh-btn (rounded,
  // bold, tree-green primary). This file can't reference either stylesheet's custom properties
  // directly -- it runs on pages that load neither -- so the values are inlined here instead.
  //
  // The one exception is --nav-bar-h: on narrow/landscape viewports the app pins its own tab bar
  // (.inspector-actions, css/map-ui.css) to the bottom of the screen at the same offset this
  // banner would otherwise use, so the two would overlap. var(..., 0px) reads that custom
  // property where css/base.css defines it (the app) and is simply absent -- falling back to
  // 0px -- on every page that doesn't (homepage, terms, admin, reports).
  function injectStyle() {
    if (document.getElementById("cookieConsentStyle")) return;
    const style = document.createElement("style");
    style.id = "cookieConsentStyle";
    style.textContent = `
#cookieConsentBanner{position:fixed;left:16px;right:16px;
bottom:calc(16px + var(--nav-bar-h, 0px) + env(safe-area-inset-bottom, 0px));
z-index:2147483000;max-width:960px;
margin:0 auto;padding:18px 24px;border-radius:16px;background:#fff;color:#17221e;
border:1px solid rgba(36,56,47,.15);box-shadow:0 18px 50px rgba(19,31,25,.18);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,ui-sans-serif,system-ui,sans-serif;
display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between}
#cookieConsentBanner .cookie-consent-copy{flex:1 1 320px;min-width:0}
#cookieConsentBanner strong{display:block;margin:0 0 4px;font-size:.95rem;font-weight:800}
#cookieConsentBanner p{margin:0;color:#5d6a62}
#cookieConsentBanner a{color:#2f6f4e;font-weight:700;text-decoration:underline}
#cookieConsentBanner .cookie-consent-actions{display:flex;gap:10px;flex:0 0 auto;margin-left:auto}
#cookieConsentBanner button{border-radius:9px;padding:10px 18px;font:inherit;font-size:.88rem;
font-weight:700;cursor:pointer;transition:transform .12s ease,background-color .15s ease}
#cookieConsentBanner button:active{transform:scale(.97)}
#cookieConsentBanner button[data-action="accept"]{border:0;background:#2f6f4e;color:#fff}
#cookieConsentBanner button[data-action="accept"]:hover{background:#1d4a2f}
#cookieConsentBanner button[data-action="decline"]{border:1px solid rgba(47,111,78,.3);
background:#fff;color:#2f6f4e}
#cookieConsentBanner button[data-action="decline"]:hover{background:#f1f5ee}
@media (max-width:480px){#cookieConsentBanner{flex-direction:column;align-items:stretch;justify-content:flex-start}
#cookieConsentBanner .cookie-consent-copy{flex:0 0 auto}
#cookieConsentBanner .cookie-consent-actions{margin-left:0;flex:0 0 auto;justify-content:flex-end}}
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
      '<div class="cookie-consent-copy">' +
      "<strong>We use analytics cookies</strong>" +
      '<p>To understand how people use this site. ' +
      '<a href="/terms.html" target="_blank" rel="noopener">Privacy &amp; terms</a></p>' +
      "</div>" +
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
