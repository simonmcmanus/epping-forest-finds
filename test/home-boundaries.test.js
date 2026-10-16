"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");

test("returning app users fetch marketing assets without consulting app caches", () => {
  const handlers = {};
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://example.test" },
      addEventListener: (name, handler) => { handlers[name] = handler; },
    },
    caches: new Proxy({}, { get() { throw new Error("Marketing must not access caches"); } }),
  });
  context.importScripts = (...scripts) => {
    for (const script of scripts) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, script.replace(/^\.\//, "")), "utf8"), context);
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), context);
  for (const filename of fs.readdirSync(path.join(ROOT, "assets/home"))) {
    handlers.fetch({
      request: { url: `https://example.test/assets/home/${filename}?v=next`, method: "GET", mode: "cors" },
      respondWith() { assert.fail("Marketing requests must remain browser-managed"); },
    });
  }
  assert.equal(vm.runInContext('APP_SHELL.some(url => url.includes("assets/home/"))', context), false);
});

test("the app entry point does not depend on marketing assets", () => {
  const html = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
  assert.doesNotMatch(html, /(?:src|href)=["'][^"']*assets\/home\//);
});

test("the homepage keeps a no-script Ledger route while its latest preview stays marketing-owned", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "assets", "home", "home.js"), "utf8");
  assert.match(html, /id="latestLedgerLink" href="\/reports\/"/);
  assert.match(html, /class="ledger-archive-link" href="\/reports\/"/);
  assert.match(script, /fetch\("\/reports\/"\)/);
  assert.match(script, /fetch\(editionUrl\)/);
  assert.doesNotMatch(script, /\/(?:js|css|data)\//);
});
