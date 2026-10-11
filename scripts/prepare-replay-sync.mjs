// Recover the existing renderer's time mapping; do not recompute paper metrics.
// Usage: node scripts/prepare-replay-sync.mjs --render-manifest CSV
//   --sensor-root DIR --sdk-offsets CSV [--build-scenes | --patch]
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const pathAliases = args.flatMap((arg, i) => arg === "--path-alias" ? [args[i + 1].split("=")] : []);
for (const name of ["--render-manifest", "--sensor-root", "--sdk-offsets"]) {
  if (!args.includes(name)) throw new Error(`Missing ${name}`);
}

function csv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if (c === "\n" && !quoted) {
      row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = "";
    } else value += c;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

function resolveInput(input, gt = false) {
  const aliases = [input];
  for (const [from, to] of pathAliases) if (input.startsWith(from)) aliases.push(to + input.slice(from.length));
  for (const p of aliases) if (fs.existsSync(p)) return p;
  if (gt) {
    for (const p of aliases) {
      const parent = path.dirname(p);
      const root = ["instan360x5", "insight9"].includes(path.basename(parent)) ? path.dirname(parent) : parent;
      if (!fs.existsSync(root)) continue;
      const tum = fs.readdirSync(root).filter((f) => /^left_.*\.tum$/.test(f)).sort()[0];
      if (tum) return path.join(root, tum);
    }
  }
  throw new Error(`Missing ${gt ? "reference" : "trajectory"} input: ${input}`);
}

const sourceRows = csv(fs.readFileSync(option("--render-manifest"), "utf8"));
const byKey = new Map(sourceRows.map((r) => [`${r.task_slug}::${r.method_slug}`, r]));
const offsetRows = csv(fs.readFileSync(option("--sdk-offsets"), "utf8"));
const offsets = new Map(offsetRows.map((r) => [r.vio_csv_path, Number(r.time_offset_s) || 0]));
const boundsCache = new Map();

function bounds(input, type = "tum", gt = false) {
  const resolved = resolveInput(input, gt);
  const key = `${resolved}::${type}`;
  if (boundsCache.has(key)) return boundsCache.get(key);
  const content = fs.readFileSync(resolved, "utf8");
  let times;
  if (type === "insight9_sdk_csv") {
    const offset = offsets.get(input) ?? offsets.get(resolved) ?? 0;
    times = csv(content).filter((r) => [r.host_unix_ns, r.px, r.py, r.pz].every((v) => v !== "" && Number.isFinite(Number(v))))
      .map((r) => Number(r.host_unix_ns) / 1e9 + offset).sort((a, b) => a - b);
  } else {
    times = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => Number(l.trim().split(/\s+/)[0]));
  }
  if (times.length < 2 || times.some((t) => !Number.isFinite(t))) throw new Error(`Invalid timestamps: ${input}`);
  const result = [times[0], times.at(-1)];
  if (result[1] <= result[0]) throw new Error(`Invalid time interval: ${input}`);
  boundsCache.set(key, result);
  return result;
}

const sensorRoot = path.resolve(option("--sensor-root"));
const sensorRows = ["x5_rosbag_sync_manifest.json", "insight9_rosbag_sync_manifest.json"]
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(sensorRoot, f), "utf8")).sequences);
const sensors = new Map(sensorRows.map((r) => [r.sequence_id, r]));
const manifestFile = "assets/videos/replay_matrix_manifest.json";
const previous = fs.readFileSync(path.join(site, manifestFile), "utf8");
const data = JSON.parse(previous);
data.playback_version = "20261011-all15-recording-status-v2";
data.playback_policy = "One shared 16 s presentation clock per task. Existing trajectory clips are mapped back to their reference-relative time intervals; separate recordings share normalized reference progress, not a common absolute timestamp.";

const sceneLabels = { apriltag_4: "AprilTag 4", aruco_4: "ArUco 4" };
const rounded = (v) => Number(v.toFixed(9));
const timeMap = (gt, start, end) => ({
  start_fraction: rounded((start - gt[0]) / (gt[1] - gt[0])),
  end_fraction: rounded((end - gt[0]) / (gt[1] - gt[0])),
  reference_duration_s: rounded(gt[1] - gt[0]),
  video_duration_s: 16,
  last_frame_s: 15.95,
});

for (const item of data.items) {
  const row = byKey.get(`${item.task_slug}::${item.method_slug}`);
  if (!row || row.sequence !== item.sequence || row.render_status !== item.status) {
    throw new Error(`Renderer/website evidence mismatch: ${item.task_slug} / ${item.method_slug}`);
  }
  const parts = item.sequence.split("__");
  item.recording_label = parts[1] in sceneLabels
    ? `${sceneLabels[parts[1]]} · ${parts[2] === "insight9" ? "Insight9" : "Insta360 X5"}`
    : "Controller recording";
  if (item.status === "rendered") {
    const gt = bounds(row.gt_path, "tum", true);
    const est = bounds(row.trajectory_path, row.file_type);
    const start = Math.max(gt[0], est[0]), end = Math.min(gt[1], est[1]);
    if (end <= start) throw new Error(`No overlapping interval: ${item.sequence}`);
    item.timeline = timeMap(gt, start, end);
  }
}

const jobs = [];
for (const task of data.task_order) {
  task.scenes = [];
  task.presentation_duration_s = 16;
  const seen = new Set();
  for (const method of ["aprilvins_ours", "ucoslam", "insight9_sdk_vio"]) {
    const item = data.items.find((i) => i.task_slug === task.slug && i.method_slug === method);
    if (!item || seen.has(item.sequence)) continue;
    const sensor = sensors.get(item.sequence);
    if (!sensor?.rosbag_sync || !sensor.output_exists) continue;
    const row = byKey.get(`${task.slug}::${method}`);
    const gt = bounds(row.gt_path, "tum", true);
    const sync = sensor.rosbag_sync;
    let start = sync.first_image_ns / 1e9, end = sync.last_image_ns / 1e9;
    if (gt[0] < 1e8) {
      if (!Number.isFinite(sync.camera_start_ns)) throw new Error(`Missing camera clock origin: ${item.sequence}`);
      start -= sync.camera_start_ns / 1e9; end -= sync.camera_start_ns / 1e9;
    }
    const name = `${task.slug}__${sensor.scene_slug}__${sensor.sensor}`;
    const scene = {
      sequence: item.sequence,
      label: item.recording_label,
      video: `assets/videos/comparison_scenes/${name}.mp4`,
      poster: `assets/posters/comparison_scenes/${name}.jpg`,
      timeline: timeMap(gt, start, end),
    };
    task.scenes.push(scene); seen.add(item.sequence);
    jobs.push({ scene, source: path.join(sensorRoot, sensor.output_relative), rotate: sensor.sensor === "insight9" });
  }
  if (!task.scenes.length) throw new Error(`No scene recording for ${task.slug}`);
}

async function ffmpeg(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...command]);
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(error || `ffmpeg exit ${code}`)));
  });
}

if (args.includes("--build-scenes")) {
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const out = path.join(site, job.scene.video), poster = path.join(site, job.scene.poster);
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(path.dirname(poster), { recursive: true });
      const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", job.source], { encoding: "utf8" }).trim());
      const orient = job.rotate ? ",hflip,vflip" : "";
      if (!fs.existsSync(out)) await ffmpeg(["-threads", "2", "-i", job.source, "-an", "-vf", `setpts=(PTS-STARTPTS)*${16 / duration},scale=640:-2${orient},fps=20`, "-t", "16", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
      if (!fs.existsSync(poster)) await ffmpeg(["-ss", "1", "-i", out, "-frames:v", "1", "-q:v", "4", poster]);
      process.stdout.write(`Built scene: ${job.scene.sequence}\n`);
    }
  }));
} else if (args.includes("--patch")) {
  const after = JSON.stringify(data, null, 2) + "\n";
  process.stdout.write(`*** Begin Patch\n*** Update File: ${path.join(site, manifestFile)}\n@@\n${previous.trimEnd().split("\n").map((l) => "-" + l).join("\n")}\n${after.trimEnd().split("\n").map((l) => "+" + l).join("\n")}\n*** End Patch\n`);
} else {
  console.log(JSON.stringify({ tasks: data.task_order.length, trajectory_time_maps: data.items.filter((i) => i.timeline).length, scene_recordings: jobs.length, rows: data.task_order.map((t) => ({ task: t.label, scenes: t.scenes.map((s) => s.label) })) }));
}
