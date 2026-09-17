const REPLAY_ASSET_VERSION = "20260913-event-gt-interp-1s-v1";
const REPLAY_MATRIX_URL = `assets/videos/replay_matrix_manifest.json?v=${REPLAY_ASSET_VERSION}`;

const replayMatrix = document.getElementById("replayMatrix");
const replayStatus = document.getElementById("replayMatrixStatus");
const replayMatrixShell = document.getElementById("replayMatrixShell");
const replayScrollLeft = document.getElementById("replayScrollLeft");
const replayScrollRight = document.getElementById("replayScrollRight");
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
  video.poster = versionedReplayUrl(item.poster);
  video.setAttribute("aria-label", `${item.task}, ${item.method}`);

  const source = document.createElement("source");
  source.src = versionedReplayUrl(item.video);
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

function versionedReplayUrl(url) {
  if (!url) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${REPLAY_ASSET_VERSION}`;
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

  replayStatus.textContent = "Use the left and right arrows to slide the video matrix.";
}

function setupReplayScrollButtons() {
  if (!replayMatrixShell || !replayScrollLeft || !replayScrollRight) {
    return;
  }

  let holdFrame = null;
  let holdDirection = 0;
  let holdLastTime = 0;

  const scrollByOneView = (direction) => {
    replayMatrixShell.scrollBy({
      left: direction * Math.max(420, replayMatrixShell.clientWidth * 0.72),
      behavior: "smooth",
    });
  };

  const stopHoldScroll = () => {
    if (holdFrame) {
      cancelAnimationFrame(holdFrame);
      holdFrame = null;
    }
    holdDirection = 0;
    holdLastTime = 0;
  };

  const stepHoldScroll = (time) => {
    if (!holdDirection) {
      return;
    }
    const deltaTime = holdLastTime ? time - holdLastTime : 16;
    holdLastTime = time;
    replayMatrixShell.scrollLeft += holdDirection * deltaTime * 1.15;
    holdFrame = requestAnimationFrame(stepHoldScroll);
  };

  const startHoldScroll = (event, direction) => {
    event.preventDefault();
    stopHoldScroll();
    holdDirection = direction;
    holdFrame = requestAnimationFrame(stepHoldScroll);
  };

  const bindButton = (button, direction) => {
    button.addEventListener("click", () => scrollByOneView(direction));
    button.addEventListener("pointerdown", (event) => startHoldScroll(event, direction));
    button.addEventListener("pointerup", stopHoldScroll);
    button.addEventListener("pointercancel", stopHoldScroll);
    button.addEventListener("pointerleave", stopHoldScroll);
    button.addEventListener("blur", stopHoldScroll);
  };

  bindButton(replayScrollLeft, -1);
  bindButton(replayScrollRight, 1);
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
  setupReplayScrollButtons();
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
