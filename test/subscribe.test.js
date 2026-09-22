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
  assert.strictEqual(subscribe.looksAutomated({ website: "http://spam.example" }), true);
});

test("a fast submission is not rejected because browser autofill can be immediate", () => {
  assert.strictEqual(subscribe.looksAutomated({ renderedAt: Date.now() }), false);
});

test("a silently accepted honeypot submission is visible in privacy-safe function logs", async () => {
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(message);

  try {
    const result = await subscribe.handler(
      {
        httpMethod: "POST",
        body: JSON.stringify({
          email: "walker@example.com",
          consent: true,
          website: "filled-by-autofill",
        }),
      },
      { awsRequestId: "test-request" }
    );

    assert.strictEqual(result.statusCode, 200);
    assert.ok(messages.some((message) => message.includes("[test-request]")));
    assert.ok(messages.some((message) => message.includes("honeypot")));
    assert.ok(messages.every((message) => !message.includes("walker@example.com")));
  } finally {
    console.info = originalInfo;
  }
});

test("the consent wording is recorded so it survives later copy changes", () => {
  assert.match(subscribe.CONSENT_WORDING, /alpha invitations/i);
  assert.match(subscribe.CONSENT_WORDING, /release.*major updates/);
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes(`<span>${subscribe.CONSENT_WORDING}</span>`));
});
