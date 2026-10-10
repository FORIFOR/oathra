#!/usr/bin/env node
// Record the shipped, interactive simulation UI. No generated UI frames or remote providers.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw Error(`Missing value for ${name}`);
  return args[index + 1];
};
const BASE = new URL(flag("--base", "http://127.0.0.1:4318"));
const OUT = resolve(ROOT, flag("--out", "docs/media"));
const REVIEW = resolve(ROOT, flag("--artifacts", "artifacts/use-cases"));
const CHROME = flag("--chrome", process.env.OATHRA_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || "ffprobe";
const WIDTH = 1440, HEIGHT = 900, FPS = 25;
const DURATION = Number(flag("--duration", "50"));
const DISCLOSURE = "構想デモ・実際の発信/予約は行いません";
const definitions = {
  restaurant: {
    title: "近隣の飲食店を予約する",
    scenario: "normal",
    values: { "input-time": "19:00", "input-budget": "4000", "input-partySize": "2" },
    captions: [
      "近隣の架空店舗を選び、予約条件を入力します。",
      "日時・人数・予算を確認。条件を越える予約は許可しません。",
      "電話先、伝える情報、予約できる範囲を本人が確認します。",
      "承認して初めて、シミュレーションの通話を開始します。",
      "店の返答を一つずつ確認し、条件と照合します。",
      "通話が終わっただけでは、予約成立にはしません。",
      "相手の明確な確約と条件がそろった結果を表示します。",
    ],
  },
  stock: {
    title: "型番を指定して在庫を取り置く",
    scenario: "normal",
    values: {},
    captions: [
      "架空の製品を型番で指定し、在庫を確認します。",
      "価格の上限と受取期限を確認します。",
      "無料・購入義務なしの取り置きだけを承認します。",
      "本人の承認後、シミュレーションの通話を開始します。",
      "型番・価格・期限を、店の返答と照合します。",
      "手数料や購入義務が発生する条件には進みません。",
      "費用と購入義務がないことを含め、取り置き結果を確認します。",
    ],
  },
  modify: {
    title: "予約を変更できないときは元の予約を守る",
    scenario: "declined",
    values: { "input-time": "20:00" },
    captions: [
      "架空の既存予約を、19時から20時へ変更します。",
      "変更できないときは、元の19時の予約を維持します。",
      "変更の範囲と、元の予約を取り消さない条件を確認します。",
      "本人の承認後、シミュレーションの通話を開始します。",
      "店の回答を確認し、変更の可否を判断します。",
      "変更を断られても、元の予約を取り消しません。",
      "変更不成立と、元の19時の予約の状態を確認します。",
    ],
  },
};

if (args.includes("--help")) {
  console.log("Usage: node scripts/record-use-cases.mjs [--base http://127.0.0.1:4318] [--flow restaurant|stock|modify|all] [--duration 50] [--out docs/media] [--artifacts artifacts/use-cases] [--chrome /path/to/chrome] [--verify-only]\nSet OATHRA_PLAYWRIGHT_MODULE to an existing playwright-core/index.mjs when the package is not installed here. No dependencies or browsers are downloaded. --keep-frames retains original screencast JPEGs.");
  process.exit(0);
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(BASE.hostname) || BASE.protocol !== "http:") {
  throw Error("Recording is restricted to an HTTP loopback simulation server.");
}
if (!Number.isFinite(DURATION) || DURATION < 40 || DURATION > 60) throw Error("Duration must be 40–60 seconds.");
const selected = flag("--flow", "all");
const flows = selected === "all" ? Object.keys(definitions) : [selected];
if (flows.some(flow => !definitions[flow])) throw Error(`Unknown flow: ${selected}`);

async function run(command, argv) {
  return new Promise((done, reject) => {
    const child = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => code === 0 ? done(Buffer.concat(stdout).toString()) : reject(Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString().slice(-4000)}`)));
  });
}

// Draw a pointer that follows the same native mouse events used for the actual clicks.
const POINTER = () => {
  const install = () => {
    const dot = document.createElement("div");
    dot.id = "__oathra_recording_pointer";
    dot.style.cssText = "position:fixed;left:-60px;top:-60px;width:16px;height:16px;border-radius:50%;background:#ef8b32;border:3px solid white;box-shadow:0 2px 9px #0005;transform:translate(-50%,-50%);z-index:2147483647;pointer-events:none";
    document.body.append(dot);
    addEventListener("mousemove", event => { dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; }, true);
    addEventListener("mousedown", () => { dot.style.scale = "0.75"; }, true);
    addEventListener("mouseup", () => { dot.style.scale = "1"; }, true);
  };
  if (document.body) install(); else addEventListener("DOMContentLoaded", install, { once: true });
};

async function loadBrowserLibrary() {
  const module = process.env.OATHRA_PLAYWRIGHT_MODULE;
  try { return await import(module ? (isAbsolute(module) ? pathToFileURL(module).href : module) : "playwright-core"); }
  catch (cause) { throw Error("playwright-core is unavailable. Set OATHRA_PLAYWRIGHT_MODULE to an existing local playwright-core/index.mjs. This script never installs software.", { cause }); }
}

async function auditPage(page, label) {
  const audit = await page.evaluate(({ disclosure, label }) => {
    const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none";
    const banner = document.querySelector('[data-testid="disclaimer"]') || [...document.querySelectorAll("body *")].find(element => element.children.length === 0 && element.textContent.trim() === disclosure);
    const caption = document.querySelector('[data-testid="demo-caption"]');
    const bounds = element => {
      if (!visible(element)) return null;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, fontSize: parseFloat(style.fontSize), overflow: element.scrollWidth > element.clientWidth + 1, text: element.textContent.trim() };
    };
    return { label, disclosure: bounds(banner), caption: bounds(caption), controls: [...document.querySelectorAll("#screen button")].map(bounds).filter(Boolean), horizontalOverflow: document.documentElement.scrollWidth > innerWidth, text: document.body.innerText };
  }, { disclosure: DISCLOSURE, label });
  const banner = audit.disclosure;
  if (!banner || banner.text !== DISCLOSURE || banner.fontSize < 18 || banner.left < 0 || banner.top < 0 || banner.right > WIDTH || banner.bottom > HEIGHT || banner.overflow) {
    throw Error(`Disclosure is missing, too small, clipped, or outside the viewport at ${label}: ${JSON.stringify(banner)}`);
  }
  if (audit.horizontalOverflow) throw Error(`Horizontal page overflow at ${label}`);
  const caption = audit.caption;
  if (caption && (caption.fontSize < 22 || caption.overflow || caption.left < 0 || caption.top < 0 || caption.right > WIDTH || caption.bottom > HEIGHT)) {
    throw Error(`Caption is too small or clipped at ${label}: ${JSON.stringify(caption)}`);
  }
  if (caption && audit.controls.some(control => control.bottom > caption.top || control.top < banner.bottom)) throw Error(`A demo control is hidden behind the disclosure or subtitle at ${label}`);
  return audit;
}

async function record(browser, flow) {
  const definition = definitions[flow];
  const raw = join(REVIEW, `raw-${flow}`);
  await mkdir(raw, { recursive: true });
  const requested = [], blocked = [], errors = [], marks = [], audits = [], frames = [], writes = [];
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, locale: "ja-JP", colorScheme: "light", serviceWorkers: "block" });
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === BASE.origin && ["GET", "HEAD"].includes(request.method())) {
      requested.push({ method: request.method(), path: url.pathname });
      return route.continue();
    }
    blocked.push({ method: request.method(), origin: url.origin, path: url.pathname });
    return route.abort("blockedbyclient");
  });
  await context.addInitScript(POINTER);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL("demos/", `${BASE.href.replace(/\/$/, "")}/`);
  url.searchParams.set("flow", flow); url.searchParams.set("capture", "1");
  let session, startedAt;
  const mark = (action, detail = {}) => marks.push({ seconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)), action, ...detail });
  const caption = async (index) => { await page.evaluate(text => window.setDemoCaption(text), definition.captions[index]); mark("caption", { text: definition.captions[index] }); };
  const at = async seconds => { const remaining = seconds * 1000 - (performance.now() - startedAt); if (remaining > 0) await page.waitForTimeout(remaining); };
  const click = async id => {
    const locator = page.getByTestId(id);
    await locator.waitFor({ state: "visible" });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await page.waitForTimeout(140); await locator.click(); mark("click", { testId: id });
  };
  try {
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.setDemoCaption === "function");
    await page.evaluate(() => document.fonts.ready);
    const scenario = page.getByTestId("scenario");
    if (await scenario.count()) {
      const values = await scenario.locator("option").evaluateAll(options => options.map(option => option.value));
      if (!values.includes(definition.scenario)) throw Error(`Scenario ${definition.scenario} unavailable for ${flow}. Found: ${values.join(", ")}`);
      if (await scenario.inputValue() !== definition.scenario) await scenario.selectOption(definition.scenario);
    }
    await page.evaluate(text => window.setDemoCaption(text), definition.captions[0]);
    // Start on the readable UI rather than a focus ring left by choosing the demo scenario.
    // This is an ordinary click in the unused page margin, with no application state change.
    await page.mouse.click(WIDTH - 24, 140);
    await page.mouse.move(-24, -24);
    audits.push(await auditPage(page, "before-recording"));
    session = await context.newCDPSession(page);
    let firstResolve;
    const firstFrame = new Promise(resolve => { firstResolve = resolve; });
    session.on("Page.screencastFrame", event => {
      const index = frames.length;
      const frame = { file: `${String(index).padStart(6, "0")}.jpg`, timestamp: event.metadata.timestamp, receivedAt: performance.now() };
      frames.push(frame);
      writes.push(writeFile(join(raw, frame.file), Buffer.from(event.data, "base64")));
      session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(error => errors.push(error.message));
      if (index === 0) { startedAt = frame.receivedAt; firstResolve(); }
    });
    await session.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
    await Promise.race([firstFrame, page.waitForTimeout(10000).then(() => { if (!frames.length) throw Error("Chrome did not deliver a screencast frame"); })]);
    mark("start", { flow, title: definition.title, scenario: definition.scenario });
    await at(3);
    for (const [id, value] of Object.entries(definition.values)) {
      const input = page.getByTestId(id);
      if (await input.count()) {
        if (await input.evaluate(element => element.tagName === "SELECT")) await input.selectOption(value);
        else await input.fill(value);
        mark("fill", { testId: id, value });
      }
    }
    await caption(1); audits.push(await auditPage(page, "conditions"));
    await at(9); await click("review"); await caption(2); audits.push(await auditPage(page, "approval"));
    await at(18); await caption(3); await click("approve"); audits.push(await auditPage(page, "call-started"));
    const state = await page.evaluate(() => window.demoSnapshot());
    const maximumActions = Number(state.totalSteps) + 1;
    if (!Number.isInteger(maximumActions) || maximumActions < 1 || maximumActions > 12) throw Error(`Unexpected simulation step count: ${JSON.stringify(state)}`);
    for (let index = 0; index < maximumActions; index++) {
      await at(20 + (maximumActions === 1 ? 0 : index * (DURATION - 27) / (maximumActions - 1)));
      const next = page.getByTestId("next");
      if (await next.isVisible().catch(() => false)) {
        await caption(index < Math.ceil(maximumActions / 2) ? 4 : 5);
        await click("next"); audits.push(await auditPage(page, `reply-${index + 1}`));
      }
    }
    if (await page.getByTestId("next").isVisible().catch(() => false)) throw Error(`The ${flow} flow still needs a next action; review demoSnapshot().totalSteps and the recording timeline.`);
    await page.getByTestId("result").waitFor({ state: "visible", timeout: 3000 });
    await caption(6);
    const result = (await page.getByTestId("result").innerText()).trim();
    if (!result) throw Error(`Empty final result for ${flow}`);
    const finalState = await page.evaluate(() => window.demoSnapshot());
    if (finalState.stage !== "result" || !finalState.result || (flow !== "modify" && finalState.result.status !== "completed") || (flow === "modify" && (finalState.result.status === "completed" || finalState.result.originalPreserved !== true))) {
      throw Error(`The actual ${flow} result does not match the film's claim: ${JSON.stringify(finalState.result)}`);
    }
    mark("result", { text: result, state: finalState.result }); audits.push(await auditPage(page, "result"));
    await at(DURATION);
    const stoppedAt = performance.now();
    await session.send("Page.stopScreencast");
    await Promise.all(writes);
    const duration = (stoppedAt - startedAt) / 1000;
    // Native screencast frames are emitted only when pixels change. Keep each real frame until the
    // next capture timestamp, as any ordinary screen recorder does; no UI state is synthesized.
    const firstTimestamp = frames[0].timestamp;
    const timestamps = frames.map(frame => frame.timestamp - firstTimestamp);
    if (timestamps.some((time, index) => index && time < timestamps[index - 1])) throw Error("Non-monotonic Chrome capture timestamps");
    const lines = ["ffconcat version 1.0"];
    for (let index = 0; index < frames.length; index++) {
      const seconds = Math.max(0.001, (timestamps[index + 1] ?? duration) - timestamps[index]);
      lines.push(`file '${frames[index].file}'`, `duration ${seconds.toFixed(6)}`);
    }
    lines.push(`file '${frames.at(-1).file}'`);
    await writeFile(join(raw, "capture.ffconcat"), `${lines.join("\n")}\n`);
    const mp4 = join(OUT, `use-case-${flow}.mp4`);
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1", "-i", join(raw, "capture.ffconcat"), "-t", duration.toFixed(6), "-vf", `fps=${FPS},scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an", "-movflags", "+faststart", mp4]);
    const report = { flow, title: definition.title, url: url.href, browser: browser.version(), chromiumSandbox: true, disclosure: DISCLOSURE, capture: "Chrome Page.startScreencast of the actual interactive UI", width: WIDTH, height: HEIGHT, fps: FPS, capturedFrames: frames.length, recordingSeconds: duration, marks, audits, errors, allowedRequests: requested, blockedRequests: blocked };
    await writeFile(join(REVIEW, `${flow}-recording.json`), `${JSON.stringify(report, null, 2)}\n`);
    if (errors.length || blocked.length) throw Error(`Recording has ${errors.length} page errors and ${blocked.length} blocked unexpected requests; inspect ${flow}-recording.json`);
    const verified = await verify(flow);
    if (!args.includes("--keep-frames")) await rm(raw, { recursive: true, force: true });
    console.log(JSON.stringify({ flow, ...verified }));
  } finally {
    if (session) await session.send("Page.stopScreencast").catch(() => {});
    await Promise.allSettled(writes);
    await context.close();
  }
}

async function verify(flow) {
  const mp4 = join(OUT, `use-case-${flow}.mp4`);
  const probe = JSON.parse(await run(FFPROBE, ["-v", "error", "-count_frames", "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,pix_fmt:format=duration,size", "-of", "json", mp4]));
  const video = probe.streams.find(stream => stream.codec_type === "video"), duration = Number(probe.format.duration);
  if (!video || video.width !== WIDTH || video.height !== HEIGHT || duration < 30 || duration > 60 || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || probe.streams.some(stream => stream.codec_type === "audio") || Number(probe.format.size) >= 8 * 1024 * 1024) throw Error(`Unexpected video attributes or file at least 8 MiB for ${flow}: ${JSON.stringify(probe)}`);
  await run(FFMPEG, ["-v", "error", "-xerror", "-i", mp4, "-f", "null", "-"]);
  const stills = [];
  for (const [label, seconds] of [["opening", 0.5], ["middle", duration / 2], ["ending", duration - 1]]) {
    const file = join(REVIEW, `${flow}-${label}.png`);
    await run(FFMPEG, ["-v", "error", "-y", "-ss", String(seconds), "-i", mp4, "-frames:v", "1", file]);
    stills.push({ label, seconds, file });
  }
  const poster = join(OUT, `use-case-${flow}-poster.jpg`);
  await run(FFMPEG, ["-v", "error", "-y", "-ss", "12", "-i", mp4, "-frames:v", "1", "-q:v", "2", poster]);
  const hash = createHash("sha256").update(await readFile(mp4)).digest("hex");
  const report = { file: mp4, poster, sha256: hash, fullDecode: "passed", duration, probe, stills, visualReview: "required: inspect opening/middle/ending PNGs for legibility, whitespace, persistent disclaimer, and agreement between captions and UI" };
  await writeFile(join(REVIEW, `${flow}-qa.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

await mkdir(OUT, { recursive: true }); await mkdir(REVIEW, { recursive: true });
if (args.includes("--verify-only")) {
  for (const flow of flows) console.log(JSON.stringify({ flow, ...await verify(flow) }));
} else {
  const { chromium } = await loadBrowserLibrary();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, chromiumSandbox: true, ignoreDefaultArgs: ["--disable-ipc-flooding-protection", "--unsafely-disable-devtools-self-xss-warnings", "--enable-unsafe-swiftshader", "--disable-client-side-phishing-detection"] });
  try { for (const flow of flows) await record(browser, flow); } finally { await browser.close(); }
}
