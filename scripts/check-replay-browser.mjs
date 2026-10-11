// Browser regression checks using an isolated installed Chrome and native CDP.
// No npm packages, remote backend calls, or existing browser profile required.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = process.argv[2] || path.join(os.tmpdir(), "mild-comparison-browser-results");
fs.mkdirSync(artifactRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mild-comparison-chrome-"));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  let file;
  try { file = path.resolve(site, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Accept-Ranges": "bytes" };
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416).end(); return; }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else { res.writeHead(200, { ...headers, "Content-Length": size }); fs.createReadStream(file).pipe(res); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let log = "", browserSocket;
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Chrome startup timeout")), 15000);
  chrome.stderr.on("data", (s) => { log += s; const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log); if (match) { clearTimeout(timer); resolve(match[1]); } });
  chrome.once("error", reject);
});
const pending = new Map(), exceptions = [];
let next = 1, sessionId;
function send(method, params = {}, withSession = true) {
  const id = next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    browserSocket.send(JSON.stringify({ id, method, params, ...(withSession && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, seconds = 15) {
  const stop = Date.now() + seconds * 1000;
  while (Date.now() < stop) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`Browser condition timed out: ${expression}`);
}
const report = { checks: [], exceptions };
try {
  browserSocket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { browserSocket.addEventListener("open", resolve, { once: true }); browserSocket.addEventListener("error", reject, { once: true }); });
  browserSocket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await until("document.querySelectorAll('.replay-row[data-task]').length === 15");
  assert.equal(await evaluate("document.querySelectorAll('.replay-scene-video').length"), 15);
  assert.equal(await evaluate("document.querySelectorAll('.replay-cell').length"), 90);
  assert.equal(await evaluate("document.querySelectorAll('.replay-cell video').length"), 84);
  assert.equal(await evaluate("document.querySelectorAll('.replay-cell.is-fail').length"), 4);
  assert.equal(await evaluate("document.querySelectorAll('.replay-status-panel').length"), 6);
  assert.equal(await evaluate("document.querySelectorAll('[data-status=recording_invalid]').length"), 3);
  assert(await evaluate("document.querySelector('[data-task=box02] [data-method=insight9_sdk_vio]').dataset.status === 'recording_interrupted'"));
  assert(await evaluate("document.querySelector('[data-task=box02] [data-method=insight9_sdk_vio] .replay-status-title').textContent === 'Recording interrupted'"));
  assert(await evaluate("document.querySelector('[data-task=box02] [data-method=insight9_sdk_vio] .replay-badge').textContent === 'Recording interrupted'"));
  assert(await evaluate("!document.querySelector('[data-task=box02] [data-method=insight9_sdk_vio] .replay-status-detail')"));
  assert(await evaluate("document.querySelector('.comparison-recording-note').textContent.includes('camera, IMU, and SDK VIO recording stopped together')"));
  assert(await evaluate("!document.querySelector('[data-task=box02] [data-method=insight9_sdk_vio]').classList.contains('is-fail')"));
  assert(await evaluate("document.querySelector('.event-video-section strong').textContent === 'APE RMSE (m) / time completion'"));
  report.checks.push("15 task rows, 90 method cells, 84 clips and 6 reason-labelled status tiles");
  await evaluate("document.querySelector('.replay-row[data-task]').scrollIntoView({block:'center'}); window.row = document.querySelector('.replay-row[data-task]'); window.shell = document.getElementById('replayMatrixShell');");
  await until("row.querySelector('.replay-scene-video').readyState >= 3 && [...row.querySelectorAll('.replay-cell video')].filter(v=>v.getAttribute('src')).every(v=>v.readyState>=3)");
  await delay(1700);
  assert(Number(await evaluate("row.dataset.time")) > 0.5, "Row should autoplay forward");
  report.checks.push("Shared row playback advances");

  const snapshot = `(() => {
    const p=Number(row.dataset.time)/16;
    return [...row.querySelectorAll('video')].filter(v=>v.getAttribute('src') && v.getBoundingClientRect().right > shell.getBoundingClientRect().left && v.getBoundingClientRect().left < shell.getBoundingClientRect().right)
      .map(v=>{const a=Number(v.dataset.syncStart), b=Number(v.dataset.syncEnd), expected=Math.max(0,Math.min(1,(p-a)/(b-a)))*15.95;return {label:v.getAttribute('aria-label'),time:v.currentTime,expected,error:Math.abs(v.currentTime-expected),paused:v.paused,ready:v.readyState};});
  })()`;
  const live = await evaluate(snapshot); report.live_sync = live;
  assert(live.length >= 3); assert(live.every((v) => v.error < 0.16), "Visible clips should share source-progress clock");
  await evaluate("if(row.dataset.paused==='false') row.querySelector('.replay-row-play').click()");
  const stopped = Number(await evaluate("row.dataset.time")); await delay(400);
  assert(Math.abs(Number(await evaluate("row.dataset.time")) - stopped) < 0.01);
  assert((await evaluate(snapshot)).every((v) => v.paused));
  report.checks.push("Pause affects scene and all visible methods");

  await evaluate("row.querySelector('input').value='8';row.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}))");
  await delay(500); const sought = await evaluate(snapshot); report.seek_sync = sought;
  assert(sought.every((v) => v.error < 0.07)); report.checks.push("Shared seek respects each clip's original time interval");
  await evaluate("shell.scrollLeft=shell.scrollWidth");
  await until("row.querySelector('[data-method=aprilvins_ours] video').readyState>=3"); await delay(500);
  const scrolled = await evaluate(snapshot); report.horizontal_sync = scrolled;
  assert(scrolled.some((v) => /AprilVINS/.test(v.label))); assert(scrolled.every((v) => v.error < 0.07));
  const pinned = await evaluate("Math.abs(row.querySelector('.replay-task-header').getBoundingClientRect().left-shell.getBoundingClientRect().left)");
  assert(pinned < 20); report.checks.push("Horizontal scroll keeps task preview pinned and newly visible methods aligned");

  await evaluate("row.querySelector('.replay-scene-selector').value='1';row.querySelector('.replay-scene-selector').dispatchEvent(new Event('change',{bubbles:true}))");
  await until("row.querySelector('.replay-scene-video').readyState>=3 && row.querySelector('.replay-scene-video').currentSrc.includes('aruco_4')");
  await delay(400); assert((await evaluate(snapshot)).every((v) => v.error < 0.07));
  report.checks.push("Scene selector keeps current shared playback position");

  await evaluate("row.querySelector('.replay-row-rate').value='2';row.querySelector('.replay-row-rate').dispatchEvent(new Event('change',{bubbles:true}));row.querySelector('input').value='15.8';row.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}));row.querySelector('.replay-row-play').click()");
  await until("Number(row.dataset.time)<2");
  report.checks.push("Shared speed control and common loop restart");
  const rowReports = [];
  await evaluate("document.documentElement.style.scrollBehavior='auto';document.querySelectorAll('.replay-row[data-task]').forEach(r=>{if(r.dataset.paused==='false')r.querySelector('.replay-row-play').click()})");
  for (let i = 0; i < 15; i++) {
    console.log(JSON.stringify({ checking_task_row: i + 1 }));
    await evaluate(`window.row=document.querySelectorAll('.replay-row[data-task]')[${i}];row.scrollIntoView({block:'center'});shell.scrollLeft=shell.scrollWidth;row.querySelector('input').value='8';row.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}))`);
    await until("row.querySelector('.replay-scene-video').readyState>=3 && row.querySelector('[data-method=aprilvins_ours] video').readyState>=3");
    await delay(250);
    const state = await evaluate(snapshot);
    assert(state.every((v) => v.error < 0.07), `Shared seek failed on row ${i}`);
    rowReports.push({ task: await evaluate("row.dataset.task"), max_error_s: Math.max(...state.map((v) => v.error)) });
  }
  report.all_row_seeks = rowReports;
  report.checks.push("All 15 task rows preserve shared source-progress position after seeking");
  await evaluate("window.row=document.querySelector('.replay-row[data-task]');row.scrollIntoView({block:'center'})");
  await evaluate("if(row.dataset.paused==='false')row.querySelector('.replay-row-play').click();row.querySelector('input').value='8';row.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}))");
  await delay(500);
  const savedTime = Number(await evaluate("row.dataset.time"));
  await evaluate("window.scrollTo(0,document.body.scrollHeight)"); await delay(400);
  assert(Math.abs(Number(await evaluate("row.dataset.time")) - savedTime) < 0.01);
  assert(await evaluate("[...row.querySelectorAll('video')].every(v=>v.paused)"));
  report.checks.push("Off-screen rows do not play independently");
  await evaluate("row.scrollIntoView({block:'center'})"); await delay(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(artifactRoot, "comparison-desktop.png"), Buffer.from(shot.data, "base64"));

  for (const task of ["box02", "pick_and_place01"]) {
    await evaluate(`window.row=document.querySelector('.replay-row[data-task=${task}]');row.scrollIntoView({block:'center'});shell.scrollLeft=${task === "box02" ? 1000 : 1500};row.querySelector('input').value='8';row.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}))`);
    await until("row.querySelector('.replay-scene-video').readyState>=3"); await delay(400);
    const newShot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(artifactRoot, `comparison-${task}.png`), Buffer.from(newShot.data, "base64"));
  }
  await evaluate("window.row=document.querySelector('.replay-row[data-task]')");

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("shell.scrollLeft=0;row.scrollIntoView({block:'center'})"); await delay(500);
  const mobile = await evaluate("({ page:document.documentElement.clientWidth, width:shell.getBoundingClientRect().width, header:row.querySelector('.replay-task-header').getBoundingClientRect().width })");
  assert(mobile.width <= mobile.page); assert(mobile.header <= 220);
  const mobileShot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(artifactRoot, "comparison-mobile.png"), Buffer.from(mobileShot.data, "base64"));
  report.checks.push("Mobile matrix stays within the page width");
  assert.equal(exceptions.length, 0);
  report.passed = true;
  console.log(JSON.stringify(report));
} catch (error) {
  report.passed = false; report.error = error.message;
  report.chrome_log_tail = log.slice(-3000);
  if (browserSocket?.readyState === 1 && sessionId) {
    try { report.debug = await evaluate("({rows:document.querySelectorAll('.replay-row').length,state:typeof row!=='undefined'?row.dataset:null,videos:typeof row!=='undefined'?[...row.querySelectorAll('video')].map(v=>({src:v.currentSrc,time:v.currentTime,ready:v.readyState,paused:v.paused,seeking:v.seeking,error:v.error?.code})):[]})"); } catch {}
  }
  console.log(JSON.stringify(report)); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(artifactRoot, "browser-check.json"), JSON.stringify(report, null, 2) + "\n");
  browserSocket?.close(); chrome.kill("SIGTERM"); server.closeAllConnections(); server.close();
}
