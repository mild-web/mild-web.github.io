(() => {
  const byId = id => document.getElementById(id);
  const form = byId("uploadRunnerForm");
  if (!form) return;
  const fileInput = byId("uploadRecording"), consent = byId("uploadConsent"), convert = byId("uploadSubmit");
  const status = byId("uploadStatus"), indicator = byId("serviceIndicator"), dropzone = byId("uploadDropzone");
  const viewport = byId("trajectoryViewport"), placeholder = byId("trajectoryPlaceholder");
  const download = byId("downloadTrajectory"), share = byId("copyResultLink");
  const viewer = new window.TrajectoryViewer(byId("trajectoryCanvas"));
  const STORAGE = "mildUploadLastJob";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const api = String(window.MILD_SERVICE?.apiBase || (local ? location.origin : "")).replace(/\/+$/, "");
  let ready = false, selectedFile = null, job = null, epoch = 0, timer = null, uploading = false, starting = false;
  let maxBytes = 2 * 1024 ** 3, loadedJob = null, previewRequest = null;

  function setStatus(text, state = "idle") { status.textContent = text; status.dataset.state = state; }
  function remember(value) {
    try { value ? localStorage.setItem(STORAGE, JSON.stringify(value)) : localStorage.removeItem(STORAGE); } catch {}
  }
  function lockInputs(busy) {
    fileInput.disabled = busy; consent.disabled = busy;
    dropzone.dataset.busy = String(busy);
  }
  function canConvert() { return Boolean(ready && job?.can_convert && consent.checked && !starting && !uploading); }
  function updateButton() { convert.disabled = !canConvert(); }
  function showView(state, title, detail) {
    viewport.dataset.state = state; placeholder.hidden = false;
    byId("trajectoryStateTitle").textContent = title;
    byId("trajectoryStateDetail").textContent = detail;
    byId("trajectoryReset").hidden = true; byId("trajectoryControlsHint").hidden = true;
  }
  function clearResult() {
    previewRequest?.abort(); previewRequest = null;
    loadedJob = null; viewer.clear();
    download.removeAttribute("href"); download.setAttribute("aria-disabled", "true"); download.tabIndex = -1;
    share.hidden = true; share.textContent = "Copy result link";
    byId("trajectorySummary").textContent = "3D preview · IMU/body position in meters";
    showView("empty", "Your trajectory will appear here", "Check your recording, then click Convert.");
  }
  function renderChecks(checks = []) {
    const rows = new Map(checks.map(row => [row.id, row]));
    for (const element of byId("uploadChecks").children) {
      const row = rows.get(element.dataset.check);
      element.dataset.state = row?.state || "pending";
      element.querySelector("small").textContent = row?.message || "";
    }
  }
  function resultURL(id) {
    const url = new URL(location.href); url.searchParams.set("job", id); url.hash = "upload-x5-data";
    return url;
  }
  function setJobLink(id) {
    remember({ apiBase: api, jobId: id });
    history.replaceState(null, "", resultURL(id));
  }
  function stopPolling() { epoch += 1; clearTimeout(timer); timer = null; }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(api + path, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(typeof body.detail === "string" ? body.detail : `Request could not complete (${response.status}). Please try again.`);
        error.status = response.status; throw error;
      }
      return body;
    } finally { clearTimeout(timeout); }
  }

  async function showResult(result) {
    const tum = result.artifact_urls?.["trajectory.tum"];
    if (!tum || loadedJob === result.job_id) return;
    loadedJob = result.job_id;
    download.href = api + tum; download.setAttribute("aria-disabled", "false"); download.tabIndex = 0;
    download.setAttribute("download", "trajectory.tum"); share.hidden = false;
    showView("loading", "Loading your trajectory…", "The TUM download is ready.");
    const controller = new AbortController(); previewRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(api + tum, { signal: controller.signal });
      if (!response.ok) throw new Error("The preview could not load. You can still download the trajectory.");
      const text = await response.text();
      if (job?.job_id !== result.job_id) return;
      const summary = viewer.load(text);
      placeholder.hidden = true; viewport.dataset.state = "succeeded";
      byId("trajectoryReset").hidden = false; byId("trajectoryControlsHint").hidden = false;
      byId("trajectoryControlsHint").textContent = matchMedia("(pointer: coarse)").matches
        ? "One finger: rotate · Two fingers: pan / zoom" : "Drag to rotate · Shift-drag to pan · Scroll to zoom";
      byId("trajectorySummary").textContent = `${summary.poses.toLocaleString()} poses · ${summary.duration.toFixed(1)} s · IMU/body position in meters`;
    } catch (error) {
      if (job?.job_id !== result.job_id) return;
      showView("failed", "Preview unavailable", error.name === "AbortError" ? "The preview timed out. Your TUM download is ready." : error.message);
    } finally { clearTimeout(timeout); }
  }

  function renderJob(result) {
    job = result;
    renderChecks(result.validation?.checks);
    consent.checked = true; // Every saved job was accepted with explicit retention consent.
    if (result.filename) byId("uploadFileLabel").textContent = result.filename;
    const active = ["created", "validation_queued", "validating", "queued", "running"].includes(result.status);
    lockInputs(active);
    updateButton();
    if (result.status === "validation_queued" || result.status === "created") {
      setStatus("Uploaded. Waiting to check your recording…", "validation_queued");
    } else if (result.status === "validating") {
      setStatus("Checking your recording…", "validating");
    } else if (result.status === "ready") {
      setStatus(result.can_convert ? "All checks passed. Ready to convert." : "Finishing checks…", "ready");
      byId("uploadFileDetail").textContent = "Checked · choose another ZIP to replace";
    } else if (result.status === "invalid") {
      setStatus("Fix the highlighted check, then upload the corrected ZIP.", "invalid");
      byId("uploadFileDetail").textContent = "Choose a corrected recording";
    } else if (result.status === "queued") {
      setStatus("Recording checked. Conversion is queued.", "queued");
      byId("uploadFileDetail").textContent = "Recording saved · conversion queued";
      showView("queued", "Waiting to convert…", "Your recording is saved. Processing starts when the worker is available.");
    } else if (result.status === "running") {
      setStatus("Recording checked. Converting on the server.", "running");
      byId("uploadFileDetail").textContent = "Recording saved · converting";
      showView("running", "Building your trajectory…", "This can take a few minutes. You can return using this page’s link.");
    } else if (result.status === "succeeded") {
      setStatus("Conversion complete. Explore or download your trajectory.", "succeeded");
      byId("uploadFileDetail").textContent = "Complete · choose another ZIP to start again";
      showResult(result);
    } else if (result.status === "failed") {
      setStatus(result.error || "Processing could not complete. Please check your recording and try again.", "failed");
      showView("failed", "Conversion could not complete", result.error || "Check the recording and upload it again.");
    }
  }

  async function poll(id, token, failures = 0) {
    try {
      const result = await request(`/api/jobs/${id}`);
      if (token !== epoch) return;
      renderJob(result);
      if (["succeeded", "invalid", "failed"].includes(result.status) || (result.status === "ready" && result.can_convert)) return;
      timer = setTimeout(() => poll(id, token), result.status === "running" ? 2200 : 1000);
    } catch (error) {
      if (token !== epoch) return;
      convert.disabled = true;
      if ([401, 403, 404, 410].includes(error.status)) {
        setStatus("This recording link is unavailable. Choose a new ZIP to begin.", "failed");
        lockInputs(false); return;
      }
      setStatus("Connection interrupted. Your recording is saved; reconnecting…", "waiting");
      timer = setTimeout(() => poll(id, token, failures + 1), Math.min(15000, 1500 * 2 ** Math.min(failures, 4)));
    }
  }
  function watch(id) { stopPolling(); setJobLink(id); poll(id, epoch); }

  async function uploadSelected() {
    if (!selectedFile || job || uploading) return;
    if (!consent.checked) { setStatus("Review the data-use agreement to upload and check this recording."); return; }
    if (!ready) { setStatus("The service is temporarily offline. Your file has not been uploaded.", "waiting"); return; }
    uploading = true; lockInputs(true); updateButton();
    const data = new FormData();
    data.append("recording", selectedFile); data.append("consent", "true");
    data.append("sensor_route", "insta360_x5");
    // The PDF's 180 mm image contains a 108 mm detection border (6/10 cells).
    data.append("tag_size_m", String((window.TAG_CUSTOM48H12?.printedWidthAtBorderMm || 108) / 1000));
    setStatus("Uploading your recording…", "uploading");
    try {
      const body = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", api + "/api/jobs"); xhr.responseType = "json"; xhr.timeout = 1800000;
        xhr.upload.onprogress = event => {
          const percent = event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null;
          setStatus(percent === 100 ? "Upload sent. Saving your recording…" : `Uploading${percent !== null ? ` · ${percent}%` : "…"}`, "uploading");
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) :
          reject(new Error(typeof xhr.response?.detail === "string" ? xhr.response.detail : "Upload could not complete. Choose the file to try again."));
        xhr.onerror = () => reject(new Error("The upload connection was interrupted. Choose the ZIP again to retry."));
        xhr.ontimeout = () => reject(new Error("The upload timed out. Check your connection and choose the ZIP again."));
        xhr.send(data);
      });
      if (!body?.job_id) throw new Error("The service did not return a recording ID. Please try again.");
      renderJob(body); watch(body.job_id);
    } catch (error) { setStatus(error.message, "failed"); lockInputs(false); }
    finally { uploading = false; updateButton(); }
  }

  function chooseFile(file) {
    if (!file || fileInput.disabled) return;
    stopPolling(); job = null; selectedFile = null; remember(null); clearResult(); renderChecks();
    const url = new URL(location.href); url.searchParams.delete("job"); history.replaceState(null, "", url);
    byId("uploadFileLabel").textContent = file.name;
    byId("uploadFileDetail").textContent = `${(file.size / 1024 ** 2).toFixed(1)} MB · ready to upload`;
    updateButton();
    if (!file.name.toLowerCase().endsWith(".zip") || file.size > maxBytes || !file.size) {
      setStatus(`Choose a non-empty X5 SDK ZIP no larger than ${Math.round(maxBytes / 1024 ** 2)} MiB.`, "invalid"); return;
    }
    selectedFile = file; uploadSelected();
  }
  fileInput.addEventListener("change", () => chooseFile(fileInput.files[0]));
  // Selecting the same corrected filename should dispatch change again.
  fileInput.addEventListener("click", () => { fileInput.value = ""; });
  consent.addEventListener("change", () => { updateButton(); uploadSelected(); });
  for (const type of ["dragenter", "dragover"]) dropzone.addEventListener(type, event => {
    event.preventDefault(); if (!fileInput.disabled) dropzone.classList.add("is-over");
  });
  for (const type of ["dragleave", "drop"]) dropzone.addEventListener(type, event => {
    event.preventDefault(); dropzone.classList.remove("is-over");
    if (type === "drop" && !fileInput.disabled) {
      if (event.dataTransfer.files.length !== 1) setStatus("Choose one recording ZIP at a time.", "invalid");
      else chooseFile(event.dataTransfer.files[0]);
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (!canConvert()) return;
    const id = job.job_id;
    starting = true; lockInputs(true); updateButton();
    showView("queued", "Starting conversion…", "Preparing your checked recording.");
    try {
      const result = await request(`/api/jobs/${id}/start`, { method: "POST" });
      renderJob(result); watch(result.job_id);
    } catch (error) {
      setStatus(error.message, "waiting");
      showView("empty", "Conversion has not been confirmed", "Checking the saved recording. You will be able to retry if it has not started.");
      watch(id);
    } finally { starting = false; updateButton(); }
  });
  byId("trajectoryReset").addEventListener("click", () => viewer.reset());
  share.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(resultURL(job.job_id).href); share.textContent = "Link copied"; }
    catch { share.textContent = "Copy the address from your browser"; }
  });

  async function checkService() {
    const before = ready;
    try {
      if (!api) throw new Error("No endpoint");
      const health = await request("/api/health");
      ready = Boolean(health.ready && health.real_command_configured && !health.mock_without_command && health.upload_flow === "validate_then_convert_v1");
      maxBytes = health.max_upload_bytes || maxBytes;
    } catch { ready = false; }
    indicator.textContent = ready ? "Service online" : "Service offline";
    indicator.dataset.state = ready ? "online" : "offline";
    updateButton();
    if (ready && !before && selectedFile && !job && consent.checked) uploadSelected();
    setTimeout(checkService, 20000);
  }
  clearResult(); checkService();
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch {}
  const linked = new URL(location.href).searchParams.get("job");
  const id = linked || (saved?.apiBase === api ? saved.jobId : null);
  if (api && /^[a-f0-9]{32}$/.test(id || "")) {
    setStatus("Restoring your recording…", "waiting");
    byId("uploadFileDetail").textContent = "Restoring saved recording";
    lockInputs(true); watch(id);
    if (linked) {
      form.closest(".section")?.querySelector('.section-toggle[aria-expanded="false"]')?.click();
      byId("upload-x5-data").scrollIntoView();
    }
  }
})();
