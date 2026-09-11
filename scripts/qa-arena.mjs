// Headless-Chrome QA for the Arena: screenshots at 1440/390, light/dark, Watch/Play/Result.
// usage: node packages/cli/dist/bin.js demo --no-open &  node scripts/qa-arena.mjs <outDir> [baseUrl]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.argv[2] ?? ".";
const BASE = process.argv[3] ?? "http://127.0.0.1:4242";
const PORT = 9333;

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=/tmp/oathra-qa-profile", "--window-size=1440,900", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  console.log("shot", name);
};
const viewport = (w, h, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const scheme = (s) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s }] });

await send("Page.enable");
await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
});

await viewport(1440, 900);
await scheme("light");
await send("Page.navigate", { url: BASE });
await sleep(1500);
await shot("01-start-light-1440");
await scheme("dark");
await sleep(300);
await shot("02-start-dark-1440");
await viewport(390, 844, true);
await sleep(300);
await shot("03-start-dark-390");
await viewport(1440, 900);
await scheme("light");

// Real Phone panel
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/real phone/i.test(b.textContent)); if(b) b.click(); return !!b; })()`);
await sleep(400);
await shot("04-real-phone-panel");
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/^back$/i.test(b.textContent.trim())); if(b) b.click(); return !!b; })()`);
await sleep(300);

// Watch: start restaurant
const started = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/Restaurant Reservation/i.test(b.textContent)); if(b) b.click(); return !!b; })()`);
console.log("clicked scenario:", started);
await sleep(9000);
await shot("05-watch-live-1440");
await viewport(390, 844, true);
await sleep(300);
await shot("06-watch-live-390");
await viewport(1440, 900);
await sleep(38000);
await shot("07-watch-result-1440");
await scheme("dark");
await sleep(300);
await shot("08-watch-result-dark");
await scheme("light");
// Details drawer
await evaluate(`(() => { const b=[...document.querySelectorAll('button, summary')].find(b=>/details/i.test(b.textContent)); if(b) b.click(); return !!b; })()`);
await sleep(500);
await shot("09-details-drawer");
// Timeline row click (time travel)
await evaluate(`(() => { const rows=[...document.querySelectorAll('[data-seq], .timeline-row, tr, li')].filter(r=>/transcript\\.final|evidence/.test(r.textContent)); if(rows[3]) rows[3].click(); return rows.length; })()`);
await sleep(500);
await shot("10-time-travel");

// Play mode
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/new mission/i.test(b.textContent)); if(b) b.click(); return !!b; })()`);
await sleep(600);
await evaluate(`(() => { const b=[...document.querySelectorAll('button, label, input')].find(b=>/play/i.test(b.textContent||b.value||'') && !/replay/i.test(b.textContent||'')); if(b) b.click(); return !!b; })()`);
await sleep(300);
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/Restaurant Reservation/i.test(b.textContent)); if(b) b.click(); return !!b; })()`);
await sleep(9000);
await shot("11-play-waiting");
await evaluate(`(() => { const i=document.querySelector('input[type=text], textarea'); if(!i) return false; i.value='はい、9月12日の19時半でしたら2名様ご案内できます。ご予約承りました。'; i.dispatchEvent(new Event('input',{bubbles:true})); const b=[...document.querySelectorAll('button')].find(b=>/^send$/i.test(b.textContent.trim())); if(b) b.click(); return !!b; })()`);
await sleep(12000);
await shot("12-play-after-reply");
const dom = await evaluate(`document.body.innerText.slice(0, 1500)`);
console.log("---- body text ----\n" + dom);
console.log("---- page errors ----\n" + (errors.length ? errors.join("\n") : "(none)"));
ws.close();
chrome.kill();
