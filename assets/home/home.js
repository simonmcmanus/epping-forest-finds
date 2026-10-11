/*
 * Marketing homepage only. Progressive enhancement: the page's copy and the
 * sign-up form work with JavaScript disabled. This adds a quiet scroll reveal
 * and upgrades the sign-up submit to an async call so the visitor stays on the
 * page. See spec/spec-marketing.md §5.
 */

// Load only the category a visitor opens; large lists render in batches.
(function () {
  "use strict";

  var motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  document.querySelectorAll("[data-inventory-key]").forEach(function (row) {
    var key = row.dataset.inventoryKey;
    var term = row.querySelector("dt");
    var label = term.textContent;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-toggle";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "inventory-" + key);
    while (term.firstChild) button.appendChild(term.firstChild);
    term.appendChild(button);

    var panel = document.createElement("dd");
    panel.id = "inventory-" + key;
    panel.className = "inventory-items";
    panel.hidden = true;
    row.appendChild(panel);

    var status = document.createElement("p");
    status.setAttribute("role", "status");
    panel.appendChild(status);
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "inventory-action";
    retry.textContent = "Try again";
    retry.hidden = true;
    retry.addEventListener("click", load);
    panel.appendChild(retry);
    var loaded = false;
    var loading = false;
    var icon = button.querySelector("img");
    var stillIcon = icon.getAttribute("src");
    var animatedIcon = stillIcon.replace("map-icons/", "map-icons/animated/");
    var animationFailed = false;

    function updateIcon() {
      var animate = !panel.hidden && !motionPreference.matches && document.visibilityState !== "hidden" && !animationFailed;
      var source = animate ? animatedIcon : stillIcon;
      if (icon.getAttribute("src") !== source) icon.setAttribute("src", source);
    }
    icon.addEventListener("error", function () {
      if (icon.getAttribute("src") !== animatedIcon) return;
      animationFailed = true;
      updateIcon();
    });
    motionPreference.addEventListener("change", updateIcon);
    document.addEventListener("visibilitychange", updateIcon);

    function showItems(items) {
      var search = document.createElement("input");
      search.type = "search";
      search.placeholder = "Search " + label.toLowerCase();
      search.setAttribute("aria-label", "Search " + label.toLowerCase());
      panel.insertBefore(search, status);
      var list = document.createElement("ul");
      panel.appendChild(list);
      var more = document.createElement("button");
      more.type = "button";
      more.className = "inventory-action";
      more.textContent = "Show more";
      panel.appendChild(more);
      var limit = 50;

      function render() {
        var query = search.value.trim().toLocaleLowerCase("en-GB");
        var matches = items.filter(function (item) {
          return (item.name + " " + item.detail).toLocaleLowerCase("en-GB").includes(query);
        });
        list.replaceChildren();
        matches.slice(0, limit).forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item.name;
          if (item.detail) {
            var detail = document.createElement("small");
            detail.textContent = item.detail;
            li.appendChild(detail);
          }
          list.appendChild(li);
        });
        status.textContent = !items.length ? "No places in this category yet."
          : !matches.length ? "No matching places."
          : "Showing " + Math.min(limit, matches.length).toLocaleString("en-GB") + " of " + matches.length.toLocaleString("en-GB");
        more.hidden = matches.length <= limit;
        search.hidden = !items.length;
      }
      search.addEventListener("input", function () { limit = 50; render(); });
      more.addEventListener("click", function () { limit += 50; render(); });
      render();
    }

    function load() {
      if (loaded || loading) return;
      loading = true;
      retry.hidden = true;
      status.textContent = "Loading places…";
      fetch("/assets/home/inventory/" + key + ".json")
        .then(function (response) {
          if (!response.ok) throw new Error("Category unavailable");
          return response.json();
        })
        .then(function (items) {
          showItems(items);
          loaded = true;
        })
        .catch(function () {
          status.textContent = "Couldn't load these places. Please try again.";
          retry.hidden = false;
        })
        .finally(function () { loading = false; });
    }

    button.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      updateIcon();
      if (!panel.hidden) load();
    });
  });
})();

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
  var entry = document.getElementById("signupEntry");
  var stage = document.getElementById("signupStage");
  var confirmation = document.getElementById("signupConfirmation");
  var pending = false;
  var honeypot = document.getElementById("website");
  var submitButton = form.querySelector("button[type=submit]");

  function say(text, kind) {
    if (!message) return;
    message.textContent = text;
    message.className = "form-msg" + (kind ? " is-" + kind : "");
  }

  function finishSending() {
    pending = false;
    form.removeAttribute("aria-busy");
    if (submitButton) submitButton.disabled = false;
  }

  async function showConfirmation() {
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var animate = !reduceMotion && typeof stage.animate === "function";
    var oldHeight = stage.getBoundingClientRect().height;
    if (animate) {
      await entry.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }],
        { duration: 140, easing: "ease-out" }
      ).finished.catch(function () {});
    }
    entry.hidden = true;
    confirmation.hidden = false;
    form.removeAttribute("aria-busy");
    form.reset();
    if (animate) {
      stage.animate(
        [{ height: oldHeight + "px" }, { height: stage.getBoundingClientRect().height + "px" }],
        { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" }
      );
    }
    var heading = document.getElementById("confirmationHeading");
    heading.focus({ preventScroll: true });
    var bounds = confirmation.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      confirmation.scrollIntoView({ block: "center", behavior: reduceMotion ? "instant" : "smooth" });
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (pending) return;

    var email = (emailField && emailField.value ? emailField.value : "").trim();
    if (!email) {
      say("Please enter your email address.", "error");
      if (emailField) emailField.focus();
      return;
    }
    if (!emailField.validity.valid) {
      say("Please enter a valid email address.", "error");
      emailField.focus();
      return;
    }

    pending = true;
    form.setAttribute("aria-busy", "true");
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
          finishSending();
          return;
        }
        // This wording also covers an existing contact. EmailOctopus returns
        // 409 without resending double opt-in, and distinguishing that case
        // would reveal whether an address is already on the list.
        return showConfirmation();
      })
      .catch(function () {
        say("Couldn't reach the server. Please try again.", "error");
        finishSending();
      });
  });
})();
