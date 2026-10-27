// Reading the whole report ledger (spec-community.md, "Scaling").
//
// Each report is its own blob, `reports/<id>`, written once by community-report.js and only ever
// removed (data deletion). Fetching every one of them on every hourly rebuild grew with the ledger,
// so their bodies are also kept in a handful of large cache blobs (`ledger-cache/<n>`, CHUNK_SIZE
// reports each) and a rebuild fetches only the reports the cache has not seen yet. The listing of
// `reports/` stays the source of truth: a cached report whose key has gone is dropped, a cache chunk
// that cannot be read is simply refilled from the ledger.
const { mapLimit } = require("./map-limit");

const CACHE_INDEX = "ledger-cache/index";
const chunkKey = (n) => `ledger-cache/${n}`;
const CHUNK_SIZE = 2000;
const READ_CONCURRENCY = 25;

async function readCache(store) {
  const index = await store.get(CACHE_INDEX);
  const count = index && Number.isInteger(index.chunks) ? index.chunks : 0;
  const chunks = await mapLimit(Array.from({ length: count }, (_, n) => n), READ_CONCURRENCY, async (n) => {
    const chunk = await store.get(chunkKey(n));
    return { entries: new Map(chunk && Array.isArray(chunk.entries) ? chunk.entries : []), dirty: !chunk };
  });
  return chunks;
}

async function writeCache(store, chunks) {
  await mapLimit(chunks.map((chunk, n) => [chunk, n]).filter(([chunk]) => chunk.dirty), READ_CONCURRENCY,
    ([chunk, n]) => store.put(chunkKey(n), { entries: [...chunk.entries] }));
  await store.put(CACHE_INDEX, { chunks: chunks.length });
}

// Every report in the ledger. `strict` (data deletion) reads every report afresh and throws on a storage
// error, so a snapshot is never published from a partial ledger; it then rewrites the cache from what it
// read. The routine rebuild skips a report it cannot read and tries it again next time.
async function loadLedger(store, { strict = false } = {}) {
  const keys = await store.list("reports/");

  if (strict) {
    const get = store.getStrict ? (k) => store.getStrict(k) : (k) => store.get(k);
    const reports = await mapLimit(keys, READ_CONCURRENCY, get);
    const chunks = [];
    keys.forEach((key, i) => {
      if (!reports[i]) return;
      if (!chunks.length || chunks[chunks.length - 1].entries.size >= CHUNK_SIZE) chunks.push({ entries: new Map(), dirty: true });
      chunks[chunks.length - 1].entries.set(key, reports[i]);
    });
    await writeCache(store, chunks);
    return reports.filter(Boolean);
  }

  const chunks = await readCache(store);
  const live = new Set(keys);
  const cached = new Set();
  for (const chunk of chunks) {
    for (const key of chunk.entries.keys()) {
      if (live.has(key)) cached.add(key);
      else { chunk.entries.delete(key); chunk.dirty = true; }
    }
  }

  const missing = keys.filter((key) => !cached.has(key));
  const fresh = await mapLimit(missing, READ_CONCURRENCY, (key) => store.get(key));
  missing.forEach((key, i) => {
    if (!fresh[i]) return;
    let last = chunks[chunks.length - 1];
    if (!last || last.entries.size >= CHUNK_SIZE) { last = { entries: new Map(), dirty: true }; chunks.push(last); }
    last.entries.set(key, fresh[i]);
    last.dirty = true;
  });

  if (chunks.some((chunk) => chunk.dirty)) await writeCache(store, chunks);
  return chunks.flatMap((chunk) => [...chunk.entries.values()]);
}

module.exports = { loadLedger, CHUNK_SIZE };
