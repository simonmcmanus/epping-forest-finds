// This is deliberately a tiny, independently-bumped release marker. The
// post-merge cache-version workflow is the only automation allowed to change it.
const APP_CACHE_VERSION = `${globalThis.__DEV__ === true ? "dev-" : ""}v111`;
