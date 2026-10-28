"use strict";

// Google Analytics (gtag.js) consent banner for the site's public pages. This is the PECR/UK GDPR
// cookie consent gate that must run before GA's non-essential cookies (_ga, _ga_*) are set, on
// every page that loads the tag -- including the homepage, which has no other consent UI. Inside
// the app the same cookies are part of one usage-analytics question (js/tracker.js
// setAnalyticsConsent), which writes this file's key too, so a choice made either way carries over.
//
// Every page's <head> defines the gtag() queue with all four Consent Mode v2 signals denied and
// Google Signals off (see the snippet in each page / generator), but does not load Google's
// script: this file loads it once the visitor agrees, and relays the choice to gtag.
(function () {
  const CONSENT_KEY = "ff-cookie-consent";
  const EARLY_TESTING_BANNER_KEY = "ff-early-testing-banner-v1";
  // The oak-leaf logo. The homepage keeps its own copy of the same file because marketing never
  // loads app assets; every other page takes the app's. Absolute, so /reports/ and /find/<slug>/
  // resolve it too.
  const IS_HOMEPAGE = location.pathname === "/" || location.pathname === "/index.html";
  const LOGO_SRC = IS_HOMEPAGE ? "/assets/home/map-icons/oak.png" : "/data/icons/trees/logo.png";

  function getStoredConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch {
      return null;
    }
  }

  const GA_SCRIPT_SRC = "https://www.googletagmanager.com/gtag/js?id=G-M9NL06G2JB";

  // Google's own script is loaded only once analytics is agreed to. Each page's <head> defines the
  // gtag() queue and denies every consent signal, but no longer loads the script itself: in
  // Google's "advanced" consent mode a loaded tag still sends cookieless pings (IP address, page,
  // browser) before anyone has answered, which needs consent just as the cookies do.
  function loadGoogleAnalytics() {
    if (document.querySelector(`script[src="${GA_SCRIPT_SRC}"]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = GA_SCRIPT_SRC;
    document.head.appendChild(script);
  }

  // Withdrawal stops collection and removes what was stored for it: Google Analytics' own cookies
  // (_ga, _ga_<id>), on this host and on the parent domain it may have set them for.
  function clearGoogleAnalyticsCookies() {
    const names = document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter((name) => /^_ga(_|$)/.test(name));
    const host = location.hostname;
    const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
      }
    }
  }

  function updateGtagConsent(granted) {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: granted ? "granted" : "denied" });
    }
    if (granted) loadGoogleAnalytics();
    else clearGoogleAnalyticsCookies();
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
  // invented fresh: the card look of css/loading.css's .location-gate-card (white surface, a
  // similar border, the app's own --shadow value), the pill buttons used by both
  // assets/home/home.css's .cta-btn and css/inspector.css's .settings-refresh-btn (rounded,
  // bold, tree-green primary), and the tree-green left accent border used by the reports-index
  // generator's "note" callout -- a plain white card nearly vanished against the site's own
  // off-white page backgrounds (--paper is #eef2ea/#f4f4ec, not far from this card's #fff), so
  // the stronger border/shadow and the accent stripe are what actually separate it from the page
  // underneath, not the card colour alone. This file can't reference either stylesheet's custom
  // properties directly -- it runs on pages that load neither -- so the values are inlined here.
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
margin:0 auto;padding:18px 24px 18px 20px;border-radius:16px;background:#fff;color:#17221e;
border:1px solid rgba(23,34,30,.18);border-left:5px solid #2f6f4e;
box-shadow:0 22px 50px rgba(19,31,25,.3),0 2px 10px rgba(19,31,25,.14);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,ui-sans-serif,system-ui,sans-serif;
display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between}
#cookieConsentBanner .cookie-consent-lead{display:flex;flex:1 1 320px;gap:12px;align-items:flex-start;min-width:0}
#cookieConsentBanner .cookie-consent-logo{flex:0 0 auto;width:36px;height:36px}
#cookieConsentBanner .cookie-consent-copy{flex:1 1 auto;min-width:0}
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
#cookieConsentBanner .cookie-consent-lead{flex:0 0 auto}
#cookieConsentBanner .cookie-consent-actions{margin-left:0;flex:0 0 auto;justify-content:flex-end}}
`;
    document.head.appendChild(style);
  }

  function renderBanner() {
    const existing = document.getElementById("cookieConsentBanner");
    if (existing) return;
    // The app shell (app.html, and every page generated from it -- the only pages with a
    // #consentBanner) asks this itself, as part of one usage-analytics question that also covers
    // the app's own usage data: onboarding's analytics step, or showConsentBanner in js/app.js.
    // Showing this banner there as well would ask the same person the same thing twice.
    if (document.getElementById("consentBanner")) return;
    injectStyle();
    const banner = document.createElement("div");
    banner.id = "cookieConsentBanner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<div class="cookie-consent-lead">' +
      `<img class="cookie-consent-logo" src="${LOGO_SRC}" alt="" width="36" height="36">` +
      '<div class="cookie-consent-copy">' +
      "<strong>We use analytics cookies</strong>" +
      '<p>To understand how people use this site. ' +
      '<a href="/terms.html" target="_blank" rel="noopener">Privacy &amp; terms</a></p>' +
      "</div>" +
      "</div>" +
      '<div class="cookie-consent-actions">' +
      '<button type="button" data-action="decline">Decline</button>' +
      '<button type="button" data-action="accept">Accept</button>' +
      "</div>";
    document.body.appendChild(banner);
    banner.querySelector('[data-action="accept"]').addEventListener("click", () => setConsent(true));
    banner.querySelector('[data-action="decline"]').addEventListener("click", () => setConsent(false));
  }

  function earlyTestingBannerSeen() {
    try {
      return localStorage.getItem(EARLY_TESTING_BANNER_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markEarlyTestingBannerSeen() {
    try {
      localStorage.setItem(EARLY_TESTING_BANNER_KEY, "1");
    } catch {}
  }

  function injectEarlyTestingStyle() {
    if (document.getElementById("earlyTestingBannerStyle")) return;
    const style = document.createElement("style");
    style.id = "earlyTestingBannerStyle";
    style.textContent = `
#earlyTestingBanner{margin:18px 0;padding:14px 18px;border-radius:14px;
background:#fff;color:#17221e;border:1px solid rgba(23,34,30,.18);border-left:5px solid #c58b16;
box-shadow:0 2px 8px rgba(19,31,25,.12);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,ui-sans-serif,system-ui,sans-serif;
display:flex;gap:12px 18px;align-items:flex-start}
#earlyTestingNoticeSlot #earlyTestingBanner{margin:12px 12px 0;background:linear-gradient(120deg,rgba(197,139,22,.13),rgba(255,255,255,.86))}
#earlyTestingBanner .early-testing-logo{flex:0 0 auto;width:36px;height:36px}
#earlyTestingBanner .early-testing-copy{flex:1 1 320px;min-width:0}
#earlyTestingBanner strong{display:block;margin:0 0 3px;font-size:.95rem;font-weight:800}
#earlyTestingBanner p{margin:0;color:#5d6a62}
#earlyTestingBanner a{color:#1d4a2f;font-weight:700;text-decoration:underline}
#earlyTestingBanner button{flex:0 0 auto;border:0;background:transparent;color:#405048;padding:2px;
font:inherit;font-size:1.2rem;line-height:1;cursor:pointer}
#earlyTestingBanner button:hover{color:#17221e}
@media (max-width:760px){#earlyTestingBanner{position:fixed;top:max(12px,env(safe-area-inset-top,0px));left:12px;right:12px;z-index:109;max-width:560px;margin:0 auto;padding:13px 14px;gap:10px;box-shadow:0 18px 42px rgba(19,31,25,.24),0 2px 8px rgba(19,31,25,.12)}}
`;
    document.head.appendChild(style);
  }

  function renderEarlyTestingBanner() {
    if (earlyTestingBannerSeen() || document.getElementById("earlyTestingBanner")) return;
    // The homepage already explains the trial and has its own sign-up invitation, so keep this
    // extra notice for people arriving elsewhere on the site.
    if (location.pathname === "/" || location.pathname === "/index.html") return;
    // Fixed descendants are scoped by a transformed inspector sheet, so on mobile this must be
    // mounted directly under <body>: otherwise it is fixed to the sheet and covers the location
    // notice inside it. Desktop keeps the notice in the inspector's reading flow.
    const noticeSlot = window.matchMedia("(max-width: 760px)").matches
      ? document.body
      : document.getElementById("earlyTestingNoticeSlot") || document.querySelector("main, .page");
    if (!noticeSlot) return;
    // Do not layer a site notice over the app's first-run onboarding dialog. It is shown once
    // that dialog has been completed instead.
    const onboarding = document.getElementById("onboardingOverlay");
    if (onboarding && !onboarding.hidden) return;
    injectEarlyTestingStyle();
    const banner = document.createElement("aside");
    banner.id = "earlyTestingBanner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-label", "Early testing notice");
    banner.innerHTML =
      `<img class="early-testing-logo" src="${LOGO_SRC}" alt="" width="36" height="36">` +
      '<div class="early-testing-copy">' +
      "<strong>Epping Forest Finds is still a work in progress</strong>" +
      '<p>You may find data problems or bugs — please <a href="/report">report any you find</a>.</p>' +
      "</div>" +
      '<button type="button" data-action="dismiss" aria-label="Dismiss early testing notice">×</button>';
    noticeSlot.prepend(banner);
    // This is an informational notice, not a consent choice: recording it at first display
    // means visitors never see it again when they navigate to another page.
    markEarlyTestingBannerSeen();
    banner.querySelector('[data-action="dismiss"]').addEventListener("click", () => banner.remove());
  }

  function initEarlyTestingBanner() {
    if (location.pathname === "/" || location.pathname === "/index.html") return;
    renderEarlyTestingBanner();
    const onboarding = document.getElementById("onboardingOverlay");
    if (onboarding && !onboarding.hidden && !earlyTestingBannerSeen()) {
      const observer = new MutationObserver(() => {
        if (!onboarding.hidden) return;
        observer.disconnect();
        renderEarlyTestingBanner();
      });
      observer.observe(onboarding, { attributes: true, attributeFilter: ["hidden"] });
    }
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
    initEarlyTestingBanner();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      init();
      initEarlyTestingBanner();
    }, { once: true });
  }

  // Exposed so a page can offer a "manage cookie preferences" control (see terms.html) and the app
  // can record its own analytics answer (js/tracker.js) without duplicating the consent logic.
  window.ForestFindsCookieConsent = {
    get: getStoredConsent,
    set: setConsent,
    showBanner: renderBanner,
  };
})();
