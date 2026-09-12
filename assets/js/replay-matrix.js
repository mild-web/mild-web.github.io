const REPLAY_MATRIX_URL = "assets/videos/replay_matrix_manifest.json";

const replayMatrix = document.getElementById("replayMatrix");
const replayStatus = document.getElementById("replayMatrixStatus");
let replayObserver = null;

function statusLabel(status) {
  if (status === "fail_video_table_cross") {
    return "Fail";
  }
  if (status === "visualization_blocked") {
    return "Unavailable";
  }
  return "Rendered";
}

function statusClass(status) {
  if (status === "fail_video_table_cross") {
    return "is-fail";
  }
  if (status === "visualization_blocked") {
    return "is-unavailable";
  }
  return "is-rendered";
}

function createReplayVideoCell(item) {
  const cell = document.createElement("article");
  cell.className = `replay-cell ${statusClass(item.status)}`;
  cell.dataset.task = item.task_slug;
  cell.dataset.method = item.method_slug;
  cell.setAttribute("role", "cell");

  const video = document.createElement("video");
  video.controls = true;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.poster = item.poster;
  video.setAttribute("aria-label", `${item.task}, ${item.method}`);

  const source = document.createElement("source");
  source.src = item.video;
  source.type = "video/mp4";
  video.appendChild(source);

  const meta = document.createElement("div");
  meta.className = "replay-cell-meta";

  const metric = document.createElement("span");
  metric.className = "replay-metric";
  metric.textContent = item.metric || "—";

  const badge = document.createElement("span");
  badge.className = "replay-badge";
  badge.textContent = statusLabel(item.status);

  meta.append(metric, badge);
  cell.append(video, meta);
  return cell;
}

function buildReplayMatrix(data) {
  const itemsByKey = new Map();
  data.items.forEach((item) => {
    itemsByKey.set(`${item.task_slug}::${item.method_slug}`, item);
  });

  replayMatrix.replaceChildren();

  const corner = document.createElement("div");
  corner.className = "replay-corner";
  corner.textContent = "Task / Method";
  corner.setAttribute("role", "columnheader");
  replayMatrix.appendChild(corner);

  data.method_order.forEach((method) => {
    const header = document.createElement("div");
    header.className = "replay-method-header";
    header.textContent = method.label;
    header.setAttribute("role", "columnheader");
    replayMatrix.appendChild(header);
  });

  data.task_order.forEach((task) => {
    const taskHeader = document.createElement("div");
    taskHeader.className = "replay-task-header";
    taskHeader.textContent = task.label;
    taskHeader.setAttribute("role", "rowheader");
    replayMatrix.appendChild(taskHeader);

    data.method_order.forEach((method) => {
      const item = itemsByKey.get(`${task.slug}::${method.slug}`);
      if (item) {
        replayMatrix.appendChild(createReplayVideoCell(item));
      } else {
        const empty = document.createElement("div");
        empty.className = "replay-cell replay-cell-empty";
        empty.setAttribute("role", "cell");
        empty.textContent = "No clip";
        replayMatrix.appendChild(empty);
      }
    });
  });

  replayStatus.textContent = `${data.items.length} replay clips arranged as ${data.task_order.length} tasks × ${data.method_order.length} methods.`;
}

function setupReplayObserver() {
  if (replayObserver) {
    replayObserver.disconnect();
  }
  replayObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.42, rootMargin: "100px 0px" }
  );
  document.querySelectorAll(".replay-cell video").forEach((video) => replayObserver.observe(video));
}

if (replayMatrix && replayStatus) {
  fetch(REPLAY_MATRIX_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${REPLAY_MATRIX_URL}`);
      }
      return response.json();
    })
    .then((data) => {
      buildReplayMatrix(data);
      setupReplayObserver();
    })
    .catch((error) => {
      replayStatus.textContent = "Replay matrix failed to load. Please check the manifest and assets.";
      console.error(error);
    });
}
