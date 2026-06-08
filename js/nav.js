function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }

  if (els.installButton) {
    els.installButton.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });

  if (els.installButton) els.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
  });
}

function setupUiZoomLock() {
  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("gestureend", (event) => event.preventDefault(), { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

function showFilterHintIfFirstVisit() {
  try {
    if (localStorage.getItem(FILTER_HINT_KEY)) return;
    localStorage.setItem(FILTER_HINT_KEY, "1");
  } catch {}
  setTimeout(() => {
    els.filterToggle.classList.add("filter-toggle-hint");
    els.filterToggle.addEventListener("animationend", () => {
      els.filterToggle.classList.remove("filter-toggle-hint");
    }, { once: true });
  }, 1400);
}

function setupInteractions() {
  setupCompassListeners();
  setupResizeHandler();
  setupInspectorHandlers();
  setupInspectorDragResize();
  setupFilterPanelHandlers();
  setupSearchAndNavHandlers();
  setupMapCanvasHandlers();
}

function setupResizeHandler() {
  updateMapControlVisibility();
  updateFilterUi();
  window.addEventListener("resize", () => {
    updateMapControlVisibility();
    updateSubfilterScrollHints();
    resizeCanvas();
    if (state.bounds) {
      if (state.userLocation && selectedCompassTarget()) ensureUserAndSelectionVisible({ animate: true, durationMs: 360 });
      else fitToBounds(false);
    }
    requestDraw();
  });
}

function setupInspectorHandlers() {
  if (els.closeInspector) {
    els.closeInspector.addEventListener("click", () => {
      setInspectorMinimized(!els.inspector.classList.contains("minimized"));
    });
  }

  els.inspectorBack.addEventListener("click", () => {
    goToInitialView();
  });

  els.inspector.addEventListener("click", (event) => {
    if (!els.inspector.classList.contains("minimized")) return;
    if (els.closeInspector && event.target === els.closeInspector) return;
    setInspectorMinimized(false);
  });

  els.locateButton.addEventListener("click", () => {
    locateUser({ initial: false });
  });

  if (els.locationGateButton) {
    els.locationGateButton.addEventListener("click", async () => {
      if (!state.userLocation) {
        locateUser({ initial: false });
      } else {
        await requestCompassPermissionIfNeeded({ fromGesture: true });
        if (state.compassPermission === "granted") {
          setLocationGateVisible(false);
          updateCompassOverlay();
        } else if (compassPermissionCanBeRequested()) {
          showCompassAccessPrompt();
        }
      }
    });
  }

  if (els.distanceWarningButton) {
    els.distanceWarningButton.addEventListener("click", () => {
      state.distanceWarningShown = true;
      hideWithFade(els.distanceWarning);
    });
  }
}

function setupFilterPanelHandlers() {
  els.filterToggle.addEventListener("click", () => {
    if (els.inspector.classList.contains("minimized")) {
      setInspectorMinimized(false);
    }
    openFiltersScreen();
  });

  if (els.nearbyToggle) {
    els.nearbyToggle.addEventListener("click", () => selectOverview(true));
  }

  if (els.reportToggle) {
    els.reportToggle.addEventListener("click", () => {
      openReportModal();
    });
  }

  if (els.settingsToggle) {
    els.settingsToggle.addEventListener("click", () => {
      openSettings();
    });
  }

  // Select dropdown is part of the overview UI; listener attached in selectOverview()
  document.addEventListener("change", (event) => {
    if (event.target.id === "nearestItemsSelect") {
      state.walkingDistanceMinutes = parseInt(event.target.value, 10);
      selectOverview();
      if (state.userLocation) {
        const { latitude, longitude } = state.userLocation;
        const maxMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
        const nearestTrees = nearbyTreesWithinDistance(latitude, longitude, maxMetres);
        state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
        ensureOverviewTargetsVisible({ animate: true, durationMs: 420 });
        requestDraw();
      }
    }
  }, true);

  els.inspectorBody.addEventListener("click", (event) => {
    const clearAllButton = event.target.closest("[data-filter-clear-all]");
    if (clearAllButton) {
      setOverviewFilters([]);
      return;
    }

    const subfilterButton = event.target.closest("[data-filter-subfilter]");
    if (subfilterButton) {
      toggleOverviewSubfilter(subfilterButton.dataset.filterSubfilter);
      return;
    }

    const groupButton = event.target.closest("[data-filter-group]");
    if (groupButton) {
      toggleOverviewFilterGroup(groupButton.dataset.filterGroup);
    }
  });
}

function setupSearchAndNavHandlers() {
  els.treeSearchToggle.addEventListener("click", () => {
    const isOpen = !els.treeSearchPanel.hidden;
    els.treeSearchPanel.hidden = isOpen;
    els.treeSearchToggle.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) {
      setInspectorMinimized(false);
      els.treeSearchInput.focus();
    }
  });

  els.treeSearchButton.addEventListener("click", () => {
    searchTreeByNumber();
  });

  els.treeSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchTreeByNumber();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (els.treeSearchPanel.hidden) return;
    if (target.closest("#treeSearchPanel") || target.closest("#treeSearchToggle")) return;
    els.treeSearchPanel.hidden = true;
    els.treeSearchToggle.setAttribute("aria-expanded", "false");
  });

  window.addEventListener("hashchange", () => {
    if (state.suppressHashChange) return;
    if (!window.location.hash) {
      goToInitialView(false);
      return;
    }
    applySelectionFromHash(false);
  });

  els.inspectorBody.addEventListener("click", (event) => {
    const shareBtn = event.target.closest("[data-action='share-location']");
    if (shareBtn) { shareCurrentLocation(); return; }
    const walkBtn = event.target.closest(".walk-chip-btn");
    if (walkBtn) {
      const expanded = walkBtn.getAttribute("aria-expanded") === "true";
      const span = walkBtn.querySelector("[data-walk-short]");
      if (span) span.textContent = expanded ? span.dataset.walkShort : span.dataset.walkFull;
      walkBtn.setAttribute("aria-expanded", String(!expanded));
      return;
    }
    const button = event.target.closest("[data-overview-type][data-overview-key]");
    if (!button) return;
    focusOverviewItem(button.dataset.overviewType, button.dataset.overviewKey);
  });
}

function setupMapCanvasHandlers() {
  els.canvas.addEventListener("pointerdown", (event) => {
    stopViewportAnimation();
    els.canvas.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.moved = false;
    state.dragStart = {
      x: event.clientX,
      y: event.clientY,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
    };
    els.canvas.classList.add("dragging");
  });

  els.canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    if (shouldAutoRepositionSelection()) {
      ensureUserAndSelectionVisible({ animate: true, durationMs: 300 });
      return;
    }
    const dx = event.clientX - state.dragStart.x;
    const dy = event.clientY - state.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
    state.viewport.tx = state.dragStart.tx + dx;
    state.viewport.ty = state.dragStart.ty + dy;
    requestDraw();
  });

  els.canvas.addEventListener("pointerup", (event) => {
    els.canvas.releasePointerCapture(event.pointerId);
    els.canvas.classList.remove("dragging");
    const wasClick = !state.moved;
    state.dragging = false;
    if (wasClick) handleMapClick(event);
  });

  els.canvas.addEventListener("pointercancel", () => {
    state.dragging = false;
    els.canvas.classList.remove("dragging");
  });

  els.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.22 : 1 / 1.22;
    zoomAt(factor, canvasPoint(event));
  }, { passive: false });
}

function setInspectorMinimized(minimized) {
  const wasMinimized = els.inspector.classList.contains("minimized");
  els.inspector.classList.toggle("minimized", minimized);
  if (wasMinimized && !minimized && state.userLocation && selectedCompassTarget()) {
    centerViewportOnPointsKeepScale(
      [state.userLocation.point, selectedCompassTarget().point],
      { animate: true, durationMs: 480, focusVisibleArea: true, assumeInspectorOpen: true }
    );
  }
  if (typeof updateCompassOverlay === "function") updateCompassOverlay();
}

function setupInspectorDragResize() {
  const dragHandle = document.getElementById("inspectorDragHandle");
  if (!dragHandle) return;
  let dragRecenterFrame = null;

  function isMobileLayout() {
    return window.innerWidth <= 850;
  }

  function setInspectorHeight(percent) {
    if (!isMobileLayout()) return;
    const clamped = Math.max(20, Math.min(85, percent));
    state.inspectorHeightPercent = clamped;
    els.inspector.style.setProperty("--inspector-height", `${clamped}%`);
  }

  function recentMapForInspectorChange(options = {}) {
    const animate = Boolean(options.animate);
    const durationMs = options.durationMs || (animate ? 220 : 0);
    if (!state.userLocation) return;
    if (state.selected && selectedCompassTarget()) {
      centerViewportOnPointsKeepScale(
        [state.userLocation.point, selectedCompassTarget().point],
        { animate, durationMs, focusVisibleArea: true, assumeInspectorOpen: true }
      );
    } else if (isOverviewScreenActive()) {
      ensureOverviewTargetsVisible({ animate, durationMs });
    }
  }

  dragHandle.addEventListener("pointerdown", (event) => {
    if (!isMobileLayout()) return;
    event.preventDefault();
    dragHandle.setPointerCapture(event.pointerId);
    state.inspectorDragging = true;
    els.inspector.classList.add("is-dragging");
    state.inspectorDragStart = {
      y: event.clientY,
      heightPercent: state.inspectorHeightPercent || 48,
    };
    dragHandle.classList.add("dragging");
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (!state.inspectorDragging) return;
    const deltaY = state.inspectorDragStart.y - event.clientY;
    const viewportHeight = window.innerHeight;
    const deltaPercent = (deltaY / viewportHeight) * 100;
    const newPercent = state.inspectorDragStart.heightPercent + deltaPercent;
    setInspectorHeight(newPercent);
    if (dragRecenterFrame == null) {
      dragRecenterFrame = requestAnimationFrame(() => {
        dragRecenterFrame = null;
        recentMapForInspectorChange({ animate: true, durationMs: 180 });
      });
    }
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
    if (dragRecenterFrame != null) {
      cancelAnimationFrame(dragRecenterFrame);
      dragRecenterFrame = null;
    }
    recentMapForInspectorChange({ animate: true, durationMs: 240 });
  });

  dragHandle.addEventListener("pointercancel", () => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
  });

  window.addEventListener("resize", () => {
    if (!isMobileLayout() && state.inspectorHeightPercent !== null) {
      els.inspector.style.removeProperty("--inspector-height");
      state.inspectorHeightPercent = null;
    }
  });
}

function goToInitialView(updateHash = true) {
  state.selected = null;
  selectOverview(true);
  setInspectorMinimized(false);
  ensureOverviewTargetsVisible({ animate: true, durationMs: 300 });
  if (!state.userLocation) fitToBounds(false, { animate: true, durationMs: 300 });
  updateCompassOverlay();
  if (updateHash) setHashFromSelection();
  requestDraw();
}

function pinchZoomLikelyAvailable() {
  return (navigator.maxTouchPoints || 0) >= 2 || window.matchMedia("(pointer: coarse)").matches;
}

function updateMapControlVisibility() {
  if (!els.toolbar) return;
  els.toolbar.style.display = pinchZoomLikelyAvailable() ? "none" : "flex";
}

function updateLocateButtonVisibility() {
  const geolocationAvailable = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  els.locateButton.hidden = !geolocationAvailable || Boolean(state.userLocation);
  syncInspectorToolsVisibility();
}

function syncInspectorToolsVisibility() {
  if (!els.inspectorTools || els.inspectorTools.hidden) return;
  const hasContent = !els.locateButton.hidden
    || !els.treeSearchPanel.hidden
    || (els.installButton && getComputedStyle(els.installButton).display !== "none");
  els.inspectorTools.classList.toggle("tools-empty", !hasContent);
}

function hideWithFade(el, onDone) {
  if (!el || el.hidden) { if (onDone) onDone(); return; }
  if (el.classList.contains("fading-out")) return;
  el.classList.add("fading-out");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.hidden = true;
    el.classList.remove("fading-out");
    if (onDone) onDone();
  };
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 420);
}

function setLocationGateVisible(visible, message, buttonLabel, title) {
  if (!els.locationGate) return;
  if (visible) {
    els.locationGate.classList.remove("fading-out");
    els.locationGate.hidden = false;
  } else {
    // When the gate is dismissed (all permissions granted), show loading overlay if data isn't ready yet
    if (!state.dataLoaded && els.loadingOverlay) {
      els.loadingOverlay.hidden = false;
    }
    hideWithFade(els.locationGate);
  }
  if (title && els.locationGateTitle) {
    els.locationGateTitle.textContent = title;
  }
  if (message && els.locationGateMessage) {
    els.locationGateMessage.textContent = message;
  }
  if (els.locationGateButton) {
    els.locationGateButton.textContent = buttonLabel || "Enable location to continue";
  }
}
