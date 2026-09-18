const HAND_EYE_DATA_URL = "visualizations/hand-eye/data/handeye_devices.json";

const AXIS_COLORS = {
  x: "#e5484d",
  y: "#2fb344",
  z: "#2f6fed",
};

const SENSOR_MARKERS = {
  camera: "square",
  imu: "diamond",
};

const DEFAULT_VIEW = {
  yaw: -0.62,
  pitch: -0.48,
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function rotateByQuaternion(vector, quaternion) {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = quaternion;

  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function rotateView(point, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const x1 = cy * point[0] - sy * point[1];
  const y1 = sy * point[0] + cy * point[1];
  const z1 = point[2];

  return [
    x1,
    cp * y1 - sp * z1,
    sp * y1 + cp * z1,
  ];
}

function drawArrow(ctx, start, end, color, width = 2) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const head = 7;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMarker(ctx, point, sensor, selected = false) {
  const color = sensor.color || "#64748b";
  const marker = SENSOR_MARKERS[sensor.geometry] || "circle";
  const radius = selected ? 6 : 5;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 2;
  if (marker === "square") {
    ctx.beginPath();
    ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
  } else if (marker === "diamond") {
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - radius - 1);
    ctx.lineTo(point.x + radius + 1, point.y);
    ctx.lineTo(point.x, point.y + radius + 1);
    ctx.lineTo(point.x - radius - 1, point.y);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx, text, point, color = "#334155", align = "left") {
  ctx.save();
  ctx.font = "700 11px Inter, system-ui, sans-serif";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const paddingX = 5;
  const w = metrics.width + paddingX * 2;
  const h = 18;
  const x = align === "right" ? point.x - w - 8 : point.x + 8;
  const y = point.y - h / 2;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.strokeStyle = "rgba(148,163,184,0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, align === "right" ? point.x - 13 : point.x + 13, point.y + 0.5);
  ctx.restore();
}

function initMiniViewer(container, device) {
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  let yaw = DEFAULT_VIEW.yaw;
  let pitch = DEFAULT_VIEW.pitch;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const sensors = device.sensors.map((sensor) => {
    const pose = sensor.pose_xyzw_m || [];
    return {
      ...sensor,
      position: sensor.translation_mm,
      quaternion: pose.slice(3, 7),
    };
  });

  const allPositions = [[0, 0, 0], ...sensors.map((sensor) => sensor.position)];
  const center = allPositions.reduce((acc, p) => add(acc, p), [0, 0, 0]).map((v) => v / allPositions.length);
  const radius = Math.max(
    90,
    ...allPositions.map((p) => {
      const d = sub(p, center);
      return Math.hypot(d[0], d[1], d[2]);
    })
  );

  const projectFactory = (width, height) => {
    const scale = Math.min(width, height) * 0.34 / radius;
    return (point) => {
      const p = rotateView(sub(point, center), yaw, pitch);
      return {
        x: width * 0.5 + p[0] * scale,
        y: height * 0.53 - p[1] * scale,
        depth: p[2],
      };
    };
  };

  const draw = () => {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, rect.width);
    const height = Math.max(240, rect.height);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const project = projectFactory(width, height);
    const origin = project([0, 0, 0]);

    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.24)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    sensors.forEach((sensor) => {
      const p = project(sensor.position);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    ctx.restore();

    drawLabel(ctx, "TCP", { x: origin.x, y: origin.y - 18 }, "#1f3760", origin.x > width * 0.55 ? "right" : "left");
    drawMarker(ctx, origin, { color: "#334155" }, true);
    const tcpAxes = [
      ["x", [1, 0, 0]],
      ["y", [0, 1, 0]],
      ["z", [0, 0, 1]],
    ];
    tcpAxes.forEach(([axis, dir]) => {
      const end = project(mul(dir, 42));
      drawArrow(ctx, origin, end, AXIS_COLORS[axis], 2.3);
    });

    const ordered = [...sensors].sort((a, b) => project(a.position).depth - project(b.position).depth);
    ordered.forEach((sensor) => {
      const p = project(sensor.position);
      drawMarker(ctx, p, sensor);
      const label = sensor.scene_label || sensor.name;
      drawLabel(ctx, label, { x: p.x, y: p.y - 16 }, sensor.color || "#334155", p.x > width * 0.64 ? "right" : "left");

      [
        ["x", [1, 0, 0]],
        ["y", [0, 1, 0]],
        ["z", [0, 0, 1]],
      ].forEach(([axis, dir]) => {
        const rotated = rotateByQuaternion(dir, sensor.quaternion);
        const end = project(add(sensor.position, mul(rotated, 30)));
        drawArrow(ctx, p, end, AXIS_COLORS[axis], 1.8);
      });
    });

    ctx.save();
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = AXIS_COLORS.x;
    ctx.fillText("x", 14, height - 18);
    ctx.fillStyle = AXIS_COLORS.y;
    ctx.fillText("y", 30, height - 18);
    ctx.fillStyle = AXIS_COLORS.z;
    ctx.fillText("z", 46, height - 18);
    ctx.fillStyle = "#64748b";
    ctx.fillText("axes", 62, height - 18);
    ctx.restore();
  };

  const start = (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    container.setPointerCapture?.(event.pointerId);
    container.classList.add("is-dragging");
  };

  const move = (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    yaw += dx * 0.01;
    pitch = Math.max(-1.35, Math.min(0.55, pitch - dy * 0.008));
    draw();
  };

  const stop = () => {
    dragging = false;
    container.classList.remove("is-dragging");
  };

  container.addEventListener("pointerdown", start);
  container.addEventListener("pointermove", move);
  container.addEventListener("pointerup", stop);
  container.addEventListener("pointercancel", stop);
  container.addEventListener("lostpointercapture", stop);
  container.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") yaw -= 0.12;
    else if (event.key === "ArrowRight") yaw += 0.12;
    else if (event.key === "ArrowUp") pitch = Math.max(-1.35, pitch - 0.1);
    else if (event.key === "ArrowDown") pitch = Math.min(0.55, pitch + 0.1);
    else return;
    event.preventDefault();
    draw();
  });

  new ResizeObserver(draw).observe(container);
  draw();
}

fetch(HAND_EYE_DATA_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`Failed to load hand-eye data: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    const devices = new Map(data.devices.map((device) => [device.id, device]));
    document.querySelectorAll(".handeye-mini").forEach((container) => {
      const device = devices.get(container.dataset.device);
      if (!device) return;
      initMiniViewer(container, device);
    });
  })
  .catch((error) => {
    document.querySelectorAll(".handeye-mini").forEach((container) => {
      container.textContent = "Hand-eye frame data unavailable.";
    });
    console.error(error);
  });
