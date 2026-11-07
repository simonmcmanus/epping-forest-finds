/**
 * Sign-up endpoint (netlify/functions/subscribe.js): what it accepts, what it refuses, and what it sends
 * upstream. The closed alpha gate has its own suite, test/alpha-gate.test.js.
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
  assert.match(subscribe.CONSENT_WORDING, /launch news, opportunities to take part as an early tester/i);
  assert.match(subscribe.CONSENT_WORDING, /weekly Epping Forest Ledger updates when they launch/);
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes(`<p class="signup-intro" id="signupConsent">${subscribe.CONSENT_WORDING}</p>`));
});

test("the endpoint still requires affirmative consent from the signup action", async () => {
  for (const consent of [undefined, false, "true"]) {
    const result = await subscribe.handler({
      httpMethod: "POST",
      body: JSON.stringify({ email: "walker@example.com", consent })
    });
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(JSON.parse(result.body).error, "Please use the ‘Email me updates’ button to sign up.");
  }
});

test("a request body that is JSON but not an object is refused with a 400, not an error", async () => {
  for (const body of ["null", "42", "\"walker@example.com\""]) {
    const result = await subscribe.handler({ httpMethod: "POST", body }, {});
    assert.strictEqual(result.statusCode, 400, `body ${body} should be refused`);
  }
});
