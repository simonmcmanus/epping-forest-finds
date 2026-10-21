// Offline outbox: reports and feedback that could not be sent are kept in IndexedDB (photos make
// them too big for localStorage) and re-sent when the connection returns. Each item carries a
// client-generated id the server already uses to de-duplicate, so a retry can never double-post.
// Fires "outbox:change" ({pending}) and "outbox:sent" ({item, response}) on window.
const OUTBOX_DB = "ff-outbox";
const OUTBOX_STORE = "items";
const OUTBOX_MAX_ITEMS = 50;
const OUTBOX_BACKOFF_MS = [5000, 30000, 120000, 600000];

const outboxMemory = []; // fallback when IndexedDB is unavailable (private window etc.)
// Items held only in outboxMemory are mirrored to localStorage (small payloads only: a photo does not fit)
// so a reload or an app kill does not lose them. When even that fails, outboxIsDurable() says so and the
// screens must not promise delivery after the app is closed.
const OUTBOX_FALLBACK_KEY = "ff-outbox-fallback-v1";
const OUTBOX_FALLBACK_MAX_CHARS = 400 * 1024;
let outboxDurable = true;
let outboxDbPromise = null;
let outboxFlushing = false;
let outboxFlushAgain = false; // something was added (or a flush asked for) while one was already running
let outboxRetryTimer = null;
let outboxFailures = 0;

function outboxFallbackSave() {
  try {
    if (!outboxMemory.length) { localStorage.removeItem(OUTBOX_FALLBACK_KEY); return true; }
    const text = JSON.stringify(outboxMemory);
    if (text.length > OUTBOX_FALLBACK_MAX_CHARS) return false;
    localStorage.setItem(OUTBOX_FALLBACK_KEY, text);
    return true;
  } catch { return false; }
}

function outboxFallbackRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(OUTBOX_FALLBACK_KEY));
    if (!Array.isArray(saved)) return;
    for (const item of saved) {
      if (item && item.id && item.url && !outboxMemory.some((m) => m.id === item.id)) outboxMemory.push(item);
    }
  } catch {}
}

// False when something queued would be lost if the app were closed now.
function outboxIsDurable() { return outboxDurable; }

function outboxOpen() {
  if (outboxDbPromise) return outboxDbPromise;
  outboxDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(OUTBOX_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return outboxDbPromise;
}

async function outboxTx(mode, run) {
  const db = await outboxOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(OUTBOX_STORE, mode);
      const result = run(tx.objectStore(OUTBOX_STORE));
      tx.oncomplete = () => resolve(result.result !== undefined ? result.result : true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function outboxList() {
  const stored = await outboxTx("readonly", (store) => store.getAll());
  return (Array.isArray(stored) ? stored : []).concat(outboxMemory).sort((a, b) => a.createdAt - b.createdAt);
}

async function outboxNotify() {
  const pending = (await outboxList()).length;
  window.dispatchEvent(new CustomEvent("outbox:change", { detail: { pending } }));
}

// item: { id, url, payload }. Re-adding an id replaces it (a retried form stays one entry).
async function outboxAdd(item) {
  const entry = { id: item.id, url: item.url, payload: item.payload, createdAt: Date.now() };
  const ok = await outboxTx("readwrite", (store) => store.put(entry));
  if (!ok) {
    const at = outboxMemory.findIndex((m) => m.id === entry.id);
    if (at >= 0) outboxMemory.splice(at, 1);
    outboxMemory.push(entry);
    if (outboxMemory.length > OUTBOX_MAX_ITEMS) outboxMemory.shift();
    outboxDurable = outboxFallbackSave();
  }
  await outboxNotify();
  return entry;
}

async function outboxRemove(id) {
  await outboxTx("readwrite", (store) => store.delete(id));
  const at = outboxMemory.findIndex((m) => m.id === id);
  if (at >= 0) {
    outboxMemory.splice(at, 1);
    outboxDurable = outboxFallbackSave();
  }
}

function outboxScheduleRetry() {
  if (outboxRetryTimer) return;
  const delay = OUTBOX_BACKOFF_MS[Math.min(outboxFailures, OUTBOX_BACKOFF_MS.length) - 1] || OUTBOX_BACKOFF_MS[0];
  outboxRetryTimer = setTimeout(() => { outboxRetryTimer = null; outboxFlush(); }, delay);
}

async function outboxFlush() {
  if (!navigator.onLine) return;
  if (outboxFlushing) { outboxFlushAgain = true; return; } // run again once this pass is done, so a late add is never stranded
  outboxFlushing = true;
  try {
    for (const item of await outboxList()) {
      let response;
      try {
        response = await fetch(item.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });
      } catch {
        outboxFailures += 1;
        outboxScheduleRetry();
        break;
      }
      // 5xx / 408 / 429 are worth retrying; any other 4xx will never succeed, so drop it.
      if (!response.ok && (response.status >= 500 || response.status === 408 || response.status === 429)) {
        outboxFailures += 1;
        outboxScheduleRetry();
        break;
      }
      outboxFailures = 0;
      await outboxRemove(item.id);
      const body = await response.json().catch(() => ({}));
      window.dispatchEvent(new CustomEvent("outbox:sent", { detail: { item, ok: response.ok, response: body } }));
    }
  } finally {
    outboxFlushing = false;
    await outboxNotify();
  }
  if (outboxFlushAgain) { outboxFlushAgain = false; await outboxFlush(); }
}

if (typeof window !== "undefined" && window.addEventListener) {
  outboxFallbackRestore();
  window.addEventListener("online", outboxFlush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") outboxFlush(); });
  outboxFlush();
}
