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

// The API key and list id are read when the module loads, so each suite that needs them loads a fresh copy.
function loadSubscribeWithUpstream() {
  const saved = { key: process.env.EMAILOCTOPUS_API_KEY, list: process.env.EMAILOCTOPUS_LIST_ID };
  process.env.EMAILOCTOPUS_API_KEY = "test-key";
  process.env.EMAILOCTOPUS_LIST_ID = "list-123";
  delete require.cache[require.resolve("../netlify/functions/subscribe.js")];
  try {
    return require("../netlify/functions/subscribe.js");
  } finally {
    if (saved.key === undefined) delete process.env.EMAILOCTOPUS_API_KEY; else process.env.EMAILOCTOPUS_API_KEY = saved.key;
    if (saved.list === undefined) delete process.env.EMAILOCTOPUS_LIST_ID; else process.env.EMAILOCTOPUS_LIST_ID = saved.list;
  }
}

async function withEmailOctopus(status, run) {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ error: "refused" }), { status, headers: { "content-type": "application/json" } });
  };
  console.error = () => {};
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
  }
}

const signUp = (sub, email) => sub.handler({ httpMethod: "POST", body: JSON.stringify({ email, consent: true }) }, {});

test("Sign-up sends the address to the configured EmailOctopus list as a pending contact", async () => {
  const sub = loadSubscribeWithUpstream();
  await withEmailOctopus(200, async (calls) => {
    const result = await signUp(sub, "walker@example.com");
    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.emailoctopus.com/lists/list-123/contacts");
    assert.equal(calls[0].body.email_address, "walker@example.com");
    assert.equal(calls[0].body.status, "pending");
  });
});

test("Sign-up tells the visitor to check an address the sign-up service rejects", async () => {
  const sub = loadSubscribeWithUpstream();
  for (const status of [400, 422]) {
    await withEmailOctopus(status, async () => {
      // Passes the deliberately loose local check, but EmailOctopus refuses it.
      const result = await signUp(sub, "name@domain.c");
      assert.equal(result.statusCode, 400, `EmailOctopus ${status} is the visitor's address to fix`);
      assert.deepEqual(JSON.parse(result.body), { error: "We could not add that address. Please check it and try again." });
    });
  }
});

test("Sign-up stays 'temporarily unavailable', not blamed on the address, when the service itself is at fault", async () => {
  const sub = loadSubscribeWithUpstream();
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await withEmailOctopus(status, async () => {
      const result = await signUp(sub, "walker@example.com");
      assert.equal(result.statusCode, 502, `EmailOctopus ${status} is not the visitor's fault`);
      assert.deepEqual(JSON.parse(result.body), { error: "Sign-up is temporarily unavailable. Please try again later." });
    });
  }
});

test("Sign-up still reports an address already on the list as signed up", async () => {
  const sub = loadSubscribeWithUpstream();
  await withEmailOctopus(409, async () => {
    const result = await signUp(sub, "walker@example.com");
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });
  });
});
