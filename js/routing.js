// Builds a walkable routing graph from the app's normalized road/path features
// (js/normalize.js's toRoadFeature/toPathFeature output, state.roads/state.paths) and finds
// shortest routes across it for the selected-target route line (drawSelectedRoute in
// js/renderer.js). Pure functions only -- no `state`/DOM access -- so this can be unit tested
// in isolation, matching js/normalize.js's own no-DOM-dependency convention.
//
// Coordinate space: graph nodes are the same projected world {x,y} points already sitting in
// state.roads[].segments / state.paths[].segments (see projectLonLat in index.html) -- callers
// snap and draw with those points directly, no extra conversion. Edge weights are real-world
// metres, computed once at build time from caller-supplied `toLatLon`/`distanceMetresFn`
// (index.html's unprojectPoint/distanceMetres) rather than raw Euclidean distance in world
// units, so the shortest path found is the shortest real walk.
//
// Junction topology: OSM ways sharing a junction share the exact same node coordinate from
// Overpass ("out geom"), so snapping every segment vertex to a coordinate-rounded key
// reconstructs the network without needing real OSM node IDs (normalize.js's segments are plain
// {x,y} arrays with no IDs attached). See ROUTING_NODE_PRECISION below for the rounding.

// World-unit coordinate rounding used to merge shared way endpoints into one graph node.
// 1e-6 degrees of longitude/Mercator-y is sub-millimetre at this projection's scale -- far
// tighter than any real floating-point noise, so it only ever merges genuinely coincident OSM
// nodes, never two distinct nearby junctions.
const ROUTING_NODE_PRECISION = 6;

// Highway/path types the router will cross, each mapped to a weight multiplier applied to its
// real distance. Every value is >=1: it *penalises* a type relative to a plain dedicated path,
// steering the search toward footpaths and quiet streets over busier roads when more than one
// way connects two points, without ever ruling a road out outright (some destinations are only
// reachable by street). motorway/trunk (and their _link variants) are deliberately absent --
// not walkable/safe, so those ways never enter the graph at all.
const ROUTING_TYPE_WEIGHTS = {
  path: 1, footway: 1, bridleway: 1, track: 1, byway: 1, cycleway: 1,
  pedestrian: 1.05, living_street: 1.05,
  residential: 1.15, service: 1.15, unclassified: 1.15,
  tertiary: 1.3, tertiary_link: 1.3,
  secondary: 1.6, secondary_link: 1.6,
  primary: 2, primary_link: 2,
};

// Alleys are highway=service ways additionally tagged service=alley -- OSM's way of marking a
// narrow pedestrian/service cut-through, distinct from a car park aisle or loading bay (also
// highway=service, but not walkable-shortcut in the same way). js/normalize.js's toRoadFeature
// already tells the two apart (roadType: "alley" vs "service") and js/renderer.js already
// draws alleys as the thinnest, faintest road line for the same reason -- so route them like a
// footpath too, rather than penalising them at the generic "service" rate.
function routingWeightForFeature(feature) {
  if (!feature) return null;
  const highway = feature.highway;
  if (highway === "service" && feature.service === "alley") return ROUTING_TYPE_WEIGHTS.path;
  return Object.prototype.hasOwnProperty.call(ROUTING_TYPE_WEIGHTS, highway)
    ? ROUTING_TYPE_WEIGHTS[highway]
    : null;
}

function routingNodeKey(point) {
  return point.x.toFixed(ROUTING_NODE_PRECISION) + "," + point.y.toFixed(ROUTING_NODE_PRECISION);
}

// Shared graph-accumulation state used by both buildRoutingGraph (synchronous, for tests and
// small inputs) and buildRoutingGraphAsync (chunked/yielding, used by the app itself so a
// ~120k-node build never blocks a frame -- see ensureRoutingGraph in js/loader.js). Keeping one
// implementation of the actual graph-building logic behind this factory means the sync and
// async entry points can never drift apart into producing different graphs.
function createRoutingGraphBuilder(toLatLon, distanceMetresFn) {
  const nodeIndex = new Map();
  const nodes = [];
  const adjacency = [];

  function nodeId(point) {
    const key = routingNodeKey(point);
    let id = nodeIndex.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodeIndex.set(key, id);
      nodes.push(point);
      adjacency.push([]);
    }
    return id;
  }

  function addEdge(fromId, toId, point1, point2, weight) {
    const a = toLatLon(point1);
    const b = toLatLon(point2);
    const metres = distanceMetresFn(a.latitude, a.longitude, b.latitude, b.longitude);
    if (!(metres > 0)) return; // skip zero-length / degenerate segments
    const cost = metres * weight;
    adjacency[fromId].push({ to: toId, metres, cost });
    adjacency[toId].push({ to: fromId, metres, cost });
  }

  return {
    // Adds every routable feature in `features` (a state.roads/state.paths-shaped array) to the
    // graph being built. Safe to call repeatedly with successive slices of a larger array --
    // that's exactly what buildRoutingGraphAsync below does to spread the work across ticks.
    addFeatures(features) {
      for (const feature of features || []) {
        const weight = routingWeightForFeature(feature);
        if (weight == null) continue;
        for (const segment of feature.segments || []) {
          let prevId = null;
          let prevPoint = null;
          for (const point of segment) {
            const id = nodeId(point);
            if (prevId !== null && prevId !== id) {
              addEdge(prevId, id, prevPoint, point, weight);
            }
            prevId = id;
            prevPoint = point;
          }
        }
      }
    },
    build() {
      return { nodes, adjacency };
    },
  };
}

// Builds the graph in one synchronous pass. `roadFeatures`/`pathFeatures` are state.roads/
// state.paths-shaped arrays (each with .highway and .segments -- see js/normalize.js).
// `toLatLon` converts a world {x,y} point back to {latitude,longitude} (index.html's
// unprojectPoint); `distanceMetresFn(lat1, lon1, lat2, lon2)` returns real metres between two
// lat/lon pairs (index.html's distanceMetres). Both are injected rather than imported so this
// module stays dependency-free for testing. Fine for tests and small inputs; the app itself
// uses buildRoutingGraphAsync below so the full ~28k-way regional network doesn't build inside
// a single blocking call.
function buildRoutingGraph(roadFeatures, pathFeatures, toLatLon, distanceMetresFn) {
  const builder = createRoutingGraphBuilder(toLatLon, distanceMetresFn);
  builder.addFeatures(roadFeatures);
  builder.addFeatures(pathFeatures);
  return builder.build();
}

// Same result as buildRoutingGraph, but processes `featureBatchSize` features at a time (default
// 500, matching loadMapData's own road-processing batch size in js/loader.js) and yields to the
// main thread with a zero-delay setTimeout between batches, so building the full regional graph
// (~28k ways) never blocks a frame or an in-flight input handler. Returns a Promise.
function buildRoutingGraphAsync(roadFeatures, pathFeatures, toLatLon, distanceMetresFn, featureBatchSize) {
  const batchSize = featureBatchSize || 500;
  const builder = createRoutingGraphBuilder(toLatLon, distanceMetresFn);
  const allFeatures = [...(roadFeatures || []), ...(pathFeatures || [])];
  const yieldToMainThread = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function run() {
    for (let i = 0; i < allFeatures.length; i += batchSize) {
      builder.addFeatures(allFeatures.slice(i, i + batchSize));
      if (i + batchSize < allFeatures.length) await yieldToMainThread();
    }
    return builder.build();
  }

  return run();
}

// Finds the graph node nearest to `point` (plain nearest-vertex search, not nearest-point-on-
// edge -- OSM way vertices sit ~20m apart on average across this dataset, so the extra accuracy
// of projecting onto edges isn't worth the added complexity for a walking-directions line).
// Returns null only if the graph has no nodes at all.
function nearestRoutingNode(graph, point) {
  const nodes = graph && graph.nodes;
  if (!nodes || !nodes.length) return null;
  let bestId = -1;
  let bestDistSq = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i].x - point.x;
    const dy = nodes[i].y - point.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = i;
    }
  }
  return { nodeId: bestId, point: nodes[bestId] };
}

// Minimal binary min-heap keyed by priority, used by dijkstraPath below. Kept inline rather than
// a naive O(n) scan for the frontier -- the graph has 100k+ nodes (the full Epping Forest area's
// roads+paths), so an unindexed scan per pop would make every query far too slow.
function createRoutingHeap() {
  const items = [];
  function swap(i, j) { const t = items[i]; items[i] = items[j]; items[j] = t; }
  return {
    get size() { return items.length; },
    push(priority, value) {
      items.push({ priority, value });
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (items[parent].priority <= items[i].priority) break;
        swap(parent, i);
        i = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = i * 2 + 2;
          let smallest = i;
          if (l < items.length && items[l].priority < items[smallest].priority) smallest = l;
          if (r < items.length && items[r].priority < items[smallest].priority) smallest = r;
          if (smallest === i) break;
          swap(smallest, i);
          i = smallest;
        }
      }
      return top;
    },
  };
}

// Dijkstra's algorithm from startNode to endNode over `graph`, weighted by each edge's `.cost`
// (real metres * the type preference multiplier -- see ROUTING_TYPE_WEIGHTS) but reporting the
// path's actual `.metres` (unweighted real distance) alongside it, so callers can sanity-check
// the result against the straight-line distance without re-walking the path. Returns null when
// the two nodes aren't connected (the road/path network isn't one single connected component --
// small fenced-off fragments exist, see spec-data-rendering.md).
function dijkstraPath(graph, startNode, endNode) {
  const n = graph.adjacency.length;
  if (startNode < 0 || endNode < 0 || startNode >= n || endNode >= n) return null;
  const cost = new Float64Array(n).fill(Infinity);
  const metres = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  cost[startNode] = 0;
  metres[startNode] = 0;
  const heap = createRoutingHeap();
  heap.push(0, startNode);

  while (heap.size) {
    const { priority: d, value: u } = heap.pop();
    if (visited[u]) continue;
    visited[u] = 1;
    if (d > cost[u]) continue; // stale heap entry
    if (u === endNode) break; // shortest path to the target is finalised
    for (const edge of graph.adjacency[u]) {
      if (visited[edge.to]) continue;
      const nextCost = d + edge.cost;
      if (nextCost < cost[edge.to]) {
        cost[edge.to] = nextCost;
        metres[edge.to] = metres[u] + edge.metres;
        prev[edge.to] = u;
        heap.push(nextCost, edge.to);
      }
    }
  }

  if (!Number.isFinite(cost[endNode])) return null;

  const nodeIds = [];
  for (let cur = endNode; cur !== -1; cur = prev[cur]) nodeIds.push(cur);
  nodeIds.reverse();
  return { nodeIds, metres: metres[endNode] };
}

// Top-level entry point: finds a walking route from `fromPoint` to `toPoint` (both world {x,y})
// across `graph`, and returns it as an array of world points ready to draw -- the real start and
// end points followed by the graph's node path in between -- or null when a sensible route
// can't be found, in which case the caller should fall back to a plain straight line:
//   - either point is further than options.maxSnapMetres from the nearest graph node (there's
//     no path/road anywhere near it, e.g. deep off-trail), or
//   - the two points aren't in the same connected part of the network, or
//   - the found route is more than options.maxDetourRatio times the straight-line distance,
//     which in practice means the snap landed in one of the network's small disconnected
//     fragments rather than a route that's genuinely just indirect.
function findRoutePoints(graph, fromPoint, toPoint, options) {
  if (!graph || !graph.nodes || !graph.nodes.length) return null;
  const toLatLon = options.toLatLon;
  const distanceMetresFn = options.distanceMetresFn;
  const maxSnapMetres = options.maxSnapMetres != null ? options.maxSnapMetres : 250;
  const maxDetourRatio = options.maxDetourRatio != null ? options.maxDetourRatio : 4;

  const fromLatLon = toLatLon(fromPoint);
  const toLatLonValue = toLatLon(toPoint);
  const straightLineMetres = distanceMetresFn(
    fromLatLon.latitude, fromLatLon.longitude,
    toLatLonValue.latitude, toLatLonValue.longitude
  );
  if (!(straightLineMetres > 0)) return null;

  const fromSnap = nearestRoutingNode(graph, fromPoint);
  const toSnap = nearestRoutingNode(graph, toPoint);
  if (!fromSnap || !toSnap || fromSnap.nodeId === toSnap.nodeId) return null;

  const fromSnapLatLon = toLatLon(fromSnap.point);
  const toSnapLatLon = toLatLon(toSnap.point);
  const fromSnapMetres = distanceMetresFn(
    fromLatLon.latitude, fromLatLon.longitude,
    fromSnapLatLon.latitude, fromSnapLatLon.longitude
  );
  const toSnapMetres = distanceMetresFn(
    toLatLonValue.latitude, toLatLonValue.longitude,
    toSnapLatLon.latitude, toSnapLatLon.longitude
  );
  if (fromSnapMetres > maxSnapMetres || toSnapMetres > maxSnapMetres) return null;

  const path = dijkstraPath(graph, fromSnap.nodeId, toSnap.nodeId);
  if (!path) return null;

  const routeMetres = path.metres + fromSnapMetres + toSnapMetres;
  if (routeMetres > straightLineMetres * maxDetourRatio) return null;

  const points = path.nodeIds.map((id) => graph.nodes[id]);
  return [fromPoint, ...points, toPoint];
}
