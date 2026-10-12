(() => {
  "use strict";
  const VERSION = "20261012-reason-labels-v8";
  // The original eleven task videos retain their existing playback display.
  // Coverage-window changes apply only to the four subsequently added tasks.
  const COVERAGE_HOLD_TASKS = new Set(["box02", "pick_and_place01", "pick_and_place02", "pick_and_place03"]);
  const usesCoverageHold = (item) => COVERAGE_HOLD_TASKS.has(item.task_slug);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Recover each clip's GT/estimate overlap rather than stretching a partial
  // estimate over the full recording. Different recordings share GT progress.
  function mappedClipTime(position, rowDuration, timeline, mediaDuration) {
    const start = Number(timeline?.start_fraction ?? 0), end = Number(timeline?.end_fraction ?? 1);
    const span = end - start;
    const lastFrame = Math.min(Number(timeline?.last_frame_s ?? mediaDuration), mediaDuration);
    if (!(span > 0) || !(lastFrame > 0)) return null;
    const local = (position / rowDuration - start) / span;
    return { time: clamp(local, 0, 1) * lastFrame, rate: lastFrame / (rowDuration * span),
      inside: local >= 0 && local < 1, phase: local < 0 ? "Not started" : local >= 1 ? "Trajectory ended" : "" };
  }
  function coverageNotice(item, target) {
    if (item.status === "recording_interrupted") return "Recording interrupted";
    if (item.status !== "rendered" || !usesCoverageHold(item)) return "";
    return target?.inside ? "" : "No trajectory coverage";
  }
  function coverageDetail(item, target) {
    if (item.status !== "rendered" || !usesCoverageHold(item) || target?.inside || !target) return "";
    return target.phase === "Not started"
      ? "The estimate has not started. The clip is held at its first frame with the complete GT reference visible."
      : "The estimate is held at its last recorded frame with the complete GT reference visible. No new estimated poses are supplied.";
  }
  function heldFramePath(item, target) {
    if (item.status !== "rendered" || !usesCoverageHold(item) || !item.poster || !target || target.inside) return "";
    return target.phase === "Not started" ? item.poster.replace(/_poster\.png$/, "_first.jpg") : item.poster;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { mappedClipTime, usesCoverageHold, coverageNotice, coverageDetail, heldFramePath };
  if (typeof document === "undefined") return;
  const matrix = document.getElementById("replayMatrix"), status = document.getElementById("replayMatrixStatus"), shell = document.getElementById("replayMatrixShell");
  if (!matrix || !status || !shell) return;
  const rows = [], clipsByVideo = new Map(), rowsByHeader = new Map();
  const versioned = (url) => url ? `${url}${url.includes("?") ? "&" : "?"}v=${VERSION}` : "";
  const clockLabel = (time) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  class RowClock {
    constructor(task, row, header) {
      Object.assign(this, { task, row, header, duration: task.presentation_duration_s || 16, position: 0, speed: 1,
        visible: false, paused: window.matchMedia("(prefers-reduced-motion: reduce)").matches, scrubbing: false, seekUntil: 0, clips: [] });
      this.createControls(); rows.push(this); rowsByHeader.set(header, this);
    }
    createControls() {
      const toolbar = element("div", "replay-row-controls");
      this.playButton = element("button", "replay-row-play"); this.playButton.type = "button";
      this.playButton.addEventListener("click", () => this.toggle());
      const restart = element("button", "replay-row-restart", "↺"); restart.type = "button";
      restart.setAttribute("aria-label", `Restart ${this.task.label} comparison`);
      restart.addEventListener("click", () => this.seek(0));
      const rate = element("select", "replay-row-rate"); rate.setAttribute("aria-label", `Playback speed for ${this.task.label}`);
      for (const speed of [0.5, 1, 2]) {
        const option = element("option", "", `${speed}×`); option.value = String(speed); option.selected = speed === 1; rate.appendChild(option);
      }
      rate.addEventListener("change", () => { this.speed = Number(rate.value); this.sync(true); });
      this.clock = element("span", "replay-row-time"); toolbar.append(this.playButton, restart, rate, this.clock);
      this.slider = element("input", "replay-row-timeline");
      Object.assign(this.slider, { type: "range", min: "0", max: String(this.duration), step: "0.01" });
      this.slider.setAttribute("aria-label", `Shared timeline for ${this.task.label}`);
      this.slider.addEventListener("input", () => this.seek(Number(this.slider.value)));
      this.slider.addEventListener("pointerdown", () => { this.scrubbing = true; });
      window.addEventListener("pointerup", () => { this.scrubbing = false; });
      window.addEventListener("pointercancel", () => { this.scrubbing = false; });
      this.header.append(toolbar, this.slider); this.updateControls();
    }
    addVideo(video, item, badge = null, methodWindow = null, heldFrame = null) {
      const clip = { video, item, badge, methodWindow, heldFrame, row: this, visible: false, error: false, playPending: false, retryAt: 0 };
      Object.assign(video, { muted: true, defaultMuted: true, playsInline: true, controls: false, loop: false, preload: "none", poster: versioned(item.poster) });
      video.dataset.syncStart = String(item.timeline?.start_fraction ?? 0); video.dataset.syncEnd = String(item.timeline?.end_fraction ?? 1);
      video.addEventListener("click", () => this.toggle());
      video.addEventListener("loadedmetadata", () => this.syncClip(clip, true));
      video.addEventListener("canplay", () => this.syncClip(clip, true));
      video.addEventListener("error", () => { clip.error = true; if (badge) badge.textContent = "Video unavailable"; this.header.dataset.mediaError = "true"; });
      clipsByVideo.set(video, clip); this.clips.push(clip); return clip;
    }
    load(clip) {
      if (!clip.video.getAttribute("src")) {
        // A visible paused clip must decode its synchronized covered frame
        // without calling play(). Off-screen clips still unload below.
        clip.video.preload = "auto";
        clip.video.src = versioned(clip.item.video); clip.video.load();
      }
    }
    setVisible(clip, visible) {
      clip.visible = visible;
      if (visible) { this.load(clip); this.syncClip(clip, true); }
      else {
        clip.video.pause();
        // Release off-screen decoder buffers. The row clock, not a retained
        // media player, owns progress; re-entry loads and seeks to that clock.
        if (clip.video.getAttribute("src")) { clip.video.preload = "none"; clip.video.removeAttribute("src"); clip.video.load(); }
      }
    }
    changeScene(clip, scene) {
      clip.video.pause(); Object.assign(clip, { item: scene, error: false, playPending: false, retryAt: 0 });
      clip.video.poster = versioned(scene.poster);
      clip.video.setAttribute("aria-label", `${this.task.label}, ${scene.label} scene recording`);
      clip.video.dataset.syncStart = String(scene.timeline.start_fraction); clip.video.dataset.syncEnd = String(scene.timeline.end_fraction);
      clip.video.removeAttribute("src"); if (clip.visible) this.load(clip);
    }
    toggle() {
      this.paused = !this.paused; this.clips.forEach((clip) => { clip.retryAt = 0; });
      this.updateControls(); this.sync(true);
    }
    seek(time) {
      this.position = clamp(time, 0, this.duration); this.seekUntil = performance.now() + 150;
      this.updateControls(); this.sync(true);
    }
    isWaiting() {
      return this.clips.some((clip) => {
        if (!clip.visible || clip.error || clip.item.status === "fail_video_table_cross") return false;
        const duration = clip.video.readyState >= 1 ? clip.video.duration : clip.item.timeline?.video_duration_s || this.duration;
        const target = mappedClipTime(this.position, this.duration, clip.item.timeline, duration);
        if (!target?.inside) return false;
        if (clip.video.readyState < 1) return true;
        return target?.inside && (clip.video.readyState < 3 || clip.video.seeking);
      });
    }
    updateControls() {
      this.playButton.textContent = this.paused ? "▶" : "Ⅱ";
      this.playButton.setAttribute("aria-label", `${this.paused ? "Play" : "Pause"} all videos for ${this.task.label}`);
      this.playButton.setAttribute("aria-pressed", String(!this.paused));
      this.slider.value = String(this.position); this.slider.setAttribute("aria-valuetext", `${Math.round(this.position / this.duration * 100)}% of the recording`);
      this.clock.textContent = `${clockLabel(this.position)} / ${clockLabel(this.duration)}`;
      this.row.dataset.time = this.position.toFixed(3); this.row.dataset.paused = String(this.paused);
    }
    syncClip(clip, force = false, waiting = false) {
      const video = clip.video;
      if (!clip.visible || clip.error) { video.pause(); return; }
      const duration = video.readyState >= 1 ? video.duration : clip.item.timeline?.video_duration_s || this.duration;
      const target = mappedClipTime(this.position, this.duration, clip.item.timeline, duration); if (!target) return;
      if (clip.methodWindow && clip.item.status === "rendered" && usesCoverageHold(clip.item)) {
        const notice = coverageNotice(clip.item, target);
        clip.methodWindow.dataset.coverage = notice ? "missing" : "covered";
        clip.methodWindow.dataset.coveragePhase = target.phase || "Covered";
        video.setAttribute("aria-hidden", String(Boolean(notice)));
        const frame = heldFramePath(clip.item, target);
        clip.heldFrame.hidden = !frame;
        if (frame && clip.heldFrame.getAttribute("src") !== versioned(frame)) clip.heldFrame.src = versioned(frame);
        if (notice) {
          // Retain a real boundary image while releasing the decoder. This
          // keeps GT and the observed estimate visible without inventing
          // poses, buffering uncovered time, or hanging an end/start seek.
          video.pause();
          if (video.getAttribute("src")) { video.removeAttribute("src"); video.load(); }
          return;
        }
        this.load(clip);
      }
      if (video.readyState < 1) { video.pause(); return; }
      const drift = Math.abs(video.currentTime - target.time);
      // 20 fps assets: realign at a seek/re-entry, and correct playback drift
      // above roughly one to two frames instead of seeking on every frame.
      if (!video.seeking && (force ? drift > 0.015 : drift > 0.085)) video.currentTime = target.time;
      const rate = clamp(target.rate * this.speed, 0.0625, 16);
      if (Math.abs(video.playbackRate - rate) > 1e-6) video.playbackRate = rate;
      const canRun = this.visible && !this.paused && !this.scrubbing && !document.hidden && target.inside;
      // Buffering holds the shared clock and buffered peers; the waiting clip
      // may still fetch data. It never gets its own independent playback clock.
      const shouldPlay = canRun && (!waiting || video.readyState < 3);
      if (shouldPlay && video.paused && !clip.playPending && performance.now() >= clip.retryAt) {
        clip.playPending = true;
        video.play().catch((error) => {
          if (error.name === "AbortError") return; // A shared pause/seek cancelled a pending play.
          clip.retryAt = Infinity; this.paused = true; this.updateControls();
        })
          .finally(() => { clip.playPending = false; });
      } else if (!shouldPlay && !video.paused) video.pause();
    }
    sync(force = false) {
      const waiting = this.isWaiting(); this.row.dataset.buffering = String(waiting);
      this.clips.forEach((clip) => this.syncClip(clip, force, waiting));
    }
    tick(delta, now) {
      if (!this.visible) return;
      const running = !this.paused && !this.scrubbing && !document.hidden && !this.isWaiting() && now >= this.seekUntil;
      let wrapped = false;
      if (running) { this.position += delta * this.speed; if (this.position >= this.duration) { this.position %= this.duration; wrapped = true; } }
      this.updateControls(); this.sync(wrapped);
    }
  }

  function videoCell(item, row) {
    const fail = ["fail_video_table_cross", "no_trajectory"].includes(item.status), unavailable = item.status !== "rendered" && !fail;
    const cell = element("article", `replay-cell ${fail ? "is-fail" : unavailable ? "is-unavailable" : "is-rendered"}`);
    cell.setAttribute("role", "cell"); cell.dataset.task = item.task_slug; cell.dataset.method = item.method_slug; cell.dataset.status = item.status;
    const meta = element("div", "replay-cell-meta"), metric = element("span", "replay-metric", fail ? "×" : item.metric || "—");
    const badge = element("span", "replay-badge", fail ? "Fail" : unavailable ? item.status_title || "Unavailable" : "Rendered");
    if (item.note) metric.title = item.note;
    if (item.video) {
      const video = document.createElement("video"); video.setAttribute("aria-label", `${item.task}, ${item.method}. Controlled by the shared task timeline.`);
      const methodWindow = element("div", "replay-video-window");
      const initial = mappedClipTime(row.position, row.duration, item.timeline, item.timeline?.video_duration_s || row.duration);
      const notice = coverageNotice(item, initial);
      methodWindow.dataset.coverage = notice ? "missing" : "covered";
      methodWindow.dataset.coveragePhase = initial?.phase || "Covered";
      methodWindow.appendChild(video);
      let heldFrame = null;
      if (item.status === "rendered" && usesCoverageHold(item)) {
        heldFrame = element("img", "replay-held-frame");
        heldFrame.alt = `${item.task}, ${item.method}: recorded boundary frame with complete GT reference; no new estimate at this time.`;
        heldFrame.loading = "lazy"; heldFrame.decoding = "async";
        const frame = heldFramePath(item, initial); heldFrame.hidden = !frame;
        if (frame) { heldFrame.src = versioned(frame); video.setAttribute("aria-hidden", "true"); }
        methodWindow.appendChild(heldFrame);
      }
      cell.appendChild(methodWindow); row.addVideo(video, item, badge, methodWindow, heldFrame);
    } else {
      // Missing/invalid evidence is a reason-labelled tile, never a synthetic
      // successful video and never an independent clock or buffering source.
      const panel = element("div", "replay-status-panel"); panel.setAttribute("role", "img");
      panel.setAttribute("aria-label", `${item.task}, ${item.method}: ${item.status_detail || item.status_title || "No clip available"}`);
      panel.append(element("strong", "replay-status-title", item.status_title || (fail ? "Fail" : "Unavailable")));
      cell.appendChild(panel);
    }
    meta.append(metric, badge); cell.appendChild(meta);
    if (unavailable && item.status_detail) cell.appendChild(element("div", "replay-cell-note replay-status-detail", item.status_detail));
    if (item.status === "rendered" && item.trajectory_outside_view) cell.appendChild(element("div", "replay-cell-note replay-crop-note", "Trajectory outside the display window."));
    cell.appendChild(element("div", "replay-recording-label", item.recording_label || "")); return cell;
  }
  function build(data) {
    if (data.playback_version !== VERSION) throw new Error("Playback mapping is missing or stale.");
    const items = new Map(data.items.map((item) => [`${item.task_slug}::${item.method_slug}`, item]));
    const head = element("div", "replay-row replay-heading-row"); head.setAttribute("role", "row");
    const corner = element("div", "replay-corner", "Task / Method"); corner.setAttribute("role", "columnheader"); head.appendChild(corner);
    data.method_order.forEach((method) => { const cell = element("div", "replay-method-header", method.label); cell.setAttribute("role", "columnheader"); head.appendChild(cell); });
    matrix.replaceChildren(head);
    data.task_order.forEach((task) => {
      const rowNode = element("div", "replay-row"); rowNode.setAttribute("role", "row"); rowNode.dataset.task = task.slug;
      const header = element("div", "replay-task-header"); header.setAttribute("role", "rowheader"); header.appendChild(element("div", "replay-task-name", task.label));
      const selector = element("select", "replay-scene-selector"); selector.setAttribute("aria-label", `Scene recording for ${task.label}`);
      task.scenes.forEach((scene, i) => { const option = element("option", "", scene.label); option.value = String(i); selector.appendChild(option); });
      const sceneVideo = element("video", "replay-scene-video"); sceneVideo.setAttribute("aria-label", `${task.label}, ${task.scenes[0].label} scene recording`);
      header.append(selector, sceneVideo); const row = new RowClock(task, rowNode, header); const sceneClip = row.addVideo(sceneVideo, task.scenes[0]);
      selector.addEventListener("change", () => row.changeScene(sceneClip, task.scenes[Number(selector.value)]));
      rowNode.appendChild(header);
      data.method_order.forEach((method) => {
        const item = items.get(`${task.slug}::${method.slug}`);
        if (item) rowNode.appendChild(videoCell(item, row));
        else { const empty = element("div", "replay-cell replay-cell-empty", "No clip"); empty.setAttribute("role", "cell"); rowNode.appendChild(empty); }
      });
      matrix.appendChild(rowNode);
    });
    status.textContent = "Use each task's play button and timeline to control its scene and all methods together. Use keyboard ← / → to scroll horizontally.";
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const clip = clipsByVideo.get(entry.target); if (clip) clip.row.setVisible(clip, entry.isIntersecting);
        const row = rowsByHeader.get(entry.target);
        if (row) { row.visible = entry.isIntersecting; if (!row.visible) row.clips.forEach((c) => c.video.pause()); else row.sync(true); }
      });
    }, { threshold: 0.02 });
    rows.forEach((row) => { observer.observe(row.header); row.clips.forEach((clip) => observer.observe(clip.video)); });
    let last = performance.now();
    function tick(now) {
      const delta = Math.min(Math.max((now - last) / 1000, 0), 0.1); last = now;
      rows.forEach((row) => row.tick(delta, now)); requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", () => { last = performance.now(); rows.forEach((row) => row.sync(true)); });
  }
  shell.addEventListener("keydown", (event) => {
    if (event.target.closest("input, select, button") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); shell.scrollBy({ left: (event.key === "ArrowRight" ? 1 : -1) * Math.max(420, shell.clientWidth * 0.72), behavior: "smooth" });
  });
  fetch(versioned("assets/videos/replay_matrix_manifest.json"))
    .then((response) => { if (!response.ok) throw new Error("Comparison manifest unavailable."); return response.json(); })
    .then(build).catch((error) => { status.textContent = "Comparison matrix failed to load. Please reload the page."; console.error(error); });
})();
