// Oathra launch video renderer.
//  1. capture real Arena footage (present mode, dark) at 1920×1080 via headless Chrome
//  2. render video/template.html deterministically frame by frame (30 fps)
//  3. encode MP4 (h264) + poster + README GIF with ffmpeg
// usage: node packages/cli/dist/bin.js demo --no-open --port 4242 &   node scripts/render-video.mjs [--skip-capture] [--out docs/media]
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? true : d; };
const OUT = resolve(flag("--out", "docs/media"));
const BASE = flag("--base", "http://127.0.0.1:4242");
const SCENARIO = flag("--scenario", "restaurant-reservation");
const SKIP_CAPTURE = args.includes("--skip-capture");
const FPS = 30, W = 1920, H = 1080;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORK = resolve("video/.work");
const FOOT = join(WORK, "arena");
const FRAMES = join(WORK, "frames");
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chrome(port, extra = []) {
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", `--user-data-dir=/tmp/oathra-render-${port}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1", ...extra, "about:blank"], { stdio: "ignore" });
  await sleep(1300);
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); };
  return { send, evaluate, shot, close: () => { ws.close(); proc.kill(); } };
}

// ---------------------------------------------------------------------------
// 1. Footage
// ---------------------------------------------------------------------------
async function capture() {
  rmSync(FOOT, { recursive: true, force: true }); mkdirSync(FOOT, { recursive: true });
  const c = await chrome(9341);
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await c.send("Page.navigate", { url: `${BASE}/?present=1&theme=dark&autostart=${SCENARIO}&mode=watch` });
  await sleep(1200);
  const t0 = Date.now();
  const times = [];
  let n = 0, doneAt;
  const CAP_FPS = 10;
  while (Date.now() - t0 < 75000) {
    const at = Date.now() - t0;
    await c.shot(join(FOOT, `f${String(n++).padStart(4, "0")}.png`));
    times.push(at);
    const done = await c.evaluate(`!!document.body.innerText.match(/MISSION COMPLETE|INCOMPLETE|CONSTRAINT VIOLATION|FAILED/)`);
    if (done && !doneAt) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > 3500) break;
    const next = t0 + (n * 1000) / CAP_FPS;
    await sleep(Math.max(0, next - Date.now()));
  }
  // the call id, to align captions with real events
  const callId = await c.evaluate(`(window.__oathraCallId || (document.querySelector('[data-call-id]')||{}).dataset?.callId || '')`).catch(() => "");
  c.close();
  let events = [];
  try {
    const list = await (await fetch(`${BASE}/api/calls`)).json();
    const latest = list.sort((a, b) => b.startedAt - a.startedAt)[0];
    const call = await (await fetch(`${BASE}/api/calls/${callId || latest.id}`)).json();
    events = call.events || [];
  } catch { /* captions fall back to fixed timing */ }
  writeFileSync(join(WORK, "footage.json"), JSON.stringify({ frames: n, times, events }, null, 2));
  console.log(`footage: ${n} frames over ${(times.at(-1) / 1000).toFixed(1)}s`);
}

// Map real call events to caption times inside the arena scene.
function buildCaptions(footage, arenaStart, arenaLen, speed = 1) {
  const ev = footage.events || [];
  // wall-clock (screenshot loop) vs call clock: the call starts ~1s after navigation; estimate offset from first 'call.started' screenshot index
  const find = (pred) => ev.find(pred);
  const tOffer = find((e) => e.type === "transcript.final" && e.source === "callee" && /19時半/.test(e.text))?.t;
  const tVerified = find((e) => e.type === "evidence.verified")?.t;
  const tConfirmed = find((e) => e.type === "evidence.verified" && e.evidence?.field === "confirmed")?.t;
  const tResult = find((e) => e.type === "result")?.t;
  const callToWall = 1000; // ms between navigation and call.started, approximate
  // call clock -> scene clock (footage may be played faster than real time)
  const at = (callMs, fallback) => arenaStart + Math.min(arenaLen - 2500, ((callMs ?? fallback) + callToWall) / speed);
  const caps = [
    { at: arenaStart + 600, text: 'AI vs AI in the simulator, no API key. Mission: a table for two, tomorrow <b>after 19:00</b>.' },
    { at: at(tOffer, 9000) + 300, text: '19:00 is full. The restaurant offers <b>19:30</b>.' },
    { at: at(tVerified, 13000) + 400, text: 'Every field becomes <b>evidence</b> — from the callee’s own words.' },
    { at: at(tConfirmed, 24000) + 200, text: 'Only 「<b>ご予約承りました</b>」 can complete the call.' },
    { at: at(tResult, 30000) + 900, text: '<b>MISSION COMPLETE</b> · verified, not summarized.' },
  ].sort((a, b) => a.at - b.at);
  for (let i = 0; i < caps.length; i++) caps[i].until = caps[i + 1]?.at ?? Infinity;
  // trim footage so the result card lands before the scene ends
  return caps;
}

// ---------------------------------------------------------------------------
// 2. Render
// ---------------------------------------------------------------------------
async function renderFrames() {
  rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });
  const footage = existsSync(join(WORK, "footage.json")) ? JSON.parse(readFileSync(join(WORK, "footage.json"), "utf8")) : { frames: 0, times: [], events: [] };
  const frameFiles = existsSync(FOOT) ? readdirSync(FOOT).filter((f) => f.endsWith(".png")).sort().map((f) => pathToFileURL(join(FOOT, f)).href) : [];
  const c = await chrome(9342, ["--allow-file-access-from-files"]);
  await c.send("Page.navigate", { url: pathToFileURL(resolve("video/template.html")).href });
  await sleep(2500); // fonts
  const T = await c.evaluate("window.__TIMELINE__");
  const [a0, a1] = T.arena;
  // Fit the footage into the arena scene: play from the frame where the call connects; speed up if longer than the scene.
  const total = footage.times.at(-1) || 0;
  const scene = a1 - a0;
  const fps = footage.frames / Math.max(1, total / 1000);
  const speed0 = total > scene ? total / scene : 1;
  const captions = buildCaptions(footage, a0, scene, speed0);
  console.log("captions:", captions.map((c) => `${(c.at / 1000).toFixed(1)}s ${c.text.replace(/<[^>]+>/g, "")}`).join(" | "));
  const speed = total > scene ? total / scene : 1; // >1 = play faster
  await c.evaluate(`window.__FOOTAGE__ = ${JSON.stringify({ frames: frameFiles, fps: fps * speed, offsetMs: 0, captions })}; window.render(0); true`);
  const duration = T.end[1];
  const n = Math.ceil((duration / 1000) * FPS);
  console.log(`rendering ${n} frames (${(duration / 1000).toFixed(1)}s @ ${FPS}fps), footage speed ×${speed.toFixed(2)}`);
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    const t = Math.round((i * 1000) / FPS);
    await c.evaluate(`window.render(${t}); true`);
    if (t >= a0 && t < a1) {
      // wait for the footage frame to decode before capturing
      await c.evaluate(`(async () => { const i = document.getElementById('arena-img'); try { await i.decode(); } catch {} await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`);
    }
    await c.shot(join(FRAMES, `f${String(i).padStart(5, "0")}.png`));
    if (i % 150 === 0) console.log(`  ${i}/${n}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  c.close();
  return n;
}

// ---------------------------------------------------------------------------
// 3. Encode
// ---------------------------------------------------------------------------
function encode() {
  const mp4 = join(OUT, "oathra-launch.mp4"), gif = join(OUT, "oathra-launch.gif"), poster = join(OUT, "oathra-launch-poster.png"), sq = join(OUT, "oathra-launch-square.mp4");
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${FRAMES}/f%05d.png -vf "format=yuv420p" -c:v libx264 -preset slow -crf 20 -movflags +faststart ${mp4}`);
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${FRAMES}/f%05d.png -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ${gif}`);
  execSync(`ffmpeg -y -loglevel error -ss 1.9 -i ${mp4} -frames:v 1 ${poster}`);
  // 1:1 crop for feeds (center 1080×1080)
  execSync(`ffmpeg -y -loglevel error -i ${mp4} -vf "crop=1080:1080:420:0" -c:v libx264 -preset slow -crf 20 -movflags +faststart ${sq}`);
  console.log("wrote", mp4, gif, poster, sq);
}

if (!SKIP_CAPTURE) await capture();
await renderFrames();
encode();
