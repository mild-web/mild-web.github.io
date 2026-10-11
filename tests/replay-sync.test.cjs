const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { mappedClipTime } = require("../assets/js/replay-row-sync.js");
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
test("paper metrics, statuses, sequence IDs and method ordering are unchanged", () => {
  const original = JSON.parse(cp.execFileSync("git", ["show", "origin/main:assets/videos/replay_matrix_manifest.json"], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(manifest.method_order, original.method_order);
  for (let i = 0; i < original.items.length; i++) {
    for (const [key, value] of Object.entries(original.items[i])) assert.deepEqual(manifest.items[i][key], value);
  }
  assert.equal(manifest.items.length, 66);
  assert.equal(manifest.task_order.length, 11);
  assert.equal(manifest.items.filter((i) => i.status === "fail_video_table_cross").length, 3);
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
  assert.equal(scenes, 29);
});
