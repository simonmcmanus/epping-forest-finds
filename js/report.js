// Epping Forest Finds — Report: the Report screen's form, photo handling, the send-or-queue path, and the location-issue report on a place.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

function openReportModal() {
  if (typeof dismissOnboarding === "function") dismissOnboarding();
  if (typeof trackGaScreenView === "function") trackGaScreenView("Report");
  // See the matching comment in openFiltersScreen.
  exitClusterExpansion();
  state.selected = { type: "report", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("feedback", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  setNavScreenActive(els.reportToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Feedback";
  els.inspectorType.textContent = "Tell us what is wrong or missing";
  transitionInspectorBody(reportFormHtml(), "forward", () => {
    const detailsInput = document.getElementById("reportDetails");
    if (detailsInput) {
      // Keep the new Feedback screen at its top. Keyboard avoidance will scroll the
      // field into view later if the viewport actually shrinks on a phone.
      detailsInput.focus({ preventScroll: true });
    }
  });
  bindReportFormHandlers();
  setReportStatus("");
  updateReportLocationLabel();
  setInspectorMinimized(false);
  updateCompassOverlay();
  syncHashFromSelection();
  requestDraw();
}

function reportFormHtml() {
  let draft = {};
  try {
    const raw = localStorage.getItem(REPORT_DRAFT_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch {}
  const detailsValue = draft.details || "";
  const online = navigator.onLine;
  return `<div class="report-screen">
    <div class="report-type-field">
      <label for="reportType">What would you like to tell us?
        <select id="reportType" class="report-textarea community-input">
          <option value="feedback">Feedback, a bug or something strange</option>
          <option value="tree">A tree that's missing from the map</option>
          <option value="place">A place that's missing from the map</option>
        </select>
      </label>
    </div>
    <form id="reportForm" class="report-form">
      <p class="report-intro">We welcome feedback, bug reports, and anything strange you have noticed. It helps us improve the data for everyone.</p>
      <label for="reportDetails">What did you notice?
        <textarea id="reportDetails" class="report-textarea" placeholder="Describe what's missing or what you'd like to see…" required>${escapeHtml(detailsValue)}</textarea>
      </label>
      ${reportPhotoFieldHtml("reportPhoto")}
      ${communityPublicNoticeHtml()}
      <p id="reportStatus" class="report-status" aria-live="polite"></p>
      <p id="reportOutboxNote" class="report-note" aria-live="polite" hidden></p>
      <p id="reportOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>You're offline. Your report will be saved and sent automatically when you're back online.</p>
      <div class="report-form-actions">
        <button id="reportCancel" class="button button-ghost" type="button">Cancel</button>
        <button id="reportSubmit" class="button" type="submit">Submit</button>
      </div>
    </form>
    ${communityAddFormHostHtml()}
    </div>`;
}

// `capture="environment"` asks a phone for its rear camera, where supported. Browsers which
// do not expose a camera still present their normal image picker, so reporting stays simple on
// desktop and for users who already have a useful picture.
function reportPhotoFieldHtml(inputId, hint = "Take a photo of the tree tag, or choose an existing picture.") {
  return `<div class="report-photo-field">
      <label for="${inputId}">Photo (optional)
        <input id="${inputId}" class="report-photo-input" type="file" accept="image/*" capture="environment">
      </label>
      <p class="report-note report-photo-note">${escapeHtml(hint)}</p>
      <p class="report-photo-status" aria-live="polite"></p>
    </div>`;
}

function bindReportFormHandlers() {
  populateReportLocation();

  const cancelButton = document.getElementById("reportCancel");
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      goToInitialView();
    });
  }

  const typeSelect = document.getElementById("reportType");
  if (typeSelect) typeSelect.addEventListener("change", () => communitySetReportType(typeSelect.value));

  const form = document.getElementById("reportForm");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitReportForm();
    });
  }

  // Save draft to localStorage as the user types
  function saveDraft() {
    const detailsInput = document.getElementById("reportDetails");
    try {
      localStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify({
        details: detailsInput ? detailsInput.value : "",
      }));
    } catch {}
  }
  const detailsInput = document.getElementById("reportDetails");
  if (detailsInput) detailsInput.addEventListener("input", saveDraft);
  bindReportPhotoInput(document.getElementById("reportPhoto"));
  // A browser's own scroll-into-view-on-focus is free to pick an odd ancestor/offset in the
  // cramped landscape keyboard-avoiding layout; re-assert our own nearest-both-axes scroll
  // whenever the field is (re)focused, however that focus happened, so it's deterministic.
  if (detailsInput) detailsInput.addEventListener("focus", () => {
    detailsInput.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // Show or hide the offline note when connectivity changes (submitting stays possible: it queues)
  function updateOnlineState() {
    const offlineNote = document.getElementById("reportOfflineNote");
    if (!offlineNote) return; // form has been removed from DOM
    const online = navigator.onLine;
    if (offlineNote) offlineNote.hidden = online;
  }
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);

  // "N waiting to send" for anything parked in the outbox (js/outbox.js).
  function showOutboxPending(pending) {
    const note = document.getElementById("reportOutboxNote");
    if (!note) return;
    note.hidden = !pending;
    note.textContent = pending ? `${pending} report${pending === 1 ? "" : "s"} waiting to send` : "";
  }
  window.addEventListener("outbox:change", (event) => showOutboxPending(event.detail.pending));
  outboxList().then((items) => showOutboxPending(items.length));
}

function bindReportPhotoInput(input) {
  if (!input) return;
  const status = input.closest(".report-photo-field")?.querySelector(".report-photo-status");
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!status) return;
    status.textContent = file ? `Photo ready: ${file.name}` : "";
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
}

// Modern phone photos are much larger than an issue report needs. Scale them down before
// posting so a tree-tag picture works on ordinary mobile connections and within function limits.
async function prepareReportPhoto(file) {
  if (!file) return null;
  if (!String(file.type || "").startsWith("image/")) throw new Error("Please choose an image file.");
  try {
    const image = await createImageBitmap(file);
    const longestSide = Math.max(image.width, image.height);
    const scale = Math.min(1, 1600 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    image.close();
    if (blob && blob.size <= REPORT_PHOTO_MAX_BYTES) {
      return { contentType: "image/jpeg", dataUrl: await readFileAsDataUrl(blob) };
    }
  } catch {
    // Some phones expose HEIC files that this browser cannot draw. A modest original still
    // works, and a larger one gets a clear message instead of silently dropping the evidence.
  }
  if (file.size > REPORT_PHOTO_MAX_BYTES) throw new Error("That photo is too large. Please choose a smaller image.");
  return { contentType: file.type, dataUrl: await readFileAsDataUrl(file) };
}

function setReportStatus(message, tone = "", issueUrl = null) {
  const statusEl = document.getElementById("reportStatus");
  if (!statusEl) return;
  applyReportStatusContent(statusEl, message, tone, issueUrl);
}

// Shared by the full Report screen (setReportStatus) and the inline per-location form
// (submitLocationIssueReport): builds the status line via DOM APIs rather than a template
// string, so the filed GitHub issue's URL renders as a real clickable link instead of dead
// text the user has to select and copy, while everything else in the message stays plain
// text -- .textContent/.createElement escape it automatically, no innerHTML involved.
function applyReportStatusContent(statusEl, message, tone, issueUrl) {
  statusEl.textContent = message || "";
  statusEl.classList.remove("error", "success");
  if (tone) statusEl.classList.add(tone);
  if (issueUrl && /^https:\/\//.test(issueUrl)) {
    statusEl.append(" ");
    const link = document.createElement("a");
    link.href = issueUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View issue";
    statusEl.append(link);
  }
}

function currentReportLocation() {
  const sourceLocation = state.reportDraftLocation || state.userLocation;
  if (!sourceLocation) return null;
  return {
    latitude: Number(sourceLocation.latitude.toFixed(6)),
    longitude: Number(sourceLocation.longitude.toFixed(6)),
  };
}

function updateReportLocationLabel() {
  const locationLabel = document.getElementById("reportLocationLabel");
  if (!locationLabel) return;
  const loc = currentReportLocation();
  if (!loc) {
    locationLabel.hidden = true;
    return;
  }
  locationLabel.hidden = false;
  locationLabel.textContent = `📍 ${loc.latitude}, ${loc.longitude}`;
}

async function populateReportLocation() {
  // hasRealLocation(), not state.userLocation's bare truthiness: a report drafted while only
  // DEFAULT_LOCATION's High Beach stand-in is active should still try for the real fix the
  // report is actually about, rather than silently settling for an anchor the reader was never
  // actually standing at.
  if (hasRealLocation()) return;
  if (!Native.geolocation) return;
  // Only when it answers silently: opening the feedback form must never be what puts a location
  // prompt on screen. A report without a position is still a report.
  if (await Native.locationPermissionState() !== "granted") return;
  await new Promise((resolve) => {
    Native.geolocation.getCurrentPosition((position) => {
      state.reportDraftLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      resolve();
    }, resolve, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

function generateRequestId() {
  return (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateReportRequestId() {
  try {
    const existing = localStorage.getItem(REPORT_REQUEST_ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = generateRequestId();
  try { localStorage.setItem(REPORT_REQUEST_ID_KEY, id); } catch {}
  return id;
}

async function sendOrQueueReport(payload) {
  const url = "/.netlify/functions/report-missing-data";
  if (typeof communityDeviceId === "function") {
    payload.deviceId = communityDeviceId();
    if (typeof communityNoteFeedback === "function") communityNoteFeedback(payload);
  }
  const queue = async () => {
    await outboxAdd({ id: payload.requestId, url, payload });
    return { queued: true };
  };
  if (!navigator.onLine) return queue();
  const TIMED_OUT = Symbol("timed-out");
  // Abandoned on timeout, so only the outbox's copy is still in flight (the server also refuses a second
  // copy of the same requestId that is being filed; see report-missing-data).
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => { if (controller) controller.abort(); resolve(TIMED_OUT); }, REPORT_SEND_TIMEOUT_MS);
  });
  const send = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...(controller ? { signal: controller.signal } : {}),
  }).then(async (response) => ({ response, data: await response.json().catch(() => ({})) }), () => null);
  const result = await Promise.race([send, timeout]);
  clearTimeout(timeoutId);
  const serverDown = result && result !== TIMED_OUT && (result.response.status >= 500 || result.response.status === 408);
  if (result && result !== TIMED_OUT && !serverDown) return result;
  // Failed or timed out: keep a copy in the outbox (same requestId, so the server files it once) and
  // let the outbox send it again when the connection allows.
  return queue();
}

function reportQueuedMessage() {
  return typeof outboxIsDurable === "function" && !outboxIsDurable() ? REPORT_QUEUED_VOLATILE_MESSAGE : REPORT_QUEUED_MESSAGE;
}

async function submitReportForm() {
  // Guard against duplicate GitHub issues from double-taps or a submit
  // firing again while the previous request is still in flight.
  if (state.reportSubmitting) return;

  const reportDetailsInput = document.getElementById("reportDetails");
  if (!reportDetailsInput) return;

  const details = String(reportDetailsInput.value || "").trim();
  if (!details) {
    setReportStatus("Please add details before submitting.", "error");
    return;
  }

  // Claim the submission before awaiting photo processing: even an empty-photo async
  // preparation yields once, which otherwise lets two rapid submit events both proceed.
  state.reportSubmitting = true;
  // Answer the tap at once: preparing a phone photo can take seconds, and a blank button reads as broken.
  const submitButton = document.getElementById("reportSubmit");
  if (submitButton) submitButton.disabled = true;
  setReportStatus("Saving your report…");
  let photo;
  try {
    photo = await prepareReportPhoto(document.getElementById("reportPhoto")?.files?.[0]);
  } catch (error) {
    state.reportSubmitting = false;
    if (submitButton) submitButton.disabled = false;
    setReportStatus(error.message || "Could not prepare that photo.", "error");
    return;
  }

  const payload = {
    reportType: "feedback",
    details,
    location: currentReportLocation(),
    appVersion: state.swVersion || APP_VERSION,
    userAgent: navigator.userAgent,
    pageUrl: window.location.href,
    // Stable per-report ID: stays the same across retries of this same
    // report so the server can recognise and skip a resubmission.
    requestId: getOrCreateReportRequestId(),
    photo,
  };

  try {
    const { queued, response, data } = await sendOrQueueReport(payload);
    if (!queued && !response.ok) {
      const errorText = data && data.error ? data.error : `Request failed (${response.status})`;
      setReportStatus(errorText, "error");
      return;
    }

    if (queued) setReportStatus(reportQueuedMessage(), "success");
    else setReportStatus("Report submitted successfully.", "success", data && data.issueUrl);
    reportDetailsInput.value = "";
    const photoInput = document.getElementById("reportPhoto");
    if (photoInput) {
      photoInput.value = "";
      const photoStatus = photoInput.closest(".report-photo-field")?.querySelector(".report-photo-status");
      if (photoStatus) photoStatus.textContent = "";
    }
    try {
      localStorage.removeItem(REPORT_DRAFT_KEY);
      localStorage.removeItem(REPORT_REQUEST_ID_KEY);
    } catch {}
  } catch (error) {
    setReportStatus("Could not submit report. Please try again.", "error");
  } finally {
    state.reportSubmitting = false;
    if (submitButton) submitButton.disabled = false;
  }
}

// The inline "Noticed a problem with this location?" form on a tree/landmark detail screen
// (reportIssueHtml, js/inspector.js). Expands in place rather than navigating to the full
// Report screen, and posts the flagged item's own coordinates (carried on the wrapper's
// dataset) instead of the reporter's GPS fix, plus a locationContext identifying which item
// it was. There is no persisted draft here -- unlike the full Report screen's form, this one
// is opened, filled and submitted (or abandoned) in one sitting, so a fresh request ID per
// open is enough for double-tap/retry safety without localStorage.
function locationIssueFormHtml() {
  const online = navigator.onLine;
  // Wrapped in .report-form (display:grid; gap:10px, same as the full Report screen's own
  // form) rather than left as bare stacked elements -- without that gap the textarea's
  // focus-visible outline (base.css, 3px solid + 2px offset) had nothing to clear and bled
  // up over the question text sitting flush above it.
  return `<div class="report-form">
      <p class="report-issue-question">What's wrong with this location?</p>
      <textarea class="report-textarea" placeholder="Describe the problem…"></textarea>
      ${reportPhotoFieldHtml("locationIssuePhoto")}
      <p class="report-status" aria-live="polite"></p>
      <p class="report-note report-offline-note"${online ? " hidden" : ""}>You're offline. Your report will be saved and sent automatically when you're back online.</p>
      <div class="report-form-actions">
        <button class="button button-ghost" type="button" data-action="cancel-location-issue">Cancel</button>
        <button class="button" type="button" data-action="submit-location-issue">Submit</button>
      </div>
    </div>`;
}

function toggleLocationIssueForm(toggleButton) {
  const wrapper = toggleButton.closest(".report-issue");
  if (!wrapper) return;
  wrapper.innerHTML = locationIssueFormHtml();
  const textarea = wrapper.querySelector(".report-textarea");
  bindReportPhotoInput(wrapper.querySelector(".report-photo-input"));
  if (textarea) {
    textarea.focus();
    textarea.scrollIntoView({ block: "nearest" });
  }
}

function cancelLocationIssueForm(wrapper) {
  if (!wrapper) return;
  wrapper.innerHTML = `<button class="report-issue-toggle" type="button" data-action="report-issue">Noticed a problem with this location?</button>`;
}

async function submitLocationIssueReport(wrapper) {
  if (!wrapper || wrapper.dataset.submitting === "true") return;

  const textarea = wrapper.querySelector(".report-textarea");
  const statusEl = wrapper.querySelector(".report-status");
  const submitButton = wrapper.querySelector("[data-action='submit-location-issue']");
  if (!textarea || !statusEl) return;

  const details = String(textarea.value || "").trim();
  if (!details) {
    statusEl.textContent = "Please describe the problem before submitting.";
    statusEl.className = "report-status error";
    return;
  }

  wrapper.dataset.submitting = "true";
  let photo;
  try {
    photo = await prepareReportPhoto(wrapper.querySelector(".report-photo-input")?.files?.[0]);
  } catch (error) {
    wrapper.dataset.submitting = "false";
    statusEl.textContent = error.message || "Could not prepare that photo.";
    statusEl.className = "report-status error";
    return;
  }

  if (!wrapper.dataset.requestId) wrapper.dataset.requestId = generateRequestId();

  const payload = {
    reportType: "location-issue",
    details,
    location: {
      latitude: Number(Number(wrapper.dataset.reportLat).toFixed(6)),
      longitude: Number(Number(wrapper.dataset.reportLon).toFixed(6)),
    },
    locationContext: {
      type: wrapper.dataset.reportType || "",
      name: wrapper.dataset.reportName || "",
    },
    appVersion: state.swVersion || APP_VERSION,
    userAgent: navigator.userAgent,
    pageUrl: window.location.href,
    requestId: wrapper.dataset.requestId,
    photo,
  };

  if (submitButton) submitButton.disabled = true;
  statusEl.textContent = "Submitting report…";
  statusEl.className = "report-status";

  try {
    const { queued, response, data } = await sendOrQueueReport(payload);
    if (!queued && !response.ok) {
      const errorText = data && data.error ? data.error : `Request failed (${response.status})`;
      statusEl.textContent = errorText;
      statusEl.className = "report-status error";
      return;
    }

    if (queued) applyReportStatusContent(statusEl, reportQueuedMessage(), "success");
    else applyReportStatusContent(statusEl, "Report submitted successfully.", "success", data && data.issueUrl);
    textarea.value = "";
    const photoInput = wrapper.querySelector(".report-photo-input");
    if (photoInput) photoInput.value = "";
    // The form stays open, so the next report in it is a new one: it needs its own id (the same id
    // would be answered as a duplicate of this one, or replace it in the outbox).
    delete wrapper.dataset.requestId;
  } catch (error) {
    statusEl.textContent = "Could not submit report. Please try again.";
    statusEl.className = "report-status error";
  } finally {
    wrapper.dataset.submitting = "false";
    if (submitButton) submitButton.disabled = false;
  }
}
