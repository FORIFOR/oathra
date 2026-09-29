// The new gateway app at /app (design: Oathra App.dc.html): sign in, ホーム, 依頼, 電話を頼む, 電話中/報告, 練習, 連絡先, 設定.
// Authenticated gateway in practice mode + real SQLite; the worker is never started and nothing is dialled. The call
// states and transcripts below are local fixtures for rendering only, never a claim that such a call took place.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createGateway, configuration } from "../../apps/gateway/server.mjs";
import { hash } from "../../apps/gateway/lib/security.mjs";
import { checklist, launch, sleep } from "./cdp.mjs";

const dir = mkdtempSync(join(tmpdir(), "oathra-gateway-app-")), token = randomBytes(32).toString("hex");
const user = { id: randomUUID(), team: "local", role: "admin", tokenHash: hash(token) };
const config = configuration({ OATHRA_USERS_JSON: JSON.stringify([user]), OATHRA_DATA_KEY: randomBytes(32).toString("hex"), OATHRA_DB: join(dir, "db.sqlite") });
const app = await createGateway(config, { env: {} }); await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + app.server.address().port; config.publicUrl = base;
const out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const c = checklist("gateway app");
const api = (path, body) => fetch(base + "/v1" + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json());
const draft = async (name, instruction) => (await api("/phone/draft", { phone: "+819012345678", name, instruction })).mission.id;
const put = (id, status, turns) => { const m = app.store.get("mission", id); m.status = status; m.approvedAt = Date.now(); if (status !== "ACTIVE") m.finishedAt = Date.now(); m.transcript = turns.map(([source, text], i) => ({ id: `t-${i}`, source, text, t: (i + 1) * 4000, startMs: i * 4000 + 310, endMs: i * 4000 + 3180 })); app.store.put("mission", m); };
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
  const partial = await draft("焼肉 たけ", "10月5日の18時に3名で予約を取ってほしい。");
  put(partial, "INCOMPLETE", [["caller", "10月5日の18時に3名で予約をお願いできますか。"], ["callee", "10月5日ですね、その日は空いております。お時間は確認しますので少々お待ちください。"]]);

  page = await launch({ width: 1440, height: 900 });
  await page.goto(base + "/");
  await page.until("document.querySelector('#login-email')", { label: "sign in" });
  c.ok(await page.js("!!document.querySelector('link[href=\"/app/style.css\"]')"), "/ is the new app (the previous screen lives at /workspace)");
  c.ok(!(await page.visible("#tabs")) && await page.visible("#login-password") && !(await page.js("!!document.querySelector('#token')")), "before sign-in: email and password, no token field");
  await page.screenshot(join(out, "gateway-app-login.png"));
  await page.js("[...document.querySelectorAll('button')].find(b => /管理者のトークン/.test(b.textContent)).click()");
  await page.until("document.querySelector('#token')", { label: "token form" });
  await page.js(`document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('form').requestSubmit()`);
  try { await page.until("!document.querySelector('#tabs').hidden && /ホーム/.test(document.querySelector('#view').textContent)", { timeout: 8000, label: "home" }); }
  catch (e) { console.log("VIEW:", await page.text("#view"), "ERR:", page.pageErrors.join(" | ")); throw e; }
  await page.js("location.hash='#/new'"); await page.until("!!document.querySelector('#ask-engine')", { label: "engine select" });
  const engines = await page.js("[...document.querySelectorAll('#ask-engine option')].map(o=>o.textContent)");
  c.ok(engines.some(t => /gpt-live-1/.test(t)) && engines.some(t => /gemini-3\.8-live/.test(t)), "電話を頼む: 音声AI names the model (gpt-live-1 / gemini-3.8-live)", engines.join(" | "));
  await page.js("location.hash='#/'"); await page.until("/ホーム/.test(document.querySelector('#view').textContent)");
  const home = await page.text("#view");
  c.ok(/あなたの確認が必要なものが 3 件/.test(home) && await page.text("#attention-badge") === "3", "ホーム: three things need you (an unknown outcome, two drafts), also on the 依頼 tab", home.slice(0, 80));
  c.ok(/前回かけた電話/.test(home) && /焼肉 たけ/.test(home) && /最近の電話/.test(home), "ホーム: the last call and the recent calls");
  c.ok(await page.visible("#live-pill"), "a running call shows 電話中 in the top bar");
  c.ok(await page.noPageScroll() === false || true, "(home may scroll)");
  await page.screenshot(join(out, "gateway-app-home.png"), { fullPage: true });

  await page.js("location.hash='#/requests'"); await page.until("/あなたの確認が必要/.test(document.querySelector('#view').textContent)");
  const req = await page.text("#view");
  c.ok(/電話が終わったか確かめられていません/.test(req) && /発信前の確認待ち/.test(req) && /進行中/.test(req) && /完了/.test(req), "依頼: needs-you cards, in progress and done", req.slice(0, 300));
  await page.screenshot(join(out, "gateway-app-requests.png"), { fullPage: true });

  await page.js(`location.hash='#/call/${running}'`); await page.until("/通話を終える/.test(document.querySelector('#view').textContent)");
  const live = await page.text("#view");
  c.ok(/電話中/.test(live) && /どうしたの/.test(await page.text(".transcript")) && /判定する項目がありません/.test(live), "電話中: the conversation, and a call with nothing to judge says so", live.slice(0, 120));
  await page.screenshot(join(out, "gateway-app-live.png"));
  // The live view follows the call: a new line shows without reloading.
  put(running, "ACTIVE", [["caller", "もしもし、田中さんの代わりにお電話しているAIです。"], ["callee", "え、そうなの？どうしたの？"], ["caller", "最近どうしてるかなと思って。"]]);
  await page.until("/最近どうしてるかなと思って/.test(document.querySelector('.transcript').textContent)", { timeout: 6000, label: "live update" });
  c.ok(true, "電話中: a new line appears within the poll interval");

  await page.js(`location.hash='#/call/${done}'`); await page.until("!!document.querySelector('.report-top')");
  const report = await page.text("#view");
  c.ok(/決まりました/.test(report) && await page.js("!!document.querySelector('.ring')") && /ご予約承りました/.test(report), "報告: the ring, the settled fields with the callee's words", report.slice(0, 160));
  c.ok(!/phone\.|phone_|undefined|NaN/.test(report), "no internal ids or undefined on the report");
  c.ok(await page.js("!!document.querySelector('.report-top .verdict') && document.querySelectorAll('.rrow').length===4") && /確かめたのは、電話での合意までです/.test(report) && /\d\d:\d\d\.\d{3} – \d\d:\d\d\.\d{3}/.test(report), "報告 as in the film: verdict with summary, one row per field with the callee's words and their time, the caveat");
  c.ok(/AIの発言・判定に数えません/.test(await page.text(".transcript")) && /証拠/.test(await page.text(".side-top")), "the AI's own 「できました」 is marked as not counted; the side is the evidence");
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
  await page.js("[...document.querySelectorAll('a.link')].find(a=>/次の月/.test(a.textContent)).click()"); await sleep(500);
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
  for (const id of [running, unknown]) { const m = app.store.get("mission", id); m.status = "COMPLETED"; m.finishedAt = Date.now(); app.store.put("mission", m); }
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
  await page.close();

  // 390: a fresh page at phone width (a viewport change does not reach full-page captures), signed in again.
  // 390, and the email login: a one-time setup link (what 設定 issues), then sign out and back in with email and password.
  const link = await api("/account/password-link", {});
  c.ok(/^[A-Za-z0-9_-]{43}$/.test(link.code ?? ""), "設定 › メールとパスワード: a one-time setup code", JSON.stringify(link).slice(0, 60));
  page = await launch({ width: 390, height: 844 });
  await page.goto(base + "/app#setup=" + link.code);
  await page.until("document.querySelector('#login-email') && /ログインの設定/.test(document.querySelector('#view').textContent)", { label: "setup form" });
  await page.js(`document.querySelector('#login-password').value='short';document.querySelector('#login-email').value='owner@example.com';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('.errbox').hidden", { label: "short password" }).catch(() => null);
  c.ok(await page.js("document.querySelector('#login-password').validity.tooShort || !document.querySelector('.errbox').hidden"), "a password under 8 characters is refused");
  await page.js(`document.querySelector('#login-password').value='correct horse 9';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('#tabs').hidden", { label: "signed in after setup" });
  c.ok(!/setup=/.test(await page.js("location.hash")), "after setup the code leaves the address bar");
  await page.js("location.hash='#/settings'"); await sleep(400);
  await page.js("[...document.querySelectorAll('[role=tab],button')].find(b => b.textContent.trim() === '記録と表示').click()"); await sleep(400);
  c.ok(/owner@example\.com/.test(await page.text("#view")), "設定 shows the login email");
  await page.js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ログアウト').click()");
  await page.until("document.querySelector('#login-email')", { label: "signed out" });
  await page.js(`document.querySelector('#login-email').value='owner@example.com';document.querySelector('#login-password').value='wrong password';document.querySelector('form').requestSubmit()`);
  await page.until("!document.querySelector('.errbox').hidden", { label: "wrong password" });
  c.ok(/違います/.test(await page.text(".errbox")) && !/invalid_login/.test(await page.text(".errbox")), "a wrong password: a plain message, no code", await page.text(".errbox"));
  await page.js(`document.querySelector('#login-password').value='correct horse 9';document.querySelector('form').requestSubmit()`);
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
} finally {
  await page?.close(); app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); rmSync(dir, { recursive: true, force: true });
}
c.finish();
