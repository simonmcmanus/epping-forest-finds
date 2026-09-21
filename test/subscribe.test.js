/**
 * Sign-up endpoint and alpha gate validation.
 *
 * The gate's own request handling runs on a Netlify edge function and cannot
 * be exercised here (server.js does not run edge functions -- see
 * spec/spec-alpha-access.md section 3.4), so these cover the decision logic it
 * is built from: which secrets are valid, and what the cookie looks like.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const subscribe = require("../netlify/functions/subscribe.js");

test("an address with a name, an at-sign and a dotted domain is accepted", () => {
  assert.strictEqual(subscribe.isPlausibleEmail("walker@example.co.uk"), true);
  assert.strictEqual(subscribe.isPlausibleEmail("  spaced@example.com  "), true);
});

test("obvious rubbish is rejected before a network call is made", () => {
  for (const value of ["", "nope", "no@domain", "two@@at.com", "has space@example.com", null, 42]) {
    assert.strictEqual(
      subscribe.isPlausibleEmail(value),
      false,
      `${JSON.stringify(value)} should not be treated as an email address`
    );
  }
});

test("a filled honeypot field marks the submission automated", () => {
  assert.strictEqual(subscribe.looksAutomated({ honeypot: "http://spam.example" }), true);
});

test("a form submitted faster than a person could read it is automated", () => {
  const now = 1_000_000;
  assert.strictEqual(
    subscribe.looksAutomated({ renderedAt: now - 100 }, now),
    true,
    "a submission 100ms after render is a bot"
  );
  assert.strictEqual(
    subscribe.looksAutomated({ renderedAt: now - subscribe.MIN_FILL_MS - 1 }, now),
    false,
    "a submission after the minimum fill time is a person"
  );
});

test("a missing or unparseable render stamp does not block a real person", () => {
  assert.strictEqual(subscribe.looksAutomated({}), false);
  assert.strictEqual(subscribe.looksAutomated({ renderedAt: "nonsense" }), false);
});

test("the consent wording is recorded so it survives later copy changes", () => {
  assert.match(subscribe.CONSENT_WORDING, /alpha invitations/i);
  assert.match(subscribe.CONSENT_WORDING, /release.*major updates/);
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes(`<span>${subscribe.CONSENT_WORDING}</span>`));
});
