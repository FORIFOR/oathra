// The new gateway app at /app (design: Oathra App.dc.html): sign in, ホーム, 依頼, 電話を頼む, 電話中/報告, 練習, 連絡先, 設定.
// Authenticated gateway in practice mode + real SQLite; the worker is never started and nothing is dialled. The call
// states and transcripts below are local fixtures for rendering only, never a claim that such a call took place.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createGateway, configuration } from "../../apps/gateway/server.mjs";
import { hash } from "../../apps/gateway/lib/security.mjs";
import { checkInReport } from "../../packages/core/dist/index.js";
import { checklist, launch, sleep } from "./cdp.mjs";

const dir = mkdtempSync(join(tmpdir(), "oathra-gateway-app-")), token = randomBytes(32).toString("hex"), mateToken = randomBytes(32).toString("hex");
const user = { id: randomUUID(), team: "local", role: "admin", tokenHash: hash(token) };
// A teammate without the supervisor role: their calls show in チームの電話, and they must not see its entry.
const mate = { id: "suzuki", team: "local", role: "operator", tokenHash: hash(mateToken) };
const config = configuration({ OATHRA_USERS_JSON: JSON.stringify([user, mate]), OATHRA_DATA_KEY: randomBytes(32).toString("hex"), OATHRA_DB: join(dir, "db.sqlite") });
// An alert destination, as a server that runs wellbeing calls has (a standing gentle call is refused without one). Nothing is ever sent to it here.
const app = await createGateway(config, { env: { OATHRA_ALERT_WEBHOOK_URL: "https://alerts.invalid/oathra", OATHRA_ALERT_WEBHOOK_SECRET: randomBytes(32).toString("hex") }, fetchImpl: async () => { throw new Error("no network in this check"); } }); await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + app.server.address().port; config.publicUrl = base;
const out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const c = checklist("gateway app");
const apiAs = (bearer) => (path, body) => fetch(base + "/v1" + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + bearer, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json());
const api = apiAs(token);
const signIn = async (page, bearer) => {
  await page.goto(base + "/");
  await page.until("[...document.querySelectorAll('button')].some(b => /管理者のトークン/.test(b.textContent))", { label: "sign in" });
  await page.js("[...document.querySelectorAll('button')].find(b => /管理者のトークン/.test(b.textContent)).click()");
  await page.until("document.querySelector('#token')", { label: "token form" });
  await page.js(`document.querySelector('#token').value=${JSON.stringify(bearer)};document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('#tabs').hidden && /ホーム/.test(document.querySelector('#view').textContent)", { timeout: 8000, label: "home" });
};
// A capture never carries the toast of the step before it.
const launchQuiet = async (size) => { const pg = await launch(size), shot = pg.screenshot; pg.screenshot = async (...a) => { await pg.until("document.querySelector('#toast')?.hidden !== false", { timeout: 5000 }).catch(() => null); return shot(...a); }; return pg; };
const draft = async (name, instruction) => (await api("/phone/draft", { phone: "+819012345678", name, instruction })).mission.id;
// Fixture calls carry a daytime of the day before (a finished call shown at the minute this check runs, late at night,
// reads as behaviour). A call still in progress keeps "now".
const jstDay = (offset = 0) => new Date(Date.now() + 9 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
let fixtures = 0;
const put = (id, status, turns) => { const m = app.store.get("mission", id); m.status = status; m.approvedAt = Date.now(); if (status !== "ACTIVE") { const at = Date.parse(`${jstDay(-1)}T10:00:00+09:00`) + fixtures++ * 7 * 60_000; Object.assign(m, { createdAt: at, approvedAt: at + 20_000, finishedAt: at + 110_000 }); } m.transcript = turns.map(([source, text], i) => ({ id: `t-${i}`, source, text, t: (i + 1) * 4000, startMs: i * 4000 + 310, endMs: i * 4000 + 3180 })); app.store.put("mission", m); };
let page;
try {
  await api("/consent", { version: config.consentVersion });
  await api("/account/caller-name", { callerName: "田中" });
  await api("/contacts", { name: "焼肉 たけ", company: "飲食店", phone: "+81355550142" });
  await api("/contacts", { name: "佐藤", company: "株式会社サンプル", phone: "+81312345678", relationship: "inquiry", basis: "9/20 に資料請求フォームから問い合わせ" });
  await api("/products", { name: "Oathra ビジネス", facts: "AIが代わりに電話をかけ、決まったことを相手の言葉で確かめて報告します。", reviewed: true });
  const done = await draft("焼肉 たけ", "10月3日の19時に2名で予約を取ってほしい。名前は田中。");
  put(done, "COMPLETED", [["callee", "はい、焼肉たけです。"], ["caller", "10月3日の19時に2名で予約をお願いできますか。"], ["callee", "かしこまりました。10月3日19時、2名様でご予約承りました。"], ["caller", "ありがとうございます。ご予約できましたね。"]]);
  app.store.event(app.store.get("mission", done), { type: "decision.made", decision: "19時が満席だったので、20時半で予約をお願いしました", within: "時間は第一希望から2時間以内" });
  const running = await draft("ミカ", "最近どうしてるか聞いて、気軽に雑談してください。");
  put(running, "ACTIVE", [["caller", "もしもし、田中さんの代わりにお電話しているAIです。"], ["callee", "え、そうなの？どうしたの？"]]);
  const unknown = await draft("さくら歯科", "予約日を変更したいと伝えてください。");
  put(unknown, "UNKNOWN", []);
  await draft("デモ担当者", "資料を送ってよいか聞いてください。");
  // A request saved with its 任せる範囲 (as the app writes it), to check that it reads back.
  const scopedDraft = await draft("喫茶 ひかり", "10月8日の15時に3名で席を取ってほしい。\n\n【任せる範囲】\nその場で決めてよい：席の種類はどれでも\n決めずに持ち帰る（相手に「確認して折り返します」と伝える）：日付を変える案\nしない：支払い・カード番号を伝える、AIであることを隠す");
  const partial = (await api("/phone/draft", { phone: "+81355550142", name: "焼肉 たけ", instruction: "10月5日の18時に3名で予約を取ってほしい。", task: "reservation" })).mission.id;
  put(partial, "INCOMPLETE", [["caller", "10月5日の18時に3名で予約をお願いできますか。"], ["callee", "10月5日ですね、その日は空いております。お時間は確認しますので少々お待ちください。"]]);

  page = await launchQuiet({ width: 1440, height: 900 });
  await page.goto(base + "/");
  await page.until("document.querySelector('#public-email')", { label: "sign in" });
  c.ok(await page.js("!!document.querySelector('link[href=\"/app/style.css\"]')"), "/ is the new app (the previous screen lives at /workspace)");
  c.ok(!(await page.visible("#tabs")) && await page.visible("#public-password") && !(await page.js("!!document.querySelector('#token')")), "before sign-in: email and password, no token field");
  await page.screenshot(join(out, "gateway-app-login.png"));
  await page.js("[...document.querySelectorAll('button')].find(b => /管理者のトークン/.test(b.textContent)).click()");
  await page.until("document.querySelector('#token')", { label: "token form" });
  await page.js(`document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('form').requestSubmit()`);
  try { await page.until("!document.querySelector('#tabs').hidden && /ホーム/.test(document.querySelector('#view').textContent)", { timeout: 8000, label: "home" }); }
  catch (e) { console.log("VIEW:", await page.text("#view"), "ERR:", page.pageErrors.join(" | ")); throw e; }
  await page.js("location.hash='#/new'"); await page.until("!!document.querySelector('#ask-engine')", { label: "engine select" });
  const engines = await page.js("[...document.querySelectorAll('#ask-engine option')].map(o=>o.textContent)");
  c.ok(engines.some(t => /gpt-live-1/.test(t)) && engines.some(t => /gemini-3\.8-live/.test(t)), "電話を頼む: 音声AI names the model (gpt-live-1 / gemini-3.8-live)", engines.join(" | "));
  // As on a server with the keys set: every voice AI can be chosen (the worker never runs here; nothing is dialled).
  const engineReady = (config.voiceEngines ?? []).map((e) => e.ready); for (const e of config.voiceEngines ?? []) e.ready = true;
  await page.js("location.hash='#/'"); await page.until("/ホーム/.test(document.querySelector('#view').textContent)");
  await page.js("location.hash='#/new';location.reload()"); await sleep(1200); await page.until("!!document.querySelector('[data-group=\"people\"]')", { label: "ask form" });
  // 声: every voice of the chosen engine, and the choice is what the request sends.
  const voiceCounts = await page.js("(()=>{const s=document.querySelector('#ask-engine'),n=id=>{s.value=id;s.dispatchEvent(new Event('change'));return document.querySelectorAll('#ask-voice-name option').length-1;};const r={gpt:n('gpt-live'),gemini:n('gemini-live')};s.value='gpt-live';s.dispatchEvent(new Event('change'));return r;})()");
  c.ok(voiceCounts.gpt === 22 && voiceCounts.gemini === 30, "電話を頼む › 声: GPT-Live lists 22 voices and Gemini Live 30", JSON.stringify(voiceCounts));
  await page.js("(()=>{const v=document.querySelector('#ask-voice-name');v.value='shimmer';v.dispatchEvent(new Event('change'));const s=document.querySelector('#ask-engine');s.value='gemini-live';s.dispatchEvent(new Event('change'));})()");
  c.ok(await page.js("document.querySelector('#ask-voice-name').value===''"), "電話を頼む › 声: a voice the new engine does not have goes back to おまかせ");
  await page.js("(()=>{const s=document.querySelector('#ask-engine');s.value='gpt-live';s.dispatchEvent(new Event('change'));})()");
  c.ok(await page.js("document.querySelector('#ask-voice-name').value==='shimmer'"), "電話を頼む › 声: back on GPT-Live, the voice chosen there comes back");
  await page.js("(()=>{const p=document.querySelector('#ask-voice');p.value='sales-female';p.dispatchEvent(new Event('change'));})()");
  c.ok(/口調だけ/.test(await page.text("#ask-voice-note")) && /口調のみ/.test(await page.text(".ask-side")) && !/女性声/.test(await page.text(".ask-side")), "a chosen voice with a 話し方: the note and the brief say the 話し方 sets only the tone");
  await page.js("(()=>{const p=document.querySelector('#ask-voice');p.value='';p.dispatchEvent(new Event('change'));})()");
  await page.js("(()=>{const s=document.querySelector('#ask-engine');s.value='gpt-live';s.dispatchEvent(new Event('change'));const v=document.querySelector('#ask-voice-name');v.value='shimmer';v.dispatchEvent(new Event('change'));})()");
  c.ok(/shimmer/.test(await page.text(".ask-side")), "AIへの指示書 names the chosen voice");
  await page.js("document.querySelector('#ask-voice-name').scrollIntoView({block:'center'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-voice.png"));
  await page.js("window.scrollTo(0,0)");
  await page.js("(()=>{const v=document.querySelector('#ask-voice-name');v.value='';v.dispatchEvent(new Event('change'));})()");
  await page.js("[...document.querySelectorAll('[data-group]')].find(b=>b.dataset.group==='people').click()");
  await page.js("document.querySelector('[data-kind=\"ai-news\"]').click()");
  const news = await page.js("({engine:document.querySelector('#ask-engine').value,others:[...document.querySelectorAll('#ask-engine option')].filter(o=>o.value!=='gpt-live').every(o=>o.disabled),note:document.querySelector('#ask-engine-note').hidden?'':document.querySelector('#ask-engine-note').textContent,text:document.querySelector('#ask-instruction').value})");
  c.ok(news.engine === "gpt-live" && news.others && /GPT-Live/.test(news.note) && /満足/.test(news.text) && /他にどういった分野/.test(news.text), "電話を頼む › AIニュースを届ける: the request is written, and the voice AI is GPT-Live (the one with the news lookup)", news.note);
  await page.screenshot(join(out, "gateway-app-ask-ai-news.png"));
  await page.js("document.querySelector('[data-kind=\"chat\"]').click()");
  await page.js("(()=>{const s=document.querySelector('#ask-engine');s.value='gemini-live';s.dispatchEvent(new Event('change'));document.querySelector('[data-kind=\"ai-news\"]').click();document.querySelector('[data-kind=\"chat\"]').click();})()");
  c.ok(await page.js("document.querySelector('#ask-engine-note').hidden && [...document.querySelectorAll('#ask-engine option')].some(o=>o.value==='gemini-live'&&!o.disabled) && document.querySelector('#ask-engine').value==='gemini-live'"), "電話を頼む: choosing another kind gives the other voice AIs back, and the one chosen before");
  c.ok(await page.js("getComputedStyle(document.querySelector('.brief blockquote')).whiteSpace==='pre-line'"), "AIへの指示書 keeps the request's line breaks");
  // A live server without GPT-Live: the AI news call cannot be checked or placed, and says why.
  await page.js("location.hash='#/'"); await page.until("/ホーム/.test(document.querySelector('#view').textContent)");
  config.mode = "live"; config.liveReady = true; config.voiceEngines.find((e) => e.id === "gpt-live").ready = false;
  await page.js("location.hash='#/new';location.reload()"); await sleep(1200); await page.until("!!document.querySelector('[data-group=\"people\"]')", { label: "ask form" });
  await page.js("[...document.querySelectorAll('[data-group]')].find(b=>b.dataset.group==='people').click();document.querySelector('[data-kind=\"ai-news\"]').click()");
  const noLive = await page.js("({check:[...document.querySelectorAll('button')].find(b=>b.textContent==='内容を確かめる').disabled,warn:[...document.querySelectorAll('.warnbox')].map(w=>w.textContent).join('|')})");
  c.ok(noLive.check && /GPT-Live が使えないため/.test(noLive.warn), "AIニュース without GPT-Live: 内容を確かめる is off and the reason is shown", noLive.warn);
  await page.js("document.querySelector('[data-kind=\"chat\"]').click()");
  c.ok(await page.js("![...document.querySelectorAll('.warnbox')].some(w=>/GPT-Live が使えないため/.test(w.textContent))"), "another kind drops that warning");
  config.mode = "simulator"; config.liveReady = false;
  (config.voiceEngines ?? []).forEach((e, i) => { e.ready = engineReady[i]; });
  await page.js("location.hash='#/';location.reload()"); await sleep(1200); await page.until("/ホーム/.test(document.querySelector('#view').textContent)");
  const home = await page.text("#view");
  c.ok(/あなたの確認が必要な依頼が 3 件/.test(home) && await page.text("#attention-badge") === "3", "ホーム: three things need you (an unknown outcome, two drafts), also on the 依頼 tab", home.slice(0, 80));
  c.ok(/最新の報告/.test(home) && /焼肉 たけ/.test(home) && /最近の依頼/.test(home), "ホーム: the last call and the recent calls");
  c.ok(await page.visible("#live-pill"), "a running call shows 電話中 in the top bar");
  c.ok(await page.noPageScroll() === false || true, "(home may scroll)");
  await page.screenshot(join(out, "gateway-app-home.png"), { fullPage: true });

  await page.js("location.hash='#/requests'"); await page.until("!!document.querySelector('.page-actions a[href$=standing]')");
  const req = await page.text("#view");
  c.ok(/電話が終わったか確かめられていません/.test(req) && /発信前の確認待ち/.test(req) && /進行中/.test(req) && /終了した電話/.test(req), "依頼: needs-you cards, in progress and done", req.slice(0, 300));
  await page.screenshot(join(out, "gateway-app-requests.png"), { fullPage: true });

  await page.js(`location.hash='#/call/${running}'`); await page.until("/通話を終える/.test(document.querySelector('#view').textContent)");
  const live = await page.text("#view");
  c.ok(/電話中/.test(live) && /どうしたの/.test(await page.text(".transcript")) && /判定する項目がありません/.test(live), "電話中: the conversation, and a call with nothing to judge says so", live.slice(0, 120));
  await page.screenshot(join(out, "gateway-app-live.png"));
  // The live view follows the call: a new line shows without reloading.
  put(running, "ACTIVE", [["caller", "もしもし、田中さんの代わりにお電話しているAIです。"], ["callee", "え、そうなの？どうしたの？"], ["caller", "最近どうしてるかなと思って。"]]);
  await page.until("/最近どうしてるかなと思って/.test(document.querySelector('.transcript').textContent)", { timeout: 6000, label: "live update" });
  c.ok(true, "電話中: a new line appears within the poll interval");
  // A refresh that fails during a call keeps the screen and its stop button, says so, and recovers by itself.
  await page.js("window.__liveFetch=window.fetch;window.fetch=()=>Promise.reject(new TypeError('offline'))");
  await page.until("!!document.querySelector('.live-stale')", { timeout: 8000, label: "live refresh failure" });
  c.ok(await page.js("!!document.querySelector('.stop-call') && !document.querySelector('.stop-call').disabled && /状況を取得できません/.test(document.querySelector('.live-stale').textContent) && /通話は続いている可能性があります/.test(document.querySelector('.live-stale').textContent)"), "電話中: a failed refresh keeps the stop button and says the call may still be running");
  await page.screenshot(join(out, "gateway-app-live-stale.png"));
  await page.js("window.fetch=window.__liveFetch"); await page.until("!document.querySelector('.live-stale')", { timeout: 8000, label: "live refresh recovers" });
  c.ok(true, "電話中: the screen recovers by itself when the connection returns");
  // A stop that cannot be sent stays on screen with the button usable again; nothing claims the call ended.
  await page.js("window.__liveFetch=window.fetch;window.fetch=(u,o)=>/\\/cancel$/.test(String(u))?Promise.reject(new TypeError('offline')):window.__liveFetch(u,o)");
  await page.js("document.querySelector('.stop-call').click()");
  await page.until("!!document.querySelector('.call-foot .errbox:not([hidden])')", { timeout: 6000, label: "stop failure" });
  c.ok(await page.js("/停止を受け付けたか確認できませんでした/.test(document.querySelector('.call-foot .errbox').textContent) && !document.querySelector('.stop-call').disabled"), "電話中: a stop that could not be sent stays on screen and can be pressed again");
  await page.js("window.fetch=window.__liveFetch");
  // Stop accepted is not the call ended: the screen says it is confirming, and offers no second stop.
  { const m = app.store.get("mission", running); m.status = "CANCEL_REQUESTED"; app.store.put("mission", m); }
  await page.until("/停止を受け付けました/.test(document.querySelector('#view').textContent)", { timeout: 6000, label: "stopping" });
  c.ok(await page.js("!document.querySelector('.stop-call') && /電話が切れたことを確認しています/.test(document.querySelector('.headline').textContent) && !/電話が終わりました/.test(document.querySelector('#view').textContent) && !/上限の時間になると/.test(document.querySelector('#view').textContent) && /停止の確認中/.test(document.querySelector('#live-pill').textContent)"), "停止の受付: says the stop was accepted and is being confirmed, not that the call ended, with no second stop");
  await page.screenshot(join(out, "gateway-app-live-stopping.png"));
  { const m = app.store.get("mission", running); m.status = "ACTIVE"; app.store.put("mission", m); }
  await page.until("!!document.querySelector('.stop-call')", { timeout: 6000, label: "back to running" });

  await page.js(`location.hash='#/call/${done}'`); await page.until("!!document.querySelector('.report-top')");
  const report = await page.text("#view");
  c.ok(/決まりました/.test(report) && await page.js("!!document.querySelector('.ring')") && /ご予約承りました/.test(report), "報告: the ring, the settled fields with the callee's words", report.slice(0, 160));
  c.ok(!/phone\.|phone_|undefined|NaN/.test(report), "no internal ids or undefined on the report");
  c.ok(await page.js("!!document.querySelector('.report-top .verdict') && document.querySelectorAll('.rrow').length===4") && /確かめたのは、電話での合意までです/.test(report) && /会話の \d\d:\d\d/.test(report) && !/\d\d:\d\d\.\d{3}/.test(report), "報告 as in the film: verdict with summary, one row per field with the callee's words and their time, the caveat");
  c.ok(/AIの発言・判定に数えません/.test(await page.text(".transcript")) && /会話の記録/.test(await page.text(".side-top")), "the AI's own 「できました」 is marked as not counted; the side is the evidence");
  c.ok(/AIが判断したこと/.test(report) && /20時半で予約をお願いしました/.test(report) && /任せた範囲「時間は第一希望から2時間以内」の中です/.test(report) && /AIの報告です/.test(report), "報告: AIが判断したこと, marked as the AI's own account");
  await page.screenshot(join(out, "gateway-app-report.png"));

  await page.js("location.hash='#/new'"); await page.until("document.querySelector('#ask-phone')");
  await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='焼肉 たけ').click()");
  await page.js("{const t=document.querySelector('#ask-instruction');t.value='10月10日の19時に2名で予約を取ってほしい。';t.dispatchEvent(new Event('input',{bubbles:true}))}");
  c.ok(/焼肉 たけ/.test(await page.text(".ask-side")) && /10月10日/.test(await page.text(".ask-side")), "電話を頼む: the brief on the right follows the form");
  // 任せる範囲: ○ empty, △ two to start, × fixed; the brief follows; not for a chat.
  const scope = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.scope')].map(s=>[...s.querySelectorAll('.scope-item')].map(i=>i.firstChild.textContent)))"));
  c.ok(scope[0].length === 0 && scope[1].length === 2 && scope[2].length === 2, "任せる範囲: nothing decided for the AI by default, two to bring back, two it never does", JSON.stringify(scope));
  await page.js("document.querySelector('.scope.ok .scope-add').click()");
  c.ok(/その場で決めてよいこと：時間は第一希望から2時間以内/.test(await page.text(".ask-side")), "adding a ○ item shows in the AI's brief");
  await page.js("document.querySelector('[data-group=people]').click();document.querySelector('[data-kind=chat]').click()");
  c.ok(await page.js("document.querySelector('.scopes').closest('.field').hidden"), "a chat has no 任せる範囲");
  // 予約を取る: the blanks become fields (the names filled from the account), the request is written from them.
  await page.js("document.querySelector('[data-group=shop]').click();document.querySelector('[data-kind=reserve]').click()"); await sleep(150);
  const blanks = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('[data-blank]')].map(i=>[i.dataset.blank,i.value]))"));
  c.ok(blanks.length === 4 && blanks.find(([k]) => k === "自分の名前")?.[1] === "田中", "予約を取る: its blanks as fields, your name filled in", JSON.stringify(blanks));
  await page.js("for (const [k,v] of [['希望日時','10月10日の19時'],['人数','2名']]) { const i=document.querySelector(`[data-blank='${k}']`); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); }");
  c.ok(/10月10日の19時に2名で予約を取ってください/.test(await page.js("document.querySelector('#ask-instruction').value")) && /AIが予約を取ります/.test(await page.text(".ask-side")) && !(await page.js("document.querySelector('.scopes').closest('.field').hidden")), "the request is written from the fields; the brief says the AI books; 任せる範囲 is there");
  await page.screenshot(join(out, "gateway-app-ask-reserve.png"));
  await page.js("document.querySelector('[data-group=free]').click()");
  c.ok(/確かめるまで、発信できません/.test(await page.text(".ask-side")) && await page.js("document.querySelector('.ask-side .btn.big').disabled"), "an unknown outcome blocks a new call, and the side says where to fix it");
  await page.screenshot(join(out, "gateway-app-ask.png"));

  // A saved request reads its 任せる範囲 back: the text without the block, the choices restored.
  await page.js(`location.hash='#/new?draft=${scopedDraft}'`); await page.until("document.querySelector('#ask-instruction')");
  await sleep(300);
  const back = JSON.parse(await page.js("JSON.stringify({text:document.querySelector('#ask-instruction').value,ok:[...document.querySelectorAll('.scope.ok .scope-item')].map(i=>i.firstChild.textContent),hold:[...document.querySelectorAll('.scope.hold .scope-item')].map(i=>i.firstChild.textContent)})"));
  c.ok(!/任せる範囲/.test(back.text) && back.ok.join() === "席の種類はどれでも" && back.hold.join() === "日付を変える案", "reopening a request restores its 任せる範囲 and leaves it out of the text", JSON.stringify(back));
  await page.js("location.hash='#/requests'"); await page.until("/喫茶 ひかり/.test(document.querySelector('#view').textContent)");
  c.ok(!/【任せる範囲】/.test(await page.text("#view")), "lists show the request without the 任せる範囲 block");
  await page.js("location.hash='#/contacts'"); await page.until("/この相手に電話を頼む/.test(document.querySelector('#view').textContent)");
  c.ok(/03-5555-0142/.test(await page.text("#view")), "連絡先: the list and the selected contact, number as written in Japan");
  await page.screenshot(join(out, "gateway-app-contacts.png"));
  // Add with a number as people write it, edit it in the same form, then delete it (confirm() is answered by the page stub).
  const fill = (v) => page.js(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.elements.basis);for(const [k,x] of Object.entries(${JSON.stringify(v)}))f.elements[k].value=x;f.requestSubmit();})()`);
  await page.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='＋ 連絡先を追加').click()");
  await fill({ name: "山田", phone: "090-1234-5678" });
  await page.until("/山田/.test(document.querySelector('.headline')?.textContent)", { label: "contact added" });
  c.ok(/090-1234-5678/.test(await page.text("#view")), "連絡先: a number written 090-1234-5678 is saved and shown as written");
  await page.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='編集').click()");
  c.ok(await page.js("(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.elements.basis);return !f.hidden&&/連絡先を編集/.test(f.textContent)&&f.elements.name.value==='山田'&&f.elements.phone.value==='090-1234-5678';})()"), "連絡先: 編集 opens the form filled with the contact");
  c.ok(await page.js("[...document.querySelectorAll('.card')].every(el=>el.hidden||!/この相手に電話を頼む/.test(el.textContent)||el.tagName==='FORM')"), "連絡先: while editing, the detail card and its buttons step aside");
  await page.js("(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.elements.basis);f.elements.basis.value='途中';f.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false;[...document.querySelectorAll('.list .item')].find(b=>/佐藤/.test(b.textContent)).click();})()");
  await sleep(300);
  c.ok(await page.js("(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.elements.basis);return !f.hidden&&f.elements.basis.value==='途中'&&/#\\/contacts\\//.test(location.hash)&&!/佐藤/.test(document.querySelector('.headline')?.textContent||'');})()"), "連絡先: choosing another contact with unsaved edits asks first; 'no' keeps the typing");
  await page.screenshot(join(out, "gateway-app-contact-edit.png"));
  await fill({ name: "山田 花子", phone: "080-9999-0000" });
  await page.until("/山田 花子/.test(document.querySelector('.headline')?.textContent)", { label: "contact edited" });
  c.ok(/080-9999-0000/.test(await page.text("#view")) && (await api("/contacts")).filter((x) => /山田/.test(x.name)).length === 1, "連絡先: editing changes the same contact, not a new one");
  await page.js("window.confirm=()=>true;[...document.querySelectorAll('button')].find(b=>b.textContent==='削除').click()");
  await page.until("!/山田/.test(document.querySelector('#view').textContent)", { label: "contact deleted" });
  c.ok(!(await api("/contacts")).some((x) => /山田/.test(x.name)) && /焼肉 たけ/.test(await page.text("#view")), "連絡先: 削除 removes it and shows the rest");
  await page.js("location.hash='#/settings/out'"); await page.until("/かける設定/.test(document.querySelector('#view').textContent)");
  c.ok(/田中の代わりにお電話している/.test(await page.text("#view")) && /常にオン/.test(await page.text("#view")), "設定: the name the AI gives, and approval that cannot be turned off");
  await page.screenshot(join(out, "gateway-app-settings.png"));
  // かけられた時の設定: saved per account and shown again.
  await page.js("location.hash='#/settings/in'"); await page.until("/かかってきたとき/.test(document.querySelector('#view').textContent)");
  c.ok(await page.js("document.querySelector('input[name=inb-mode][value=forward]').disabled"), "あなたにつなぐ needs a verified phone (disabled here)");
  await page.js("document.querySelector('input[name=inb-mode][value=decline]').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='保存する').click()");
  await page.until("document.querySelector('input[name=inb-mode][value=decline]')?.checked && /保存しました/.test(document.querySelector('#toast').textContent)", { label: "inbound saved" });
  c.ok(true, "かけられた時の設定: 出ない is saved and shown again");
  await page.screenshot(join(out, "gateway-app-inbound.png"));
  // 月の上限: set in 設定 › 費用とクレジット, shown on ホーム.
  await page.js("location.hash='#/settings/voice'"); await page.until("/声を聞く/.test(document.querySelector('#view').textContent)", { label: "voice samples" });
  c.ok(await page.js("document.querySelectorAll('.voice-item .sample').length") >= 5 && await page.js("[...document.querySelectorAll('.voice-item .sample')].every(b=>/^\\/phone\\/voices\\/[a-z]+\\.wav$/.test(b.dataset.url))"), "設定 › 声とAI: recorded samples of the voices, playable");
  c.ok((await fetch(base + "/phone/voices/marin.wav", { headers: { range: "bytes=0-99" } })).status === 206, "samples answer Range requests (Safari)");
  await page.screenshot(join(out, "gateway-app-settings-voice.png"));
  await page.js("location.hash='#/settings/cost'"); await page.until("/月の上限/.test(document.querySelector('#view').textContent)");
  await page.js("{const i=document.querySelector('input[aria-label=\"月の上限（米ドル）\"]');i.value='30';[...document.querySelectorAll('button')].find(b=>b.textContent==='保存する'&&b.closest('.set-row')?.textContent.includes('月の上限')).click()}");
  await page.until("/上限 \\$30/.test(document.querySelector('#view').textContent)", { label: "cap saved" });
  await page.js("location.hash='#/'"); await page.until("/今月の費用/.test(document.querySelector('#view').textContent)");
  c.ok(/上限 \$30/.test(await page.text("#view")) && await page.js("!!document.querySelector('.bar-meter i')"), "月の上限: saved in 設定 and shown on ホーム with a meter");
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));

  // 予定: dates settled on calls, 確定 only on the callee's words.
  await page.js("location.hash='#/schedule'"); await page.until("/これからの予定/.test(document.querySelector('#view').textContent)");
  const sched = await page.text("#view");
  c.ok(/10月3日（土）/.test(sched) && /19:00/.test(sched) && /相手の言葉で確定/.test(sched) && /10月5日（月）/.test(sched) && /未確定（提案・確認待ち）/.test(sched), "予定: the booked day settled by the callee's words, the proposed one not", sched.slice(0, 200));
  await page.js("location.hash='#/schedule/2026-10'"); await sleep(500); // the month the fixtures' dates fall in
  c.ok(await page.js("document.querySelectorAll('.cal-d .dots i.ok').length") >= 1 && await page.js("document.querySelectorAll('.cal-d .dots i.wait').length") >= 1, "the month grid marks settled and unsettled days");
  await page.screenshot(join(out, "gateway-app-schedule.png"), { fullPage: true });
  // 練習: the list, the detail, and a practice run that closes the ring only on the callee's words.
  await page.emulateReducedMotion();
  await page.js("location.hash='#/practice'"); await page.until("document.querySelectorAll('.item').length>0", { label: "practice list" });
  c.ok(await page.js("document.querySelectorAll('.item').length") >= 5 && /レストラン予約/.test(await page.text("#view")), "練習: the practice list in Japanese");
  await page.js("location.hash='#/practice/restaurant-reservation'"); await sleep(400);
  await page.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='練習を始める').click()");
  await page.until("/練習が終わりました/.test(document.querySelector('#view').textContent)", { timeout: 20000, label: "practice run" });
  c.ok(await page.js("document.querySelector('.ring text')?.textContent") === "4/4" && /決まりました/.test(await page.text(".headline")) && /なし/.test(await page.text(".call-foot")), "練習 run: the ring closes 4/4 on the callee's words, no false completion");
  await page.screenshot(join(out, "gateway-app-practice.png"));
  await page.js("location.hash='#/practice/false-completion-trap/run'");
  await page.until("/練習が終わりました/.test(document.querySelector('#view').textContent)", { timeout: 20000, label: "trap run" });
  c.ok(/決まりませんでした/.test(await page.text(".headline")), "the full-restaurant trap is not reported as settled");

  // 自分が相手役: the AI calls you and you answer as the shop in text; the ring closes only on what you said.
  await page.js("location.hash='#/practice/restaurant-reservation'"); await sleep(400);
  await page.js("document.querySelector('input[name=how][value=play]').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='練習を始める').click()");
  await page.until("!!document.querySelector('#play-text')", { label: "play view" });
  await page.js(`document.querySelector('#play-text').value='はい、さくら亭です。';document.querySelector('.play-form').requestSubmit()`);
  await page.until("[...document.querySelectorAll('.transcript .line:not(.callee)')].some(n=>/予約/.test(n.textContent))", { timeout: 20000, label: "AI asks" });
  c.ok(await page.js("document.querySelector('.ring text')?.textContent") === "0/4", "自分が相手役: the AI asking closes nothing", await page.js("document.querySelector('.ring text')?.textContent"));
  await page.js(`document.querySelector('#play-text').value='はい、9月12日の19時に2名様で空いております。';document.querySelector('.play-form').requestSubmit()`);
  await page.until("document.querySelectorAll('.fcard.ok').length>=3", { timeout: 20000, label: "fields settle" });
  c.ok(/あなた（/.test(await page.text(".transcript")) && await page.js("[...document.querySelectorAll('.fcard.ok .q')].every(q=>[...document.querySelectorAll('.transcript .line.callee')].some(l=>l.textContent.includes(q.textContent.replace(/^「|」$/g,''))))"), "each settled field quotes your own line", await page.text(".fields"));
  await page.screenshot(join(out, "gateway-app-practice-play.png"));
  await page.js("[...document.querySelectorAll('button')].find(b=>b.textContent==='電話を切る').click()");
  await page.until("/練習が終わりました/.test(document.querySelector('#view').textContent)", { timeout: 20000, label: "play hangup" });
  c.ok(!(await page.visible("#play-text")), "after the call the answer box closes");

  // 営業の目的: a registered contact and a reviewed product; practice mode talks to the practice partner.
  for (const id of [running, unknown]) { const m = app.store.get("mission", id), at = Date.parse(`${jstDay(-1)}T13:00:00+09:00`) + fixtures++ * 7 * 60_000; Object.assign(m, { status: "COMPLETED", createdAt: at, approvedAt: at + 20_000, finishedAt: at + 110_000 }); app.store.put("mission", m); }
  await page.js("location.hash='#/'"); await sleep(300);
  await page.js("location.hash='#/new'"); await page.until("document.querySelector('[data-group=work]')");
  await page.js("document.querySelector('[data-group=work]').click();document.querySelector('[data-kind=meeting]').click()");
  c.ok(!(await page.js("document.querySelector('#ask-product').closest('.two').hidden")) && /15分の商談/.test(await page.js("document.querySelector('#ask-instruction').value")), "商談: the product appears and the request follows the purpose");
  await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='佐藤').click()");
  await page.js("[...document.querySelectorAll('.ask-side button')].find(b=>b.textContent==='内容を確かめる').click()");
  try { await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "sales review" }); } catch (e) { console.log("SIDE:", await page.text(".ask-side")); throw e; }
  c.ok(/練習なので0円/.test(await page.text(".ask-side")) && /Oathra ビジネス/.test(await page.text(".ask-side")), "the review names the product and says practice costs nothing");
  await page.screenshot(join(out, "gateway-app-ask-sales.png"));
  await page.js("document.querySelector('#ask-ack').click()"); await sleep(100);
  await page.js("[...document.querySelectorAll('.ask-side button')].find(b=>b.textContent==='この内容で電話をかける').click()");
  await page.until("location.hash.startsWith('#/call/') && /佐藤/.test(document.querySelector('#view').textContent)", { label: "sales call view" });
  c.ok(/商談の日時/.test(await page.text("#view")) && /練習/.test(await page.text(".crumb")), "after approval the sales call opens in the call view, marked 練習, with its one field");

  await page.js(`location.hash='#/call/${partial}'`); await page.until("!!document.querySelector('.report-top')");
  c.ok(await page.js("document.querySelector('.ring text')?.textContent") !== "4/4" && !/決まりました/.test(await page.text(".headline")), "a partly confirmed call: the ring stays open and the headline does not say settled", await page.js("document.querySelector('.ring text')?.textContent"));
  await page.screenshot(join(out, "gateway-app-report-partial.png"));

  // 見守り・定期・チーム・連絡停止 (2026-10-02). As above: fixtures for rendering, written the way the worker writes them
  // (the check-in comes from the real checkInReport over the fixture's lines); never a claim that such a call took place.
  const care = async (as, name, phone, turns, more = {}) => {
    const id = (await as("/phone/draft", { phone, name, instruction: "ひかり苑からの見守りの電話です。体調、食事、お薬、睡眠、困りごとを一つずつ尋ねてください。", pace: "gentle" })).mission.id;
    put(id, turns.length ? "COMPLETED" : "INCOMPLETE", turns);
    const m = app.store.get("mission", id), checkIn = checkInReport(m.transcript), signals = [...checkIn.signals.map(({ quote, ...s }) => s), ...(more.reported ? [{ level: "concern", category: "reported", source: "model", phrase: more.reported }] : [])]; delete more.reported;
    Object.assign(m, { answered: checkIn.answered, result: { ...(m.result ?? {}), checkIn }, attention: signals.length ? { level: signals.some((s) => s.level === "emergency") ? "emergency" : "concern", signals } : null, ...more });
    // When the call was: a time a schedule could really have rung (07:00-21:00), not the moment this check runs.
    const at = more.at ?? Date.parse(`${jstDay(-1)}T09:10:00+09:00`) + fixtures++ * 6 * 60_000;
    Object.assign(m, { createdAt: at, approvedAt: at, finishedAt: at + 90_000 }); delete m.at;
    app.store.put("mission", m); return id;
  };
  const haru = await api("/contacts", { name: "山本 ハル", company: "ひかり苑 201号室", phone: "+819011112222", basis: "9/28 ご本人と長女から、毎日の見守りの電話に同意をいただいた" });
  const mitsu = await api("/contacts", { name: "佐々木 ミツ", company: "ひかり苑 105号室", phone: "+819033334444", basis: "10/1 入居時にご本人から同意をいただいた" });
  const stoppedContact = await api("/contacts", { name: "田中 一郎", company: "田中工務店", phone: "+819055556666" });
  const optedOut = await api("/contacts", { name: "高橋 花", phone: "+819077778888" });
  await api("/suppressions", { contactId: stoppedContact.id, acknowledged: true });
  app.store.suppress("local", optedOut.phone, "dtmf");
  const careCall = await care(api, "山本 ハル", haru.phone, [["caller", "こんにちは。ひかり苑の代わりにお電話しているAIです。今日のお体の調子はいかがですか。"], ["callee", "昨日の夜に廊下で転んでしまって、起き上がれなくて大変でした。"],
    ["caller", "そうでしたか。ご飯は召し上がりましたか。"], ["callee", "はい、食べました。"], ["caller", "お薬は飲まれましたか。"], ["callee", "まだです。あとで飲みます。"],
    ["caller", "夜はよく眠れましたか。"], ["callee", "たぶん眠れたかな。"], ["caller", "困っていることや、伝えておきたいことはありますか。"], ["callee", "腰が痛いので、だれかに見てもらいたいです。"],
    ["caller", "分かりました。聞いた内容はひかり苑に伝えます。ありがとうございました。"]], { reported: "声がいつもより弱く、途中で何度も咳をしていた", at: Date.parse(`${new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10)}T09:00:20+09:00`) });
  const day = (offset) => new Date(Date.now() + 9 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
  const standing = await api("/schedules", { request: { phone: haru.phone, name: "山本 ハル", instruction: "ひかり苑からの見守りの電話です。体調、食事、お薬、睡眠、困りごとを一つずつ尋ねてください。", pace: "gentle" }, times: ["09:00"], until: day(45) + "T23:59:59+09:00", retries: { count: 2, minutes: 30 }, acknowledged: true });
  { const made = app.store.get("schedule", standing.id); made.createdAt = Date.parse(`${day(-4)}T08:00:00+09:00`); app.store.put("schedule", made); }
  const noAnswer = await care(api, "山本 ハル", haru.phone, [], { schedule: { id: standing.id, run: `${standing.id}:${day(-2)}:09:00`, attempt: 2, final: true }, at: Date.parse(`${day(-2)}T10:01:10+09:00`) });
  // One row for every 09:00 since the schedule was made (four days ago). Today's, once it has passed, was missed: this check never runs the worker.
  const todayPassed = Date.now() > Date.parse(`${day(0)}T09:00:00+09:00`);
  const runs = [[day(-4), "09:00", "FAILED", [], "insufficient_credits"], [day(-3), "09:00", "SKIPPED", [], "window_passed"], [day(-2), "09:00", "UNANSWERED", [noAnswer, noAnswer, noAnswer]], [day(-1), "09:00", "ANSWERED", [careCall]], ...(todayPassed ? [[day(0), "09:00", "SKIPPED", [], "service_was_not_running"]] : [])];
  for (const [date, time, state, attempts, reason] of runs) app.store.put("schedule-run", { id: `${standing.id}:${date}:${time}`, owner: user.id, scheduleId: standing.id, date, time, state, status: state, ...(reason ? { reason } : {}), attempts: attempts.map((missionId) => ({ missionId, at: Date.now() })) });
  const mateApi = apiAs(mateToken);
  await mateApi("/account/caller-name", { callerName: "鈴木" });
  // 佐々木 ミツ over three mornings: spoke, then nobody answered twice (これまでの電話 shows the two in a row).
  await care(api, "佐々木 ミツ", mitsu.phone, [["caller", "ご飯は召し上がりましたか。"], ["callee", "はい、食べました。"], ["caller", "お薬は飲まれましたか。"], ["callee", "はい、飲みました。"]], { at: Date.parse(`${day(-3)}T09:05:00+09:00`) });
  for (const d of [-2, -1]) await care(api, "佐々木 ミツ", mitsu.phone, [], { at: Date.parse(`${day(d)}T09:05:00+09:00`) });
  // 折り返しの依頼: as the line writes them when a caller presses 1 (two open, one already called back by a teammate).
  const callbackSeed = [["+819088887777", "busy", `${day(-1)}T12:40:00+09:00`], ["+81355550199", "outside_business_hours", `${day(-1)}T21:35:00+09:00`], ["+819066665555", "rate_limited", `${day(-2)}T11:05:00+09:00`, "suzuki"]];
  for (const [phone, reason, at, doneBy] of callbackSeed) app.store.put("callback-request", { id: "cb_" + randomBytes(6).toString("hex"), owner: user.id, team: "local", status: doneBy ? "DONE" : "OPEN", phone, reason, createdAt: Date.parse(at), ...(doneBy ? { doneAt: Date.parse(at) + 40 * 60_000, doneBy } : {}) });
  const mateCall = await care(mateApi, "田村 節子", "+819012340001", [["caller", "ご飯は召し上がりましたか。"], ["callee", "食欲がなくて、朝から何も食べていません。"], ["caller", "お薬は飲まれましたか。"], ["callee", "はい、飲みました。"]]);
  // Nothing flagged as a line, but an answer that needs a look: the report must still carry a 要確認 banner.
  const mateQuiet = await care(mateApi, "石井 トメ", "+819012340003", [["caller", "お薬は飲まれましたか。"], ["callee", "まだです。"], ["caller", "夜はよく眠れましたか。"], ["callee", "はい、眠れました。"]]);
  // A teammate's saved contact (its history opens from 相手ごとの様子), and a trade call that asked for 50ケース and heard 30.
  const tamuraContact = await mateApi("/contacts", { name: "田村 節子", phone: "+819012340001", basis: "9/25 ご家族から見守りの電話の同意をいただいた" });
  const tradeCall = (await api("/phone/draft", { phone: "+81312340009", name: "青木商店", instruction: "田中商会の田中の代理として、りんごジュースの納期を確認してください。", success: { required: ["quantity", "confirmed"], expected: { quantity: "50ケース" } } })).mission.id;
  put(tradeCall, "INCOMPLETE", [["caller", "りんごジュースを50ケース、今月中に納品いただけますか。"], ["callee", "申し訳ありません、今月は30ケースまでなら納品できます。"]]);
  // A list registered through the API two days ago, with its calls as the worker would have left them: the same calls
  // then show in the list, in each person's history, on the board and in the team list (one state for every capture).
  const seededList = await api("/batches", { kind: "request", contactIds: [haru.id, mitsu.id, optedOut.id, stoppedContact.id], request: { instruction: "今週の体調をうかがって、困りごとがないか聞いてください。", pace: "gentle" }, retry: { count: 1, minutes: 60 }, acknowledged: true });
  { const listHaru = await care(api, "山本 ハル", haru.phone, [["caller", "お薬は飲まれましたか。"], ["callee", "はい、飲みました。"]], { batch: { id: seededList.id }, at: Date.parse(`${day(-2)}T15:00:00+09:00`) });
    const listMitsu = await care(api, "佐々木 ミツ", mitsu.phone, [], { batch: { id: seededList.id }, at: Date.parse(`${day(-2)}T16:05:00+09:00`) });
    const b = app.store.get("batch", seededList.id), item = (n) => b.items.find((i) => i.name === n);
    Object.assign(item("山本 ハル"), { state: "DONE", outcome: "COMPLETED", attempts: 1, missionId: listHaru });
    Object.assign(item("佐々木 ミツ"), { state: "DONE", outcome: "UNANSWERED", attempts: 2, missionId: listMitsu });
    b.createdAt = Date.parse(`${day(-2)}T14:50:00+09:00`); b.expiresAt = b.createdAt + 7 * 86400e3; b.status = "FINISHED"; b.finishedAt = Date.parse(`${day(-2)}T16:07:00+09:00`); app.store.put("batch", b); }
  // Trade calls that required both a quantity and a delivery date: one where only the quantity was confirmed, one where both were.
  const due = day(18), dueSaid = `${Number(due.slice(5, 7))}月${Number(due.slice(8))}日`, later = `${Number(day(23).slice(5, 7))}月${Number(day(23).slice(8))}日`;
  const trade = async (name, phone, reply) => { const id = (await api("/phone/draft", { phone, name, instruction: `田中商会の田中の代理として、りんごジュースの納期を確認してください。\n確かめる条件：数量 50ケース・納期 ${dueSaid}。`, success: { required: ["quantity", "date", "confirmed"], expected: { quantity: "50ケース", date: due } } })).mission.id;
    put(id, reply.status, [["caller", `りんごジュースを50ケース、${dueSaid}に納品いただけますか。`], ["callee", reply.text]]); return id; };
  const tradeHalf = await trade("西川青果", "+81312340010", { status: "INCOMPLETE", text: `50ケースはご用意できます。ただ、納品は${later}になります。` });
  const tradeBoth = await trade("東山食品", "+81312340011", { status: "COMPLETED", text: `はい、50ケース、${dueSaid}の納品で承りました。` });
  const mateLong = (await mateApi("/phone/draft", { phone: "+81312340002", name: "特別養護老人ホームひかり苑 第二事業所 地域連携室 山田太郎", instruction: "来週の面会の予定をお知らせしてください。" })).mission.id;
  put(mateLong, "COMPLETED", [["caller", "来週の面会の予定をお知らせします。"], ["callee", "分かりました。ありがとうございます。"]]);
  // ---- 2026-10-02: ゆっくり・やさしく話す, the wellbeing report, 定期の電話, チームの電話, 連絡停止 and the CSV import.
  const go = async (hashv, ready, label = hashv) => { await page.js(`location.hash=${JSON.stringify(hashv)}`); await page.until(ready, { timeout: 10_000, label }); };
  const small = async (label) => { const s = await page.smallTargets(44); c.ok(s.length === 0, `${label}: no control under 44px`, s.join(", ")); };
  const clickText = (text, scope = "") => page.js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a`)})].find(n=>n.offsetParent&&n.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('no control: ${text}');b.click();return true})()`);
  // As on a live server: only there can a phone request be reviewed. The worker is never started, so nothing is dialled.
  for (const m of app.store.list("mission", user.id)) if (["QUEUED", "DIALING", "ACTIVE", "UNKNOWN"].includes(m.status)) { const at = Date.parse(`${jstDay(-1)}T14:00:00+09:00`) + fixtures++ * 7 * 60_000; Object.assign(m, { status: "COMPLETED", createdAt: at, approvedAt: at + 20_000, finishedAt: at + 110_000 }); app.store.put("mission", m); }
  config.mode = "live"; config.liveReady = true;
  await page.js("location.hash='#/new';location.reload()"); await sleep(1200);
  await page.until("!!document.querySelector('[data-group=\"care\"]')", { label: "ask form (as live)" });
  const groups = await page.js("[...document.querySelectorAll('[data-group]')].map(b=>b.textContent)");
  await page.js("document.querySelector('[data-group=trade]').click()");
  const tradeKinds = await page.js("[...document.querySelectorAll('[data-kind]')].map(b=>b.dataset.kind).join()");
  await page.js("document.querySelector('[data-group=care]').click()");
  const careKinds = await page.js("[...document.querySelectorAll('[data-kind]')].map(b=>b.dataset.kind).join()");
  c.ok(groups.includes("見守り・介護") && groups.includes("取引先への確認") && careKinds === "wellbeing-check,medication-reminder,visit-notice" && tradeKinds === "delivery-date,quote-request", "電話を頼む: the new kinds sit under 見守り・介護 and 取引先への確認", `${careKinds} | ${tradeKinds}`);
  const gentleOn = () => page.js("document.querySelector('#ask-gentle').checked");
  c.ok(!(await gentleOn()) && /高齢の方や、耳の遠い方に/.test(await page.text("#ask-gentle-note")), "ゆっくり・やさしく話す: off to begin with, with one line saying who it is for");
  await page.js("document.querySelector('[data-kind=wellbeing-check]').click()");
  c.ok(await gentleOn(), "choosing 見守り switches ゆっくり・やさしく話す on");
  await page.js("document.querySelector('[data-kind=visit-notice]').click()");
  c.ok(!(await gentleOn()), "a kind without it switches it off again");
  await page.js("document.querySelector('[data-kind=wellbeing-check]').click()");
  await page.js("document.querySelector('#ask-gentle').focus()"); await page.press(" ");
  const gentleFocus = await page.focused();
  c.ok(!(await gentleOn()) && gentleFocus.id === "ask-gentle" && gentleFocus.outline, "the option works from the keyboard and shows its focus", JSON.stringify(gentleFocus));
  await page.press(" ");
  await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='佐々木 ミツ').click()");
  // The template's blank left as it is, the text edited by hand: it must not reach approval.
  await page.js("{const t=document.querySelector('#ask-instruction');t.value=t.value+' よろしくお願いします。';t.dispatchEvent(new Event('input',{bubbles:true}))}");
  await clickText("内容を確かめる", ".ask-side"); await sleep(600);
  c.ok(/「施設名や依頼者の名前」を入れてください/.test(await page.text(".ask-side .errbox")) && !(await page.js("!!document.querySelector('#ask-ack')")) && !app.store.list("mission", user.id).some((m) => m.status === "DRAFT" && m.target.name === "佐々木 ミツ"), "a wellbeing request whose （施設名や依頼者の名前） is still in the text is refused before any draft is made", await page.text(".ask-side .errbox"));
  await page.js("document.querySelector('[data-kind=visit-notice]').click();document.querySelector('[data-kind=wellbeing-check]').click()");
  await page.js("{const i=document.querySelector('[data-blank]');i.value='ひかり苑';i.dispatchEvent(new Event('input',{bubbles:true}))}");
  c.ok(/ひかり苑の代わりであること/.test(await page.text(".ask-side")) && !/田中の代わり/.test(await page.text(".ask-side")), "the brief names one caller: the facility the request speaks for");
  await page.js("document.querySelector('#ask-gentle').scrollIntoView({block:'center'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-gentle.png"));
  await small("電話を頼む (gentle)");
  await page.js("window.scrollTo(0,0)"); await sleep(200);
  const sideBox = JSON.parse(await page.js("JSON.stringify((()=>{const s=document.querySelector('.ask-side'),cs=getComputedStyle(s);return {w:innerWidth,h:innerHeight,position:cs.position,overflow:cs.overflowY,clipped:s.scrollHeight>s.clientHeight+1,rows:[...s.querySelectorAll('.defs dt')].map(d=>d.textContent)}})())"));
  c.ok(sideBox.w === 1440 && sideBox.h === 900 && sideBox.position === "static" && sideBox.overflow === "visible" && !sideBox.clipped, "電話を頼む at 1440x900, top of the page: the confirmation column clips nothing (no row is cut by a box of its own)", JSON.stringify(sideBox));
  c.ok(sideBox.rows.includes("話す速さ") && !sideBox.rows.includes("話し方") && !sideBox.rows.includes("音声AI"), "with the gentle pace on, the column shows 話す速さ and not 話し方 標準", sideBox.rows.join());
  await clickText("内容を確かめる", ".ask-side");
  await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "review" });
  const reviewed = app.store.list("mission", user.id).find((m) => m.status === "DRAFT" && m.target.name === "佐々木 ミツ");
  c.ok(/話す速さ/.test(await page.text(".ask-side")) && /ゆっくり・やさしく話す/.test(await page.text(".ask-side .defs")) && reviewed?.phoneRequest.pace === "gentle" && reviewed.phoneRequest.callerName === "ひかり苑" && !/gpt-live-1/.test(await page.text(".ask-side .defs")), "the review shows 話す速さ and no model id; the draft carries the gentle pace and the one caller name", String(reviewed?.phoneRequest.pace));
  // The confirmation says until when it holds; an expired one goes back to 内容を確かめる, says nothing was dialled, and dials nothing.
  c.ok(/\d{2}:\d{2} まで有効です/.test(await page.text(".ask-side")), "the confirmation says until when it is valid");
  const placedBefore = app.store.list("mission", user.id).filter((m) => m.target?.name === "佐々木 ミツ" && m.status !== "DRAFT").length;
  await page.js("document.querySelector('#ask-ack').click()");
  await page.js("window.__askFetch=window.fetch;window.fetch=(u,o)=>/\\/start$/.test(String(u))?Promise.resolve(new Response(JSON.stringify({error:'approval_expired_or_used'}),{status:409,headers:{'content-type':'application/json'}})):window.__askFetch(u,o)");
  await page.js("[...document.querySelectorAll('.ask-side button')].find(b=>b.textContent==='この内容で電話をかける').click()");
  await page.until("!document.querySelector('#ask-ack')", { timeout: 6000, label: "expired approval resets" });
  c.ok(await page.js("[...document.querySelectorAll('.ask-side button')].find(b=>b.textContent==='内容を確かめる')?.disabled===false") && /電話はかけていません/.test(await page.text(".ask-side .errbox")) && app.store.list("mission", user.id).filter((m) => m.target?.name === "佐々木 ミツ" && m.status !== "DRAFT").length === placedBefore, "an expired approval returns to 内容を確かめる, says nothing was dialled, and nothing was dialled");
  await page.js("window.fetch=window.__askFetch");
  await sleep(500);
  c.ok(!app.store.list("mission", user.id).some((m) => m.status === "DRAFT" && m.target?.name === "佐々木 ミツ"), "the draft made for the expired confirmation is not left waiting for approval");
  await clickText("内容を確かめる", ".ask-side");
  await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "review again" });
  // 定期の電話にする: times, weekdays, end date, retries, the rules and the upper bound, then an explicit approval.
  await page.js("document.querySelector('#rep-on').click()");
  await page.until("!!document.querySelector('.rep-panel')", { label: "repeat panel" });
  c.ok(!(await page.js("[...document.querySelectorAll('.ask-side button')].some(b=>b.textContent==='この内容で電話をかける')")), "with 定期の電話にする on, the one-off call button steps aside");
  await page.js("document.querySelector('.rep-add').click()");
  await page.js("{const i=[...document.querySelectorAll('.rep-times input')].pop();i.value='18:30';i.dispatchEvent(new Event('change',{bubbles:true}))}");
  await page.js("for (const d of ['0','6']) document.querySelector(`.day-chip[data-day='${d}']`).click()");
  await page.js(`{const u=document.querySelector('#rep-until');u.value='${day(20)}';u.dispatchEvent(new Event('change',{bubbles:true}));const n=document.querySelector('#rep-count');n.value='2';n.dispatchEvent(new Event('change',{bubbles:true}))}`);
  let ringDays = 0, occ = 0; { const now = Date.now(), end = Date.parse(day(20) + "T23:59:59+09:00"); for (let t = now, n = 0; n < 100; t += 86400e3, n++) { const d = new Date(t + 9 * 3600e3); if (![1, 2, 3, 4, 5].includes(d.getUTCDay())) continue; const ahead = ["09:00", "18:30"].filter((time) => { const at = Date.parse(`${d.toISOString().slice(0, 10)}T${time}:00+09:00`); return at >= now && at < end; }).length; if (ahead) { ringDays++; occ += ahead; } } }
  const bound = occ * 3, rules = await page.text(".rep-rules");
  c.ok(new RegExp(`最大 ${bound} 回かけます（これからの${occ}回 × かけ直しを含め3回・かける日 ${ringDays}日）`).test(await page.text(".rep-bound")), "the upper bound counts the times still ahead on the chosen weekdays, with its breakdown", await page.text(".rep-bound"));
  await page.js("{const i=[...document.querySelectorAll('.rep-times input')].pop();i.value='22:00';i.dispatchEvent(new Event('change',{bubbles:true}))}");
  c.ok(/22:00 は登録できません。かけられる時刻は 07:00〜21:00 です/.test(await page.text("#rep-hours")), "a night-time is refused up front, with the hours that can be used", await page.text("#rep-hours"));
  await page.js("{const i=[...document.querySelectorAll('.rep-times input')].pop();i.value='18:30';i.dispatchEvent(new Event('change',{bubbles:true}))}");
  const repSum = await page.text(".rep-sum");
  c.ok(["佐々木 ミツ", "09:00、18:30", "毎週 月・火・水・木・金", "まで", `最大 ${bound} 回`, "30分後にかけ直す（2回まで）。それでも出なかった回は、報告と（設定があれば）職員への通知で知らせます。AIがご家族や救急に連絡することはありません。", "一時停止・終了"].every((t) => repSum.includes(t)) && await page.js("(()=>{const s=getComputedStyle(document.querySelector('.ask-side'));const sum=document.querySelector('.rep-sum'),ack=document.querySelector('#rep-ack');return s.position==='static'&&s.overflowY==='visible'&&!!(sum.compareDocumentPosition(ack)&4)})()"), "who, when, weekdays, until when, the bound, retries and how to stop are together right before the approval, on the page itself (no inner scroll)", repSum);
  c.ok(["連絡先に保存し", "電話してよい根拠", "予約を取る電話は定期にできません", "最長92日", "同じように費用", "出なかったときだけ", "見送ります", "もう電話しないで"].every((t) => rules.includes(t)), "the rules of a standing request are stated before approval", rules);
  c.ok(await page.js("document.querySelector('.rep-panel .btn.primary').disabled"), "登録 stays off until the rules are acknowledged");
  await page.js("document.querySelector('.rep').scrollIntoView({block:'start'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-repeat.png"));
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    await page.viewport(w, h); await sleep(300);
    await page.js("document.querySelector('.rep-panel > .btn.primary').scrollIntoView({block:'end'})"); await sleep(200);
    const fit = JSON.parse(await page.js("JSON.stringify((()=>{const side=document.querySelector('.ask-side'),cs=getComputedStyle(side),b=document.querySelector('.rep-panel > .btn.primary').getBoundingClientRect();return {inner:cs.overflowY!=='visible'||side.scrollHeight>side.clientHeight+1,top:Math.round(b.top),bottom:Math.round(b.bottom),h:innerHeight,covered:document.elementFromPoint(b.left+b.width/2,b.top+4)!==document.querySelector('.rep-panel > .btn.primary')}})())"));
    c.ok(!fit.inner && fit.top >= 0 && fit.bottom <= fit.h && !fit.covered, `定期の電話の承認 at ${w}x${h}: no inner scroll, and the approve button is fully visible when scrolled to`, JSON.stringify(fit));
  }
  await page.screenshot(join(out, "gateway-app-ask-repeat-end.png"));
  await small("定期の電話にする");
  await page.js("document.querySelector('#rep-ack').click()"); await sleep(100);
  await clickText("定期の電話を登録する", ".ask-side");
  await page.until("location.hash==='#/standing' && [...document.querySelectorAll('.sched h2')].some(h=>h.textContent==='佐々木 ミツ')", { timeout: 10_000, label: "standing list after registering" });
  const made = (await api("/schedules")).find((s) => s.request.name === "佐々木 ミツ");
  c.ok(made?.times.join() === "09:00,18:30" && made.weekdays.join() === "1,2,3,4,5" && made.retries.count === 2 && made.request.pace === "gentle" && made.bounds.callsUpperBound === bound && made.bounds.occurrences === occ, "the standing request is saved as entered, with the same upper bound the screen stated", JSON.stringify(made?.bounds));
  c.ok(!app.store.list("mission", user.id).some((m) => m.status === "DRAFT" && m.target.name === "佐々木 ミツ"), "the one-off draft made for the review is not left waiting for approval");
  // A saved contact with no written basis: not offered either.
  await go(`#/new?contact=${stoppedContact.id}`, "document.querySelector('#ask-name')?.value==='田中 一郎'");
  await page.js("{const i=document.querySelector('#ask-instruction'); i.value='来週の打ち合わせの時間を聞いてください。'; i.dispatchEvent(new Event('input',{bubbles:true}));}");
  await clickText("内容を確かめる", ".ask-side");
  await page.until("!!document.querySelector('#ask-ack') || !document.querySelector('.ask-side .errbox').hidden", { timeout: 8000, label: "review (no basis)" });
  c.ok(!(await page.js("!!document.querySelector('#rep-on')")) && /電話してよい根拠/.test(await page.text(".rep") ?? ""), "a contact with no written basis cannot be made a standing request, and the screen says what to add", await page.text(".ask-side .errbox"));
  // Not a saved contact: the option is not offered, and it says why.
  await go("#/new", "!!document.querySelector('#ask-phone')");
  await page.js("for (const [s,v] of [['#ask-phone','090-9999-0001'],['#ask-name','名簿にない人'],['#ask-instruction','折り返しの電話をお願いしてください。']]) { const i=document.querySelector(s); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); }");
  await clickText("内容を確かめる", ".ask-side");
  await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "review (not a contact)" });
  c.ok(!(await page.js("!!document.querySelector('#rep-on')")) && /連絡先に保存した相手だけ/.test(await page.text(".rep")), "a number that is not a saved contact cannot be made a standing request, and the screen says why");
  // 相手の言葉で確かめる条件: a quantity and a date for the trade kinds, checked before anything is sent.
  await go("#/new", "!!document.querySelector('#ask-phone')");
  c.ok(await page.js("document.querySelector('#ask-qty').closest('.field').hidden"), "確かめる条件 is not shown for other kinds");
  await page.js("document.querySelector('[data-group=trade]').click();document.querySelector('[data-kind=delivery-date]').click()");
  await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='山本 ハル').click()");
  await page.js("for (const [k,v] of [['会社名と自分の名前','田中商会の田中'],['注文番号や品名','りんごジュース']]) { const i=document.querySelector(`[data-blank='${k}']`); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); }");
  const setTerms = (amount, unit, date) => page.js(`{const a=document.querySelector('#ask-qty'),u=document.querySelector('#ask-qty-unit'),d=document.querySelector('#ask-due');a.value=${JSON.stringify(amount)};u.value=${JSON.stringify(unit)};d.value=${JSON.stringify(date)};a.dispatchEvent(new Event('input',{bubbles:true}))}`);
  await setTerms("0", "ケース", ""); await clickText("内容を確かめる", ".ask-side"); await sleep(300);
  const zeroErr = await page.text(".ask-side .errbox");
  await setTerms("50", "", ""); await clickText("内容を確かめる", ".ask-side"); await sleep(300);
  c.ok(/0より大きい数/.test(zeroErr) && /単位を選んでください/.test(await page.text(".ask-side .errbox")) && !(await page.js("!!document.querySelector('#ask-ack')")), "a quantity of 0, or one without a unit, is refused before anything is sent", zeroErr);
  await setTerms("50", "ケース", day(18));
  await page.js("document.querySelector('#ask-qty').scrollIntoView({block:'center'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-terms.png"));
  await small("電話を頼む (確かめる条件)");
  await clickText("内容を確かめる", ".ask-side");
  await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "review (terms)" });
  const termsDraft = app.store.list("mission", user.id).find((m) => m.status === "DRAFT" && m.phoneRequest?.success);
  c.ok(/確かめる条件/.test(await page.text(".ask-side .defs")) && /数量 50ケース・納期 /.test(await page.text(".ask-side .defs")) && termsDraft?.phoneRequest.success.expected.quantity === "50ケース" && termsDraft.phoneRequest.success.expected.date === day(18) && termsDraft.phoneRequest.success.required.join() === "quantity,date,confirmed" && /確かめる条件：数量 50ケース・納期 /.test(termsDraft.phoneRequest.instruction) && /確かめる条件：数量 50ケース/.test(await page.text(".ask-side .brief")), "the conditions show in the confirmation and go with the draft as the contract writes them (50ケース)", JSON.stringify(termsDraft?.phoneRequest.success));
  config.mode = "simulator"; config.liveReady = false;

  // 定期の電話: status, next and past runs in plain words, pause / resume / end.
  await go("#/requests", "!!document.querySelector('.page-actions a[href$=standing]')");
  c.ok(await page.js("[...document.querySelectorAll('.page-actions a')].map(a=>a.textContent).join()") === "定期の電話,名簿の電話,折り返しの依頼2,チームの電話" && await page.js("document.querySelector('a[href=\"/v1/calls.csv\"]')?.textContent") === "電話の記録をCSVで保存", "依頼: 定期の電話, 名簿の電話, チームの電話 (supervisor) and 電話の記録をCSVで保存");
  const ownCsv = await fetch(base + "/v1/calls.csv", { headers: { authorization: "Bearer " + token } });
  c.ok(ownCsv.status === 200 && /text\/csv/.test(ownCsv.headers.get("content-type")) && /attachment/.test(ownCsv.headers.get("content-disposition")) && /日時,担当,相手,電話番号/.test(await ownCsv.text()), "/v1/calls.csv answers a CSV file to save");
  c.ok(!/【任せる/.test(await page.text("#view")) && /応答がありませんでした/.test(await page.text("#view")) && /緊急の確認があります/.test(await page.text("#view")), "依頼: a wellbeing call nobody answered, and one with an emergency line, say so in the list");
  await clickText("定期の電話", ".page-actions");
  await page.until("location.hash==='#/standing' && document.querySelectorAll('.sched').length===2", { label: "standing list" });
  const standingText = await page.text("#view");
  c.ok(/山本 ハル/.test(standingText) && /毎日 09:00/.test(standingText) && /30分後にかけ直す（2回まで）/.test(standingText) && /終了日までに最大 \d+ 回（これからの\d+回 × かけ直しを含め3回・かける日 \d+日）/.test(standingText) && /次の回/.test(standingText), "定期の電話: when, until when, retries and the upper bound", standingText.slice(0, 200));
  c.ok(!/応答あり/.test(standingText) && /話せました/.test(standingText) && await page.js("document.querySelectorAll('.runs .lvl.emergency').length") === 1 && /応答なし/.test(standingText) && /3回かけました/.test(standingText) && !/× 見送り|かけられませんでした/.test(standingText) && /時刻を過ぎたため、かけていません/.test(standingText) && !/見送りました/.test(standingText) && /クレジットが足りません/.test(standingText) && await page.js("document.querySelectorAll('.runs .lvl.concern').length") >= 3 && await page.js("[...document.querySelectorAll('.runs .lvl.miss')].map(n=>n.textContent).join()") === [...(todayPassed ? ["かけていません"] : []), "応答なし", "かけていません", "かけていません"].join() && await page.js("document.querySelectorAll('.runs li').length") === 4 + (todayPassed ? 1 : 0), "past runs: answered, unanswered, skipped and failed, each with its reason; the two that did not reach the person carry a mark");
  c.ok(!/window_passed|insufficient_credits|UNANSWERED|ANSWERED|SKIPPED|FAILED|ACTIVE|PAUSED|undefined|NaN/.test(standingText), "no state names or codes on 定期の電話");
  await page.screenshot(join(out, "gateway-app-standing.png"), { fullPage: true });
  await small("定期の電話");
  const card = (name) => `[...document.querySelectorAll('.sched')].find(n=>n.querySelector('h2').textContent===${JSON.stringify(name)})`;
  await page.js(`[...${card("山本 ハル")}.querySelectorAll('button')].find(b=>b.textContent==='一時停止').click()`);
  await page.until(`${card("山本 ハル")}.dataset.status==='PAUSED'`, { label: "paused" });
  c.ok((await api("/schedules")).find((s) => s.id === standing.id).status === "PAUSED" && /一時停止中はかけません/.test(await page.js(`${card("山本 ハル")}.textContent`)) && (await page.focused()).text === "再開する", "一時停止: saved, shown, and the focus moves to 再開する");
  await page.js(`[...${card("山本 ハル")}.querySelectorAll('button')].find(b=>b.textContent==='再開する').click()`);
  await page.until(`${card("山本 ハル")}.dataset.status==='ACTIVE'`, { label: "resumed" });
  await page.js(`window.confirm=()=>true;[...${card("佐々木 ミツ")}.querySelectorAll('button')].find(b=>b.textContent==='終了する').click()`);
  await page.until(`${card("佐々木 ミツ")}.dataset.status==='ENDED'`, { label: "ended" });
  c.ok(/あなたが終了しました/.test(await page.js(`${card("佐々木 ミツ")}.textContent`)) && !(await page.js(`!!${card("佐々木 ミツ")}.querySelector('.actions')`)) && (await api("/schedules")).find((s) => s.id === made.id).status === "ENDED", "終了する: ended for good, with the reason, and nothing left to press");

  await sleep(3300); // the toast has gone
  // 報告: the lines to read now, quoted, above everything else; then what was said, topic by topic.
  await go(`#/call/${careCall}`, "!!document.querySelector('.band')");
  const band = await page.text(".band"), reportText = await page.text("#view");
  c.ok(await page.js("!!document.querySelector('.band.emergency h2 .lvl.emergency') && !!(document.querySelector('.band').compareDocumentPosition(document.querySelector('.headline, .verdict')) & 4)") && /緊急/.test(band) && /ご本人の様子を、すぐに確かめてください/.test(band), "報告: an emergency banner above the headline, asking for the person to be checked");
  c.ok(/「昨日の夜に廊下で転んでしまって、起き上がれなくて大変でした。」/.test(band) && /「腰が痛いので、だれかに見てもらいたいです。」/.test(band) && await page.js("document.querySelectorAll('.band-lines .lvl.emergency').length===1 && document.querySelectorAll('.band-lines .lvl.concern').length===2"), "the banner quotes the flagged lines from the conversation, each marked 緊急 or 要確認", band.slice(0, 160));
  c.ok(/AIが気になった発言（AIが聞き取った内容で、確かめられた事実ではありません）/.test(band) && /「声がいつもより弱く、途中で何度も咳をしていた」/.test(band) && await page.js("!document.querySelector('.band li.by-model time')"), "the voice model's own report is shown as what the AI heard, quoted, with no line in the record and never as a fact");
  c.ok(/ほかに要確認が2件あります（下の表）。/.test(band) && await page.js("document.querySelectorAll('.checkin-table tbody .lvl').length") === 4, "the banner quotes the flagged lines and counts the other 要確認 rows of the table (two flagged, two more)", band.slice(-120));
  c.ok(/これは診断ではありません/.test(band) && await page.text(".band-act") === "AIはどこにも連絡していません。ご本人の様子は、人が確かめてください。" && await page.js("(()=>{const a=getComputedStyle(document.querySelector('.band-act')),n=getComputedStyle(document.querySelector('.band-note'));return parseFloat(a.fontSize)>parseFloat(n.fontSize)&&a.color!==n.color})()"), "the banner says on a line of its own that the AI contacted nobody and a person must check; and that it is not a diagnosis");
  const rowsSaid = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.checkin-table tbody tr')].map(r=>[r.children[0].textContent,r.children[1].firstChild.textContent,r.children[2].textContent]))"));
  c.ok(rowsSaid.map((r) => r[0]).join() === "体調,食事,服薬,睡眠,相談や困りごと" && rowsSaid[1][1] === "食べたと話しました" && rowsSaid[2][1] === "まだ飲んでいないと話しました" && rowsSaid[2][2] === "「まだです。あとで飲みます。」" && rowsSaid[3][1] === "はっきりしない返事でした" && rowsSaid[4][1] === "相談や困りごとを話しました", "見守りの聞き取り: five topics, what was said, and the person's own words", JSON.stringify(rowsSaid));
  c.ok(rowsSaid.every((r) => /話しました$|返事でした$|^返答なし$|^聞いていません$/.test(r[1])) && /実際の様子を確かめたものではありません/.test(reportText), "no answer is worded as a fact: each one is something said");
  c.ok(await page.js("(()=>{const row=document.querySelector('.checkin-table tbody tr'),lines=[...document.querySelectorAll('.transcript .flag-line .lvl')].map(n=>n.className+':'+n.textContent).join();return !!row.querySelector('.lvl.emergency')&&lines==='lvl emergency:緊急の発言,lvl concern:要確認の発言,lvl concern:要確認の発言,lvl concern:要確認の発言'})()"), "the same line carries the same level in the banner, the check-in row and the conversation");
  c.ok(/\d+\/\d+\(.\) \d\d:\d\d/.test(await page.text(".call-when")) && !(await page.js("!!document.querySelector('.transcript .span')")), "the report says when the call was (Japan time); a wellbeing report carries no millisecond ranges", await page.text(".call-when"));
  c.ok(!/self_harm|no_answer|not_asked|undefined|NaN|emergency|concern/.test(reportText), "the flagged lines are marked in the conversation; no internal words on the report");
  await page.js("document.querySelector('.family-note summary').click()");
  const famText = await page.text(".family-note");
  c.ok(/サービスからは送りません。職員が読んで確かめてから、自分で送ってください。/.test(famText) && /山本 ハル/.test(famText) && await page.js("[...document.querySelectorAll('.family-note button')].some(b=>b.textContent==='文をコピー')"), "ご家族への報告文: the server's text, a copy button, and that a person sends it after reading", famText.slice(0, 200));
  await page.screenshot(join(out, "gateway-app-report-care.png"), { fullPage: true });
  await go(`#/call/${noAnswer}`, "/応答がありませんでした/.test(document.querySelector('.headline')?.textContent)");
  const missedBand = await page.text(".band");
  c.ok(await page.js("!!document.querySelector('.band.concern h2 .lvl.concern') && !document.querySelector('.no-answer')") && /ご本人の様子を確かめてください/.test(missedBand) && /電話に出なかったか、何も話しませんでした。3回目の電話で、この回のかけ直しはここまでです。/.test(missedBand) && /AIはどこにも連絡していません。/.test(missedBand) && /定期の電話・3回目/.test(await page.text(".call-when")) && /10:01/.test(await page.text(".call-when")) && !(await page.js("!!document.querySelector('.checkin-table')")) && await page.js("(()=>{const f=document.querySelector('.call-foot').getBoundingClientRect(),d=[...document.querySelectorAll('.request-details')].pop().getBoundingClientRect();return f.top-d.bottom<80})()"), "a wellbeing call nobody answered: the same 要確認 banner form, which try it was, at a time a schedule could ring; the button sits under the content", missedBand);
  await page.js("document.querySelector('.family-note summary').click()"); await sleep(200);
  const unansweredNote = await page.text(".family-note .request-text");
  c.ok(/^山本 ハルさんへの電話（10月\d+日 \d+時ごろ）のご報告です。担当の代わりに、AIがおかけしました。/.test(unansweredNote) && /AIがかけた電話の記録として/.test(await page.text(".family-note summary")), "the family note on an unanswered call: the new opening, under a heading that says an AI made the call", unansweredNote.slice(0, 80));
  await page.screenshot(join(out, "gateway-app-report-unanswered.png"), { fullPage: true });

  // チームの電話 (manager / admin): rows at a glance, 要確認 only, a teammate's report read-only, CSV.
  const teamAll = await api("/team/calls");
  // A notice that could not be delivered (fixture: nothing is sent from this check): a supervisor is told on チームの電話.
  app.store.enqueue("alert", "al_" + randomBytes(6).toString("hex"), user.id, { id: "al_fixture", reason: "unanswered", level: "concern", mission: noAnswer, team: "local", recipient: "山本 ハル", at: Date.parse(`${day(-2)}T10:03:00+09:00`), categories: [] });
  { const job = app.store.list("alert", undefined, "pending")[0]; job.attempts = 3; app.store.put("alert", job); }
  await page.js("location.hash='#/';location.reload()"); await sleep(1200); await page.until("!document.querySelector('#tabs').hidden", { label: "reloaded" });
  await go("#/team", "!!document.querySelector('.team-table')");
  const teamRow = (name) => page.js(`[...document.querySelectorAll('.team-table tbody tr')].find(r=>r.querySelector('th').textContent.includes(${JSON.stringify(name)}))?.textContent ?? ''`);
  c.ok(await page.js("document.querySelectorAll('.team-table tbody tr').length") === teamAll.total && new RegExp(`要確認だけ（${teamAll.needsAttention}件）`).test(await page.text(".team-tools .chip")) && teamAll.needsAttention >= 7, "チームの電話: every call of the team; the count that needs a look includes the wellbeing call nobody answered", `${teamAll.total} / ${teamAll.needsAttention}`);
  const tamura = await teamRow("田村 節子"), yamamoto = await page.js("[...document.querySelectorAll('.team-table tbody tr')].find(r=>r.querySelector('.lvl.emergency'))?.textContent ?? ''");
  c.ok(/鈴木/.test(tamura) && !/suzuki/.test(tamura) && /要確認/.test(tamura) && /食事：まだ食べていないと話しました/.test(tamura) && /服薬：飲んだと話しました/.test(tamura) && /話せました/.test(tamura), "a teammate's row: who asked, how the call went, 要確認, and the answers as things said", tamura);
  c.ok(/自分/.test(yamamoto) && /山本 ハル/.test(yamamoto) && /緊急/.test(yamamoto) && /体調：不調や困りごとを話しました/.test(yamamoto) && /話せました/.test(yamamoto) && !/確認済み/.test(yamamoto), "an emergency row is marked 緊急 in words, and its result is 話せました, never 確認済み", yamamoto);
  const missedRow = await page.js("(()=>{const r=[...document.querySelectorAll('.team-table tbody tr')].find(r=>r.querySelector('.lvl.miss'));return r?r.className+'|'+r.querySelector('.lvl.miss').textContent+'|'+(r.querySelector('.lvl.concern:not(.miss)')?.textContent??''):''})()");
  c.ok(missedRow === "need-concern|応答なし|要確認", "a wellbeing call nobody answered: the 応答なし mark, 要確認 and the left band", missedRow);
  const ranks = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.team-table tbody tr')].map(r=>r.querySelector('td .lvl.emergency')?0:r.classList.contains('need-concern')?1:2))"));
  c.ok(ranks[0] === 0 && ranks.every((v, i) => i === 0 || ranks[i - 1] <= v) && ranks.filter((v) => v < 2).length === 7, "the unfiltered list puts what needs a look first: 緊急, then 要確認, then the rest", ranks.join(""));
  const tableText = await page.text(".team-table");
  c.ok(!/確認済み|未確定/.test(tableText) && (await page.js("[...document.querySelectorAll('.team-table .verdict-tag')].map(n=>n.textContent).join()")).split(",").sort().join() === "決まっていません,決まっていません,決まっていません,決まりました,決まりました" && !/応答の記録なし/.test(tableText) && await page.js("[...document.querySelectorAll('.team-table tbody th .tag')].filter(t=>t.textContent==='名簿').length") === 2 && await page.js("(()=>{const r=[...document.querySelectorAll('.team-table tbody tr')].find(r=>r.querySelector('td .lvl.emergency'));const g=r.querySelector('.glance');return g.querySelectorAll('.lvl.emergency').length===1&&g.querySelectorAll('.lvl.concern').length===3})()") && await page.js("[...document.querySelectorAll('.glance b')].every(b=>getComputedStyle(b).textDecorationLine==='none')"), "電話の結果 uses call words for every row; the verdict is a separate small label on the sales call only; the answers are not underlined");
  const undeliveredText = await page.text(".undelivered-block") ?? "", unplacedText = await page.text(".team-block.need-concern") ?? "";
  c.ok(/届いていない通知が 1 件あります/.test(undeliveredText) && /その電話の相手には確認が必要です/.test(undeliveredText) && /要確認/.test(undeliveredText) && /山本 ハル/.test(undeliveredText) && /応答なし・自分が頼んだ電話・送信を3回試みました/.test(undeliveredText) && await page.js(`document.querySelector('.undelivered-block a')?.getAttribute('href')`) === `#/team/${noAnswer}`, "チームの電話: each undelivered notice with its level, person, when, attempts and the report; the person still needs a look", undeliveredText);
  const unplacedApi = (await api("/team/calls")).notPlaced;
  c.ok(new RegExp(`かけられなかった定期の電話　${unplacedApi.length}件`).test(unplacedText) && /山本 ハル/.test(unplacedText) && /時刻を過ぎたため、かけていません/.test(unplacedText) && /クレジットが足りなかったため、かけていません/.test(unplacedText) && await page.js(`[...document.querySelectorAll('.team-block.need-concern a')].every(a=>/^#\\/team\\/(person\\/[a-f0-9-]{36}|people)$|^#\\/standing$/.test(a.getAttribute('href')))`) && teamAll.needsAttention === 7 + unplacedApi.length, "チームの電話: the scheduled calls never placed are rows that need a look, linking to the person, and counted", unplacedText.slice(0, 200));
  const sumText = await page.text(".team-sum");
  const sumApi = (await api("/team/summary?days=7")).total, wentCounts = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.team-table td[data-label=\"電話の結果\"]')].reduce((n,td)=>{const t=td.querySelector('.lvl.miss')?.textContent??td.firstChild.textContent;n[t]=(n[t]??0)+1;return n},{}))"));
  c.ok(new RegExp(`電話${teamAll.total}件`).test(sumText) && new RegExp(`話せた割合${String(sumApi.answerRatePercent).replace(".", "\\.")}%かけた${sumApi.answered + sumApi.unanswered}件のうち${sumApi.answered}件で話せました`).test(sumText) && new RegExp(`応答なし${sumApi.unanswered}件`).test(sumText) && (wentCounts["話せました"] ?? 0) === sumApi.answered && (wentCounts["応答なし"] ?? 0) === sumApi.unanswered && new RegExp(`要確認${7 + (sumApi.notPlacedScheduled ?? 0)}件うち緊急 1件・かけられなかった定期 ${sumApi.notPlacedScheduled}件`).test(sumText) && /要確認\d（うち緊急1）/.test(await page.text(".sum-days")) && /かけられなかった定期\d/.test(await page.text(".sum-days")) && await page.js("document.querySelectorAll('.sum-days li').length") === 7, "この7日間: the tile's numbers can be counted from the list below it (話せました / 応答なし), needs-attention, emergencies, seven days", sumText + " " + JSON.stringify(wentCounts));
  c.ok(await page.noSidewaysScroll() && !/\+81|090-/.test(await page.text(".team-table")), "a long recipient name does not widen the page; the list carries no phone numbers");
  await page.screenshot(join(out, "gateway-app-team.png"), { fullPage: true });
  await small("チームの電話");
  const teamCsv = await fetch(base + "/v1/team/calls.csv", { headers: { authorization: "Bearer " + token } }), mateCsv = await fetch(base + "/v1/team/calls.csv", { headers: { authorization: "Bearer " + mateToken } });
  c.ok(await page.js("(()=>{const a=document.querySelector('a[href=\"/v1/team/calls.csv\"]');return !!a&&a.hasAttribute('download')&&a.textContent==='CSVで保存'})()") && teamCsv.status === 200 && /attachment/.test(teamCsv.headers.get("content-disposition")) && mateCsv.status === 403, "CSVで保存 points at the team file; the server refuses it to an operator");
  c.ok(await page.js("(()=>{const c=[...document.querySelectorAll('.team-tools .chip')];return c.length===2&&c[0].getAttribute('aria-pressed')==='false'&&c[1].getAttribute('aria-pressed')==='true'&&getComputedStyle(c[1]).backgroundColor!==getComputedStyle(c[0]).backgroundColor})()") && new RegExp(`すべて（${teamAll.total}件）`).test(await page.text(".team-tools")), "two tabs: すべて（the total）is the selected one, visibly");
  await page.js("document.querySelector('.team-tools .chip').click()");
  await page.until(`document.querySelectorAll('.team-table tbody tr').length===${teamAll.needsAttention - teamAll.notPlaced.length} && document.querySelector('.team-tools .chip').getAttribute('aria-pressed')==='true'`, { label: "要確認 only" });
  c.ok(new RegExp(`すべて（${teamAll.total}件）`).test(await page.text(".team-tools")) && await page.js("document.querySelectorAll('.team-tools .chip')[1].getAttribute('aria-pressed')==='false'"), "filtered, the other tab still says the total");
  c.ok(await page.js("[...document.querySelectorAll('.team-table tbody tr')].some(r=>r.querySelector('.lvl.miss')?.textContent==='応答なし')") && await page.js("(()=>{const r=[...document.querySelectorAll('.team-table tbody tr')];return !!r[0].querySelector('.lvl.emergency') && r.slice(1).every(x=>!x.querySelector('.lvl.emergency'))})()"), "要確認だけ: only the calls that need a look, the unanswered wellbeing call among them, emergencies first");
  await page.screenshot(join(out, "gateway-app-team-attention.png"), { fullPage: true });
  await page.js("[...document.querySelectorAll('.team-table tbody th a')].find(a=>a.textContent==='田村 節子').click()");
  await page.until(`location.hash==='#/team/${mateCall}' && !!document.querySelector('.band')`, { label: "teammate's report" });
  const mateReport = await page.text("#view");
  c.ok(/^依頼 › チームの電話 › 田村 節子/.test(await page.text(".crumb")) && /頼んだ人：鈴木/.test(mateReport) && /開いたことは記録されます/.test(mateReport) && await page.js("!!document.querySelector('.band.concern') && !document.querySelector('.band .lvl.emergency')") && /「食欲がなくて、朝から何も食べていません。」/.test(mateReport), "a teammate's report opens with its 要確認 banner (not 緊急)");
  c.ok(!/同じ相手にまた頼む|通話を終える|カレンダーに入れる/.test(mateReport) && /チームの電話に戻る/.test(mateReport) && app.store.audits({ after: 0, limit: 500 }).some((a) => a.action === "team.record_viewed"), "it is read-only, and opening it was recorded");
  await page.screenshot(join(out, "gateway-app-team-report.png"), { fullPage: true });
  await go(`#/team/${mateQuiet}`, "!!document.querySelector('.checkin-table')");
  c.ok(await page.js("!!document.querySelector('.band.concern')") && /要確認の返事が1件あります（下の表）。/.test(await page.text(".band")) && await page.js("document.querySelectorAll('.checkin-table tbody .lvl.concern').length") === 1, "a report whose table says 要確認 with no flagged line still carries a 要確認 banner (team report, same rule)", await page.text(".band"));
  // The trade call's report: the quantity the other side offered is not what was asked, so it reads as not settled.
  await go(`#/call/${tradeCall}`, "!!document.querySelector('.report-top')");
  const tradeReport = await page.text("#view");
  c.ok(/数量/.test(tradeReport) && /数量相手の答え30ケース頼んだのは 50ケース頼んだ内容と違うので、決まっていません/.test(tradeReport) && /相手の承諾—相手がはっきり承諾した言葉は、確かめられませんでした/.test(tradeReport) && !(await page.js("!!document.querySelector('.transcript .span')")) && await page.js("document.querySelectorAll('.rrow').length") === 2 && !/決まりました/.test(await page.text(".verdict")), "報告: a quantity the other side did not confirm reads as not settled, with what they offered", tradeReport.slice(0, 200));
  await page.screenshot(join(out, "gateway-app-report-quantity.png"));
  await go(`#/call/${tradeHalf}`, "!!document.querySelector('.report-top')");
  const halfRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.rrow')].map(r=>r.className+'|'+r.textContent))"));
  c.ok(halfRows.length === 3 && /ok\|数量相手の言葉で確認50ケース/.test(halfRows.find((r) => /数量/.test(r)) ?? "") && /相手の答え/.test(halfRows.find((r) => /納期/.test(r)) ?? "") && /頼んだのは/.test(halfRows.find((r) => /納期/.test(r)) ?? "") && !/決まりました/.test(await page.text(".verdict")) && !/まだ確かめていません/.test(await page.text("#view")), "報告: quantity confirmed, delivery date not: the date row says 相手の答え and what was asked; the call is not settled", halfRows.join(" || "));
  await page.screenshot(join(out, "gateway-app-report-terms-partial.png"));
  await go(`#/call/${tradeBoth}`, "!!document.querySelector('.report-top')");
  const bothRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.rrow')].map(r=>r.className+'|'+r.textContent))"));
  c.ok(/決まりました/.test(await page.text(".verdict")) && bothRows.length === 3 && bothRows.every((r) => /ok\|/.test(r) && /「/.test(r)) && /相手の承諾相手の言葉で確認はい/.test(bothRows.join()), "報告: quantity and delivery date both confirmed reads 決まりました, each with the other side's words", bothRows.join(" || "));
  await page.screenshot(join(out, "gateway-app-report-terms-settled.png"));
  // 相手ごとの様子: one line per person the team calls; what needs a look first; opens the person's history.
  await go("#/team", "!!document.querySelector('.team-table')");
  await clickText("相手ごとの様子", ".page-actions");
  await page.until("location.hash==='#/team/people' && !!document.querySelector('.people-table')", { label: "people board" });
  const peopleRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.people-table tbody tr')].map(r=>r.className+'|'+r.textContent))"));
  c.ok(/^need-emergency\|山本 ハル/.test(peopleRows[0]) && /緊急/.test(peopleRows[0]) && /話せました/.test(peopleRows[0]) && (!todayPassed || new RegExp(`${Number(day(0).slice(5, 7))}/${Number(day(0).slice(8))} 09:00 の定期の電話は、かけていません（サービスが止まっていたため）`).test(peopleRows[0])) && /^need-concern\|佐々木 ミツ/.test(peopleRows[1]) && /応答なし/.test(peopleRows[1]) && /3回続けて応答がありません/.test(peopleRows[1]) && /4回・うち応答なし 3回/.test(peopleRows[1]) && !/応答の記録なし/.test(peopleRows.join()), "相手ごとの様子: the emergency first (with the scheduled call that was not placed on that line), then three unanswered in a row including the list call, with the counts", peopleRows.slice(0, 2).join(" || "));
  const tamuraPerson = peopleRows.find((r) => /田村 節子/.test(r)) ?? "";
  c.ok(/鈴木/.test(tamuraPerson) && /食事：まだ食べていないと話しました要確認/.test(tamuraPerson) && await page.js("document.querySelectorAll('.people-table .glance .lvl.emergency').length") === 1 && !/\+81|090-|03-/.test(await page.text(".people-table")) && await page.noSidewaysScroll(), "who calls them, the last answers as things said with 緊急 and 要確認 marked apart, and no phone numbers", tamuraPerson);
  await page.screenshot(join(out, "gateway-app-people.png"), { fullPage: true });
  await small("相手ごとの様子");
  await page.js("[...document.querySelectorAll('.people-table tbody th a')].find(a=>a.textContent==='田村 節子').click()");
  await page.until(`location.hash==='#/team/person/${tamuraContact.id}' && document.querySelectorAll('.past-rows li').length===1`, { label: "teammate's person history" });
  c.ok(/開いたことは記録されます/.test(await page.text("#view")) && await page.js(`document.querySelector('.past-rows a').getAttribute('href')`) === `#/team/${mateCall}` && app.store.audits({ after: 0, limit: 500 }).some((a) => a.action === "team.history_viewed"), "a teammate's person opens これまでの電話, says it is recorded, links to the read-only report, and the server recorded it");
  await page.screenshot(join(out, "gateway-app-person.png"));
  await go("#/team/people", "!!document.querySelector('.people-table')");
  await page.js("[...document.querySelectorAll('.people-table tbody th a')].find(a=>a.textContent==='山本 ハル').click()");
  const haruHistory = await api(`/contacts/${haru.id}/history?days=30`);
  await page.until(`location.hash==='#/team/person/${haru.id}' && document.querySelectorAll('.past-rows li').length===${haruHistory.calls.length + haruHistory.notPlaced.length}`, { label: "person with unplaced scheduled calls" });
  const haruRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.past-rows li')].map(r=>r.className+'|'+r.textContent))"));
  c.ok(haruHistory.notPlaced.length === (todayPassed ? 3 : 2) && haruRows.filter((r) => /^need-concern not-placed\|/.test(r) && /かけていません要確認定期の電話。(時刻を過ぎたため|クレジットが足りなかったため|サービスが止まっていたため)、かけていません。/.test(r)).length === (todayPassed ? 3 : 2) && new RegExp(`かけていない定期 ${todayPassed ? 3 : 2}回。`).test(await page.text(".person-past .note")) && (await page.js("[...document.querySelectorAll('.past-rows li time')].map(t=>t.getAttribute('datetime'))")).every((v, i, a) => i === 0 || Date.parse(a[i - 1]) >= Date.parse(v)), "a person's history: the scheduled calls never placed as rows among the calls, in date order, each with its reason and a mark, and counted in the summary", haruRows.join("\n"));
  await page.screenshot(join(out, "gateway-app-person-unplaced.png"), { fullPage: true });
  // A read that fails offers the read again; an answer that arrives after the person has moved on changes nothing.
  await page.js("window.__fetch=window.fetch;window.fetch=()=>Promise.reject(new TypeError('offline'))");
  await go("#/team", "!!document.querySelector('.team-box .errbox')", "team read fails");
  c.ok(/接続を確認できませんでした/.test(await page.text(".team-box .errbox")) && await page.js("[...document.querySelectorAll('.team-box button')].some(b=>b.textContent==='もう一度読み込む')"), "チームの電話: a failed read says so and offers もう一度読み込む");
  await page.js("window.fetch=window.__fetch"); await clickText("もう一度読み込む", ".team-box");
  await page.until("!!document.querySelector('.team-table')", { label: "team read again" });
  await page.js("window.fetch=(...a)=>new Promise(r=>setTimeout(()=>r(window.__fetch(...a)),1500))");
  await page.js("location.hash='#/standing'"); await sleep(300); await page.js("location.hash='#/contacts'"); await sleep(2600);
  c.ok(/連絡先/.test(await page.text("#view h1")) && !(await page.js("!!document.querySelector('.sched')")), "a late answer for 定期の電話 does not replace the screen chosen after it");
  await page.js("window.fetch=window.__fetch");

  // 連絡先: 連絡停止中, its release with a written reason, and the CSV import.
  await go(`#/contacts/${stoppedContact.id}`, "/田中 一郎/.test(document.querySelector('.headline')?.textContent)");
  c.ok(await page.js("document.querySelectorAll('.list .item .tag.stopped').length") === 2 && /連絡停止中/.test(await page.text(".stopped-box")) && !/この相手に電話を頼む/.test(await page.text(".contact-detail")), "連絡先: 連絡停止中 on the list and the contact; no call button for it");
  c.ok(new RegExp(`${Number(day(0).slice(5, 7))}月${Number(day(0).slice(8))}日、職員が止めました。`).test(await page.text(".stop-how")), "a stop made by the team says how and when it was stopped", await page.text(".stop-how"));
  await clickText("連絡停止を解除", ".stopped-box");
  c.ok((await page.focused()).id === "release-reason" && /記録されます/.test(await page.text(".release-form")), "連絡停止を解除 (stopped by the team): asks for a reason and says it is recorded");
  const release = (reason, ack) => page.js(`(()=>{const f=document.querySelector('.release-form');f.elements.reason.value=${JSON.stringify(reason)};f.elements.ack.checked=${ack};f.requestSubmit();})()`);
  await release("短い", true); await sleep(200);
  await page.screenshot(join(out, "gateway-app-contact-stopped.png"));
  c.ok(/5〜300文字/.test(await page.text(".release-form .errbox")) && (await api("/contacts")).find((x) => x.id === stoppedContact.id).suppressed, "a reason under 5 characters is refused before anything is sent");
  await release("本人から電話で、連絡を再開してよいと言われた（10/2）", true);
  await page.until("/連絡停止を解除しました/.test(document.querySelector('#toast').textContent) && !document.querySelector('.stopped-box')", { label: "released" });
  c.ok(!(await api("/contacts")).find((x) => x.id === stoppedContact.id).suppressed && app.store.audits({ after: 0, limit: 500 }).some((a) => a.action === "contact.suppression_released") && /この相手に電話を頼む/.test(await page.text(".contact-detail")) && /連絡停止を解除しました。解除した理由は記録されました。/.test(await page.text(".released")), "released: recorded, said on the contact, and the contact can be called again");
  await sleep(3300);
  await page.screenshot(join(out, "gateway-app-contact-released.png"));
  await go(`#/contacts/${optedOut.id}`, "/高橋 花/.test(document.querySelector('.headline')?.textContent)");
  c.ok(/ご本人が通話中にボタンを押して、電話を止めました。/.test(await page.text(".stopped-box")) && /ご本人の意思なので、この停止は解除できません。/.test(await page.text(".stopped-box")) && !(await page.js("!!document.querySelector('.release-form') || [...document.querySelectorAll('.stopped-box button')].length>0")), "a stop the person made during a call: said plainly from the start, with no release form at all", await page.text(".stopped-box"));
  await page.screenshot(join(out, "gateway-app-contact-stopped-recipient.png"));
  await small("連絡先 (連絡停止)");
  const setFile = (parts) => page.js(`(()=>{const i=document.querySelector('#contact-csv');const dt=new DataTransfer();dt.items.add(new File([${parts}],'contacts.csv',{type:'text/csv'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await go("#/contacts", "!!document.querySelector('.contacts-page')");
  await clickText("CSVから取り込む", ".page-actions");
  c.ok(await page.visible(".import-card") && (await page.focused()).id === "contact-csv" && /Shift_JIS のファイルは読めません/.test(await page.text("#contact-csv-help")) && await page.js("document.querySelector('.import-card .btn.primary').disabled"), "CSVから取り込む: the help names the columns and says Shift_JIS is not read; nothing to import yet");
  await setFile("new Uint8Array([0x96,0xBC,0x91,0x4F,0x2C,0x93,0x64,0x98,0x62,0x94,0xD4,0x8D,0x86,0x0D,0x0A])");
  await page.until("!document.querySelector('.import-card .errbox').hidden", { label: "not UTF-8" });
  c.ok(/UTF-8 として読めませんでした/.test(await page.text(".import-card .errbox")) && await page.js("document.querySelector('.import-card .btn.primary').disabled"), "a Shift_JIS file is refused with what to do about it");
  const csv = "﻿名前,会社,電話番号,関係,根拠,メール,メモ,部署\r\n中村 恵,\"中村商事, 営業部\",090-2222-0001,問い合わせ,\"10/1 に \"\"資料請求\"\" あり\",megumi@example.com,\"午前中に\r\n電話\",営業\r\n小林 進,,03-1234-000,,,,,\r\n\"医療法人社団さくら会 さくら訪問看護ステーション東京西 管理者 長谷川\",,090-2222-0003,,,,,\r\n焼肉 たけ,,03-5555-0142,,,,,\r\n電話なし 太郎,,,,,,,\r\n,,090-2222-0006,,,,,\r\n";
  await setFile(JSON.stringify(csv));
  await page.until("/6件を取り込む/.test(document.querySelector('.import-card .btn.primary').textContent)", { label: "csv preview" });
  c.ok(/6件を読みました/.test(await page.text(".import-info")) && /使わない列：部署/.test(await page.text(".import-info")), "the file is read in the browser: BOM, CRLF, quoted commas and line breaks; the row count is shown first", await page.text(".import-info"));
  await clickText("6件を取り込む", ".import-card");
  await page.until("!!document.querySelector('.import-result')", { label: "import result" });
  const imported = await page.text(".import-result"), nakamura = (await api("/contacts")).find((x) => x.name === "中村 恵");
  c.ok(/追加した2件/.test(imported) && /すでにあった1件/.test(imported) && /取り込めなかった3件/.test(imported), "取り込みの結果: added, already there, and not imported", imported.slice(0, 80));
  c.ok(/2件目小林 進電話番号を確かめてください。/.test(imported) && /5件目電話なし 太郎電話番号がありません。/.test(imported) && /6件目090-2222-0006名前か会社名がありません。/.test(imported) && !/invalid_|contact_/.test(imported), "each row that was not imported says why, in Japanese", imported.slice(80));
  c.ok(nakamura?.company === "中村商事, 営業部" && nakamura.relationship === "inquiry" && nakamura.basis === "10/1 に \"資料請求\" あり" && /午前中に\r?\n電話/.test(nakamura.notes) && nakamura.email === "megumi@example.com" && /中村 恵/.test(await page.text(".list")), "the imported contact holds the quoted fields as written, and is on the list", JSON.stringify(nakamura));
  await page.screenshot(join(out, "gateway-app-contacts-import.png"));
  await small("連絡先 (取り込みの結果)");

  // 名簿にまとめて電話: pick contacts, decide the call once, see who will and will not be called, approve, follow the list.
  const pick = (names) => page.js(`for (const n of ${JSON.stringify(names)}) [...document.querySelectorAll('label.item.pick')].find(l=>l.querySelector('b').textContent===n).querySelector('input').click()`);
  await go("#/contacts", "!!document.querySelector('.contacts-page')");
  await clickText("名簿にまとめて電話", ".page-actions");
  await page.until("!!document.querySelector('.pick-bar:not([hidden])') && document.querySelectorAll('label.item.pick').length>0", { label: "pick mode" });
  c.ok(await page.js("document.querySelector('.pick-bar a.btn').hasAttribute('aria-disabled')") && /0人を選んでいます/.test(await page.text(".pick-count")), "名簿: nothing chosen yet, 内容を決める is off");
  await pick(["山本 ハル", "佐々木 ミツ", "中村 恵", "高橋 花", "焼肉 たけ"]);
  c.ok(/5人を選んでいます/.test(await page.text(".pick-count")), "名簿: the count follows the checkboxes", await page.text(".pick-count"));
  await page.screenshot(join(out, "gateway-app-list-pick.png"));
  await small("連絡先 (名簿の相手を選ぶ)");
  await clickText("内容を決める", ".pick-bar");
  await page.until("location.hash==='#/lists/new' && !!document.querySelector('#list-ack')", { label: "list form" });
  const listSide = () => page.text(".ask-side");
  c.ok(await page.js("document.querySelector('#tabs a[aria-current=page]')?.dataset.tab") === "contacts", "名簿にまとめて電話: the breadcrumb says 連絡先 and so does the selected tab");
  await page.until("/電話をかける相手/.test(document.querySelector('.ask-side').textContent)", { label: "list preview" });
  c.ok(/電話をかける相手　3人/.test(await listSide()) && /かけない相手　2人/.test(await listSide()) && /高橋 花連絡停止中です/.test(await listSide()) && /焼肉 たけ「電話してよい根拠」が書かれていません/.test(await listSide()), "名簿の確認: who will be called and who will not, with the reason, before approval", (await listSide()).slice(0, 200));
  await page.js("document.querySelector('input[name=list-kind][value=sales]').click()");
  await page.until("/電話をかける相手　1人/.test(document.querySelector('.ask-side').textContent)", { label: "sales preview" });
  c.ok(/電話をかける相手　1人/.test(await listSide()) && /山本 ハル「この相手との関係」が登録されていません/.test(await listSide()) && /Oathra ビジネス/.test(await listSide()), "a sales list needs the relationship too: the split changes with the kind of call");
  await page.js("document.querySelector('input[name=list-kind][value=request]').click()");
  // (2) An empty 頼むこと cannot be started, even with the checkbox ticked.
  await page.js("document.querySelector('#list-ack').click()"); await sleep(100);
  await clickText("この名簿で電話を始める", ".ask-side"); await sleep(500);
  c.ok(/頼むことを書いてください/.test(await page.text(".ask-side .errbox")) && await page.js("location.hash") === "#/lists/new" && (await api("/batches")).length === 1, "a list with an empty 頼むこと is not started even with the checkbox ticked; nothing is registered");
  await page.js("{const t=document.querySelector('#list-text');t.value='来週の訪問の予定をお知らせして、ご都合を聞いてください。';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#list-gentle').click();const n=document.querySelector('#list-retry');n.value='1';n.dispatchEvent(new Event('change',{bubbles:true}))}");
  const listRules = await page.text(".ask-side .rep-rules");
  c.ok(["同じように費用", "08:00〜21:00 の間だけかけます。時間の外では、かけずに待ちます", "一時停止します", "7日", "断った相手には、もうかけません"].every((t) => listRules.includes(t)) && /1時間後に、1回までかけ直す/.test(await listSide()) && /最大 6 回（かける3人 × かけ直しを含め2回）/.test(await listSide()) && /承認するとすぐ、08:00〜21:00 の間に順にかけ始めます/.test(await listSide()) && await page.js("document.querySelector('.ask-side .btn.primary').disabled"), "the rules of a list and the retry choice are stated; 始める stays off until acknowledged", listRules);
  await page.screenshot(join(out, "gateway-app-list-new.png"), { fullPage: true });
  await small("名簿にまとめて電話");
  await page.js("document.querySelector('#list-ack').click()"); await sleep(100);
  await clickText("この名簿で電話を始める", ".ask-side");
  await page.until("location.hash==='#/lists' && document.querySelectorAll('.sched').length===2", { timeout: 10_000, label: "lists after registering" });
  const batch = (await api("/batches"))[0], states = Object.fromEntries(batch.items.map((i) => [i.name, i.state + (i.reason ? ":" + i.reason : "")]));
  c.ok(batch.kind === "request" && batch.spec.pace === "gentle" && batch.retry.count === 1 && batch.retry.minutes === 60 && states["山本 ハル"] === "PENDING" && states["佐々木 ミツ"] === "PENDING" && states["中村 恵"] === "PENDING" && states["高橋 花"] === "SKIPPED:recipient_suppressed" && states["焼肉 たけ"] === "SKIPPED:contact_basis_required", "the list is saved as approved, and the server skips exactly the people the screen said it would", JSON.stringify(states));
  await go("#/requests", "!!document.querySelector('.page-actions a[href$=standing]')");
  await clickText("名簿の電話", ".page-actions");
  await page.until("location.hash==='#/lists' && document.querySelectorAll('.sched').length===2", { label: "lists" });
  // The list seeded with its calls (two days ago): progress over the people to be called, and each person's result.
  const listText = await page.js("document.querySelectorAll('.sched')[1].textContent"), newText = await page.text(".sched");
  c.ok(/・4人の名簿/.test(listText) && /完了/.test(listText) && /かける2人のうち2人にかけ終えました（かけない相手 2人）/.test(listText) && await page.js("document.querySelectorAll('.sched')[1].querySelector('.bar-meter i').style.width") === "100%" && /山本 ハル話せました—?報告を開く/.test(listText) && /佐々木 ミツ応答なし2回かけました。報告を開く/.test(listText) && /高橋 花かけていません連絡停止中です/.test(listText) && /「来週の訪問の予定をお知らせして、ご都合を…」・5人の名簿/.test(newText) && /かける3人のうち0人にかけ終えました（かけない相手 2人）/.test(newText) && /中村 恵これからかけます/.test(newText) && !/PENDING|SKIPPED|DONE|UNANSWERED|contact_|recipient_|undefined/.test(listText + newText), "名簿の電話: progress over the people to be called, each person's result in plain Japanese, and the report link", listText.slice(0, 260));
  await sleep(3300);
  await page.screenshot(join(out, "gateway-app-lists.png"), { fullPage: true });
  await small("名簿の電話");
  await clickText("一時停止", ".sched");
  await page.until("document.querySelector('.sched').dataset.status==='PAUSED'", { label: "list paused" });
  c.ok((await api("/batches"))[0].status === "PAUSED" && (await page.focused()).text === "再開する", "名簿: 一時停止 is saved, and the focus moves to 再開する");
  await clickText("再開する", ".sched");
  await page.until("document.querySelector('.sched').dataset.status==='ACTIVE'", { label: "list resumed" });
  await sleep(3300);
  // これまでの電話（30日）: one person's calls over time, newest first, each opening its report.
  await go(`#/contacts/${mitsu.id}`, "document.querySelectorAll('.past-rows li').length===4", "contact history");
  const past = await page.text(".past"), pastRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.past-rows li')].map(l=>l.textContent))"));
  c.ok(/3回続けて応答がありません/.test(await page.text(".past-missed")) && await page.js("!!document.querySelector('.past-missed .lvl.concern')") && /4回の電話のうち、話せました 1回・応答なし 3回・要確認 3回/.test(past) && !(await page.visible(".contact-detail > .rows")), "これまでの電話: two unanswered in a row comes first, marked 要確認; then the counts", past.slice(0, 120));
  c.ok(/応答なし/.test(pastRows[0]) && /要確認/.test(pastRows[0]) && /応答なし/.test(pastRows[1]) && /16:05/.test(pastRows[1]) && /話せました/.test(pastRows[3]) && /食事：食べたと話しました/.test(pastRows[3]) && /09:05/.test(pastRows[3]) && await page.js("[...document.querySelectorAll('.past-rows a')].every(a=>/^#\\/call\\/[a-f0-9-]{36}$/.test(a.getAttribute('href')))"), "newest at the top: how each call went, the answers as things said, and a link to each report", pastRows.join(" | "));
  await page.screenshot(join(out, "gateway-app-contact-history.png"), { fullPage: true });
  await small("連絡先 (これまでの電話)");
  await go(`#/contacts/${optedOut.id}`, "/高橋 花/.test(document.querySelector('.headline')?.textContent)"); await sleep(500);
  c.ok(!(await page.visible(".past")), "a contact with no calls shows no これまでの電話");
  // 折り返しの依頼: who asked to be called back, why they could not get through, and marking one done.
  await go("#/requests", "!!document.querySelector('.page-actions a[href$=standing]')");
  await page.js("document.querySelector('.page-actions a[href=\"#/callbacks\"]').click()");
  await page.until("location.hash==='#/callbacks' && document.querySelectorAll('.row.callback').length===3", { label: "callbacks" });
  const cbRows = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.row.callback')].map(r=>r.textContent))"));
  c.ok(/03-5555-0199受付時間の外でした。折り返しました/.test(cbRows[0]) && /090-8888-7777回線がふさがっていて、つながりませんでした。/.test(cbRows[1]) && /090-6666-5555着信が多く、受けられませんでした。折り返し済み（鈴木・/.test(cbRows[2]) && /折り返すことは約束していません/.test(await page.text(".callback-note")), "折り返しの依頼: newest first, the number as written in Japan, why they could not get through, who already called back; no call back was promised", cbRows.join(" | "));
  await page.screenshot(join(out, "gateway-app-callbacks.png"));
  await small("折り返しの依頼");
  await page.js("document.querySelector('.row.callback button').click()");
  await page.screenshot(join(out, "gateway-app-callbacks-confirm.png"));
  c.ok(/この番号に折り返しましたか？（取り消せません）/.test(await page.text(".row.callback .cb-action")) && (await api("/callbacks")).open === 2, "折り返しました asks once more in the row itself before anything is saved");
  await page.js("[...document.querySelectorAll('.row.callback .cb-action button')].find(b=>b.textContent==='はい、折り返しました').click()");
  await page.until("document.querySelectorAll('.row.callback.done').length===2", { label: "callback done" });
  const cbAfter = await api("/callbacks");
  c.ok(cbAfter.open === 1 && /折り返し済み（自分・/.test(await page.js("document.querySelector('.row.callback').textContent")) && app.store.audits({ after: 0, limit: 500 }).some((a) => a.action === "call.callback_done"), "折り返しました: saved, recorded, and the row says who and when");
  await sleep(3300);
  c.ok(page.pageErrors.length === 0, "no page errors (new screens)", page.pageErrors.join(" "));
  await page.close();

  // 390: a fresh page at phone width (a viewport change does not reach full-page captures), signed in again.
  // 390, and the email login: a one-time setup link (what 設定 issues), then sign out and back in with email and password.
  const link = await api("/account/password-link", {});
  c.ok(/^[A-Za-z0-9_-]{43}$/.test(link.code ?? ""), "設定 › メールとパスワード: a one-time setup code", JSON.stringify(link).slice(0, 60));
  page = await launchQuiet({ width: 390, height: 844 });
  await page.goto(base + "/app#setup=" + link.code);
  await page.until("document.querySelector('#public-email') && /ログイン方法を設定/.test(document.querySelector('#view').textContent)", { label: "setup form" });
  await page.js(`document.querySelector('#public-password').value='short';document.querySelector('#public-email').value='owner@example.com';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('.public-error').hidden", { label: "short password" }).catch(() => null);
  c.ok(await page.js("document.querySelector('#public-password').validity.tooShort || !document.querySelector('.public-error').hidden"), "a password under 8 characters is refused");
  await page.js(`document.querySelector('#public-password').value='correct horse 9';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('#tabs').hidden", { label: "signed in after setup" });
  c.ok(!/setup=/.test(await page.js("location.hash")), "after setup the code leaves the address bar");
  await page.js("location.hash='#/settings/view'"); await page.until("/記録と表示/.test(document.querySelector('.settings-content h2')?.textContent)", { label: "設定 › 記録と表示" });
  c.ok(/owner@example\.com/.test(await page.text("#view")), "設定 shows the login email");
  await page.js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ログアウト').click()");
  await page.until("document.querySelector('#public-email') && document.querySelector('#public-login-submit') && !document.querySelector('#public-login-submit').disabled", { label: "signed out, sign-in form ready" });
  await page.js(`document.querySelector('#public-email').value='owner@example.com';document.querySelector('#public-password').value='wrong password';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('.public-error').hidden", { label: "wrong password" });
  c.ok(/違います/.test(await page.text(".public-error")) && !/invalid_login/.test(await page.text(".public-error")), "a wrong password: a plain message, no code", await page.text(".public-error"));
  await page.js(`document.querySelector('#public-password').value='correct horse 9';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('#tabs').hidden", { label: "email sign in" });
  c.ok(true, "signed in with email and password");
  await page.goto(base + "/app#/");
  await page.until("!document.querySelector('#tabs').hidden");
  for (const [label, hashv] of [["home", "#/"], ["requests", "#/requests"], ["report", `#/call/${done}`], ["ask", "#/new"]]) {
    await page.js(`location.hash='${hashv}'`); await sleep(900);
    const width = await page.js("innerWidth");
    c.ok(width === 390 && await page.noSidewaysScroll(), `390 ${label}: measured at ${width}px, no sideways scroll`);
    await page.screenshot(join(out, `gateway-app-${label}-mobile.png`));
  }
  c.ok(page.pageErrors.length === 0, "no page errors (390)", page.pageErrors.join(" "));
  // The new screens at 390: no sideways scroll, and a screenshot of each.
  const at390 = async (label, hashv, ready) => {
    await page.js(`location.hash=${JSON.stringify(hashv)}`); await page.until(ready, { timeout: 10_000, label: `390 ${label}` }); await sleep(400);
    c.ok(await page.js("innerWidth") === 390 && await page.noSidewaysScroll(), `390 ${label}: no sideways scroll`);
    const s = await page.smallTargets(44); c.ok(s.length === 0, `390 ${label}: no control under 44px`, s.join(", "));
  };
  await at390("ask-gentle", "#/new?kind=wellbeing-check", "document.querySelector('#ask-gentle')?.checked===true");
  await page.js("document.querySelector('#ask-gentle').scrollIntoView({block:'center'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-gentle-mobile.png"));
  await at390("report-care", `#/call/${careCall}`, "!!document.querySelector('.checkin-table')");
  await page.screenshot(join(out, "gateway-app-report-care-mobile.png"), { fullPage: true });
  await at390("standing", "#/standing", "document.querySelectorAll('.sched').length>=1");
  await page.screenshot(join(out, "gateway-app-standing-mobile.png"), { fullPage: true });
  await at390("team", "#/team", "!!document.querySelector('.team-table')");
  c.ok(await page.js("[...document.querySelectorAll('.team-table td.none')].every(n=>getComputedStyle(n).display==='none') && [...document.querySelectorAll('.team-table td[data-label^=\"話したこと\"]:not(.none)')].length>=2 && document.querySelectorAll('.sum-days li').length===7"), "390 team: no empty fields on the cards; the answers sit under a 話したこと label; the seven-day strip fits");
  // Over 3000px the one tall capture is illegible: the top (summary, the blocks) and the list are saved apart, at a 2400px viewport.
  { const tall = await page.js("document.documentElement.scrollHeight") > 3000;
    if (tall) { await page.viewport(390, 2400); await sleep(300); await page.js("scrollTo(0,0)"); await sleep(200);
      await page.screenshot(join(out, "gateway-app-team-mobile-top.png"));
      await page.js("scrollTo(0, document.querySelector('.team-wrap').getBoundingClientRect().top+scrollY-8)"); await sleep(300);
      await page.screenshot(join(out, "gateway-app-team-mobile-list.png"));
      await page.js("scrollTo(0,0)"); await page.viewport(390, 844); await sleep(300); }
    else await page.screenshot(join(out, "gateway-app-team-mobile.png"), { fullPage: true }); }
  c.ok(await page.js("[...document.querySelectorAll('.sum-days .at.wide')].every(n=>getComputedStyle(n).display==='none') && [...document.querySelectorAll('.sum-days .at.narrow')].some(n=>/^(緊急|未発信)\\d+$/.test(n.textContent))"), "390 day strip: short labels, nothing broken inside a word");
  await page.js("document.querySelector('.team-tools .chip').click()");
  await page.until("document.querySelector('.team-tools .chip').getAttribute('aria-pressed')==='true' && document.querySelectorAll('.team-table tbody tr').length===7", { label: "390 要確認 only" });
  await page.screenshot(join(out, "gateway-app-team-attention-mobile.png"), { fullPage: true });
  await at390("people", "#/team/people", "!!document.querySelector('.people-table')");
  await page.screenshot(join(out, "gateway-app-people-mobile.png"), { fullPage: true });
  await at390("person", `#/team/person/${tamuraContact.id}`, "document.querySelectorAll('.past-rows li').length===1");
  await page.screenshot(join(out, "gateway-app-person-mobile.png"));
  await at390("ask-terms", "#/new?kind=delivery-date", "!!document.querySelector('#ask-qty') && !document.querySelector('#ask-qty').closest('.field').hidden");
  await page.js("document.querySelector('#ask-qty').scrollIntoView({block:'center'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-ask-terms-mobile.png"));
  await at390("callbacks", "#/callbacks", "document.querySelectorAll('.row.callback').length===3");
  await page.js("document.querySelector('.row.callback button').click()"); await sleep(200);
  c.ok(await page.noSidewaysScroll() && /折り返しましたか/.test(await page.text(".row.callback .cb-action")), "390 callbacks: the in-row confirmation fits the width");
  await page.screenshot(join(out, "gateway-app-callbacks-confirm-mobile.png"));
  await page.js("[...document.querySelectorAll('.row.callback .cb-action button')].find(b=>b.textContent==='まだです').click()");
  await page.screenshot(join(out, "gateway-app-callbacks-mobile.png"), { fullPage: true });
  await at390("contact history", `#/contacts/${mitsu.id}`, "document.querySelectorAll('.past-rows li').length===4");
  await page.js("document.querySelector('.past').scrollIntoView({block:'start'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-app-contact-history-mobile.png"));
  await at390("lists", "#/lists", "document.querySelectorAll('.sched').length===2");
  await page.screenshot(join(out, "gateway-app-lists-mobile.png"), { fullPage: true });
  await at390("contacts (pick)", "#/contacts", "!!document.querySelector('.contacts-page')");
  await page.js("[...document.querySelectorAll('.page-actions button')].find(b=>b.textContent==='名簿にまとめて電話').click()");
  await page.until("document.querySelectorAll('label.item.pick').length>0", { label: "390 pick mode" });
  await page.js("for (const n of ['山本 ハル','中村 恵','焼肉 たけ']) [...document.querySelectorAll('label.item.pick')].find(l=>l.querySelector('b').textContent===n).querySelector('input').click()");
  await page.js("document.querySelector('.pick-bar a.btn').click()");
  await at390("list-new", "#/lists/new", "!!document.querySelector('#list-ack')");
  await page.screenshot(join(out, "gateway-app-list-new-mobile.png"), { fullPage: true });
  // The standing-request approval at 390, as on a live server (nothing is dialled; nothing is registered here).
  config.mode = "live"; config.liveReady = true;
  await page.js(`location.hash='#/new?contact=${haru.id}';location.reload()`); await sleep(1200);
  await page.until("document.querySelector('#ask-name')?.value==='山本 ハル'", { label: "390 ask (as live)" });
  await page.js("{const i=document.querySelector('#ask-instruction'); i.value='お変わりないか、体調を聞いてください。'; i.dispatchEvent(new Event('input',{bubbles:true}));}");
  await page.js("[...document.querySelectorAll('.ask-side button')].find(b=>b.textContent==='内容を確かめる').click()");
  await page.until("!!document.querySelector('#rep-on')", { timeout: 8000, label: "390 review" });
  await page.js("document.querySelector('#rep-on').click()"); await page.until("!!document.querySelector('.rep-sum')", { label: "390 repeat panel" });
  c.ok(await page.noSidewaysScroll() && /山本 ハル/.test(await page.text(".rep-sum")) && /最大 \d+ 回/.test(await page.text(".rep-sum")), "390 定期の電話にする: the summary before the approval fits the width");
  await page.js("document.querySelector('.rep-panel > .btn.primary').scrollIntoView({block:'end'})"); await sleep(300);
  await page.screenshot(join(out, "gateway-app-ask-repeat-mobile.png"));
  config.mode = "simulator"; config.liveReady = false;
  await at390("contacts", "#/contacts", "!!document.querySelector('.contacts-page')");
  await page.js("[...document.querySelectorAll('.page-actions button')].find(b=>b.textContent==='CSVから取り込む').click()");
  await page.js(`(()=>{const i=document.querySelector('#contact-csv');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify("name,company,phone\r\n渡辺 さくら,渡辺クリニック,090-2222-0011\r\n山田 花子,,12345\r\n焼肉 たけ,,03-5555-0142\r\n")}],'contacts.csv',{type:'text/csv'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await page.until("/3件を取り込む/.test(document.querySelector('.import-card .btn.primary').textContent)", { label: "390 csv preview" });
  await page.js("document.querySelector('.import-card .btn.primary').click()");
  await page.until("!!document.querySelector('.import-result')", { label: "390 import result" }); await sleep(300);
  c.ok(/追加した1件/.test(await page.text(".import-result")) && /すでにあった1件/.test(await page.text(".import-result")) && /2件目山田 花子電話番号を確かめてください。/.test(await page.text(".import-result")) && await page.noSidewaysScroll(), "390 contacts: English column names are read too; the result fits the width", await page.text(".import-result"));
  await page.screenshot(join(out, "gateway-app-contacts-import-mobile.png"));
  // Another role: no way in to チームの電話, and the address typed by hand is refused in words.
  await page.close();
  page = await launchQuiet({ width: 390, height: 844 });
  await signIn(page, mateToken);
  await page.js("location.hash='#/requests'"); await page.until("!!document.querySelector('.page-actions a[href$=standing]')", { label: "operator requests" });
  c.ok(await page.js("[...document.querySelectorAll('.page-actions a')].map(a=>a.textContent).join()") === "定期の電話,名簿の電話,折り返しの依頼", "an operator sees 定期の電話 and 名簿の電話 but no チームの電話");
  await page.js("location.hash='#/callbacks'"); await page.until("/折り返しの依頼はありません。/.test(document.querySelector('#view').textContent)", { label: "operator callbacks (empty)" });
  await page.screenshot(join(out, "gateway-app-callbacks-empty-mobile.png"));
  await page.js("location.hash='#/team'"); await page.until("/管理者とマネージャーだけ/.test(document.querySelector('#view').textContent)", { label: "operator team" });
  c.ok(!(await page.js("!!document.querySelector('.team-table')")) && page.pageErrors.length === 0, "#/team typed by an operator shows no calls");
  await page.close();
  // 暗い表示: the OS asks for dark and the app's own dark theme is on (?theme=dark, what 設定 › 表示 remembers). Same screens, -dark.
  const darkShots = async (w, h, names) => {
    page = await launchQuiet({ width: w, height: h }); await page.emulateColorScheme("dark");
    await page.goto(base + "/app?theme=dark"); await page.until("document.documentElement.dataset.theme==='dark'", { label: "dark theme" });
    await signIn(page, token);
    const shot = async (name, hashv, ready, full = true) => { await page.js(`location.hash=${JSON.stringify(hashv)}`); await page.until(ready, { timeout: 10_000, label: `dark ${name}` }); await sleep(400);
      c.ok(await page.js("getComputedStyle(document.body).backgroundColor") === "rgb(19, 18, 17)" && await page.noSidewaysScroll(), `dark ${name} at ${w}: the dark background, no sideways scroll`);
      await page.screenshot(join(out, `gateway-app-${name}-dark${w < 600 ? "-mobile" : ""}.png`), { fullPage: full }); };
    const all = {
      team: () => shot("team", "#/team", "!!document.querySelector('.team-table') && !!document.querySelector('.sum-days li')"),
      people: () => shot("people", "#/team/people", "!!document.querySelector('.people-table')"),
      "report-care": () => shot("report-care", `#/call/${careCall}`, "!!document.querySelector('.checkin-table')"),
      "report-unanswered": () => shot("report-unanswered", `#/call/${noAnswer}`, "!!document.querySelector('.band')"),
      standing: () => shot("standing", "#/standing", "document.querySelectorAll('.sched').length>=1"),
      "list-new": async () => { await page.js("location.hash='#/contacts'"); await page.until("!!document.querySelector('.contacts-page')", { label: "dark contacts" });
        await page.js("[...document.querySelectorAll('.page-actions button')].find(b=>b.textContent==='名簿にまとめて電話').click()"); await page.until("document.querySelectorAll('label.item.pick').length>0", { label: "dark pick mode" });
        await page.js("for (const n of ['山本 ハル','中村 恵','高橋 花','焼肉 たけ']) [...document.querySelectorAll('label.item.pick')].find(l=>l.querySelector('b').textContent===n).querySelector('input').click()");
        await page.js("document.querySelector('.pick-bar a.btn').click()"); await shot("list-new", "#/lists/new", "!!document.querySelector('#list-ack') && /かけない相手/.test(document.querySelector('.ask-side').textContent)"); },
      callbacks: () => shot("callbacks", "#/callbacks", "document.querySelectorAll('.row.callback').length===3", false),
      "contact-stopped": () => shot("contact-stopped", `#/contacts/${optedOut.id}`, "!!document.querySelector('.stopped-box')", false),
      "ask-repeat-end": async () => { const was = { mode: config.mode, liveReady: config.liveReady }; config.mode = "live"; config.liveReady = true;
        await page.js("location.hash='#/new';location.reload()"); await sleep(1200); await page.until("!!document.querySelector('[data-group=\"care\"]')", { label: "dark ask" });
        await page.js("document.querySelector('[data-group=care]').click();document.querySelector('[data-kind=wellbeing-check]').click()");
        await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='佐々木 ミツ').click()");
        await page.js("{const i=document.querySelector('[data-blank]');i.value='ひかり苑';i.dispatchEvent(new Event('input',{bubbles:true}))}");
        await clickText("内容を確かめる", ".ask-side"); await page.until("!!document.querySelector('#ask-ack')", { timeout: 8000, label: "dark review" });
        await page.js("document.querySelector('#rep-on').click()"); await page.until("!!document.querySelector('.rep-panel')", { label: "dark repeat panel" });
        await page.js("document.querySelector('.rep-panel > .btn.primary').scrollIntoView({block:'end'})"); await sleep(200);
        await page.screenshot(join(out, "gateway-app-ask-repeat-end-dark.png")); Object.assign(config, was); },
    };
    for (const n of names) await all[n]();
    c.ok(page.pageErrors.length === 0, `no page errors (dark, ${w})`, page.pageErrors.join(" "));
    await page.close();
  };
  await darkShots(1440, 900, ["team", "people", "report-care", "report-unanswered", "standing", "list-new", "callbacks", "contact-stopped", "ask-repeat-end"]);
  await darkShots(390, 844, ["team", "people", "report-care", "report-unanswered"]);
} finally {
  await page?.close(); app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); rmSync(dir, { recursive: true, force: true });
}
c.finish();
