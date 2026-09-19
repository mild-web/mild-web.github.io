/* Equal-scale, orthographic 3D TUM viewer. No network or graphics dependencies. */
class TrajectoryViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = [];
    this.pointers = new Map();
    this.reset();
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", event => {
      if (!this.points.length) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    canvas.addEventListener("pointermove", event => {
      const old = this.pointers.get(event.pointerId);
      if (!old) return;
      const next = { x: event.clientX, y: event.clientY };
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(old.x - other.x, old.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        if (before > 2) this.zoom = Math.max(.15, Math.min(20, this.zoom * after / before));
        this.pan[0] += (next.x - old.x) / 2;
        this.pan[1] += (next.y - old.y) / 2;
      } else if (event.shiftKey || event.buttons === 2) {
        this.pan[0] += next.x - old.x;
        this.pan[1] += next.y - old.y;
      } else {
        this.yaw += (next.x - old.x) * .009;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (next.y - old.y) * .009));
      }
      this.pointers.set(event.pointerId, next);
      this.draw();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(type, event => this.pointers.delete(event.pointerId));
    }
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("wheel", event => {
      if (!this.points.length) return;
      event.preventDefault();
      this.zoom = Math.max(.15, Math.min(20, this.zoom * Math.exp(-event.deltaY * .0015)));
      this.draw();
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (!this.points.length) return;
      if (event.key === "ArrowLeft") this.yaw -= .1;
      else if (event.key === "ArrowRight") this.yaw += .1;
      else if (event.key === "ArrowUp") this.pitch = Math.min(1.5, this.pitch + .1);
      else if (event.key === "ArrowDown") this.pitch = Math.max(-1.5, this.pitch - .1);
      else if (["+", "="].includes(event.key)) this.zoom = Math.min(20, this.zoom * 1.1);
      else if (event.key === "-") this.zoom = Math.max(.15, this.zoom / 1.1);
      else if (event.key.toLowerCase() === "r") this.reset();
      else return;
      event.preventDefault();
      this.draw();
    });
  }

  clear() {
    this.points = [];
    this.pointers.clear();
    this.canvas.hidden = true;
    this.canvas.dataset.poses = "0";
  }

  reset() {
    this.yaw = -.7;
    this.pitch = .7;
    this.zoom = 1;
    this.pan = [0, 0];
    if (this.points.length) this.draw();
  }

  load(text) {
    const rows = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"))
      .map(line => line.trim().split(/\s+/).map(Number));
    if (rows.length < 2 || rows.length > 200000 || rows.some((row, i) => row.length !== 8 ||
        !row.every(Number.isFinite) || (i && row[0] <= rows[i - 1][0]))) {
      throw new Error("The trajectory could not be displayed. The TUM download is still available.");
    }
    this.points = rows.map(row => row.slice(1, 4));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.points) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]);
    }
    this.center = min.map((v, a) => (v + max[a]) / 2);
    this.extent = Math.max(.02, Math.hypot(...max.map((v, a) => v - min[a])));
    this.floor = min[2];
    this.canvas.hidden = false;
    this.canvas.dataset.poses = String(rows.length);
    this.reset();
    return { poses: rows.length, duration: rows.at(-1)[0] - rows[0][0] };
  }

  draw() {
    if (!this.points.length || !this.ctx || this.canvas.hidden) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = rect.width, h = rect.height, dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const scale = Math.min(w, h) * .72 / this.extent * this.zoom;
    const project = point => {
      const [x, y, z] = point.map((v, a) => v - this.center[a]);
      return [w / 2 + this.pan[0] + scale * (cy * x + sy * y),
              h / 2 + this.pan[1] - scale * (-sy * sp * x + cy * sp * y + cp * z)];
    };
    const line = (a, b, color, width = 1) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      ctx.moveTo(...project(a)); ctx.lineTo(...project(b)); ctx.stroke();
    };
    const spacing = 10 ** Math.floor(Math.log10(this.extent / 4));
    const step = spacing * ([1, 2, 5, 10].find(n => spacing * n >= this.extent / 6) || 10);
    const floorX = Math.floor(this.center[0] / step) * step;
    const floorY = Math.floor(this.center[1] / step) * step;
    for (let i = -4; i <= 4; i++) {
      line([floorX + i * step, floorY - 4 * step, this.floor], [floorX + i * step, floorY + 4 * step, this.floor], "#e3e9ee");
      line([floorX - 4 * step, floorY + i * step, this.floor], [floorX + 4 * step, floorY + i * step, this.floor], "#e3e9ee");
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let i = 1; i < this.points.length; i++) {
      const fraction = i / this.points.length;
      line(this.points[i - 1], this.points[i], `hsl(${208 - fraction * 32} 67% ${35 + fraction * 9}%)`, 2.5);
    }
    for (const [point, color] of [[this.points[0], "#1e9a70"], [this.points.at(-1), "#df7951"]]) {
      ctx.beginPath(); ctx.arc(...project(point), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    }
    // Orientation compass uses the same projection, independent of pan/zoom.
    const origin = [w - 48, h - 43];
    const axes = [[cy, -sy * sp, "X", "#b65b55"], [sy, cy * sp, "Y", "#548b62"], [0, cp, "Z", "#507da1"]];
    ctx.font = "11px system-ui";
    for (const [x, y, name, color] of axes) {
      ctx.beginPath(); ctx.moveTo(...origin); ctx.lineTo(origin[0] + x * 24, origin[1] - y * 24);
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke(); ctx.fillStyle = color;
      ctx.fillText(name, origin[0] + x * 30 - 3, origin[1] - y * 30 + 3);
    }
    ctx.fillStyle = "#74818f"; ctx.fillText(`Grid ${Number(step.toPrecision(2))} m`, 16, h - 17);
    for (const [x, label, color] of [[16, "Start", "#1e9a70"], [77, "End", "#df7951"]]) {
      ctx.beginPath(); ctx.arc(x + 3, 21, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = "#627181"; ctx.fillText(label, x + 11, 25);
    }
    this.canvas.dataset.view = [this.yaw, this.pitch, this.zoom, ...this.pan].join(",");
  }
}
window.TrajectoryViewer = TrajectoryViewer;
