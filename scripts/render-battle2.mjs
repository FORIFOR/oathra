// Battle video v2: a desktop "screen recording" of three real Arena windows replaying real calls,
// with the recorded lines voiced, keystrokes, ringback and a hang-up. Frames are rendered by
// video/battle2.html through headless Chrome; audio is mixed by ffmpeg from video/.work/{tts,sfx}.
// usage: node packages/cli/dist/bin.js demo --no-open --port 4242 &
//        node scripts/render-battle2.mjs --data video/.work/battle.json --name oathra-battle-ja [--preview 2000,12000] [--out docs/media]
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? true : d; };
const TEMPLATE = resolve(flag("--template", "video/battle2.html"));
const DATA = JSON.parse(readFileSync(resolve(flag("--data", "video/.work/battle.json")), "utf8"));
const NAME = flag("--name", "oathra-battle-ja");
const OUT = resolve(flag("--out", "docs/media"));
const BASE = flag("--base", "http://127.0.0.1:4242");
const PREVIEW = flag("--preview") ? String(flag("--preview")).split(",").map(Number) : null;
const WORK = resolve("video/.work");
const FPS = 30, W = 1920, H = 1080, PORT = 9352;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FRAMES = join(WORK, `frames-${NAME}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// measured voice durations (trimmed clips)
const dur = (f) => Math.round(parseFloat(execSync(`soxi -D ${f}`).toString()) * 1000);
const DUR = {}; for (const v of ["g1", "h1", "g2", "h3", "hf"]) DUR[v] = dur(join(WORK, "tts", `${v}-ft.wav`));

const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=/tmp/oathra-b2-${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
await sleep(1300);
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
await send("Page.enable"); await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// durations must be known before the template builds its timeline
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__DUR__ = ${JSON.stringify(DUR)}; window.__DATA__ = ${JSON.stringify(DATA)};` });
await send("Page.navigate", { url: pathToFileURL(TEMPLATE).href + `?base=${encodeURIComponent(BASE)}` });
for (let i = 0; i < 60; i++) { await sleep(500); if (await evaluate("window.__READY__ && window.__READY__()")) break; if (i === 59) throw new Error("Arena iframes did not become ready — is the demo server running on " + BASE + "?"); }
await sleep(800);
const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); };
const duration = await evaluate("window.__DURATION__");
const beats = await evaluate("JSON.stringify(window.__BEATS__)");
console.log(`duration ${(duration / 1000).toFixed(1)}s; beats: ${JSON.parse(beats).map((b) => `${b.name}@${(b.start / 1000).toFixed(1)}`).join(" ")}`);

if (PREVIEW) {
  mkdirSync(OUT, { recursive: true });
  for (const t of PREVIEW) { await evaluate(`window.render(${t})`); await sleep(120); await shot(join(OUT, `${NAME}-t${t}.png`)); }
  ws.close(); proc.kill(); console.log("previews written to", OUT); process.exit(0);
}

// ---- frames
const n = Math.ceil((duration / 1000) * FPS);
rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true }); mkdirSync(OUT, { recursive: true });
console.log(`rendering ${n} frames`);
for (let i = 0; i < n; i++) {
  await evaluate(`window.render(${Math.round((i * 1000) / FPS)})`);
  await shot(join(FRAMES, `f${String(i).padStart(5, "0")}.png`));
  if (i % 300 === 0) console.log(`  ${i}/${n}`);
}
const audioPlan = await evaluate("JSON.stringify(window.__AUDIO__)");
ws.close(); proc.kill();

// ---- audio mix: room tone + every scheduled clip at its offset; hotel lines through a phone band-pass
const plan = JSON.parse(audioPlan);
const inputs = [`-i ${join(WORK, "sfx", "room.wav")}`];
const chains = [`[0:a]atrim=0:${(duration / 1000).toFixed(3)},aformat=sample_rates=48000:channel_layouts=mono[a0]`];
plan.forEach((p, i) => {
  const f = join(WORK, p.file); if (!existsSync(f)) throw new Error("missing audio " + f);
  inputs.push(`-i ${f}`);
  const eq = p.phone ? "highpass=f=280,lowpass=f=3600,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120," : "";
  chains.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=mono,${eq}volume=${(p.gain ?? 0).toFixed(1)}dB,adelay=${Math.round(p.at)}|${Math.round(p.at)}[a${i + 1}]`);
});
const mixIn = plan.map((_, i) => `[a${i + 1}]`).join("") + "[a0]";
// static gain to -16 LUFS (a one-pass loudnorm would pump the quiet parts up and flatten the mix)
const filter = chains.join(";") + `;${mixIn}amix=inputs=${plan.length + 1}:normalize=0:dropout_transition=0[out]`;
const raw = join(WORK, `${NAME}-mix-raw.wav`), mix = join(WORK, `${NAME}-mix.wav`);
writeFileSync(join(WORK, `${NAME}-filter.txt`), filter); writeFileSync(join(WORK, `${NAME}-plan.json`), JSON.stringify(plan, null, 1));
execSync(`ffmpeg -y -loglevel error ${inputs.join(" ")} -filter_complex_script ${join(WORK, `${NAME}-filter.txt`)} -map "[out]" -t ${(duration / 1000).toFixed(3)} ${raw}`);
const lufs = parseFloat((execSync(`ffmpeg -i ${raw} -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1`).toString().match(/I:\s+(-?[0-9.]+)/) || [])[1] ?? "-23");
execSync(`ffmpeg -y -loglevel error -i ${raw} -af "volume=${(-16 - lufs).toFixed(1)}dB,alimiter=limit=0.85:attack=5:release=60" ${mix}`);

// ---- encode
const mp4 = join(OUT, `${NAME}.mp4`), gif = join(OUT, `${NAME}.gif`), poster = join(OUT, `${NAME}-poster.png`), sq = join(OUT, `${NAME}-square.mp4`);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${FRAMES}/f%05d.png -i ${mix} -vf "format=yuv420p" -c:v libx264 -preset slow -crf 20 -c:a aac -b:a 160k -ac 2 -shortest -movflags +faststart ${mp4}`);
execSync(`ffmpeg -y -loglevel error -i ${mp4} -vf "fps=8,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ${gif}`);
execSync(`ffmpeg -y -loglevel error -ss 21 -i ${mp4} -frames:v 1 ${poster}`);
execSync(`ffmpeg -y -loglevel error -i ${mp4} -vf "crop=1080:1080:420:0" -c:v libx264 -preset slow -crf 20 -c:a copy -movflags +faststart ${sq}`);
rmSync(FRAMES, { recursive: true, force: true });
console.log("wrote", mp4, gif, poster, sq);
