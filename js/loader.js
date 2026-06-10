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

  const loadTreeDataset = async (url, timeoutMs = 20000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Tree data HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.trees)) throw new Error("Tree data format invalid");
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Try enriched (24 MB) with a tight timeout — on mobile a stalled download should
  // fail fast so we can fall through to the smaller base file sooner.
  // The base file (15 MB) gets two attempts: one immediate and one retry after a
  // short pause, covering brief signal drops that recover quickly.
  const treePromise = loadTreeDataset(TREE_ENRICHED_URL, 15000)
    .catch(() => loadTreeDataset(TREE_URL, 20000))
    .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(() => loadTreeDataset(TREE_URL, 20000)))
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

  const roadsPromise = Promise.race([
    fetch(ROADS_URL)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Roads data HTTP ${r.status}`);
        const data = await r.json();
        setLoadStep("roads", "done", (data.features || []).length);
        return data;
      })
      .catch(() => {
        setLoadStep("roads", "error");
        return { features: [] };
      }),
    // Timeout after 8 seconds to prevent indefinite hang
    new Promise((resolve) => setTimeout(() => {
      setLoadStep("roads", "error");
      resolve({ features: [] });
    }, 8000))
  ]);

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
      state.buildingFeatures = (data.features || []).filter((f) => f && f.geometry && f.properties);
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
