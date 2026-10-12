// Refresh only the black table-cross placeholders. Normal trajectories are untouched.
// Run from any directory: node scripts/render-fail-clips.mjs
// Requires Node.js, FFmpeg (libx264 + drawtext), and the DejaVu Sans font.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(site, "assets/videos/replay_matrix_manifest.json"), "utf8"));
const items = manifest.items.filter(item => item.status === "fail_video_table_cross");
const filter = "drawtext=font='DejaVu Sans':text='Fail':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2";
for (const item of items) {
  for (const key of ["video", "poster"]) {
    if (!item[key]?.startsWith("assets/") || !path.resolve(site, item[key]).startsWith(site + path.sep)) {
      throw new Error("Failure asset path must stay inside this repository.");
    }
  }
  const video = path.join(site, item.video), poster = path.join(site, item.poster);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-filter_threads", "1", "-f", "lavfi", "-i", "color=c=black:s=1152x712:r=20",
    "-vf", filter, "-t", "16", "-an", "-c:v", "libx264", "-threads", "2",
    "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { stdio: "inherit" });
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-i", video, "-frames:v", "1", "-threads", "1", poster], { stdio: "inherit" });
  console.log(JSON.stringify({task: item.task_slug, method: item.method_slug, video: item.video, poster: item.poster, text: "Fail"}));
}
