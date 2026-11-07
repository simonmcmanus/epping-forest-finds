/**
 * Admin password checks shared by every admin endpoint (netlify/functions/lib/admin-auth.js). The password
 * is accepted only as an Authorization: Bearer header, compared without revealing how much of it matched.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isAdminRequest } = require("../netlify/functions/lib/admin-auth.js");

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
