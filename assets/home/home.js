/*
 * Marketing homepage only. Progressive enhancement: the page's copy and the
 * sign-up form work with JavaScript disabled. This adds a quiet scroll reveal
 * and upgrades the sign-up submit to an async call so the visitor stays on the
 * page. See spec/spec-marketing.md §5.
 */

 // The editions index is generated with every report build. Read its first row,
// then its report, so this static homepage can show the newest Ledger without
// duplicating editorial facts that would go stale between weekly runs.
(function () {
  "use strict";

  var preview = document.getElementById("ledgerLatest");
  var latestLink = document.getElementById("latestLedgerLink");
  if (!preview || !latestLink || !window.fetch || !window.DOMParser) return;

  function addStory(list, report, section, type, label) {
    var card = report.querySelector(section + " .card");
    if (!card) return;
    var item = document.createElement("li");
    item.className = "ledger-story ledger-story--" + type;
    var category = document.createElement("span");
    category.className = "ledger-story-type";
    category.textContent = label;
    var title = document.createElement("h3");
    var link = document.createElement("a");
    link.href = latestLink.pathname + section;
    link.textContent = card.querySelector("h3").textContent.trim();
    title.appendChild(link);
    var meta = document.createElement("p");
    meta.className = "ledger-story-meta";
    var status = card.querySelector(".status-label");
    if (status) {
      var date = document.createElement("span");
      date.className = "ledger-story-status";
      date.textContent = status.textContent.trim();
      meta.appendChild(date);
    }
    var place = card.querySelector(".addr");
    if (place) {
      var location = document.createElement("span");
      location.textContent = place.textContent.trim();
      meta.appendChild(location);
    }
    item.append(category, title, meta);
    list.appendChild(item);
  }

  function homepageSummary(report) {
    var banner = report.querySelector(".banner");
    if (!banner) return "";
    var update = banner.textContent.trim()
      .replace(/\s*No event updates are included this week beyond the listings below\.\s*/i, " ");
    return "This week’s Ledger: " + update + " Read the full edition for the complete round-up.";
  }

  fetch("/reports/")
    .then(function (response) {
      if (!response.ok) throw new Error("Ledger index unavailable");
      return response.text();
    })
    .then(function (source) {
      var index = new DOMParser().parseFromString(source, "text/html");
      var edition = index.querySelector(".report-link");
      if (!edition) throw new Error("No editions published");
      var editionUrl = new URL(edition.getAttribute("href"), window.location.origin + "/reports/").pathname;
      var date = edition.querySelector(".report-name");
      latestLink.href = editionUrl;
      var heroLink = document.querySelector(".hero-ledger-link");
      if (heroLink) heroLink.href = editionUrl;
      return fetch(editionUrl).then(function (response) {
        if (!response.ok) throw new Error("Latest edition unavailable");
        return response.text();
      }).then(function (reportSource) {
        return { date: date && date.textContent.trim(), report: new DOMParser().parseFromString(reportSource, "text/html") };
      });
    })
    .then(function (latest) {
      var report = latest.report;
      var stories = document.createElement("ul");
      stories.className = "ledger-stories";
      addStory(stories, report, "#businesses", "find", "Local find");
      addStory(stories, report, "#road", "access", "Plan your visit");
      addStory(stories, report, "#event", "events", "Coming up");
      if (!stories.children.length) throw new Error("No preview stories");
      preview.replaceChildren();
      var label = document.createElement("p");
      label.className = "ledger-latest-label";
      label.textContent = "Latest field notes";
      var date = document.createElement("strong");
      date.className = "ledger-latest-date";
      date.textContent = latest.date || "This week";
      var summary = homepageSummary(report);
      if (summary) {
        var introduction = document.createElement("p");
        introduction.className = "ledger-latest-summary";
        introduction.textContent = summary;
        preview.append(label, date, introduction, stories);
      } else preview.append(label, date, stories);
    })
    .catch(function () {
      preview.hidden = true;
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

// Map inventory: on wide screens the category lists are always open, so the expand control goes away;
// on phones they start collapsed. Without JavaScript they stay closed and the summary stays usable.
(function () {
  "use strict";

  var inventory = document.querySelector(".map-inventory");
  if (!inventory || !window.matchMedia) return;
  var wide = window.matchMedia("(min-width: 760px)");

  function sync(initial) {
    inventory.toggleAttribute("data-always-open", wide.matches);
    var lists = inventory.querySelectorAll(".inventory-details");
    // Phones keep whatever the visitor opened; only the move to a wide screen forces them open.
    if (wide.matches) lists.forEach(function (list) { list.open = true; });
    else if (!initial) lists.forEach(function (list) { list.open = false; });
  }

  sync(true);
  if (wide.addEventListener) wide.addEventListener("change", function () { sync(false); });
})();
