// Extract existing rendered first frames; do not run estimators or alter data.
// Default is a read-only plan; --build creates only missing first-frame JPEGs.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import playback from "../assets/js/replay-row-sync.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "assets/videos/replay_matrix_manifest.json")));
const jobs = data.items.filter(i => i.status === "rendered" && i.timeline.start_fraction > 0).map(item => ({
  task:item.task_slug, method:item.method_slug, input:path.join(root,item.video),
  output:path.join(root,playback.heldFramePath(item,{inside:false,phase:"Not started"}))
}));
if (!process.argv.includes("--build")) {
  console.log(JSON.stringify({first_frames:jobs.length,missing:jobs.filter(j=>!fs.existsSync(j.output)).length}));
} else {
  let cursor=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(cursor<jobs.length){
      const job=jobs[cursor++];
      if(fs.existsSync(job.output)) continue;
      await new Promise((resolve,reject)=>{
        const child=spawn("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-threads","1","-i",job.input,"-frames:v","1","-vf","scale=640:-2","-q:v","3","-threads","1",job.output]);
        let error="";child.stderr.on("data",s=>error+=s);child.once("error",reject);
        child.once("exit",code=>code===0?resolve():reject(new Error(error||`ffmpeg exit ${code}`)));
      });
      console.log(JSON.stringify({task:job.task,method:job.method,first_frame:"extracted"}));
    }
  }));
}
