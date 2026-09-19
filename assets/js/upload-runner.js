const uploadForm = document.getElementById("uploadRunnerForm");
const uploadApiBase = document.getElementById("uploadApiBase");
const uploadEmail = document.getElementById("uploadEmail");
const uploadTagSize = document.getElementById("uploadTagSize");
const uploadRecording = document.getElementById("uploadRecording");
const uploadNotes = document.getElementById("uploadNotes");
const uploadConsent = document.getElementById("uploadConsent");
const uploadSubmit = document.getElementById("uploadSubmit");
const uploadStatus = document.getElementById("uploadStatus");
const uploadArtifacts = document.getElementById("uploadArtifacts");

const UPLOAD_JOB_STORAGE_KEY = "mildUploadLastJob";
let uploadPollTimer = null;
let serviceReady = false;
let uploadPollEpoch = 0;

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function setUploadStatus(message, state = "idle") {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.dataset.state = state;
}

function artifactUrl(apiBase, url) {
  if (!url) return "#";
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiBase}${url}`;
}

function renderArtifacts(apiBase, job) {
  if (!uploadArtifacts) return;
  const urls = job.artifact_urls || {};
  const names = Object.keys(urls);
  if (!names.length) {
    uploadArtifacts.hidden = true;
    uploadArtifacts.replaceChildren();
    return;
  }
  const title = document.createElement("strong");
  title.textContent = job.processing_mode === "mock" ? "Test trajectory (mock)" : "Trajectory";
  const list = document.createElement("div");
  list.className = "upload-artifact-list";
  for (const name of names) {
    const link = document.createElement("a");
    link.href = artifactUrl(apiBase, urls[name]);
    link.textContent = name === "trajectory.tum" ? "Download TUM" : "Download ZIP";
    link.target = "_blank";
    link.rel = "noopener";
    list.append(link);
  }
  const returnLink = document.createElement("a");
  const resultPage = new URL(window.location.href);
  resultPage.searchParams.set("job", job.job_id);
  resultPage.hash = "upload-x5-data";
  returnLink.href = resultPage.href;
  returnLink.textContent = "Keep this result link";
  returnLink.className = "upload-result-link";
  const note = document.createElement("small");
  note.className = "upload-result-note";
  note.textContent = "Anyone with the result link can view this trajectory. Raw recordings are not downloadable.";
  uploadArtifacts.replaceChildren(title, list, returnLink, note);
  uploadArtifacts.hidden = false;
}

async function fetchJob(apiBase, jobId) {
  const response = await fetch(`${apiBase}/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Status request failed: ${response.status}`);
  }
  return response.json();
}

function stopUploadPolling() {
  uploadPollEpoch += 1;
  if (uploadPollTimer) {
    window.clearTimeout(uploadPollTimer);
    uploadPollTimer = null;
  }
}

async function pollJob(apiBase, jobId, epoch) {
  try {
    const job = await fetchJob(apiBase, jobId);
    if (epoch !== uploadPollEpoch) return;
    const status = job.status || "unknown";
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    const modeNote = job.processing_mode === "mock" ? " · Mock test output" : "";
    const summary = job.trajectory_summary;
    const resultNote = summary ? ` · ${summary.poses} poses · ${summary.output_hz.toFixed(2)} Hz output` : "";
    setUploadStatus(`${label}: job ${jobId}${modeNote}${resultNote}`, status);
    renderArtifacts(apiBase, job);
    if (status === "succeeded" || status === "failed") {
      stopUploadPolling();
      uploadSubmit.disabled = !serviceReady;
      if (status === "failed" && job.error) {
        setUploadStatus(`Failed: ${job.error}`, "failed");
      }
    } else {
      uploadPollTimer = window.setTimeout(() => pollJob(apiBase, jobId, epoch), 2200);
    }
  } catch (error) {
    if (epoch !== uploadPollEpoch) return;
    stopUploadPolling();
    uploadSubmit.disabled = !serviceReady;
    setUploadStatus(error.message, "failed");
  }
}

function startUploadPolling(apiBase, jobId) {
  stopUploadPolling();
  window.localStorage.setItem(UPLOAD_JOB_STORAGE_KEY, JSON.stringify({ apiBase, jobId }));
  const page = new URL(window.location.href);
  page.searchParams.set("job", jobId);
  window.history.replaceState(null, "", page);
  uploadSubmit.disabled = true;
  pollJob(apiBase, jobId, uploadPollEpoch);
}

async function submitUpload(event) {
  event.preventDefault();
  const apiBase = normalizeApiBase(uploadApiBase?.value);
  if (!apiBase || !serviceReady) {
    setUploadStatus("The processing service is not available yet. Please try again later.", "failed");
    return;
  }
  const file = uploadRecording?.files?.[0];
  if (!file) {
    setUploadStatus("Please choose an Insta360 X5 recording package.", "failed");
    return;
  }
  if (!uploadConsent?.checked) {
    setUploadStatus("Please confirm the data-retention consent before uploading.", "failed");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".zip") || file.size > 2 * 1024 ** 3) {
    setUploadStatus("Choose an X5 SDK ZIP package no larger than 2 GiB.", "failed");
    return;
  }
  const formData = new FormData();
  formData.append("recording", file);
  formData.append("consent", "true");
  formData.append("email", uploadEmail?.value || "");
  formData.append("sensor_route", "insta360_x5");
  formData.append("tag_size_m", uploadTagSize?.value || "0.108");
  formData.append("notes", uploadNotes?.value || "");

  uploadSubmit.disabled = true;
  setUploadStatus(`Uploading ${file.name}…`, "running");
  uploadArtifacts.hidden = true;
  uploadArtifacts.replaceChildren();

  try {
    const response = await fetch(`${apiBase}/api/jobs`, { method: "POST", body: formData });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || `Upload failed: ${response.status}`);
    }
    setUploadStatus(`Queued: job ${body.job_id}`, "queued");
    startUploadPolling(apiBase, body.job_id);
  } catch (error) {
    uploadSubmit.disabled = false;
    setUploadStatus(error.message, "failed");
  }
}

async function restoreUploadPanel() {
  if (!uploadForm) return;
  const configured = normalizeApiBase(window.MILD_SERVICE?.apiBase);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const apiBase = configured || (isLocal ? window.location.origin : "");
  if (!apiBase) {
    setUploadStatus("Hosted processing is not available yet. This page will enable uploads when the service is ready.", "idle");
    return;
  }
  uploadApiBase.value = apiBase;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${apiBase}/api/health`, { signal: controller.signal });
    const health = await response.json();
    if (!response.ok) {
      throw new Error("The processing API is unavailable. Please try again later.");
    }
    serviceReady = Boolean(health.ready && health.real_command_configured && !health.mock_without_command);
    uploadSubmit.disabled = !serviceReady;
    setUploadStatus(serviceReady ? "Service ready. Choose your X5 SDK package to begin." : "Processing is temporarily unavailable. Saved results can still be viewed.");
  } catch (error) {
    setUploadStatus(error.name === "AbortError" ? "The processing service did not respond. Please try again later." : error.message, "failed");
    return;
  } finally {
    window.clearTimeout(timeout);
  }
  const linkedJob = new URL(window.location.href).searchParams.get("job");
  if (linkedJob && /^[a-f0-9]{32}$/.test(linkedJob)) {
    uploadForm.closest(".section")?.querySelector('.section-toggle[aria-expanded="false"]')?.click();
    document.getElementById("upload-x5-data")?.scrollIntoView();
    startUploadPolling(apiBase, linkedJob);
    return;
  }
  const lastJobRaw = window.localStorage.getItem(UPLOAD_JOB_STORAGE_KEY);
  if (lastJobRaw) {
    try {
      const lastJob = JSON.parse(lastJobRaw);
      if (lastJob.apiBase === apiBase && /^[a-f0-9]{32}$/.test(lastJob.jobId || "")) {
        setUploadStatus(`Last job: ${lastJob.jobId}. Polling status…`, "queued");
        startUploadPolling(lastJob.apiBase, lastJob.jobId);
      }
    } catch {
      window.localStorage.removeItem(UPLOAD_JOB_STORAGE_KEY);
    }
  }
}

uploadForm?.addEventListener("submit", submitUpload);
restoreUploadPanel();
