// Native capability layer: the one place the client learns whether it is running inside the
// Capacitor shell (native/, see spec/spec-native.md) and the only file that talks to Capacitor.
// Everything else asks `Native` and gets the web behaviour back unchanged when it is not native.
// Loaded first, before every other js/*.js, so the fetch rewrite below is in place before any
// request goes out.

(function () {
  const PRODUCTION_ORIGIN = "https://www.eppingforestfinds.uk";
  // Relative request paths that live on the Netlify site rather than in the app bundle. On the
  // web they resolve against the page's own origin; inside the shell the page origin is the
  // bundle (capacitor://localhost or https://localhost), so they are sent to the site instead.
  const REMOTE_PATH_PREFIXES = ["/api/", "/.netlify/functions/"];

  const capacitor = window.Capacitor;
  // window.__FORCE_NATIVE_SHIM__ lets Playwright run the native branches in a desktop browser:
  // { platform, plugins: { Geolocation } } stands in for what the shell injects.
  const shim = window.__FORCE_NATIVE_SHIM__ || null;
  const isNative = Boolean(shim)
    || Boolean(capacitor && typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
  const platform = !isNative ? "web" : (shim ? shim.platform || "ios" : capacitor.getPlatform());
  const plugins = (shim && shim.plugins) || (capacitor && capacitor.Plugins) || {};
  const apiBase = isNative ? (window.__FOREST_FINDS_API_BASE__ || PRODUCTION_ORIGIN) : "";

  function remoteUrl(url) {
    if (!apiBase || typeof url !== "string") return url;
    return REMOTE_PATH_PREFIXES.some((prefix) => url.startsWith(prefix)) ? apiBase + url : url;
  }

  // --- Data updates (spec/spec-native.md "Delta updates") ---
  // The binary carries every dataset; the website publishes a manifest of the current ones
  // (data/manifest.json, scripts/lib/data-manifest.js). Changed files are downloaded into app
  // storage and recorded in DATA_INDEX_KEY, and requests for those paths are answered from storage
  // from the next launch on -- never mid-session, which would invalidate the loaded map.
  const DATA_INDEX_KEY = "ff-native-data-v1";
  const DATA_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const bundle = window.__FOREST_FINDS_BUNDLE__ || null;

  function readDataIndex() {
    try {
      const index = JSON.parse(localStorage.getItem(DATA_INDEX_KEY) || "null");
      // Downloaded for an older binary: this one bundles newer data, so those files are dropped.
      if (!index || !bundle || index.bundleGeneratedAt !== bundle.generatedAt) return null;
      return index;
    } catch {
      return null;
    }
  }

  function writeDataIndex(index) {
    try { localStorage.setItem(DATA_INDEX_KEY, JSON.stringify(index)); } catch {}
  }

  // What this launch loads: fixed at startup, so files adopted later in the session wait.
  const launchDataIndex = isNative ? readDataIndex() : null;

  function dataPath(url) {
    if (typeof url !== "string") return null;
    const clean = url.replace(/^\.?\//, "").split(/[?#]/)[0];
    return clean.startsWith("data/") ? clean : null;
  }

  function resolveDataUrl(url) {
    const path = launchDataIndex && dataPath(url);
    const entry = path && launchDataIndex.files[path];
    if (!entry) return url;
    return capacitor && typeof capacitor.convertFileSrc === "function" ? capacitor.convertFileSrc(entry.uri) : entry.uri;
  }

  let rawFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (isNative && rawFetch) {
    const nativeFetch = rawFetch;
    window.fetch = (input, init) => nativeFetch(resolveDataUrl(remoteUrl(input)), init);
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function fetchJson(url) {
    const response = await rawFetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  // Resolves to { status: "updated" | "current" | "skipped" | "unavailable" | "failed", updated, dataVersion }.
  // `force` (Settings' "Check for map updates") ignores the once-a-day limit and Data Saver.
  async function checkForDataUpdates({ force = false } = {}) {
    const Filesystem = plugins.Filesystem;
    if (!isNative || !Filesystem || !bundle || !rawFetch || !(globalThis.crypto && crypto.subtle)) return { status: "unavailable" };
    const index = readDataIndex() || { bundleGeneratedAt: bundle.generatedAt, dataVersion: bundle.dataVersion, files: {} };
    if (!force && index.checkedAt && Date.now() - index.checkedAt < DATA_CHECK_INTERVAL_MS) return { status: "skipped" };
    if (!force && navigator.connection && navigator.connection.saveData) return { status: "skipped" };
    try {
      const [live, bundled] = await Promise.all([
        fetchJson(`${apiBase}/data/manifest.json`),
        fetchJson("data/manifest.json"),
      ]);
      const updated = [];
      let complete = true;
      for (const [path, meta] of Object.entries(live.files || {})) {
        const have = (index.files[path] && index.files[path].sha256) || (bundled.files[path] && bundled.files[path].sha256);
        if (have === meta.sha256) continue;
        try {
          const response = await rawFetch(`${apiBase}/${path}`, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          const bytes = new Uint8Array(await response.arrayBuffer());
          // Never adopted unless it is exactly the file the manifest describes.
          if (await sha256Hex(bytes) !== meta.sha256) throw new Error("checksum mismatch");
          const extension = path.slice(path.lastIndexOf("."));
          const written = await Filesystem.writeFile({
            path: `data-updates/${meta.sha256}${extension}`,
            data: new TextDecoder().decode(bytes),
            directory: "DATA",
            encoding: "utf8",
            recursive: true,
          });
          // One file at a time: an interrupted update leaves a consistent mix of bundled and
          // downloaded files, each of them whole and verified.
          index.files[path] = { sha256: meta.sha256, uri: written.uri };
          writeDataIndex(index);
          updated.push(path);
        } catch {
          complete = false;
        }
      }
      // A download the binary has since caught up with (or the site has dropped) is no longer needed.
      for (const path of Object.keys(index.files)) {
        const meta = live.files[path];
        if (!meta || (bundled.files[path] && bundled.files[path].sha256 === meta.sha256)) delete index.files[path];
      }
      if (complete) index.dataVersion = live.dataVersion;
      index.checkedAt = Date.now();
      writeDataIndex(index);
      return { status: !complete ? "failed" : updated.length ? "updated" : "current", updated, dataVersion: index.dataVersion };
    } catch {
      return { status: "failed", updated: [] };
    }
  }

  const data = isNative ? {
    // The data release this launch is showing.
    activeVersion: (launchDataIndex && launchDataIndex.dataVersion) || (bundle && bundle.dataVersion) || null,
    // When the website was last asked, from any launch (ms since epoch), or null.
    lastChecked() {
      const index = readDataIndex();
      return index && index.checkedAt ? index.checkedAt : null;
    },
    resolve: resolveDataUrl,
    checkForUpdates: checkForDataUpdates,
  } : null;

  // A GeolocationPositionError-shaped object, so callers can keep testing error.code === 1.
  function positionError(code, message) {
    return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
  }

  // The Capacitor Geolocation plugin behind navigator.geolocation's own callback API. Going
  // through the plugin is what keeps location to ONE system prompt on iOS: navigator.geolocation
  // inside WKWebView shows the app's location prompt and then WebKit's own per-origin
  // "localhost would like to use your current location" prompt on top of it, every launch.
  function nativeGeolocation(Geolocation) {
    let nextWatch = 1;
    const watches = new Map();

    async function errorFor(error) {
      try {
        const status = await Geolocation.checkPermissions();
        if (status && status.location === "denied") return positionError(1, "Location permission denied");
      } catch {}
      const message = (error && error.message) || "Location unavailable";
      return positionError(/time(d)?\s*out/i.test(message) ? 3 : 2, message);
    }

    return {
      getCurrentPosition(success, failure, options) {
        Geolocation.getCurrentPosition(options || {})
          .then((position) => success(position))
          .catch(async (error) => { if (failure) failure(await errorFor(error)); });
      },
      watchPosition(success, failure, options) {
        const id = nextWatch++;
        const callbackId = Geolocation.watchPosition(options || {}, async (position, error) => {
          if (!watches.has(id)) return;
          if (position) success(position);
          else if (failure) failure(await errorFor(error));
        });
        watches.set(id, Promise.resolve(callbackId));
        return id;
      },
      clearWatch(id) {
        const pending = watches.get(id);
        watches.delete(id);
        if (pending) pending.then((callbackId) => Geolocation.clearWatch({ id: callbackId })).catch(() => {});
      },
    };
  }

  const nativeLocation = isNative && plugins.Geolocation ? nativeGeolocation(plugins.Geolocation) : null;

  // "granted" | "denied" | "prompt" | "unknown" -- whether a location request right now would
  // answer silently, fail silently, or put a system prompt on screen. "unknown" (no Permissions
  // API, or it threw) is treated by callers as "prompt": never assume a silent answer.
  async function locationPermissionState() {
    try {
      if (isNative && plugins.Geolocation) {
        const status = await plugins.Geolocation.checkPermissions();
        const value = status && status.location;
        if (value === "granted" || value === "denied") return value;
        return value ? "prompt" : "unknown";
      }
      if (!navigator.permissions || typeof navigator.permissions.query !== "function") return "unknown";
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status && ["granted", "denied", "prompt"].includes(status.state) ? status.state : "unknown";
    } catch {
      return "unknown";
    }
  }

  // Inside the shell the motion/orientation decision is the shell's, not the user's: Capacitor's
  // WKWebView delegate grants it without any dialog. WebKit still only accepts
  // DeviceOrientationEvent.requestPermission() from a user gesture, so the grant is collected
  // silently on the first tap of the session and `onGranted` re-attaches the listeners.
  function unlockMotionOnFirstGesture(onGranted) {
    if (!isNative) return;
    const Orientation = window.DeviceOrientationEvent;
    if (!Orientation || typeof Orientation.requestPermission !== "function") return;
    const events = ["touchend", "click"];
    const unlock = () => {
      events.forEach((type) => window.removeEventListener(type, unlock, true));
      Orientation.requestPermission()
        .then((result) => { if (result === "granted" && onGranted) onGranted(); })
        .catch(() => {});
    };
    events.forEach((type) => window.addEventListener(type, unlock, true));
  }

  // --- True-north heading (native/ios/App/App/ForestHeadingPlugin.swift, ForestHeadingPlugin.java) ---
  // Readings are { trueHeading, magneticHeading, accuracy, timestamp }; trueHeading is negative
  // until the plugin knows where it is, and accuracy (degrees) is negative when unreliable.
  function nativeHeading(ForestHeading) {
    let listening = null;
    let lastLocation = null;
    return {
      async start(onReading) {
        if (!listening) listening = Promise.resolve(ForestHeading.addListener("heading", onReading));
        try {
          const result = await ForestHeading.start();
          return Boolean(result && result.started);
        } catch {
          return false;
        }
      },
      stop() {
        Promise.resolve(ForestHeading.stop()).catch(() => {});
      },
      // Declination for true north; only re-sent once the walker has moved far enough for it to
      // change (it varies by well under a degree across the whole forest).
      setLocation(latitude, longitude) {
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        if (lastLocation && Math.abs(lastLocation.latitude - latitude) < 0.1 && Math.abs(lastLocation.longitude - longitude) < 0.1) return;
        lastLocation = { latitude, longitude };
        Promise.resolve(ForestHeading.setLocation({ latitude, longitude })).catch(() => {});
      },
    };
  }

  // Screen kept on only while it is useful (navigating to a find in the foreground), and every
  // repeat of the same request is dropped so callers can say what they want on every fix.
  function keepAwakeControl(KeepAwake) {
    let awake = false;
    return {
      set(wanted) {
        if (!KeepAwake || wanted === awake) return;
        awake = wanted;
        Promise.resolve(wanted ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
      },
      get active() { return awake; },
    };
  }

  function hapticsControl(Haptics) {
    const run = (fn) => { if (Haptics) Promise.resolve().then(fn).catch(() => {}); };
    return {
      // Picking something: the lightest tap there is.
      select() { run(() => Haptics.impact({ style: "LIGHT" })); },
      // Arriving at the find you were walking to.
      arrive() { run(() => Haptics.notification({ type: "SUCCESS" })); },
    };
  }

  // The address to share or open on the website. Inside the shell the page's own location is
  // the bundle (capacitor://localhost/...), which means nothing to anyone else.
  function websiteUrl(path) {
    const local = path || `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return isNative ? new URL(local, PRODUCTION_ORIGIN).href : new URL(local, window.location.href).href;
  }

  // The native share sheet; on the web the browser's own, then the clipboard. Resolves to
  // "shared", "copied" or "failed".
  async function share({ title, text, url }) {
    const target = url || websiteUrl();
    try {
      if (isNative && plugins.Share) {
        await plugins.Share.share({ title, text, url: target, dialogTitle: title });
        return "shared";
      }
      if (navigator.share) {
        await navigator.share({ title, text, url: target });
        return "shared";
      }
    } catch (error) {
      if (error && /cancel|abort/i.test(`${error.name} ${error.message}`)) return "failed";
    }
    try {
      await navigator.clipboard.writeText(target);
      return "copied";
    } catch {
      return "failed";
    }
  }

  // Pages that exist only on the website (the weekly ledger, the contribute page) and links that
  // ask for a new window: inside the shell neither can open in the app's one WebView -- iOS hands
  // a new-window link to the system as a capacitor:// address it cannot open -- so they open on
  // the website in the system browser instead. Everything else stays in the app.
  const WEBSITE_ONLY_PATHS = [/^\/$/, /^\/reports(\/|$)/, /^\/contribute(\/|$)/, /^\/terms\.html$/];
  function routeWebsiteLinks() {
    if (!isNative || typeof document === "undefined") return;
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto|tel):/i.test(href)) return;
      const url = new URL(href, window.location.href);
      const sameApp = url.origin === window.location.origin;
      if (sameApp && link.target !== "_blank" && !WEBSITE_ONLY_PATHS.some((re) => re.test(url.pathname))) return;
      event.preventDefault();
      window.open(sameApp ? websiteUrl(`${url.pathname}${url.search}${url.hash}`) : url.href, "_blank");
    }, true);
  }
  routeWebsiteLinks();

  // { version, build } from the store build, or null on the web.
  async function appInfo() {
    if (!isNative || !plugins.App) return null;
    try {
      const info = await plugins.App.getInfo();
      return info ? { version: info.version, build: info.build } : null;
    } catch {
      return null;
    }
  }

  const api = {
    isNative,
    platform,
    apiBase,
    remoteUrl,
    // Read live rather than captured once, so a page (or a test) that replaces
    // navigator.geolocation after this file ran is still the one used on the web.
    get geolocation() {
      return nativeLocation || navigator.geolocation || null;
    },
    locationPermissionState,
    // False inside the shell: there is no in-app or system compass ask to make there.
    compassNeedsPrompt: !isNative,
    unlockMotionOnFirstGesture,
    // null on the web, where the browser's own deviceorientation events are the only source.
    heading: isNative && plugins.ForestHeading ? nativeHeading(plugins.ForestHeading) : null,
    keepAwake: keepAwakeControl(isNative ? plugins.KeepAwake : null),
    haptics: hapticsControl(isNative ? plugins.Haptics : null),
    share,
    websiteUrl,
    appInfo,
    // null on the web, where the service worker keeps data fresh instead.
    data,
  };
  window.Native = api;
  globalThis.Native = api;
})();
