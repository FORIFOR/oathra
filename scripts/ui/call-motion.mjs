// Arena UI v2 motion: the typing reveal keeps the whole line in the DOM, only the speaking side's meter moves,
// the header says who is speaking, and the callee's settling words are underlined. Real demo server, no carrier.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checklist, freePort, launch, serve, sleep } from "./cdp.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const server = await serve("node", [join(root, "packages/cli/dist/bin.js"), "demo", "--no-open", "--port", String(port)], { cwd: root, url: base + "/" });
const c = checklist("call motion");
const start = async (page) => {
  await page.goto(base + "/?practice=1&lang=ja");
  await page.until("document.querySelector('[data-scenario=friend-hype]')");
  await page.js("document.querySelector('[data-scenario=friend-hype]').click()");
};
let page;
try {
  page = await launch({ width: 1440, height: 900 });
  await start(page);
  await page.until("document.querySelector('.line.typing')", { timeout: 60_000, label: "a line being revealed" });
  const typing = JSON.parse(await page.js("JSON.stringify((()=>{const l=document.querySelector('.line.typing');const say=l.querySelector('.say');return {full:say.textContent,said:say.querySelector('.said')?.textContent??'',caret:getComputedStyle(say.querySelector('.said'),'::after').content,speaker:l.classList.contains('agent')?'agent':'callee'}})())"));
  c.ok(typing.said.length < typing.full.length && typing.full.length > 10, "the line reveals progressively while the whole text is already in the DOM", `${typing.said.length}/${typing.full.length}`);
  c.ok(typing.caret !== "none", "a caret ends the speaking line");
  const header = JSON.parse(await page.js("JSON.stringify({status:document.querySelector('#call-status').textContent,agent:document.querySelectorAll('#meter-agent i.on').length,callee:document.querySelectorAll('#meter-callee i.on').length})"));
  c.ok(/話しています/.test(header.status), "the header says who is speaking", header.status);
  c.ok((header.agent > 0) !== (header.callee > 0), "only the speaking side's meter is lit", JSON.stringify(header));
  await page.until("!document.querySelector('.line.typing')", { timeout: 20_000, label: "reveal finishes" });
  await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { timeout: 150_000, label: "result" });
  await sleep(500);
  const done = JSON.parse(await page.js("JSON.stringify({status:document.querySelector('#call-status').textContent,timer:document.querySelector('#call-timer').textContent,elapsed:document.querySelector('#m-elapsed').textContent,lit:document.querySelectorAll('.meter-bars i.on').length,proofs:[...document.querySelectorAll('#transcript .say .proof')].map(n=>({text:n.textContent,callee:n.closest('.line').classList.contains('callee')})),unsaid:document.querySelectorAll('.say .unsaid').length})"));
  c.ok(done.status === "通話終了" && done.lit === 0, "after the call: 「通話終了」 and the meters are still", JSON.stringify({ status: done.status, lit: done.lit }));
  c.ok(done.timer === done.elapsed && /^\d\d:\d\d$/.test(done.timer), "the header timer shows the call's elapsed time", done.timer);
  c.ok(done.proofs.length > 0 && done.proofs.every((p) => p.callee), "the settling words are underlined, only in the callee's lines", JSON.stringify(done.proofs));
  c.ok(done.unsaid === 0, "no line is left half revealed");
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
  await page.close(); page = undefined;

  // Reduced motion: lines appear whole, the meters do not move.
  page = await launch({ width: 1440, height: 900 });
  await page.emulateReducedMotion();
  await start(page);
  await page.until("document.querySelectorAll('#transcript .line').length>=2", { timeout: 60_000, label: "lines" });
  const still = [];
  for (let i = 0; i < 4; i++) { still.push(await page.js("[...document.querySelectorAll('.meter-bars i.on')].length")); await sleep(150); }
  const rm = await page.js("matchMedia('(prefers-reduced-motion: reduce)').matches");
  if (rm) {
    c.ok(!(await page.js("!!document.querySelector('.line.typing')")), "reduced motion: lines appear whole");
    c.ok(new Set(still).size === 1, "reduced motion: the meters hold a steady level", JSON.stringify(still));
  } else console.log("  · reduced motion could not be emulated here (UNVERIFIED)");
} finally {
  await page?.close();
  server.stop();
}
c.finish();
