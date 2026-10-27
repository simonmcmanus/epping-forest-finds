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

  if (isNative && typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => nativeFetch(remoteUrl(input), init);
  }

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
  };
  window.Native = api;
  globalThis.Native = api;
})();
