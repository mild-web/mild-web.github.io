import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATA_URL = "./data/handeye_devices.json";
const DEVICE_OFFSETS = {
  compare: { x5: -185, insight9: 185 },
  x5: { x5: 0, insight9: 0 },
  "x5-cam002-kalibr": { "x5-cam002-kalibr": 0 },
  insight9: { x5: 0, insight9: 0 },
};
const VIEW_DISTANCE = { compare: 650, x5: 410, "x5-cam002-kalibr": 410, insight9: 390 };
const SENSOR_HIT_RADIUS_MM = 9;
const SENSOR_AXES_LENGTH_MM = 26;
const SENSOR_AXIS_SHAFT_RADIUS_MM = 0.8;
const SENSOR_AXIS_HEAD_RADIUS_MM = 1.6;
const SENSOR_AXIS_HEAD_LENGTH_MM = 5;
const LABEL_FONT_PX = 11;
const LABEL_AXIS_GAP_MM = 6;
const LABEL_AXIS_DIRECTIONS = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const EMBED_FORCED_MODES = {
  "mild-x5": "x5-cam002-kalibr",
  "mild-insight9": "insight9",
};
const MINIMAL_EMBEDS = new Set(["mild-x5", "mild-insight9"]);
const params = new URLSearchParams(window.location.search);
const embedMode = params.get("embed") || "full";
const forcedEmbedMode = EMBED_FORCED_MODES[embedMode] || null;

const canvas = document.querySelector("#scene");
const viewport = document.querySelector("#viewport");
const sensorList = document.querySelector("#sensor-list");
const deviceHeading = document.querySelector("#device-heading");
const viewerState = document.querySelector("#viewer-state");
const tooltip = document.querySelector("#tooltip");
const runtimeStatus = document.querySelector("#runtime-status");
const selectedName = document.querySelector("#selected-name");
const selectedSwatch = document.querySelector("#selected-swatch");
const selectedDistance = document.querySelector("#selected-distance");
const selectedTranslation = document.querySelector("#selected-translation");
const selectedSource = document.querySelector("#selected-source");

document.body.dataset.embed = embedMode;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f4f7);
scene.fog = new THREE.Fog(0xf2f4f7, 800, 1600);

const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 130;
controls.maxDistance = 1500;
controls.target.set(0, 0, 35);

scene.add(new THREE.HemisphereLight(0xffffff, 0x76818a, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(320, -450, 600);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xaac5d9, 1.2);
fillLight.position.set(-420, 260, 260);
scene.add(fillLight);

const grid = new THREE.GridHelper(1000, 20, 0xaeb7bf, 0xd6dce1);
grid.rotation.x = Math.PI / 2;
grid.position.z = -20;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const sensorObjects = new Map();
const deviceRoots = new Map();
const interactiveMeshes = [];

const state = {
  mode: "compare",
  data: null,
  selectedSensorId: null,
  labels: true,
  links: true,
  axes: true,
  autorotate: false,
  sensorVisibility: new Map(),
  pointerDown: null,
};

function makeLineMaterial(color, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
}

function makeLabelSprite(text, color) {
  const labelCanvas = document.createElement("canvas");
  const context = labelCanvas.getContext("2d");
  const ratio = 2;
  context.font = `700 ${LABEL_FONT_PX * ratio}px Arial`;
  const width = Math.ceil(context.measureText(text).width + 12 * ratio);
  labelCanvas.width = width;
  labelCanvas.height = 26 * ratio;
  context.font = `700 ${LABEL_FONT_PX * ratio}px Arial`;
  context.fillStyle = "rgba(255,255,255,0.82)";
  context.strokeStyle = "rgba(20,32,43,0.18)";
  context.lineWidth = ratio;
  context.beginPath();
  context.roundRect(ratio, ratio, width - 2 * ratio, labelCanvas.height - 2 * ratio, 4 * ratio);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.fillText(text, 6 * ratio, labelCanvas.height / 2);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width / 7.0, labelCanvas.height / 7.0, 1);
  sprite.renderOrder = 20;
  sprite.userData.isLabel = true;
  sprite.userData.labelText = text;
  return sprite;
}

function tagInteractive(object, sensorId) {
  object.traverse((child) => {
    if (child.isMesh || child.isLine || child.isLineSegments) {
      child.userData.sensorId = sensorId;
      interactiveMeshes.push(child);
    }
  });
}

function makeSensorInteractionTarget(sensorId) {
  const group = new THREE.Group();
  const hitTarget = new THREE.Mesh(
    new THREE.SphereGeometry(SENSOR_HIT_RADIUS_MM, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitTarget.name = "sensor-hit-target";
  hitTarget.userData.markerKind = "axes-only";
  group.add(hitTarget);
  tagInteractive(group, sensorId);
  return group;
}

function orientAlong(object, direction) {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
}

function makeAxisArrow(direction, color, length, shaftRadius, headRadius, headLength) {
  const group = new THREE.Group();
  const shaftLength = length - headLength;
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12), material);
  shaft.position.copy(direction).multiplyScalar(shaftLength * 0.5);
  shaft.renderOrder = 12;
  shaft.userData.isAxisMesh = true;
  orientAlong(shaft, direction);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 14), material);
  head.position.copy(direction).multiplyScalar(shaftLength + headLength * 0.5);
  head.renderOrder = 12;
  head.userData.isAxisMesh = true;
  orientAlong(head, direction);
  group.add(head);
  return group;
}

function makeAxes(
  size,
  shaftRadius = SENSOR_AXIS_SHAFT_RADIUS_MM,
  headRadius = SENSOR_AXIS_HEAD_RADIUS_MM,
  headLength = SENSOR_AXIS_HEAD_LENGTH_MM
) {
  const axes = new THREE.Group();
  axes.name = "thick-coordinate-axes";
  axes.userData.isAxes = true;
  axes.add(makeAxisArrow(new THREE.Vector3(1, 0, 0), 0xd74343, size, shaftRadius, headRadius, headLength));
  axes.add(makeAxisArrow(new THREE.Vector3(0, 1, 0), 0x23914c, size, shaftRadius, headRadius, headLength));
  axes.add(makeAxisArrow(new THREE.Vector3(0, 0, 1), 0x3467d6, size, shaftRadius, headRadius, headLength));
  return axes;
}

function makeEeSymbol(labelText) {
  const group = new THREE.Group();
  group.name = "ee-frame-symbol";
  group.add(makeAxes(58, 1.1, 2.2, 7));

  const label = makeLabelSprite(labelText, "#24313b");
  label.position.set(0, 0, 58 + LABEL_AXIS_GAP_MM);
  label.userData.anchorKind = "axis-endpoint";
  group.add(label);
  return group;
}

function makeScaleRing(radius) {
  const points = [];
  for (let index = 0; index < 96; index += 1) {
    const angle = (index / 96) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), makeLineMaterial(0x9ca7af, 0.45));
  ring.userData.isLink = true;
  return ring;
}

function buildDevice(device) {
  const root = new THREE.Group();
  root.name = device.name;
  root.add(makeEeSymbol(device.ee_scene_label || "End Effector"));
  root.add(makeScaleRing(100));

  device.sensors.forEach((sensor, sensorIndex) => {
    state.sensorVisibility.set(sensor.id, true);
    const sensorRoot = new THREE.Group();
    sensorRoot.name = sensor.name;
    sensorRoot.position.fromArray(sensor.translation_mm);
    sensorRoot.quaternion.fromArray(sensor.pose_xyzw_m.slice(3));
    sensorRoot.add(makeSensorInteractionTarget(sensor.id));

    const axes = makeAxes(SENSOR_AXES_LENGTH_MM);
    tagInteractive(axes, sensor.id);
    sensorRoot.add(axes);
    const label = makeLabelSprite(sensor.scene_label || sensor.name, sensor.color);
    const localLabelDirection = new THREE.Vector3(
      ...LABEL_AXIS_DIRECTIONS[sensorIndex % LABEL_AXIS_DIRECTIONS.length]
    );
    const eeLabelDirection = localLabelDirection.clone().applyQuaternion(sensorRoot.quaternion).normalize();
    label.position.copy(sensorRoot.position).addScaledVector(
      eeLabelDirection,
      SENSOR_AXES_LENGTH_MM + LABEL_AXIS_GAP_MM
    );
    label.userData.anchorKind = "sensor-axis-endpoint";
    label.userData.anchorDistanceMm = SENSOR_AXES_LENGTH_MM + LABEL_AXIS_GAP_MM;
    root.add(label);
    root.add(sensorRoot);

    const linkGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(...sensor.translation_mm),
    ]);
    const link = new THREE.Line(linkGeometry, makeLineMaterial(sensor.color, 0.58));
    link.userData.isLink = true;
    link.userData.sensorId = sensor.id;
    root.add(link);

    sensorObjects.set(sensor.id, { sensor, device, root: sensorRoot, link, label, axes });
  });
  deviceRoots.set(device.id, root);
  scene.add(root);
}

function activeDevices() {
  if (!state.data) return [];
  return state.data.devices.filter((device) => (
    state.mode === "compare" ? device.include_in_compare !== false : device.id === state.mode
  ));
}

function setMode(mode, resetCamera = true) {
  if (!DEVICE_OFFSETS[mode]) return;
  state.mode = mode;
  const activeIds = new Set(activeDevices().map((device) => device.id));
  for (const [deviceId, root] of deviceRoots) {
    root.visible = activeIds.has(deviceId);
    root.position.x = DEVICE_OFFSETS[mode][deviceId] ?? 0;
  }
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.mode === mode));
  });
  deviceHeading.textContent = mode === "compare"
    ? "Device comparison"
    : state.data.devices.find((device) => device.id === mode).name;
  renderSensorList();
  if (resetCamera) setView("reset");
}

function setView(view) {
  const distance = VIEW_DISTANCE[state.mode];
  const target = state.mode === "compare" ? new THREE.Vector3(0, 0, 40) : new THREE.Vector3(0, 0, 38);
  camera.up.set(0, 0, 1);
  if (view === "front") camera.position.set(0, -distance, 60);
  else if (view === "side") camera.position.set(distance, 0, 60);
  else if (view === "top") {
    camera.up.set(0, 1, 0);
    camera.position.set(0, 0, distance);
  } else camera.position.set(distance * 0.72, -distance, distance * 0.62);
  controls.target.copy(target);
  camera.lookAt(target);
  controls.update();
}

function visibleSensors() {
  const ids = new Set();
  for (const device of activeDevices()) {
    for (const sensor of device.sensors) ids.add(sensor.id);
  }
  return ids;
}

function refreshSceneVisibility() {
  const active = visibleSensors();
  for (const [sensorId, record] of sensorObjects) {
    const visible = active.has(sensorId) && state.sensorVisibility.get(sensorId);
    record.root.visible = visible;
    record.link.visible = visible && state.links;
    record.label.visible = visible && state.labels;
    record.axes.visible = visible && state.axes;
  }
  for (const root of deviceRoots.values()) {
    root.traverse((child) => {
      if (child.userData.isLink && !child.userData.sensorId) child.visible = state.links;
    });
  }
}

function sensorRow(record) {
  const row = document.createElement("div");
  row.className = "sensor-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.sensorVisibility.get(record.sensor.id);
  checkbox.setAttribute("aria-label", `Show ${record.sensor.name}`);
  checkbox.addEventListener("change", () => {
    state.sensorVisibility.set(record.sensor.id, checkbox.checked);
    refreshSceneVisibility();
  });

  const swatch = document.createElement("span");
  swatch.className = "sensor-swatch";
  swatch.style.background = record.sensor.color;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `${record.device.short_name} / ${record.sensor.name}`;
  button.title = record.sensor.source;
  button.addEventListener("click", () => selectSensor(record.sensor.id));

  const distance = document.createElement("output");
  distance.textContent = `${record.sensor.distance_mm.toFixed(1)} mm`;

  row.append(checkbox, swatch, button, distance);
  return row;
}

function renderSensorList() {
  sensorList.replaceChildren();
  const active = visibleSensors();
  for (const [sensorId, record] of sensorObjects) {
    if (active.has(sensorId)) sensorList.append(sensorRow(record));
  }
  refreshSceneVisibility();
  const firstVisible = [...active].find((id) => state.sensorVisibility.get(id));
  if (!active.has(state.selectedSensorId)) selectSensor(firstVisible || null);
}

function selectSensor(sensorId) {
  state.selectedSensorId = sensorId;
  const record = sensorObjects.get(sensorId);
  if (!record) {
    selectedSwatch.style.background = "transparent";
    selectedName.textContent = "Select a sensor";
    selectedDistance.textContent = "";
    selectedTranslation.textContent = "t_EE = --";
    selectedSource.textContent = "";
    return;
  }
  const translation = record.sensor.translation_mm.map((value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`);
  selectedSwatch.style.background = record.sensor.color;
  selectedName.textContent = `${record.device.short_name} / ${record.sensor.name}`;
  selectedDistance.textContent = `${record.sensor.distance_mm.toFixed(1)} mm`;
  selectedTranslation.textContent = `t_EE = [${translation.join(", ")}] mm`;
  selectedSource.textContent = `${record.sensor.source} | ${record.sensor.transform_chain}`;
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickSensor(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(interactiveMeshes, false).find((entry) => entry.object.visible);
  return hit ? hit.object.userData.sensorId : null;
}

function updateTooltip(event) {
  if (MINIMAL_EMBEDS.has(embedMode)) {
    tooltip.hidden = true;
    canvas.style.cursor = "grab";
    return;
  }
  const sensorId = pickSensor(event);
  const record = sensorObjects.get(sensorId);
  if (!record) {
    tooltip.hidden = true;
    canvas.style.cursor = "grab";
    return;
  }
  tooltip.hidden = false;
  const lineage = record.device.publication_role === "internal_geometry_audit"
    ? "audit"
    : (record.sensor.source_kind === "direct_hand_eye" ? "direct" : "derived");
  tooltip.textContent = `${record.device.short_name} / ${record.sensor.name} | ${record.sensor.distance_mm.toFixed(1)} mm | ${lineage}`;
  tooltip.style.left = `${Math.min(event.clientX + 12, viewport.clientWidth - 190)}px`;
  tooltip.style.top = `${Math.max(8, event.clientY - 34)}px`;
  canvas.style.cursor = "pointer";
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
}

function sampleCanvasSignal() {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (!width || !height) return false;
  const sampleSize = 64;
  const pixels = new Uint8Array(sampleSize * sampleSize * 4);
  const startX = Math.max(0, Math.floor(width / 2 - sampleSize / 2));
  const startY = Math.max(0, Math.floor(height / 2 - sampleSize / 2));
  gl.readPixels(startX, startY, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let min = 255;
  let max = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  return max - min > 8;
}

function auditLayout() {
  const topbar = document.querySelector(".topbar").getBoundingClientRect();
  const inspector = document.querySelector(".inspector").getBoundingClientRect();
  const insideViewport = [topbar, inspector].every((rect) => (
    rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1
  ));
  const separated = topbar.bottom <= inspector.top || inspector.bottom <= topbar.top;
  const controlsFit = [...document.querySelectorAll("button, .sensor-row output")].every((element) => (
    element.scrollWidth <= element.clientWidth + 2
  ));
  return insideViewport && separated && controlsFit;
}

function auditMarkerLabelSeparation() {
  const active = new Set(activeDevices().flatMap((device) => device.sensors.map((sensor) => sensor.id)));
  const markerWorld = new THREE.Vector3();
  const labelWorld = new THREE.Vector3();
  const markerNdc = new THREE.Vector3();
  const labelNdc = new THREE.Vector3();
  return [...sensorObjects.entries()].every(([sensorId, record]) => {
    if (!active.has(sensorId) || !record.root.visible || !record.label.visible) return true;
    record.root.getWorldPosition(markerWorld);
    record.label.getWorldPosition(labelWorld);
    markerNdc.copy(markerWorld).project(camera);
    labelNdc.copy(labelWorld).project(camera);
    const dx = (markerNdc.x - labelNdc.x) * viewport.clientWidth * 0.5;
    const dy = (markerNdc.y - labelNdc.y) * viewport.clientHeight * 0.5;
    return Math.hypot(dx, dy) >= 12;
  });
}

function auditEeAxesOnly() {
  return [...deviceRoots.values()].every((root) => {
    const eeFrame = root.getObjectByName("ee-frame-symbol");
    if (!eeFrame) return false;
    const meshes = [];
    const axisMeshes = [];
    eeFrame.traverse((child) => {
      if (child.isMesh) meshes.push(child);
      if (child.userData.isAxisMesh) axisMeshes.push(child);
    });
    return axisMeshes.length === 6 && meshes.every((mesh) => mesh.userData.isAxisMesh);
  });
}

function auditLabelAxisAnchors() {
  const expectedDistance = SENSOR_AXES_LENGTH_MM + LABEL_AXIS_GAP_MM;
  return [...sensorObjects.values()].every((record) => (
    record.label.userData.anchorKind === "sensor-axis-endpoint"
    && Math.abs(record.root.position.distanceTo(record.label.position) - expectedDistance) < 1e-6
  ));
}

function auditSceneLabels() {
  const expectedX5Labels = new Map([
    ["x5-cam001", "cam01"],
    ["x5-cam002", "cam02"],
    ["x5-imu", "imu"],
    ["x5-cam002-kalibr-cam001", "cam01"],
    ["x5-cam002-kalibr-cam002", "cam02"],
    ["x5-cam002-kalibr-imu", "imu"],
  ]);
  const x5LabelsPass = [...expectedX5Labels.entries()].every(([sensorId, expectedLabel]) => {
    const record = sensorObjects.get(sensorId);
    return record && record.sensor.scene_label === expectedLabel && record.label.userData.labelText === expectedLabel;
  });
  const eeLabelsPass = state.data.devices.every((device) => {
    const root = deviceRoots.get(device.id);
    const eeFrame = root && root.getObjectByName("ee-frame-symbol");
    const label = eeFrame && eeFrame.children.find((child) => child.userData.isLabel);
    return device.ee_scene_label === "End Effector" && label && label.userData.labelText === "End Effector";
  });
  return x5LabelsPass && eeLabelsPass;
}

function runSelfTest() {
  if (params.get("selftest") !== "1") return;
  resize();
  controls.update();
  renderer.render(scene, camera);
  const before = camera.position.distanceTo(controls.target);
  canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -220, bubbles: true, cancelable: true }));
  controls.update();
  renderer.render(scene, camera);
  const after = camera.position.distanceTo(controls.target);
  const orbitBefore = camera.position.clone().sub(controls.target).normalize();
  const originalSetPointerCapture = canvas.setPointerCapture;
  const originalReleasePointerCapture = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 17,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: canvas.clientWidth * 0.52,
    clientY: canvas.clientHeight * 0.48,
    bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent("pointermove", {
    pointerId: 17,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: canvas.clientWidth * 0.68,
    clientY: canvas.clientHeight * 0.42,
    bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent("pointerup", {
    pointerId: 17,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    clientX: canvas.clientWidth * 0.68,
    clientY: canvas.clientHeight * 0.42,
    bubbles: true,
  }));
  canvas.setPointerCapture = originalSetPointerCapture;
  canvas.releasePointerCapture = originalReleasePointerCapture;
  controls.update();
  renderer.render(scene, camera);
  const orbitDegrees = THREE.MathUtils.radToDeg(
    orbitBefore.angleTo(camera.position.clone().sub(controls.target).normalize())
  );
  const originalMode = state.mode;
  const alternateMode = originalMode === "insight9" ? "x5" : "insight9";
  document.querySelector(`[data-mode="${alternateMode}"]`).click();
  const modeChanged = state.mode === alternateMode;
  document.querySelector('[data-mode="x5-cam002-kalibr"]').click();
  const candidateModeChanged = state.mode === "x5-cam002-kalibr";
  const candidateDeviceActive = activeDevices().length === 1 && activeDevices()[0].id === "x5-cam002-kalibr";
  setMode(originalMode, false);
  renderer.render(scene, camera);
  const canvasSignal = sampleCanvasSignal();
  const layoutSignal = auditLayout();
  const labelSignal = auditMarkerLabelSeparation();
  const eeFrameSignal = auditEeAxesOnly();
  const labelAnchorSignal = auditLabelAxisAnchors();
  const sceneLabelSignal = auditSceneLabels();
  const markerSignal = sensorObjects.size > 0 && [...sensorObjects.values()].every(
    (record) => {
      const target = record.root.getObjectByName("sensor-hit-target");
      const thickAxes = record.root.getObjectByName("thick-coordinate-axes");
      const axisMeshes = [];
      const sensorMeshes = [];
      record.root.traverse((child) => {
        if (child.isMesh) sensorMeshes.push(child);
      });
      if (thickAxes) thickAxes.traverse((child) => {
        if (child.userData.isAxisMesh) axisMeshes.push(child);
      });
      const axesOnlyMeshes = sensorMeshes.every((mesh) => mesh === target || mesh.userData.isAxisMesh);
      return target && target.userData.markerKind === "axes-only" && thickAxes && axisMeshes.length === 6 && axesOnlyMeshes;
    }
  );
  const candidateTabSignal = candidateModeChanged && candidateDeviceActive;
  const passed = Math.abs(after - before) > 0.5 && orbitDegrees > 0.5 && modeChanged && candidateTabSignal && canvasSignal && layoutSignal && markerSignal && labelSignal && eeFrameSignal && labelAnchorSignal && sceneLabelSignal;
  document.body.dataset.selfTest = passed ? "pass" : "fail";
  document.body.dataset.canvasSignal = canvasSignal ? "pass" : "fail";
  document.body.dataset.layoutSignal = layoutSignal ? "pass" : "fail";
  document.body.dataset.markerSignal = markerSignal ? "pass" : "fail";
  document.body.dataset.labelSignal = labelSignal ? "pass" : "fail";
  document.body.dataset.candidateTabSignal = candidateTabSignal ? "pass" : "fail";
  document.body.dataset.eeFrameSignal = eeFrameSignal ? "pass" : "fail";
  document.body.dataset.labelAnchorSignal = labelAnchorSignal ? "pass" : "fail";
  document.body.dataset.sceneLabelSignal = sceneLabelSignal ? "pass" : "fail";
  runtimeStatus.textContent = `selftest=${passed ? "pass" : "fail"}; canvas=${canvasSignal ? "pass" : "fail"}; layout=${layoutSignal ? "pass" : "fail"}; marker=${markerSignal ? "pass" : "fail"}; label=${labelSignal ? "pass" : "fail"}; ee_frame=${eeFrameSignal ? "pass" : "fail"}; label_anchor=${labelAnchorSignal ? "pass" : "fail"}; scene_labels=${sceneLabelSignal ? "pass" : "fail"}; candidate_tab=${candidateTabSignal ? "pass" : "fail"}; zoom_delta=${(after - before).toFixed(3)}; orbit_deg=${orbitDegrees.toFixed(3)}`;
}

function bindUi() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(forcedEmbedMode || button.dataset.mode));
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("[data-option]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const option = checkbox.dataset.option;
      state[option] = checkbox.checked;
      if (option === "autorotate") controls.autoRotate = checkbox.checked;
      refreshSceneVisibility();
    });
  });
  canvas.addEventListener("pointerdown", (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY };
    tooltip.hidden = true;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons === 0) updateTooltip(event);
  });
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
  });
  canvas.addEventListener("pointerup", (event) => {
    const moved = state.pointerDown && Math.hypot(event.clientX - state.pointerDown.x, event.clientY - state.pointerDown.y) > 5;
    state.pointerDown = null;
    if (!moved) selectSensor(pickSensor(event));
  });
  window.addEventListener("resize", resize);
}

function animate() {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

async function initialize() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed with HTTP ${response.status}`);
    state.data = await response.json();
    state.data.devices.forEach(buildDevice);
    bindUi();
    const requestedMode = forcedEmbedMode || params.get("view");
    setMode(DEVICE_OFFSETS[requestedMode] ? requestedMode : "compare");
    selectSensor(activeDevices()[0].sensors[0].id);
    viewerState.textContent = "Ready";
    runtimeStatus.textContent = "Viewer ready";
    document.body.dataset.sensorMarkerStyle = "axes-only";
    document.body.dataset.ready = "true";
    runSelfTest();
    animate();
  } catch (error) {
    console.error(error);
    viewerState.textContent = "Error";
    runtimeStatus.textContent = error.message;
    document.body.dataset.ready = "error";
  }
}

window.__HAND_EYE_VIEWER__ = {
  getState: () => ({
    mode: state.mode,
    selectedSensorId: state.selectedSensorId,
    ready: document.body.dataset.ready,
    embedMode,
  }),
  setMode,
  setView,
};

initialize();
