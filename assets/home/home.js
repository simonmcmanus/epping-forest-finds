/*
 * Marketing homepage only. Progressive enhancement for the sign-up form: the
 * page's copy and the form itself work with JavaScript disabled, and this
 * upgrades the submit to an async call so the visitor stays on the page.
 *
 * Nothing else on the homepage needs script. See spec/spec-marketing.md §5.
 */

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
        // Double opt-in: the address is not on the list until they confirm,
        // so the wording is "check your inbox", never "you're in".
        form.reset();
        say("Check your inbox — we've sent you a confirmation email.", "ok");
      })
      .catch(function () {
        say("Couldn't reach the server. Please try again.", "error");
        if (submitButton) submitButton.disabled = false;
      });
  });
})();
