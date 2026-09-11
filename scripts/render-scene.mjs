// Generic deterministic HTML-scene renderer (no live footage): template + data JSON -> MP4 / GIF / poster / 1:1.
// usage: node scripts/render-scene.mjs --template video/battle.html --data video/.work/battle.json --lang ja --name oathra-battle-ja [--preview 1500,5000]
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? true : d; };
const TEMPLATE = resolve(flag("--template", "video/battle.html"));
const DATA = flag("--data") ? JSON.parse(readFileSync(resolve(flag("--data")), "utf8")) : {};
const LANG = flag("--lang", "ja");
const NAME = flag("--name", "oathra-scene");
const OUT = resolve(flag("--out", "docs/media"));
const PREVIEW = flag("--preview") ? String(flag("--preview")).split(",").map(Number) : null;
const FPS = 30, W = 1920, H = 1080, PORT = 9350;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FRAMES = resolve(`video/.work/frames-${NAME}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=/tmp/oathra-scene-${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
await sleep(1300);
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pathToFileURL(TEMPLATE).href + `?lang=${LANG}` }); await sleep(2500);
await evaluate(`window.__DATA__ = ${JSON.stringify(DATA)}; window.render(0); true`);
const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); };
if (PREVIEW) {
  mkdirSync(OUT, { recursive: true });
  for (const t of PREVIEW) { await evaluate(`window.render(${t}); true`); await sleep(60); await shot(join(OUT, `${NAME}-t${t}.png`)); }
  ws.close(); proc.kill(); console.log("previews written to", OUT); process.exit(0);
}
const T = await evaluate("window.__TIMELINE__");
const duration = Math.max(...Object.values(T).map((r) => r[1]));
const n = Math.ceil((duration / 1000) * FPS);
rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true }); mkdirSync(OUT, { recursive: true });
console.log(`rendering ${n} frames (${(duration / 1000).toFixed(1)}s)`);
for (let i = 0; i < n; i++) { await evaluate(`window.render(${Math.round((i * 1000) / FPS)}); true`); await shot(join(FRAMES, `f${String(i).padStart(5, "0")}.png`)); }
ws.close(); proc.kill();
const mp4 = join(OUT, `${NAME}.mp4`), gif = join(OUT, `${NAME}.gif`), poster = join(OUT, `${NAME}-poster.png`), sq = join(OUT, `${NAME}-square.mp4`);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${FRAMES}/f%05d.png -vf "format=yuv420p" -c:v libx264 -preset slow -crf 20 -movflags +faststart ${mp4}`);
execSync(`ffmpeg -y -loglevel error -i ${mp4} -vf "fps=10,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ${gif}`);
execSync(`ffmpeg -y -loglevel error -ss 1.8 -i ${mp4} -frames:v 1 ${poster}`);
execSync(`ffmpeg -y -loglevel error -i ${mp4} -vf "crop=1080:1080:420:0" -c:v libx264 -preset slow -crf 20 -movflags +faststart ${sq}`);
rmSync(FRAMES, { recursive: true, force: true });
console.log("wrote", mp4, gif, poster, sq);
