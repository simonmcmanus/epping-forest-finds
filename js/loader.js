function setLoadStep(key, status, count) {
  const el = document.querySelector(`[data-load-step="${key}"]`);
  if (!el) return;
  el.classList.remove("pending", "loading", "done", "error");
  el.classList.add(status);

  if (count != null) {
    const countEl = document.querySelector(`[data-step-count="${key}"]`);
    if (countEl) {
      countEl.textContent = count.toLocaleString();
    }
  }

  const steps = document.querySelectorAll("[data-load-step]");
  const complete = document.querySelectorAll("[data-load-step].done, [data-load-step].error").length;
  const bar = document.getElementById("loadingProgressBar");
  if (bar && steps.length > 0) {
    bar.style.width = `${Math.round((complete / steps.length) * 100)}%`;
  }
}

async function loadMapData() {
  setLoadStep("trees", "loading");
  setLoadStep("places", "loading");
  setLoadStep("paths", "loading");
  setLoadStep("roads", "loading");
  setLoadStep("environment", "loading");
  setLoadStep("forest", "loading");

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const loadJson = async (url, timeoutMs = 60000) => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      return response.json();
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  };

  const loadTreeDataset = async (url, timeoutMs = 60000) => {
    const data = await loadJson(url, timeoutMs);
    if (!data || !Array.isArray(data.trees)) throw new Error("Tree data format invalid");
    return data;
  };

  const loadTreeChunks = async (indexUrl, timeoutMs = 20000) => {
    const index = await loadJson(indexUrl, timeoutMs);
    const chunks = Array.isArray(index && index.chunks) ? index.chunks : [];
    if (chunks.length === 0) throw new Error("Tree chunk index empty");

    const results = new Array(chunks.length);
    const maxConcurrent = Math.min(6, chunks.length);
    let nextIndex = 0;
    let loadedCount = 0;

    const loadChunk = async (chunk) => {
      const data = await loadJson(chunk.url, 30000);
      if (!data || !Array.isArray(data.trees)) throw new Error(`Tree chunk invalid: ${chunk.url}`);
      return data.trees;
    };

    const worker = async () => {
      while (nextIndex < chunks.length) {
        const chunkIndex = nextIndex;
        nextIndex += 1;
        const chunk = chunks[chunkIndex];
        const trees = await loadChunk(chunk).catch(() => delay(1000).then(() => loadChunk(chunk)));
        results[chunkIndex] = trees;
        loadedCount += trees.length;
        setLoadStep("trees", "loading", loadedCount);
        await delay(0);
      }
    };

    await Promise.all(Array.from({ length: maxConcurrent }, worker));

    return {
      dataset: index.dataset,
      sourceFiles: index.sourceFiles,
      generatedAt: index.generatedAt,
      recordCount: index.recordCount,
      encoding: index.encoding,
      coordinateReferenceSystem: index.coordinateReferenceSystem,
      fields: index.fields,
      historicalNamedTreeEnrichment: index.historicalNamedTreeEnrichment || null,
      trees: results.flat(),
    };
  };

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const mobileLike = navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const constrainedConnection = connection && (connection.saveData || /(^|-)2g$|3g/.test(connection.effectiveType || ""));
  const preferBaseTreeFile = mobileLike || constrainedConnection;
  const fullFileAttempts = preferBaseTreeFile
    ? [
        { url: TREE_URL, timeoutMs: 90000 },
        { url: TREE_URL, timeoutMs: 120000, delayMs: 2000 },
        { url: TREE_ENRICHED_URL, timeoutMs: 90000 },
      ]
    : [
        { url: TREE_ENRICHED_URL, timeoutMs: 60000 },
        { url: TREE_URL, timeoutMs: 90000 },
        { url: TREE_URL, timeoutMs: 120000, delayMs: 2000 },
      ];
  const treeAttempts = [
    { load: () => loadTreeChunks(TREE_CHUNK_INDEX_URL), delayMs: 0 },
    ...fullFileAttempts.map((attempt) => ({
      delayMs: attempt.delayMs || 0,
      load: () => loadTreeDataset(attempt.url, attempt.timeoutMs),
    })),
  ];

  const treePromise = treeAttempts.reduce((promise, attempt) => {
    return promise.catch(() => delay(attempt.delayMs || 0).then(() => attempt.load()));
  }, Promise.reject())
    .then((data) => {
      setLoadStep("trees", "done", data.trees.length);
      return data;
    })
    .catch(() => {
      setLoadStep("trees", "error");
      return { trees: [], historicalNamedTreeEnrichment: null };
    });

  const landmarkPromise = Promise.all(
    LANDMARK_URLS.map(url =>
      fetch(url)
        .then(r => r.ok ? r.json() : { features: [] })
        .catch(() => ({ features: [] }))
    )
  ).then(datasets => {
    const allFeatures = datasets.flatMap(data => data.features || []);
    setLoadStep("places", "done", allFeatures.length);
    return { features: allFeatures };
  }).catch(() => {
    setLoadStep("places", "error");
    return { features: [] };
  });

  const folklorePromise = fetch(FOLKLORE_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Folklore data HTTP ${r.status}`);
      return r.json();
    })
    .catch(() => ({ locations: [] }));

  const pathsPromise = fetch(PATHS_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Paths data HTTP ${r.status}`);
      const data = await r.json();
      setLoadStep("paths", "done", data.features ? data.features.length : 0);
      return data;
    })
    .catch(() => {
      setLoadStep("paths", "error");
      return { features: [] };
    });

  const roadsPromise = loadJson(ROADS_URL, 90000)
    .catch(() => delay(2000).then(() => loadJson(ROADS_URL, 120000)))
    .then((data) => {
      setLoadStep("roads", "done", (data.features || []).length);
      return data;
    })
    .catch(() => {
      setLoadStep("roads", "error");
      return { features: [] };
    });

  const environmentPromise = fetch(ENVIRONMENT_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Environment data HTTP ${r.status}`);
      const data = await r.json();
      setLoadStep("environment", "done", data.features ? data.features.length : 0);
      return data;
    })
    .catch(() => {
      setLoadStep("environment", "error");
      return { features: [] };
    });

  const layerPromises = FEATURE_LAYERS.map((layer) =>
    fetch(layer.url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${layer.label} HTTP ${r.status}`);
        return { ...layer, data: await r.json() };
      })
      .catch(() => ({ ...layer, data: { type: "FeatureCollection", features: [] } }))
  );

  const [treeData, landmarkData, folkloreData, pathsData, roadsData, environmentData, ...resolvedLayers] = await Promise.all([
    treePromise,
    landmarkPromise,
    folklorePromise,
    pathsPromise,
    roadsPromise,
    environmentPromise,
    ...layerPromises,
  ]);

  const layerFeatureCount = resolvedLayers.reduce((sum, layer) => {
    return sum + (layer.data.features ? layer.data.features.length : 0);
  }, 0);
  setLoadStep("forest", "done", layerFeatureCount);

  state.layers = resolvedLayers;

  state.trees = treeData.trees
    .filter((tree) => tree.location && tree.location.wgs84)
    .map((tree) => ({
      ...tree,
      latitude: Number(tree.location.wgs84.latitude),
      longitude: Number(tree.location.wgs84.longitude),
      point: projectLonLat(Number(tree.location.wgs84.longitude), Number(tree.location.wgs84.latitude)),
    }));

  state.namedTreeStoriesByName = buildNamedTreeStoryIndex(treeData.historicalNamedTreeEnrichment);

  const osmLandmarks = (landmarkData.features || [])
    .filter((feature) => feature.geometry && feature.geometry.type === "Point")
    .map((feature) => {
      const longitude = Number(feature.geometry.coordinates[0]);
      const latitude = Number(feature.geometry.coordinates[1]);
      return {
        ...feature.properties,
        categoryTags: buildOsmCategoryTags(feature.properties),
        latitude,
        longitude,
        point: projectLonLat(longitude, latitude),
      };
    });

  const folkloreLandmarks = normalizeFolkloreLocations(folkloreData);
  state.landmarks = [...osmLandmarks, ...folkloreLandmarks];
  setLoadStep("places", "done", state.landmarks.length);

  state.paths = (pathsData.features || [])
    .map(toPathFeature)
    .filter(Boolean);

  // Process roads in smaller batches to avoid freezing the main thread
  const roadFeatures = roadsData.features || [];
  state.roads = [];
  const batchSize = 500;
  for (let i = 0; i < roadFeatures.length; i += batchSize) {
    const batch = roadFeatures.slice(i, i + batchSize);
    state.roads.push(...batch.map(toRoadFeature).filter(Boolean));
    if (i + batchSize < roadFeatures.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  state.environmentFeatures = (environmentData.features || []).filter((feature) => feature && feature.geometry && feature.properties);
  state.waterFeatures = extractWaterFeatures(environmentData.features || []);
}

function loadBuildingsIfNeeded() {
  if (state.buildingsLoaded || state.buildingsLoading) return;
  state.buildingsLoading = true;
  fetch(BUILDINGS_URL)
    .then((r) => r.json())
    .then((data) => {
      state.buildingFeatures = (data.features || [])
        .filter((f) => f && f.geometry && f.properties);
      state.buildingsLoaded = true;
      state.buildingsLoading = false;
      state.buildingsRevealStartTime = performance.now();
      requestDraw();
    })
    .catch(() => {
      state.buildingsLoading = false;
      state.buildingsLoaded = true; // don't retry on error
    });
}

// Lazily builds the road/path routing graph used by the selected-route line (js/routing.js,
// selectedRoutePoints in js/renderer.js). Not a network fetch like loadBuildingsIfNeeded above --
// state.roads/state.paths are already in memory from loadMapData -- but kept here for the same
// reason: a derived piece of state that most sessions never need (a user who never selects a
// specific tree/landmark never pays for it) and that must never block the caller, so building it
// is handed off to buildRoutingGraphAsync (js/routing.js), which yields to the main thread
// between batches rather than doing the ~120k-node build in one blocking call. Guarded by
// state.routingGraphBuilding/state.routingGraphReady exactly like state.buildingsLoading/
// state.buildingsLoaded, so repeated calls (it's called on every drawSelectedRoute) are free
// once building has started.
function ensureRoutingGraph() {
  if (state.routingGraphReady || state.routingGraphBuilding) return;
  state.routingGraphBuilding = true;
  buildRoutingGraphAsync(state.roads, state.paths, unprojectPoint, distanceMetres)
    .then((graph) => {
      state.routingGraph = graph;
      state.routingGraphReady = true;
      state.routingGraphBuilding = false;
      // Correct the selected-target distance/walk-time chip the instant the graph becomes
      // ready, rather than waiting for the next GPS fix to happen to call updateSelectedDetailFields.
      updateSelectedDetailFields();
      requestDraw();
    })
    .catch(() => {
      state.routingGraph = null;
      state.routingGraphReady = true; // don't retry on error -- fall back to the straight line for the rest of the session
      state.routingGraphBuilding = false;
    });
}
