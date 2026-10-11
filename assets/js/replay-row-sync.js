(() => {
  "use strict";
  const VERSION = "20261011-row-timeline-v1";
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
  if (typeof module !== "undefined" && module.exports) module.exports = { mappedClipTime };
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
    addVideo(video, item, badge = null) {
      const clip = { video, item, badge, row: this, visible: false, error: false, playPending: false, retryAt: 0 };
      Object.assign(video, { muted: true, defaultMuted: true, playsInline: true, controls: false, loop: false, preload: "none", poster: versioned(item.poster) });
      video.dataset.syncStart = String(item.timeline?.start_fraction ?? 0); video.dataset.syncEnd = String(item.timeline?.end_fraction ?? 1);
      video.addEventListener("click", () => this.toggle());
      video.addEventListener("loadedmetadata", () => this.syncClip(clip, true));
      video.addEventListener("canplay", () => this.syncClip(clip, true));
      video.addEventListener("error", () => { clip.error = true; if (badge) badge.textContent = "Video unavailable"; this.header.dataset.mediaError = "true"; });
      clipsByVideo.set(video, clip); this.clips.push(clip); return clip;
    }
    load(clip) {
      if (!clip.video.getAttribute("src")) { clip.video.src = versioned(clip.item.video); clip.video.load(); }
    }
    setVisible(clip, visible) {
      clip.visible = visible;
      if (visible) { this.load(clip); this.syncClip(clip, true); }
      else {
        clip.video.pause();
        // Release off-screen decoder buffers. The row clock, not a retained
        // media player, owns progress; re-entry loads and seeks to that clock.
        if (clip.video.getAttribute("src")) { clip.video.removeAttribute("src"); clip.video.load(); }
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
        if (clip.video.readyState < 1) return true;
        const target = mappedClipTime(this.position, this.duration, clip.item.timeline, clip.video.duration);
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
      if (!clip.visible || clip.error || video.readyState < 1) { video.pause(); return; }
      const target = mappedClipTime(this.position, this.duration, clip.item.timeline, video.duration); if (!target) return;
      const drift = Math.abs(video.currentTime - target.time);
      // 20 fps assets: realign at a seek/re-entry, and correct playback drift
      // above roughly one to two frames instead of seeking on every frame.
      if (!video.seeking && (force ? drift > 0.015 : drift > 0.085)) video.currentTime = target.time;
      const rate = clamp(target.rate * this.speed, 0.0625, 16);
      if (Math.abs(video.playbackRate - rate) > 1e-6) video.playbackRate = rate;
      if (clip.badge && clip.item.status === "rendered") {
        clip.badge.textContent = target.phase || "Rendered"; clip.badge.classList.toggle("is-ended", Boolean(target.phase));
      }
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
    const fail = item.status === "fail_video_table_cross", unavailable = item.status === "visualization_blocked";
    const cell = element("article", `replay-cell ${fail ? "is-fail" : unavailable ? "is-unavailable" : "is-rendered"}`);
    cell.setAttribute("role", "cell"); cell.dataset.task = item.task_slug; cell.dataset.method = item.method_slug;
    const video = document.createElement("video"); video.setAttribute("aria-label", `${item.task}, ${item.method}. Controlled by the shared task timeline.`);
    const meta = element("div", "replay-cell-meta"), metric = element("span", "replay-metric", item.metric || "—");
    const badge = element("span", "replay-badge", fail ? "Fail" : unavailable ? "Unavailable" : "Rendered");
    meta.append(metric, badge); cell.append(video, meta, element("div", "replay-recording-label", item.recording_label || ""));
    row.addVideo(video, item, badge); return cell;
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
