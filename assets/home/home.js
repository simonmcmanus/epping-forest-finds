/*
 * Marketing homepage only. Progressive enhancement: the page's copy and the
 * sign-up form work with JavaScript disabled. This adds a quiet scroll reveal
 * and upgrades the sign-up submit to an async call so the visitor stays on the
 * page. See spec/spec-marketing.md §5.
 */

// Scroll reveal: blocks fade up gently as they enter the viewport. Skipped for
// reduced-motion visitors and browsers without IntersectionObserver, so nothing
// is ever hidden that cannot be shown.
(function () {
  "use strict";

  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var targets = document.querySelectorAll([
    "main > section:not(.hero) > h2",
    ".section-intro", ".counts-intro", ".tag-copy > p",
    ".app-shot img", ".app-shot figcaption", ".tag-feature img", ".pillars article",
    ".map-inventory", ".signup", ".steps li", ".offline-note",
    ".faq-list", ".ledger"
  ].join(","));

  function settle(el) {
    el.classList.remove("reveal", "is-in");
    el.style.transitionDelay = "";
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      observer.unobserve(el);
      el.classList.add("is-in");
      // Once in place, drop the reveal classes so hover styles take over.
      el.addEventListener("transitionend", function done(event) {
        if (event.target !== el || event.propertyName !== "transform") return;
        el.removeEventListener("transitionend", done);
        settle(el);
      });
    });
  }, { rootMargin: "0px 0px -8% 0px" });

  Array.prototype.forEach.call(targets, function (el) {
    // Siblings in a row arrive one after another, capped so nothing lags.
    // A screenshot's phone and caption move as two objects: the caption
    // trails its phone, so they read as separate pieces.
    var shot = el.closest(".app-shot");
    var item = shot || el;
    var index = Array.prototype.indexOf.call(item.parentNode.children, item);
    var siblings = item.parentNode.querySelectorAll(":scope > " + item.tagName).length;
    var delay = siblings > 1 ? Math.min(index, 3) * 90 : 0;
    if (shot && el.tagName === "FIGCAPTION") delay += 160;
    if (delay) el.style.transitionDelay = delay + "ms";
    el.classList.add("reveal");
    observer.observe(el);
  });
})();

(function () {
  "use strict";

  var form = document.getElementById("signupForm");
  if (!form) return;

  var message = document.getElementById("formMsg");
  var emailField = document.getElementById("email");
  var consentField = document.getElementById("consent");
  var honeypot = document.getElementById("website");
  var submitButton = form.querySelector("button[type=submit]");

  function say(text, kind) {
    if (!message) return;
    message.textContent = text;
    message.className = "form-msg" + (kind ? " is-" + kind : "");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var email = (emailField && emailField.value ? emailField.value : "").trim();
    if (!email) {
      say("Please enter your email address.", "error");
      if (emailField) emailField.focus();
      return;
    }
    if (consentField && !consentField.checked) {
      say("Please tick the box to confirm you're happy to hear from us.", "error");
      consentField.focus();
      return;
    }

    if (submitButton) submitButton.disabled = true;
    say("Sending…");

    fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        consent: true,
        website: honeypot ? honeypot.value : "",
      }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body || {} };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          say(result.body.error || "Something went wrong. Please try again.", "error");
          if (submitButton) submitButton.disabled = false;
          return;
        }
        // This wording also covers an existing contact. EmailOctopus returns
        // 409 without resending double opt-in, and distinguishing that case
        // would reveal whether an address is already on the list.
        form.reset();
        if (emailField) emailField.disabled = true;
        if (consentField) consentField.disabled = true;
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = "Request received";
        }
        form.classList.add("is-complete");
        say(
          "Thanks. Confirmation is needed — check your inbox. The email might be in your spam folder.",
          "ok"
        );
      })
      .catch(function () {
        say("Couldn't reach the server. Please try again.", "error");
        if (submitButton) submitButton.disabled = false;
      });
  });
})();
