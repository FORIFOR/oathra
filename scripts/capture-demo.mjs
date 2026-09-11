// Records the Arena "Watch" call as frames via headless Chrome (CDP), then encodes MP4 + GIF with ffmpeg.
// usage: node packages/cli/dist/bin.js demo --no-open &  node scripts/capture-demo.mjs docs/media [baseUrl] [scenarioTitle]
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.argv[2] ?? "docs/media";
const BASE = process.argv[3] ?? "http://127.0.0.1:4242";
const SCENARIO = process.argv[4] ?? "Restaurant Reservation";
const PORT = 9334;
const W = 1280, H = 820, FPS = 4, MAX_SECONDS = 70;
const frames = join(OUT, ".frames");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check", "--user-data-dir=/tmp/oathra-demo-profile", `--window-size=${W},${H}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await send("Page.navigate", { url: BASE });
await sleep(1500);
let n = 0;
const shot = async () => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(frames, `f${String(n++).padStart(4, "0")}.png`), Buffer.from(r.data, "base64")); };
for (let i = 0; i < FPS * 2; i++) { await shot(); await sleep(1000 / FPS); }
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(SCENARIO)})); if(b) b.click(); return !!b; })()`);
const start = Date.now();
let doneAt;
while (Date.now() - start < MAX_SECONDS * 1000) {
  await shot();
  const done = await evaluate(`!!document.body.innerText.match(/MISSION COMPLETE|INCOMPLETE|CONSTRAINT VIOLATION|FAILED/)`);
  if (done && !doneAt) doneAt = Date.now();
  if (doneAt && Date.now() - doneAt > 4000) break;
  await sleep(1000 / FPS);
}
ws.close(); chrome.kill();
console.log(`frames: ${n} (${(n / FPS).toFixed(1)}s)`);
const mp4 = join(OUT, "demo-arena.mp4"), gif = join(OUT, "demo-arena.gif");
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${frames}/f%04d.png -vf "scale=1280:-2,format=yuv420p" -c:v libx264 -preset slow -crf 23 -movflags +faststart ${mp4}`);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${frames}/f%04d.png -vf "fps=${FPS},scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ${gif}`);
rmSync(frames, { recursive: true, force: true });
console.log("wrote", mp4, gif);
