const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { mappedClipTime, coverageNotice, coverageDetail, heldFramePath } = require("../assets/js/replay-row-sync.js");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/videos/replay_matrix_manifest.json")));

test("full-length clips follow the shared clock", () => {
  const map = { start_fraction: 0, end_fraction: 1, last_frame_s: 15.95 };
  assert.equal(mappedClipTime(8, 16, map, 16).time, 7.975);
  assert.equal(mappedClipTime(0, 16, map, 16).phase, "");
  assert.equal(mappedClipTime(16, 16, map, 16).phase, "Trajectory ended");
});
test("partial trajectories retain their original source interval", () => {
  const map = { start_fraction: 0.25, end_fraction: 0.75, last_frame_s: 15.95 };
  assert.equal(mappedClipTime(2, 16, map, 16).time, 0);
  assert.equal(mappedClipTime(2, 16, map, 16).phase, "Not started");
  assert.equal(mappedClipTime(8, 16, map, 16).time, 7.975);
  assert.equal(mappedClipTime(14, 16, map, 16).time, 15.95);
  assert.equal(mappedClipTime(14, 16, map, 16).phase, "Trajectory ended");
  assert.equal(mappedClipTime(8, 16, map, 16).rate, 1.99375);
});
test("invalid time intervals cannot drive a player", () => {
  assert.equal(mappedClipTime(1, 16, { start_fraction: 1, end_fraction: 1 }, 16), null);
  assert.equal(mappedClipTime(1, 16, null, NaN), null);
});
test("coverage labels follow timestamps without inventing an interruption cause", () => {
  const partial = { status: "rendered" }, timeline = { start_fraction: 0.25, end_fraction: 0.75, last_frame_s: 15.95 };
  assert.equal(coverageNotice(partial, mappedClipTime(2, 16, timeline, 16)), "No trajectory coverage");
  assert.equal(coverageNotice(partial, mappedClipTime(8, 16, timeline, 16)), "");
  assert.equal(coverageNotice(partial, mappedClipTime(14, 16, timeline, 16)), "No trajectory coverage");
  assert.equal(coverageNotice({ status: "recording_interrupted" }, null), "Recording interrupted");
  assert.equal(coverageNotice({ status: "fail_video_table_cross" }, null), "");
});
test("out-of-coverage holds describe existing frames, never invented poses", () => {
  const item = { status: "rendered" }, timeline = { start_fraction: 0.25, end_fraction: 0.75, last_frame_s: 15.95 };
  assert.match(coverageDetail(item, mappedClipTime(2, 16, timeline, 16)), /has not started/);
  assert.match(coverageDetail(item, mappedClipTime(14, 16, timeline, 16)), /last recorded frame/);
  assert.match(coverageDetail(item, mappedClipTime(14, 16, timeline, 16)), /No new estimated poses/);
  assert.equal(coverageDetail(item, mappedClipTime(8, 16, timeline, 16)), "");
  assert.equal(coverageDetail({ status: "recording_interrupted" }, null), "");
  const before = mappedClipTime(14, 16, timeline, 16), after = mappedClipTime(15, 16, timeline, 16);
  assert.equal(before.time, after.time);
  assert.equal(before.inside, false);
  assert.equal(after.inside, false);
});
test("boundary images come from existing videos or their final-frame posters", () => {
  for (const item of manifest.items.filter(i=>i.status==="rendered")) {
    assert.equal(heldFramePath(item,{inside:false,phase:"Trajectory ended"}),item.poster);
    assert.equal(heldFramePath(item,{inside:true,phase:""}),"");
    if(item.timeline.start_fraction>0) assert(fs.existsSync(path.join(root,heldFramePath(item,{inside:false,phase:"Not started"}))));
  }
  assert.equal(heldFramePath({status:"recording_interrupted"},{inside:false}),"");
});
test("paper metrics, statuses, sequence IDs and method ordering are unchanged", () => {
  const original = JSON.parse(cp.execFileSync("git", ["show", "74bc2ed:assets/videos/replay_matrix_manifest.json"], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(manifest.method_order, original.method_order);
  const items = new Map(manifest.items.map(i => [`${i.task_slug}::${i.method_slug}`, i]));
  for (const item of original.items) {
    for (const [key, value] of Object.entries(item)) assert.deepEqual(items.get(`${item.task_slug}::${item.method_slug}`)[key], value);
  }
  for (const task of original.task_order) assert.deepEqual(manifest.task_order.find(t => t.slug === task.slug), task);
  assert.equal(manifest.items.length, 90);
  assert.equal(items.size, 90);
  assert.equal(manifest.task_order.length, 15);
  assert.equal(manifest.items.filter((i) => i.status === "fail_video_table_cross").length, 3);
});
test("recording/pipeline/evaluation issues are distinct from no trajectory output", () => {
  const get = (task, method) => manifest.items.find(i => i.task_slug === task && i.method_slug === method);
  for (const n of ["01", "02", "03"]) {
    const item = get(`pick_and_place${n}`, "pico_controller");
    assert.equal(item.status, "recording_invalid"); assert.equal(item.status_detail, "Static controller recording");
    assert.equal(item.video, undefined); assert.equal(item.metric, "—");
    assert.equal(get(`pick_and_place${n}`, "insight9_sdk_vio").status, "rendered");
  }
  const interrupted = get("box02", "insight9_sdk_vio");
  assert.equal(interrupted.status, "recording_interrupted");
  assert.equal(interrupted.status_title, "Recording interrupted");
  assert.equal(interrupted.status_detail, "");
  assert.match(interrupted.note, /camera, IMU and SDK VIO recording stopped together/);
  assert.equal(interrupted.metric, "—");
  assert.equal(interrupted.video, undefined);
  assert.equal(get("pick_and_place01", "ucoslam").status, "pipeline_failed");
  assert.equal(get("pick_and_place01", "openvins_aruco").status, "no_trajectory");
  assert.equal(manifest.items.filter(i => i.video).length, 84);
  for (const item of manifest.items.filter(i => !i.video)) { assert(item.status_detail || item.note); assert.equal(item.timeline, undefined); }
});
test("new AprilVINS rows use the final all15 packet and preserve partial baseline spans", () => {
  for (const slug of ["box02", "pick_and_place01", "pick_and_place02", "pick_and_place03"]) {
    const item = manifest.items.find(i => i.task_slug === slug && i.method_slug === "aprilvins_ours");
    assert.equal(item.sequence.endsWith("__apriltag_4__insta360_x5"), true);
    assert(item.timeline.end_fraction > 0.99);
  }
  const partial = manifest.items.find(i => i.task_slug === "box02" && i.method_slug === "openvins_aruco");
  assert(partial.timeline.end_fraction - partial.timeline.start_fraction < 0.2);
});
test("all successful clips have valid timestamp maps", () => {
  for (const item of manifest.items.filter((i) => i.status === "rendered")) {
    assert(item.timeline, item.sequence);
    assert(item.timeline.end_fraction > item.timeline.start_fraction);
    assert(item.timeline.reference_duration_s > 0);
    assert(item.timeline.start_fraction >= -1e-6);
    assert(item.timeline.end_fraction <= 1 + 1e-6);
  }
});
test("all task rows have sequence-matched full scene recordings", () => {
  let scenes = 0;
  for (const task of manifest.task_order) {
    assert(task.scenes.length > 0);
    assert.equal(task.presentation_duration_s, 16);
    const sequences = manifest.items.filter((i) => i.task_slug === task.slug).map((i) => i.sequence);
    for (const scene of task.scenes) {
      assert(sequences.includes(scene.sequence));
      assert(fs.existsSync(path.join(root, scene.video)), scene.video);
      assert(fs.existsSync(path.join(root, scene.poster)), scene.poster);
      const info = JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=r_frame_rate,width,height", "-of", "json", path.join(root, scene.video)], { encoding: "utf8" }));
      assert(Math.abs(Number(info.format.duration) - 16) < 0.06);
      assert.equal(info.streams[0].width, 640);
      assert.equal(info.streams[0].r_frame_rate, "20/1");
      scenes++;
    }
  }
  assert.equal(scenes, 37);
});
test("all trajectory clips and posters exist and match the shared 16 s clock", () => {
  for (const item of manifest.items.filter(i => i.video)) {
    assert(fs.existsSync(path.join(root, item.video)), item.video);
    assert(fs.existsSync(path.join(root, item.poster)), item.poster);
    const info = JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=r_frame_rate", "-of", "json", path.join(root, item.video)], { encoding: "utf8" }));
    assert(Math.abs(Number(info.format.duration) - 16) < 0.06, item.video);
    assert.equal(info.streams[0].r_frame_rate, "20/1");
  }
});
