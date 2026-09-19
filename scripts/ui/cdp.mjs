// Drives the locally installed Google Chrome over CDP. No dependencies, like scripts/qa-arena.mjs.
// Shared by the UI flow checks: they operate the real page, assert, and save PNGs a person (or reviewer) then opens.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find((p) => existsSync(p));

/**
 * `--no-capture`: assert everything, write no PNGs. The evidence gate re-runs the flows on the reviewed source;
 * screens carry clock times, so re-capturing would change their hashes and orphan the review that was done on them.
 */
const CAPTURE = !process.argv.includes("--no-capture");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** Collects failed expectations instead of stopping at the first, so one run reports everything. */
export function checklist(name) {
  const failures = [], passed = [];
  return {
    ok(condition, label, detail = "") { (condition ? passed : failures).push(detail ? `${label} — ${detail}` : label); console.log(`${condition ? "  ✓" : "  ✗"} ${label}${detail ? `  (${detail})` : ""}`); return Boolean(condition); },
    finish() { console.log(`\n${name}: ${passed.length} passed, ${failures.length} failed`); if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exitCode = 1; } return failures.length === 0; },
  };
}

export async function launch({ width = 1440, height = 900 } = {}) {
  if (!CHROME) throw new Error("Google Chrome / Chromium was not found. Set CHROME_PATH.");
  const port = await freePort(), profile = mkdtempSync(join(tmpdir(), "oathra-ui-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(250); } }
  if (!targets) { chrome.kill(); throw new Error("Chrome did not open its debugging port."); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(), pageErrors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send("Runtime.enable"); await send("Page.enable"); await viewport(width, height);
  // Headless pages can report document.hidden, and the gateway page rightly stops polling while hidden.
  // A person looking at the page is what these checks stand for: keep it visible and focused.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }); await send("Page.bringToFront");

  const page = {
    pageErrors,
    async goto(url) { await send("Page.navigate", { url }); await sleep(1200); },
    /** Evaluate in the page. Rejections and exceptions become thrown errors here. */
    async js(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async until(expression, { timeout = 60_000, label = expression } = {}) { const t = Date.now(); while (Date.now() - t < timeout) { if (await page.js(expression)) return true; await sleep(250); } throw new Error(`Timed out waiting for: ${label}`); },
    click: (selector) => page.js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error("no element: ${selector.replaceAll('"', "'")}");n.click();return true})()`),
    visible: (selector) => page.js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n&&!n.hidden&&n.getBoundingClientRect().height>0})()`),
    text: (selector) => page.js(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`),
    noPageScroll: () => page.js("document.documentElement.scrollHeight<=innerHeight+2"),
    noSidewaysScroll: () => page.js("document.documentElement.scrollWidth<=innerWidth+1"),
    /** Interactive controls shorter than `min` CSS px. Project target: 44. */
    smallTargets: (min = 44) => page.js(`[...document.querySelectorAll('button,select,summary,textarea,input:not([type=checkbox]):not([type=radio]):not([type=hidden])')].filter(n=>n.offsetParent&&n.getBoundingClientRect().height<${min}).map(n=>(n.id||n.textContent.trim().slice(0,14))+':'+Math.round(n.getBoundingClientRect().height))`),
    /** Real key events, as a keyboard-only person would produce them. */
    async press(key) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, " ": 32 };
      const base = { key, code: key === " " ? "Space" : key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : key === " " ? { text: " ", unmodifiedText: " " } : {}) };
      await send("Input.dispatchKeyEvent", { type: base.text ? "keyDown" : "rawKeyDown", ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(120);
    },
    type: (text) => send("Input.insertText", { text }),
    focused: () => page.js("(()=>{const n=document.activeElement;if(!n)return null;const cs=getComputedStyle(n);return {id:n.id,tag:n.tagName,text:(n.textContent||'').trim().slice(0,20),outline:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0}})()"),
    emulateReducedMotion: () => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }),
    viewport,
    /** Saves what is on screen. `fullPage` grows the viewport to the document first. */
    async screenshot(file, { fullPage = false } = {}) {
      if (!CAPTURE) { console.log(`  ▸ (not re-captured) ${file}`); return; }
      mkdirSync(dirname(file), { recursive: true });
      if (fullPage) { const h = await page.js("document.documentElement.scrollHeight"); await viewport(width, Math.min(h, 8000)); await sleep(200); }
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      if (fullPage) await viewport(width, height);
      console.log(`  ▸ ${file}`);
    },
    async close() { try { ws.close(); } catch { /* already closed */ } chrome.kill(); await sleep(200); rmSync(profile, { recursive: true, force: true }); },
  };
  return page;
}

/** Starts a server process and waits until `url` answers 200. */
export async function serve(command, args, { cwd, env = {}, url }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status === 200) return { stop: () => child.kill(), log: () => log }; } catch { /* not up yet */ } await sleep(250); }
  child.kill(); throw new Error(`Server did not answer at ${url}\n${log.slice(-800)}`);
}
