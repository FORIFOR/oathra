// Arena, a real phone call in the call view: after 「発信する」 the screen moves to the call view, which follows the call
// live (the conversation appears as it happens, 「通話を終える」 stops it) and then shows how it ended with the next steps;
// 「記録」 opens the same view. A fake dialer stands in for the carrier: nothing dials, no provider is reached.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startArena } from "../../apps/arena/dist/index.js";
import { definePhoneRequest } from "../../packages/contract/dist/index.js";
import { checklist, launch, sleep } from "./cdp.mjs";

const work = mkdtempSync(join(tmpdir(), "oathra-real-call-"));
const out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const c = checklist("arena real call");

// The fake line: speaks when the test says so, ends when hung up or released.
let say = () => {}, release = () => {};
const dialer = {
  inspect: () => ({ ready: true, issues: [], provider: "Twilio", engine: "OpenAI", recording: false, disclosure: "テスト用の偽の回線です。", engines: [{ id: "gpt-live", label: "GPT-Live", ready: true, voices: ["marin"], defaultVoice: "marin", presetVoices: {} }], defaultEngine: "gpt-live" }),
  async execute(request, ctx) {
    let seq = 0, t = 0;
    const events = [], transcript = [];
    const emit = (e) => { const ev = { ...e, seq: ++seq, t: (t += 700) }; events.push(ev); ctx.onEvent(ev); return ev; };
    emit({ type: "call.started", callId: ctx.callId, transport: "fake", brain: "gpt-live" });
    emit({ type: "call.connected", callee: request.name });
    say = (source, text) => {
      const turnId = `turn_${seq}`;
      if (source === "caller") emit({ type: "agent.speech.started", turnId, text }); else emit({ type: "callee.speech.started", turnId });
      emit({ type: "transcript.final", turnId, source, text, startMs: t, endMs: t + 600 });
      transcript.push({ id: turnId, source, text, t });
    };
    say("caller", "もしもし、田中さんの代わりにお電話しているAIです。今、少し話せる？");
    await new Promise((res) => { release = res; ctx.signal.addEventListener("abort", res, { once: true }); });
    const endReason = ctx.signal.aborted ? "cancelled" : "agent_hangup";
    emit({ type: "call.ended", reason: endReason, durationMs: t });
    const contract = definePhoneRequest(request);
    const result = { status: "incomplete", complete: false, fields: {}, evidence: [], missing: [], confidence: 0, constraints: { ok: true, violations: [] } };
    return { callId: ctx.callId, contract, result, events, traces: [], metrics: { durationMs: t, turns: transcript.length, agentTurns: 1, calleeTurns: 0, costUsd: 0, latency: {}, evidenceCount: 0, verifiedCount: 0 }, endReason, transcript, intake: null };
  },
};
const arena = await startArena({ scenariosDir: resolve("scenarios"), brains: {}, callsDir: join(work, "calls"), phoneHistoryDir: join(work, "phone"), port: 0, phoneDialer: dialer });
let page;
const fill = (id, v) => `{const n=document.querySelector('${id}');n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}))}`;
try {
  page = await launch({ width: 1440, height: 900 });
  await page.goto(arena.url + "/?lang=ja&phone=1");
  await page.until("document.querySelectorAll('.voice-card').length>0");
  c.ok(!(await page.visible("#phone-history-section")) && !(await page.visible("#phone-live")), "the phone screen only prepares calls: no history list, no status panel under the form");
  await page.js(fill("#phone-number", "+819012345678") + ";" + fill("#phone-name", "中尾") + ";" + fill("#phone-instruction", "近況を話して、気軽に雑談してください。"));
  await page.click("#phone-form button[type=submit]"); await page.until("!document.querySelector('#phone-review').hidden");
  await page.js("{const b=document.querySelector('#phone-consent');if(b&&!b.checked)b.click()}"); await sleep(200);
  await page.click("#phone-dial");
  // Straight to the call view, following the call.
  await page.until("!document.querySelector('#screen-call').hidden && document.body.classList.contains('real-call')", { label: "call view after dialling" });
  await page.until("document.querySelectorAll('#transcript .line').length>=1", { label: "the AI's first line" });
  const live = JSON.parse(await page.js("JSON.stringify({title:document.querySelector('#call-title').textContent,sub:document.querySelector('#call-sub').textContent,rail:getComputedStyle(document.querySelector('#screen-start')).display,nav:document.querySelector('[data-transport=real]').getAttribute('aria-pressed'),hangup:!document.querySelector('#call-hangup').hidden,right:document.querySelector('#mission-list').textContent,evidence:getComputedStyle(document.querySelector('.panels > .panel[aria-labelledby=evidence-h]')).display})"));
  c.ok(live.title === "中尾" && /本番の電話/.test(live.sub), "the header names the person and says it is a real call", `${live.title} / ${live.sub}`);
  c.ok(live.rail === "none" && live.nav === "true", "the practice list is gone and 「電話をかける」 is the current place");
  c.ok(live.hangup, "「通話を終える」 is there while the call runs");
  c.ok(/判定する項目がありません|雑談の電話では/.test(live.right) && /中尾/.test(live.right) && live.evidence === "none", "nothing to judge: the right column describes the call instead of an empty verdict; no evidence column", live.right.slice(0, 80));
  // The conversation appears as it happens.
  say("callee", "できるよ、どうしたの？");
  await page.until("/できるよ/.test(document.querySelector('#transcript').textContent)", { timeout: 5000, label: "the callee's words appear live" });
  c.ok(true, "a new line appears within the poll interval while the call runs");
  await page.screenshot(join(out, "arena-real-call-live.png"));
  // 「通話を終える」 stops it through the phone service; the view shows how it ended and what next.
  await page.click("#call-hangup");
  await page.until("/通話が終わりました/.test(document.querySelector('#result-wrap').textContent)", { timeout: 10_000, label: "ended view" });
  const ended = JSON.parse(await page.js("JSON.stringify({hangup:!document.querySelector('#call-hangup').hidden,text:document.querySelector('#result-wrap').textContent,buttons:[...document.querySelectorAll('#result-wrap button')].map(b=>b.textContent)})"));
  c.ok(!ended.hangup && ended.buttons.includes("同じ相手にもう一度") && ended.buttons.includes("この内容で別の相手に"), "after the call: no hang-up, and 「同じ相手にもう一度」「この内容で別の相手に」", JSON.stringify(ended.buttons));
  const shown = await page.js("document.querySelector('#screen-call').innerText");
  c.ok(!/phone\.|phone_|信頼度|cancelled/.test(shown), "no internal ids, raw memo or English end codes on the call view", (shown.match(/.{0,30}(phone\.|phone_|信頼度|cancelled).{0,30}/) ?? [""])[0]);
  await page.screenshot(join(out, "arena-real-call-ended.png"));
  // 「同じ相手にもう一度」 goes back to the form with the person and the request filled in.
  await page.js("[...document.querySelectorAll('#result-wrap button')].find(b=>b.textContent==='同じ相手にもう一度').click()"); await sleep(400);
  c.ok(!(await page.js("document.querySelector('#screen-real').hidden")) && await page.js("document.querySelector('#phone-number').value") === "+819012345678" && !(await page.js("document.body.classList.contains('real-call')")), "「同じ相手にもう一度」 opens the form with the same person and request");
  // 「記録」 opens the same view for the saved call.
  await page.click("#records-open");
  await page.until("document.querySelectorAll('#replay-list .replay-btn').length>=1", { label: "records" });
  await page.js("[...document.querySelectorAll('#replay-list .replay-btn')].find(b=>/本番/.test(b.textContent)).click()");
  await page.until("document.body.classList.contains('real-call') && /通話が終わりました/.test(document.querySelector('#result-wrap').textContent)", { label: "record in the call view" });
  c.ok(/本番の電話の記録/.test(await page.text("#call-sub")), "from 「記録」 the same view says it is the saved record");
  // Leaving the view gives the practice list back.
  await page.js("document.querySelector('[data-transport=simulator]').click()"); await sleep(400);
  c.ok(!(await page.js("document.body.classList.contains('real-call')")) && await page.js("getComputedStyle(document.querySelector('#screen-start')).display") !== "none", "going to practice brings the practice list back");
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
  await page.close();
  // 390: the same record, stacked; the call's details and next steps are reachable without sideways scrolling.
  page = await launch({ width: 390, height: 844 });
  await page.goto(arena.url + "/?lang=ja");
  await page.until("document.querySelector('#records-open')"); await page.click("#records-open");
  await page.until("document.querySelectorAll('#replay-list .replay-btn').length>=1", { label: "records (390)" });
  await page.js("[...document.querySelectorAll('#replay-list .replay-btn')].find(b=>/本番/.test(b.textContent)).click()");
  await page.until("document.body.classList.contains('real-call') && /通話が終わりました/.test(document.querySelector('#result-wrap').textContent)", { label: "record (390)" });
  await sleep(400);
  c.ok(await page.noSidewaysScroll(), "390: no sideways scroll");
  await page.screenshot(join(out, "arena-real-call-ended-mobile.png"));
  await page.js("document.querySelector('#result-wrap').scrollIntoView({block:'center'})"); await sleep(300);
  await page.screenshot(join(out, "arena-real-call-ended-mobile-2.png"));
  c.ok(page.pageErrors.length === 0, "no page errors (390)", page.pageErrors.join(" "));
} finally {
  release(); await page?.close(); arena.server.closeAllConnections(); await arena.close(); rmSync(work, { recursive: true, force: true });
}
c.finish();
