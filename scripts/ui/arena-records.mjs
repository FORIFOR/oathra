// Arena records: practice and real phone calls in one list (「記録」 in the top bar), filterable, and a finished real call
// opens in the same verdict + evidence view. Real Arena server on temp folders; the "real" call is a saved practice
// call filed under a phone record id (no carrier, nothing dials).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startArena } from "../../apps/arena/dist/index.js";
import { preparePhoneRequest } from "../../packages/contract/dist/index.js";
import { brains } from "../../packages/cli/dist/brains.js";
import { checklist, launch, sleep } from "./cdp.mjs";

const work = mkdtempSync(join(tmpdir(), "oathra-records-"));
const out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const callsDir = join(work, "calls"), historyDir = join(work, "phone");
const arena = await startArena({ scenariosDir: resolve("scenarios"), brains: { scripted: brains.scripted }, callsDir, phoneHistoryDir: historyDir, port: 0 });
const c = checklist("arena records");
let page;
try {
  page = await launch({ width: 1440, height: 900 });
  // One practice call, saved as usual.
  await page.goto(arena.url + "/?practice=1&lang=ja");
  await page.until("document.querySelector('[data-scenario=friend-hype]')");
  await page.js("document.querySelector('[data-scenario=friend-hype]').click()");
  await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { timeout: 150_000, label: "practice result" });
  for (let i = 0; i < 40 && !readdirSync(callsDir).length; i++) await sleep(250);
  const practiceId = readdirSync(callsDir)[0];
  // The same artifacts filed as a real call: phone_ id, a phone request contract (chat), and its history record.
  const realId = `phone_${randomUUID()}`;
  cpSync(join(callsDir, practiceId), join(callsDir, realId), { recursive: true });
  const contractFile = join(callsDir, realId, "contract.json"), contract = JSON.parse(readFileSync(contractFile, "utf8"));
  writeFileSync(contractFile, JSON.stringify({ ...contract, goal: "phone.message", target: { phone: "+819012345678", name: "テスト相手" }, input: { ...contract.input, conversationMode: "chat" } }));
  const request = preparePhoneRequest({ phone: "+819012345678", name: "テスト相手", instruction: "近況を話して、気軽に雑談してください。", conversationMode: "chat" });
  const now = new Date().toISOString();
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(join(historyDir, `${realId}.json`), JSON.stringify({ id: realId, request, state: "ended", createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    readiness: { ready: false, issues: [] }, events: [], transcript: [], persistence: "saved", endReason: "agent_hangup" }));

  // 「記録」 opens the list from anywhere, with both kinds and the purpose in words.
  await page.goto(arena.url + "/?lang=ja");
  await page.until("document.querySelector('#records-open')");
  c.ok(await page.text("#records-open") === "記録", "the top bar has 「記録」");
  await page.click("#records-open");
  await page.until("!document.querySelector('#replays-panel').hidden && document.querySelectorAll('#replay-list .replay-btn').length===2", { label: "records list" });
  await sleep(700);
  const seen = JSON.parse(await page.js("JSON.stringify((()=>{const r=document.querySelector('#replays-panel').getBoundingClientRect();return {top:Math.round(r.top),vh:innerHeight,focus:document.activeElement?.dataset?.filter??null}})())"));
  c.ok(seen.top >= 0 && seen.top < seen.vh - 120 && seen.focus === "all", "「記録」 brings the list into view and puts focus on its filter", JSON.stringify(seen));
  await page.screenshot(join(out, "arena-records-desktop.png"));
  const rows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('#replay-list .replay-btn')].map(b=>b.textContent))"));
  c.ok(rows.some((r) => /^本番テスト相手\d+\/\d+ \d\d:\d\d · 雑談 · 話しました/.test(r)) && rows.some((r) => /^練習友達とテンション高めの電話\d+\/\d+ \d\d:\d\d · /.test(r)), "real and practice in one list, each with its date; the real call shows its person, purpose and a real-call outcome (not the practice score)", JSON.stringify(rows));
  c.ok(await page.text("#replays-title") === "記録" && await page.js("document.querySelector('#replay-list').getAttribute('aria-labelledby')") === "replays-title" && !(await page.visible("#replays-link")), "the list has the heading 「記録」, and the top bar is its only door (no second link in the rail)");
  c.ok(/記録を選ぶと、判定と証拠が開きます/.test(await page.text("#stage-empty")), "the empty centre says what to do while the list is open");
  c.ok(!/phone\.|phone_/.test(await page.text("#replays-panel")), "no internal ids (goal, record id) on screen for the real call");
  const count = () => page.js("document.querySelectorAll('#replay-list .replay-btn').length");
  await page.click("#replay-filter [data-filter=real]"); await sleep(150);
  const realOnly = await count();
  await page.click("#replay-filter [data-filter=practice]"); await sleep(150);
  const practiceOnly = await count();
  c.ok(realOnly === 1 && practiceOnly === 1 && await page.js("document.querySelector('#replay-filter [data-filter=practice]').getAttribute('aria-pressed')") === "true", "すべて／本番／練習 filter the list and say which is on", `${realOnly}/${practiceOnly}`);
  await page.click("#replay-filter [data-filter=all]"); await sleep(150);
  // The real call opens in the call view as the saved record (the same view that follows a call live).
  await page.js("[...document.querySelectorAll('#replay-list .replay-btn')].find(b=>/本番/.test(b.textContent)).click()");
  await page.until("document.body.classList.contains('real-call') && /通話が終わりました/.test(document.querySelector('#result-wrap').textContent)", { timeout: 20_000, label: "the real call's record" });
  c.ok(/本番の電話の記録/.test(await page.text("#call-sub")) && await page.text("#call-title") === "テスト相手", "a real call opens in the call view, named and marked as the saved record");
  // The phone screen no longer lists calls: 「記録」 is the one place.
  await page.goto(arena.url + "/?lang=ja&phone=1"); await sleep(600);
  c.ok(!(await page.visible("#phone-history-section")), "the phone screen has no second history list");
  // 390: the list and its filter fit.
  await page.viewport(390, 844); await page.goto(arena.url + "/?lang=ja");
  await page.until("document.querySelector('#records-open')"); await page.click("#records-open");
  await page.until("document.querySelectorAll('#replay-list .replay-btn').length===2", { label: "records list (390)" });
  await page.js("document.querySelector('#replays-panel').scrollIntoView({block:'start'})"); await sleep(200);
  c.ok(await page.noSidewaysScroll(), "390: no sideways scroll");
  await page.screenshot(join(out, "arena-records-mobile.png"));
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
} finally {
  await page?.close(); arena.server.closeAllConnections(); await arena.close(); rmSync(work, { recursive: true, force: true });
}
c.finish();
