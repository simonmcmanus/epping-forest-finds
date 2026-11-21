// Epping Forest Finds — Beta welcome: the full-screen welcome beta testers see over the map at /beta. The Tester ID
// lookup it shares with Settings lives in js/settings.js. See spec/spec-community.md "Beta welcome sheet".
//
// A classic script loaded before js/app.js (see app.html). It never gates the app: the sheet is shown
// after the map has booted, covers the whole screen, and can only be left by finishing the last step. Only the /beta scheduler at the bottom runs at load.

const WELCOME_PATH = "/beta";
const WELCOME_KEY = "ff-welcome-v1";
const WELCOME_STEPS = 3;
const WELCOME_MAILTO = "mcmanus.simon@gmail.com";
const WELCOME_SUBJECT = "Epping Forest Finds beta: my Tester ID";

let welcomeShownThisSession = false;
let welcomeRoot = null;
let welcomeStep = 1;
let welcomeOpener = null;

function welcomeMarkSeen() {
  try { localStorage.setItem(WELCOME_KEY, "1"); } catch {}
}

function welcomeCommunityStatusText() {
  if (!communityFeaturesKnown()) return "Checking whether Community is on for you…";
  return communityEnabled()
    ? "You're on the list. Community is on for you."
    : "Send this to Simon to turn on Community for you.";
}

function welcomeShareText(id) {
  return `Hi Simon, please add my Tester ID to the Epping Forest Finds beta: ${id}`;
}

function welcomeSend() {
  const id = testerIdState.id;
  if (!id) return;
  const text = welcomeShareText(id);
  if (typeof navigator.share === "function") {
    navigator.share({ title: WELCOME_SUBJECT, text }).catch(() => {});
    return;
  }
  const link = document.createElement("a");
  link.href = `mailto:${WELCOME_MAILTO}?subject=${encodeURIComponent(WELCOME_SUBJECT)}&body=${encodeURIComponent(text)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const WELCOME_CSS = `
#betaWelcome { position: fixed; inset: 0; z-index: 130; box-sizing: border-box; background: var(--surface); color: var(--ink); }
#betaWelcome .welcome-sheet { box-sizing: border-box; width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: calc(16px + var(--safe-top, 0px)) 16px calc(16px + var(--safe-bottom, 0px)); }
#betaWelcome .welcome-body { box-sizing: border-box; width: 100%; max-width: 440px; margin: 0 auto; display: grid; gap: 12px; }
#betaWelcome h2 { margin: 0; font-size: 1.3rem; outline: none; }
#betaWelcome p { margin: 0; overflow-wrap: anywhere; }
#betaWelcome ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 0.9rem; }
#betaWelcome .welcome-id { font: 700 1.4rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.04em; overflow-wrap: anywhere; }
#betaWelcome .welcome-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#betaWelcome .welcome-actions .button, #betaWelcome .welcome-actions .settings-btn, #betaWelcome .welcome-id-row .settings-btn { min-height: 44px; min-width: 44px; }
#betaWelcome .welcome-actions .button { flex: 1 1 auto; }
#betaWelcome .welcome-id-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
`;

function welcomeStepHtml() {
  const counter = `<p class="report-note">Step ${welcomeStep} of ${WELCOME_STEPS}</p>`;
  if (welcomeStep === 1) {
    return `${counter}<h2 id="welcomeHeading" tabindex="-1">Thanks for testing Epping Forest Finds</h2>
      <p class="settings-description">The beta is the map of trees and places, and it works offline. Community is where testers check trees and send feedback.</p>
      <div class="welcome-actions"><button type="button" class="button" data-welcome="next">Next</button></div>`;
  }
  if (welcomeStep === 2) {
    const state = testerIdState.status;
    const idHtml = state === "ready"
      ? `<div class="welcome-id-row"><code id="welcomeTesterId" class="welcome-id">${escapeHtml(testerIdState.id)}</code><button type="button" class="settings-btn" data-welcome="copy">Copy</button></div>`
      : "";
    const status = state === "loading" ? "Getting your Tester ID…"
      : state === "failed" ? "We couldn't get your Tester ID. Try again"
      : welcomeCommunityStatusText();
    const retry = state === "failed" ? `<button type="button" class="settings-btn" data-welcome="retry">Retry</button>` : "";
    const send = state === "ready" ? `<button type="button" class="button" data-welcome="send">Send to Simon</button>` : "";
    return `${counter}<h2 id="welcomeHeading" tabindex="-1">Your Tester ID</h2>
      ${idHtml}
      <p id="welcomeTesterStatus" class="settings-description" role="status" aria-live="polite">${status}</p>${retry}
      <p class="report-note">Keep this ID. It is tied to this phone or browser, so a new phone gets a new one.</p>
      <div class="welcome-actions">${send}<button type="button" class="settings-btn" data-welcome="back">Back</button><button type="button" class="settings-btn" data-welcome="next">Next</button></div>`;
  }
  return `${counter}<h2 id="welcomeHeading" tabindex="-1">What feedback helps</h2>
    <ul class="settings-description">
      <li>Wrong tree details: open a tree and tap "Help check".</li>
      <li>A tree that is missing: "Add a missing tree" on the Community screen.</li>
      <li>A closed, moved or renamed place: "Flag a place".</li>
      <li>Anything broken, slow or confusing: "Send feedback" on the Community screen.</li>
    </ul>
    <div class="welcome-actions"><button type="button" class="button" data-welcome="finish">Start exploring</button><button type="button" class="settings-btn" data-welcome="back">Back</button></div>`;
}

function welcomeRender() {
  if (!welcomeRoot) return;
  const sheet = welcomeRoot.querySelector(".welcome-sheet");
  sheet.innerHTML = `<div class="welcome-body">${welcomeStepHtml()}</div>`;
  sheet.setAttribute("aria-labelledby", "welcomeHeading");
  const heading = document.getElementById("welcomeHeading");
  if (heading) heading.focus({ preventScroll: true });
  if (welcomeStep === 2 && testerIdState.status === "loading") welcomeAwaitTesterId();
  if (welcomeStep === 2 && !communityFeaturesKnown()) welcomeAwaitFeatures();
}

// Re-draws only the live parts of step 2 so a late answer never steals focus from a button.
function welcomeRefreshStep2() {
  if (!welcomeRoot || welcomeStep !== 2) return;
  const active = document.activeElement;
  const focusedAction = active && welcomeRoot.contains(active) ? active.getAttribute("data-welcome") : null;
  const sheet = welcomeRoot.querySelector(".welcome-sheet");
  sheet.innerHTML = `<div class="welcome-body">${welcomeStepHtml()}</div>`;
  sheet.setAttribute("aria-labelledby", "welcomeHeading");
  const target = (focusedAction && sheet.querySelector(`[data-welcome="${focusedAction}"]`)) || document.getElementById("welcomeHeading");
  if (target) target.focus({ preventScroll: true });
}

function welcomeAwaitTesterId() {
  loadTesterId().then(() => welcomeRefreshStep2());
}

function welcomeAwaitFeatures() {
  if (typeof communityRefreshFeatures !== "function") return;
  Promise.resolve(communityRefreshFeatures()).then(() => welcomeRefreshStep2(), () => {});
}

function welcomeFocusable() {
  return [...welcomeRoot.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1']), a[href]")];
}

function welcomeKeydown(event) {
  if (!welcomeRoot) return;
  if (event.key !== "Tab") return;
  const items = welcomeFocusable();
  const heading = document.getElementById("welcomeHeading");
  const ring = heading ? [heading, ...items] : items;
  if (!ring.length) return;
  const index = ring.indexOf(document.activeElement);
  const next = index === -1 ? 0 : (index + (event.shiftKey ? -1 : 1) + ring.length) % ring.length;
  event.preventDefault();
  ring[next].focus();
}

async function welcomeClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-welcome]") : null;
  if (!button) return;
  const action = button.getAttribute("data-welcome");
  if (action === "next" && welcomeStep < WELCOME_STEPS) { welcomeStep += 1; welcomeRender(); }
  else if (action === "back" && welcomeStep > 1) { welcomeStep -= 1; welcomeRender(); }
  else if (action === "finish") closeWelcome();
  else if (action === "send") welcomeSend();
  else if (action === "retry") {
    testerIdState.status = "loading";
    welcomeRefreshStep2();
    welcomeAwaitTesterId();
  } else if (action === "copy") {
    try { await navigator.clipboard.writeText(testerIdState.id); button.textContent = "Copied"; }
    catch { button.textContent = "Select and copy it"; }
  }
}

function openWelcome(opener = null) {
  if (welcomeRoot) return;
  welcomeShownThisSession = true;
  welcomeStep = 1;
  welcomeOpener = opener;
  if (!document.getElementById("betaWelcomeStyle")) {
    const style = document.createElement("style");
    style.id = "betaWelcomeStyle";
    style.textContent = WELCOME_CSS;
    document.head.appendChild(style);
  }
  welcomeRoot = document.createElement("div");
  welcomeRoot.id = "betaWelcome";
  welcomeRoot.innerHTML = `<div class="welcome-sheet" role="dialog" aria-modal="true"></div>`;
  welcomeRoot.addEventListener("click", welcomeClick);
  document.body.appendChild(welcomeRoot);
  document.addEventListener("keydown", welcomeKeydown, true);
  loadTesterId();
  welcomeRender();
}

function closeWelcome() {
  if (!welcomeRoot) return;
  welcomeMarkSeen();
  document.removeEventListener("keydown", welcomeKeydown, true);
  welcomeRoot.remove();
  welcomeRoot = null;
  const opener = welcomeOpener;
  welcomeOpener = null;
  if (opener && opener.isConnected) { opener.focus(); return; }
  const map = document.getElementById("mapCanvas");
  if (map) {
    if (!map.hasAttribute("tabindex")) map.setAttribute("tabindex", "-1");
    map.focus({ preventScroll: true });
  }
}

// On /beta only, every visit: once the map has booted. Polls cheaply for up to a minute, then gives up (the next open tries again).
// Other first-run prompts go first so two never stack: the consent / map-setup card (#consentBanner) and
// the guided setup dialog (#onboardingOverlay). While either is up we keep waiting (that wait does not use
// up the minute), and the welcome opens only after both have been gone for a short quiet moment, so it never
// lands between the reader answering one and the next appearing.
const WELCOME_QUIET_MS = 1000;

function welcomeFirstRunPromptUp() {
  return ["consentBanner", "onboardingOverlay"].some((id) => {
    const el = document.getElementById(id);
    return Boolean(el && !el.hidden);
  });
}

function welcomeScheduleFirstRun() {
  if (window.location.pathname !== WELCOME_PATH) return;
  const started = Date.now();
  let sawPrompt = false;
  let quietSince = 0;
  const check = () => {
    let ready = false;
    try { ready = state.dataLoaded === true && routerBooting === false; } catch {}
    if (ready) {
      if (welcomeFirstRunPromptUp()) { sawPrompt = true; quietSince = 0; setTimeout(check, 250); return; }
      if (sawPrompt) {
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince < WELCOME_QUIET_MS) { setTimeout(check, 250); return; }
      }
      if (!welcomeRoot) openWelcome();
      return;
    }
    if (Date.now() - started < 60000) setTimeout(check, 250);
  };
  setTimeout(check, 250);
}

welcomeScheduleFirstRun();
