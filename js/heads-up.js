// Epping Forest Finds — Heads-up ordering: the score and sort that put the nearby list in the order of what is ahead of the walker.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

function headsUpScore(entry, origin, heading) {
  const metres = Number(entry && entry.metres);
  if (!Number.isFinite(metres)) return Number.POSITIVE_INFINITY;
  if (!origin || !Number.isFinite(heading)) return metres;
  const item = entry.item;
  // Trails and water features are lines/areas with no single coordinate to take a bearing
  // to, so they keep their plain distance rank rather than being guessed at.
  if (!item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return metres;
  const bearing = bearingDegrees(origin.latitude, origin.longitude, item.latitude, item.longitude);
  const delta = toRadians(shortestCompassDelta(heading, bearing));
  return metres * (1 + HEADS_UP_BEHIND_PENALTY * (1 - Math.cos(delta)) / 2);
}

// Returns a new array (never the memoized overviewItemsForActiveFilter() result, which the
// renderer also reads) ordered by heads-up score. With no compass -- desktop, or location
// without orientation -- this is the plain nearest-first order it has always been.
function headsUpSortedEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return entries;
  const heading = nearbyListHeading();
  const origin = nearbyOrigin();
  if (!Number.isFinite(heading) || !origin) return entries;
  return entries
    .map((entry, index) => ({ entry, index, score: headsUpScore(entry, origin, heading) }))
    // Ties fall back to the incoming distance order, so the sort stays deterministic.
    .sort((a, b) => (a.score - b.score) || (a.index - b.index))
    .map((scored) => scored.entry);
}
