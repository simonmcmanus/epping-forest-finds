/**
 * Admin password checks shared by every admin endpoint (netlify/functions/lib/admin-auth.js). The password
 * is accepted only as an Authorization: Bearer header, compared without revealing how much of it matched.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isAdminRequest, signSessionToken } = require("../netlify/functions/lib/admin-auth.js");

test("the admin password works as a Bearer header, whatever the header's capitalisation", () => {
  assert.equal(isAdminRequest({ headers: { authorization: "Bearer s3cret-pass" } }, "s3cret-pass"), true);
  assert.equal(isAdminRequest({ headers: { Authorization: "Bearer s3cret-pass" } }, "s3cret-pass"), true);
});

test("a wrong, partial, longer or differently formed password is refused", () => {
  for (const header of ["Bearer s3cret", "Bearer s3cret-pass-extra", "Bearer S3CRET-PASS", "s3cret-pass", "Basic s3cret-pass", ""]) {
    assert.equal(isAdminRequest({ headers: { authorization: header } }, "s3cret-pass"), false, `"${header}" should be refused`);
  }
});

test("with no password configured, nobody is an admin, even with an empty header", () => {
  assert.equal(isAdminRequest({ headers: { authorization: "Bearer " } }, ""), false);
  assert.equal(isAdminRequest({ headers: {} }, undefined), false);
});

test("a request with no headers at all is refused, not an exception", () => {
  assert.equal(isAdminRequest({}, "s3cret-pass"), false);
});

const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });

test("a valid session token is accepted, and so is the password", () => {
  const { token } = signSessionToken("s3cret-pass");
  assert.equal(isAdminRequest(bearer(token), "s3cret-pass"), true);
  assert.equal(isAdminRequest(bearer("s3cret-pass"), "s3cret-pass"), true);
});

test("an expired session token is refused", () => {
  const { token } = signSessionToken("s3cret-pass", Date.now() - 9 * 3600000);
  assert.equal(isAdminRequest(bearer(token), "s3cret-pass"), false);
});

test("a tampered session token is refused", () => {
  const { token } = signSessionToken("s3cret-pass");
  const [expires, mac] = token.split(".");
  assert.equal(isAdminRequest(bearer(`${Number(expires) + 3600000}.${mac}`), "s3cret-pass"), false);
  const flipped = mac.slice(0, -1) + (mac.endsWith("0") ? "1" : "0");
  assert.equal(isAdminRequest(bearer(`${expires}.${flipped}`), "s3cret-pass"), false);
});

test("a session token signed under a different password is refused", () => {
  const { token } = signSessionToken("other-password");
  assert.equal(isAdminRequest(bearer(token), "s3cret-pass"), false);
});

test("a malformed session token is refused", () => {
  for (const value of ["abc", "123.", ".abc", "notanumber.abcdef", "1.2.3", "9999999999999.zz"]) {
    assert.equal(isAdminRequest(bearer(value), "s3cret-pass"), false, value);
  }
});

test("a password in the query string is still refused", () => {
  assert.equal(isAdminRequest({ headers: {}, queryStringParameters: { pw: "s3cret-pass" } }, "s3cret-pass"), false);
  const { token } = signSessionToken("s3cret-pass");
  assert.equal(isAdminRequest({ headers: {}, queryStringParameters: { pw: token } }, "s3cret-pass"), false);
});
