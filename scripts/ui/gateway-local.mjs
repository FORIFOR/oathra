// The local app (`oathra demo`, apps/gateway/demo.mjs): opened from this computer without signing in, from another
// device with the sign-in link, practice with another AI (a stand-in here: nothing leaves this machine), and records.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, checklist, freePort, sleep } from "./cdp.mjs";
import { startDemo } from "../../apps/gateway/demo.mjs";
import { ScriptedAgent } from "../../providers/simulator/dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "oathra-local-app-")), out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const c = checklist("local app");
const port = await freePort();
const standIn = () => { const b = new ScriptedAgent(); Object.defineProperty(b, "name", { value: "stand_in" }); return b; };
const demo = await startDemo({ port, open: false, dataDir: join(dir, "demo"), records: join(dir, "calls"), lan: true, brains: { stand_in: standIn } });
let page;
try {
  page = await launch({ width: 1440, height: 900 });
  await page.goto(demo.url + "/#/");
  await page.until("!document.querySelector('#tabs').hidden", { label: "open without signing in" });
  c.ok(!(await page.js("!!document.querySelector('#login-email')")), "this computer: the app opens without signing in");

  await page.js("location.hash='#/practice/restaurant-reservation'"); await page.until("!!document.querySelector('#practice-ai')", { label: "AI choice" });
  c.ok(await page.js("document.querySelector('#practice-ai').options.length") === 2 && await page.js("document.querySelector('.note.warn').hidden"), "練習: the AI that calls can be chosen; the built-in one needs no warning");
  await page.js("const s=document.querySelector('#practice-ai');s.value='stand_in';s.dispatchEvent(new Event('change'))");
  c.ok(!(await page.js("document.querySelector('.note.warn').hidden")) && /料金/.test(await page.text(".note.warn")), "an external AI says the conversation is sent and charged");
  await page.screenshot(join(out, "local-app-practice-ai.png"));
  await page.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='練習を始める').click()");
  await page.until("/練習が終わりました/.test(document.querySelector('#view').textContent)", { timeout: 30000, label: "run" });
  c.ok(/stand_in/.test(await page.text(".crumb")) && /記録」に保存/.test(await page.text(".call-foot")), "the run names the AI and is saved to 記録", await page.text(".call-foot"));

  await page.js("location.hash='#/practice'"); await page.until("[...document.querySelectorAll('a.item')].some(a=>a.href.includes('/practice/record/'))", { label: "records list" });
  c.ok(/記録/.test(await page.text("#view")), "練習: the 記録 list shows the saved practice");
  await page.js("[...document.querySelectorAll('a.item')].find(a=>a.href.includes('/practice/record/')).click()");
  await page.until("/練習の記録/.test(document.querySelector('.crumb')?.textContent ?? '')", { label: "record view" });
  c.ok(await page.js("document.querySelector('.ring text')?.textContent") === "4/4" && await page.js("document.querySelectorAll('mark.proof').length") >= 1, "a record: the ring and the callee's words, marked");
  await page.screenshot(join(out, "local-app-record.png"));
  // The video templates seek a record by the call clock (postMessage oathra.seek → oathra.seeked).
  const seek = (ms) => page.js(`new Promise(r => { const on = e => { if (e.data?.type === 'oathra.seeked' && e.data.id === ${ms + 1}) { removeEventListener('message', on); r([document.querySelectorAll('.transcript .line').length, document.querySelector('.ring text')?.textContent]); } }; addEventListener('message', on); postMessage({ type: 'oathra.seek', ms: ${ms}, id: ${ms + 1} }, '*'); })`);
  const [early, ringEarly] = await seek(0), [all, ringAll] = await seek(10_000_000);
  c.ok(early < all && ringEarly !== "4/4" && ringAll === "4/4", "a record seeks: early shows fewer lines and an open ring, the end shows all", `${early}/${all} ${ringEarly}→${ringAll}`);
  await page.close(); page = null;

  const lan = demo.lanUrls[0];
  c.ok(!!lan, "--allow-remote: this computer's LAN address", lan);
  if (lan) {
    const plain = await fetch(lan + "/v1/bootstrap");
    c.ok(plain.status === 401, "another device without the link is not signed in", String(plain.status));
    page = await launch({ width: 390, height: 844 });
    await page.goto(demo.signIn(lan));
    await page.until("!document.querySelector('#tabs').hidden", { timeout: 10000, label: "LAN sign-in" });
    c.ok(await page.js("location.hash") === "#/" && await page.js("Math.max(...[...document.querySelectorAll('#tabs a')].map(a=>a.getBoundingClientRect().height))") <= 48, "another device: the link signs in, leaves the address bar, one-line tabs at 390");
    c.ok(await page.noSidewaysScroll(), "390: no sideways scroll");
    await page.screenshot(join(out, "local-app-lan-mobile.png"));
    c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
  }
} finally {
  await page?.close(); await demo.close(); rmSync(dir, { recursive: true, force: true });
}
c.finish();
