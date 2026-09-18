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

const UPLOAD_API_STORAGE_KEY = "mildUploadApiBase";
const UPLOAD_JOB_STORAGE_KEY = "mildUploadLastJob";
let uploadPollTimer = null;

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
  title.textContent = "Available outputs";
  const list = document.createElement("div");
  list.className = "upload-artifact-list";
  for (const name of names) {
    const link = document.createElement("a");
    link.href = artifactUrl(apiBase, urls[name]);
    link.textContent = name;
    link.target = "_blank";
    link.rel = "noopener";
    list.append(link);
  }
  uploadArtifacts.replaceChildren(title, list);
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
  if (uploadPollTimer) {
    window.clearInterval(uploadPollTimer);
    uploadPollTimer = null;
  }
}

async function pollJob(apiBase, jobId) {
  try {
    const job = await fetchJob(apiBase, jobId);
    const status = job.status || "unknown";
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    setUploadStatus(`${label}: job ${jobId}`, status);
    renderArtifacts(apiBase, job);
    if (status === "succeeded" || status === "failed") {
      stopUploadPolling();
      uploadSubmit.disabled = false;
      if (status === "failed" && job.error) {
        setUploadStatus(`Failed: ${job.error}`, "failed");
      }
    }
  } catch (error) {
    stopUploadPolling();
    uploadSubmit.disabled = false;
    setUploadStatus(error.message, "failed");
  }
}

function startUploadPolling(apiBase, jobId) {
  stopUploadPolling();
  window.localStorage.setItem(UPLOAD_JOB_STORAGE_KEY, JSON.stringify({ apiBase, jobId }));
  pollJob(apiBase, jobId);
  uploadPollTimer = window.setInterval(() => pollJob(apiBase, jobId), 2200);
}

async function submitUpload(event) {
  event.preventDefault();
  const apiBase = normalizeApiBase(uploadApiBase?.value);
  if (!apiBase) {
    setUploadStatus("Please set the API endpoint.", "failed");
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

  window.localStorage.setItem(UPLOAD_API_STORAGE_KEY, apiBase);
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

function restoreUploadPanel() {
  if (!uploadForm) return;
  const storedApiBase = window.localStorage.getItem(UPLOAD_API_STORAGE_KEY);
  if (storedApiBase && uploadApiBase) {
    uploadApiBase.value = storedApiBase;
  }
  const lastJobRaw = window.localStorage.getItem(UPLOAD_JOB_STORAGE_KEY);
  if (lastJobRaw) {
    try {
      const lastJob = JSON.parse(lastJobRaw);
      if (lastJob.apiBase && lastJob.jobId) {
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
