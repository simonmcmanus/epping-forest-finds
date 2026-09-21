# Closed Alpha Access Specification

Owns who may reach the map application during the closed alpha: the URL split
between the marketing homepage and the app, the shared secret that opens the
app, the edge function that enforces it, and the service-worker changes the
split requires.

It does **not** own the homepage's content or copy — that is
[spec-marketing.md](spec-marketing.md). This spec only supplies the state
(`closed` or `open`) that the homepage's call to action reads.

## 1. Threat model

The alpha is **closed, not secret**. The homepage says plainly what the app is,
the repository is public, and the weekly ledger keeps publishing. The gate has
one job: keep casual visitors, crawlers and search results out of an unfinished
app.

It is explicitly **not** designed to withstand someone determined. A single
shared secret is used by everyone, and it is expected — welcomed — that alpha
users pass the link on. That decision makes per-person tokens, revocation lists
and an invite-to-signup mapping unnecessary, and none of them are built.

Two consequences follow from that and are accepted rather than mitigated:

- **Rotating the secret does not evict anyone.** A user who has already loaded
  the app keeps a working offline copy in the service worker cache regardless
  of the gate. Rotation closes the door to new arrivals; it does not remove
  people already inside.
- **The secret travels in a query string**, so it reaches referrer headers,
  browser history and server logs. That is harmless for a value intended to
  spread, but it means the secret must never be treated as confidential or
  reused for anything else.

What the gate **does** guarantee is that the check happens on the server. A
client-side check would still serve the app's HTML to everyone, including
crawlers, and the app would be indexed and appear in search results. The
restriction has to be real even though the secret is shared.

## 2. URL layout

| Path | Serves | Gated |
| --- | --- | --- |
| `/` | Marketing homepage (`index.html`) | No |
| `/app` | The map application (`app.html`) | Yes |
| `/app.html` | Same, the underlying file | Yes |
| `/reports/`, `/terms.html`, `/admin` | Unchanged | No |
| `/js/*`, `/css/*`, `/data/*`, `/sw.js`, `/manifest.webmanifest` | Unchanged | No |

### 2.1 Why assets stay ungated

Only the app's HTML entry point is gated. The loose assets stay public for
three reasons:

1. The data is public OpenStreetMap and a public veteran tree register. Gating
   it protects nothing.
2. A gated asset response would be cached by the service worker in place of the
   real file, poisoning the offline caches it exists to fill.
3. Crawlers and link unfurlers need `robots.txt`, `sitemap.xml`, the social
   image and the homepage's CSS without a cookie. Gating those breaks every
   share preview.

The trade is that someone could assemble a working map from the loose assets.
At this stage that is not worth breaking offline caching over.

### 2.2 Why the app is a file, not a directory

`app.html` stays at the repository root. It is **not** moved to `/app/index.html`.

`js/nav.js` registers the service worker with a relative path
(`navigator.serviceWorker.register("sw.js")`), so the worker's scope is the
directory it is served from. At the root that scope is `/`, which is what lets
it cache `/js/*`, `/css/*` and `/data/*`. Moving the app into an `/app/`
directory would collapse that scope to `/app/` and the app would stop working
offline entirely — which is the product.

`/app` is therefore a URL, produced by a rewrite, not a folder.
The root-scoped service worker must bypass all `/assets/home/` requests before
its cache handling, so returning app users receive independently deployed
marketing assets without an app release.

`manifest.webmanifest`'s `start_url` moves to `/app` so an installed app opens
the map rather than the marketing homepage. `scope` stays at the root, which is
what keeps the installed app able to reach `/js`, `/css` and `/data`.

## 3. The gate

`netlify/edge-functions/alpha-gate.js`, configured for `/app` and `/app.html`.

### 3.1 Secrets

`ALPHA_SECRETS` — a comma-separated list of currently valid secrets, set as a
Netlify environment variable and documented in `.env.example`.

- Adding a value opens a new phase.
- Removing a value closes that phase to new arrivals.
- **An empty or unset `ALPHA_SECRETS` disables the gate entirely** and the app
  is public. That is how the alpha ends: clear the variable. No deploy, no code
  change, no URL change.

Secrets should be memorable rather than random — they are mailed out, read
aloud and retyped — but they **must not be a word that appears anywhere in the
site's own content**.

`netlify.toml` sets `publish = "."`, so the whole repository is the published
output, and Netlify's secrets scanning fails the build whenever an environment
variable's value is found in it. An on-brand secret is therefore exactly the
wrong instinct: "longhorn" is a pillar heading and an `og:description` on the
homepage, so setting it as the secret breaks every deploy. The first attempt at
this shipped `ALPHA_SECRETS=longhorn` in `.env.example` and did precisely that.

A short phrase with no relation to the marketing copy satisfies both: readable
over the phone, and absent from the published files. The same rule applies in
reverse — once a secret is live, it must not become site copy.

### 3.2 Behaviour

On a request to `/app` or `/app.html`:

1. No secrets configured → pass through. The app is open.
2. `?k=<value>` matches a configured secret → set the access cookie and
   redirect (302) to the same path **with `k` stripped**, so the secret does
   not sit in the address bar or get bookmarked.
3. Access cookie matches a configured secret → pass through.
4. Otherwise → redirect (302) to `/`.

A redirect, not a rewrite: the homepage and the app are separate URLs now, so
sending an uninvited visitor to `/` is honest about where they have landed and
keeps the two pages' caches distinct.

### 3.3 The cookie

`ef_alpha`, holding the secret that was presented.

`Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, and `Secure` except on
`localhost`. `HttpOnly` is deliberate: no client script needs to read it, and
it keeps the value out of `js/tracker.js`'s reach.

Because the cookie stores the secret itself rather than a derived token,
removing a secret from `ALPHA_SECRETS` invalidates every cookie issued for it
with no extra bookkeeping.

### 3.4 Local development

`server.js` does not run Netlify edge functions, so **the gate does not exist
in local dev** — `/app` is always served. This is deliberate: it keeps the e2e
suite and `npm run dev` simple, and the gate is a deployment concern.

The consequence is that the gate cannot be verified by a local run. Exercise it
with `npm run netlify:dev` or on a deploy preview.

## 4. Service worker changes

The URL split breaks two assumptions in `sw.js` that must be fixed in the same
change.

### 4.1 The navigation handler

`sw.js` answered **every** navigation request with the cached
`./index.html` — the app. Left alone, any returning visitor navigating to `/`
would be served the app instead of the new homepage, and the homepage would be
invisible to exactly the people most likely to look.

The handler is now scoped to the app's own routes (`/app`, `/app.html`).
Navigations to anything else — the homepage, the reports, the terms — fall
through to the network and are not served from the app cache.

### 4.2 The app shell

`APP_SHELL` precached `"./"`, which after the split resolves to the marketing
homepage. It would have been stored under the app's cache key and served in the
app's place.

`"./"` is removed from `APP_SHELL` and `"./app.html"` added. The homepage is
deliberately **not** precached: it is a network page, it changes independently
of app releases, and it must never be able to satisfy an app navigation.

### 4.3 Cache versions

`APP_CACHE_NAME` must move when this lands, because every returning user needs
the new worker for the navigation fix. That happens through the existing
`.github/workflows/sw-release.yml` on merge to `main`. **That workflow's path
filter changes with this**: it watched `index.html`, which is now the marketing
homepage and not part of the app shell at all, so it watches `app.html`
instead. Left unchanged, a change to the app would not have bumped the cache
and returning users would have kept the old worker. Per [agents.md](agents.md),
cache versions are never bumped by hand or on a branch.

## 5. Routing

`netlify.toml`:

- An edge function declaration binding `alpha-gate` to `/app` and `/app.html`.
- A 200 rewrite from `/app` to `/app.html`, so the pretty URL serves the file.

`server.js` mirrors the rewrite for local dev with a `/app` route serving
`app.html`, following the existing `/admin` precedent. It does **not** mirror
the gate (§3.4).

## 6. Search

`scripts/generate-sitemap.js`:

- `/` stays at priority 1.0 and is now the marketing homepage.
- `/app` is **not** listed in `sitemap.xml` and **is** added to
  `DISALLOWED_PATHS` in `robots.txt`. A gated path that answers crawlers with a
  redirect to the homepage is a soft-404 signal with nothing to gain.

When the alpha ends, `/app` can be removed from `DISALLOWED_PATHS` — but there
is little reason to: the homepage is the page that should rank, and the app has
no indexable content.

## 7. Testing

- **Unit** — the sign-up endpoint's validation and bot checks
  (`test/subscribe.test.js`). The gate's own helpers are **not** unit-tested:
  the edge function is an ES module running on Netlify's Deno runtime, and this
  project's Node test runner loads `.js` as CommonJS, so it cannot import them.
  Extracting them to a shared module would mean duplicating it for Deno, which
  is worse than the gap.
- **E2E** — the suite runs against `server.js`, where the gate is absent, so
  specs navigate to `/app` directly. `test/e2e/helpers.js` defaults to `/app`
  and every spec that navigated to `/` now navigates to `/app`.
- **Sitemap** — `test/sitemap.test.js` asserts `/app` is absent from the
  sitemap and present in the robots disallow list.

Gate behaviour is therefore not covered by either suite: the e2e suite cannot
see it (§3.4) and the unit suite cannot import it. **It is verified by hand on
a deploy preview**, checking all four branches in §3.2 — no secret configured,
a valid `?k=`, a returning cookie, and an uninvited visitor.
