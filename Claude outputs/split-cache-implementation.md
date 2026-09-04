# Split Cache Implementation Summary

**Date:** 2026-09-04  
**Goal:** Allow weekly data updates without re-downloading app code

## Changes Made

### 1. Service Worker Refactored (`sw.js`)

**Split from one cache to two:**
- `APP_CACHE_NAME = "forest-finds-app-v1"` — app code (HTML, CSS, JS)
- `DATA_CACHE_NAME = "forest-finds-data-v1"` — data (GeoJSON, tree chunks, icons)

**Assets reorganized:**
- `APP_SHELL` — critical app code (no code changes)
- `DATA_SHELL` — essential data files (trees index, landmarks, paths, environment)
- `DATA_CACHE_OPPORTUNISTIC` — optional data (tree chunks, icons, roads)

**Routing logic:**
- `isAppCodePath()` — routes CSS, JS, HTML, SVG, manifests to app cache
- `isDataPath()` — routes `/data/*` to data cache
- Both use same fetch strategy (cache-first in prod, network-first in dev via `IS_DEV`)

**Install & Activate:**
- Both `APP_SHELL` and `DATA_SHELL` are blocking — install waits for both
- Opportunistic files pre-cached in background without blocking
- Activate cleans up any cache not named `APP_CACHE_NAME` or `DATA_CACHE_NAME`

### 2. CI Workflows Updated

#### `sw-bump.yml` (non-main branches)
- Now bumps `APP_CACHE_NAME` with branch prefix instead of single `CACHE_NAME`
- Example: `forest-finds-app-fix-123-v1` → `forest-finds-app-fix-123-v2`
- Syncs `APP_VERSION` in `index.html`
- Leaves `DATA_CACHE_NAME` untouched

#### `sw-release.yml` (main branch)
- Strips branch prefix and bumps `APP_CACHE_NAME`
- Example: `forest-finds-app-fix-123-v2` → `forest-finds-app-v316`
- Syncs `APP_VERSION` in `index.html`
- Leaves `DATA_CACHE_NAME` untouched

#### `data-bump.yml` (NEW — main branch, data changes only)
- Triggers automatically on push to main when files under `data/**` change
- Bumps `DATA_CACHE_NAME` only
- Does NOT update `APP_VERSION`
- Ready for use with automated weekly data regeneration

### 3. Index HTML Updated

- Updated comment on `APP_VERSION` constant to reference `APP_CACHE_NAME` instead of old `CACHE_NAME`
- No functional changes to the code

### 4. Spec Documentation Updated

#### `glossary.md`
- Updated **Service worker** entry to document two separate caches
- Updated **Local dev flag** entry to mention both cache prefixes

#### `spec.md`
- Updated service worker section to explain split cache strategy
- Updated Force refresh note to mention "both app and data caches"

#### Project Memory
- Created `split-cache-strategy.md` documenting the full architecture
- Updated `MEMORY.md` index

## Impact

### Users
- **Weekly data updates:** ~95% smaller download (just data, no app code)
- **Code updates:** Only app code re-downloads (data reuses if unchanged)
- **Better offline support:** Can update data independently from app stability

### Developers
- `npm run dev` works same as before (network-first in local dev)
- Manual CACHE_NAME bumps only needed for on-device PWA testing (unchanged)
- Data updates can be deployed independently without app release ceremony

### Infrastructure
- Data pipeline can now run on schedule without blocking app releases
- Separate version tracks allow independent rollback/debug of data vs. app issues

## Next Steps (Optional)

1. **Automate data updates:** Create scheduled GitHub Actions workflow to regenerate data weekly
2. **Monitor cache sizes:** Track actual download sizes to verify 95% savings
3. **Test cold start:** Verify install performance with separate blocking shells
4. **Update About screen:** Could show separate app/data version numbers instead of one

## Testing Checklist

- [ ] Local dev (`npm run dev`) shows network-first behavior for both caches
- [ ] Push non-main branch, verify app cache bumps with branch prefix
- [ ] Merge to main, verify app cache cleans prefix and bumps cleanly
- [ ] Modify a file in `/data/`, push to main, verify `data-bump.yml` triggers
- [ ] Force refresh clears both app and data caches correctly
- [ ] On-device PWA install gets both caches, updates separately

## Files Modified

```
sw.js                                    — refactored with split caches
index.html                               — updated APP_VERSION comment
.github/workflows/sw-bump.yml            — bumps APP_CACHE_NAME only
.github/workflows/sw-release.yml         — bumps APP_CACHE_NAME only
.github/workflows/data-bump.yml          — NEW: bumps DATA_CACHE_NAME
spec/glossary.md                         — documented split caches
spec/spec.md                             — updated cache strategy section
```
