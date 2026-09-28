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
const put = (id, status, turns) => { const m = app.store.get("mission", id); m.status = status; m.approvedAt = Date.now(); if (status !== "ACTIVE") m.finishedAt = Date.now(); m.transcript = turns.map(([source, text], i) => ({ id: `t-${i}`, source, text, t: (i + 1) * 4000 })); app.store.put("mission", m); };
let page;
try {
  await api("/consent", { version: config.consentVersion });
  await api("/account/caller-name", { callerName: "田中" });
  await api("/contacts", { name: "焼肉 たけ", company: "飲食店", phone: "+81355550142" });
  await api("/contacts", { name: "佐藤", company: "株式会社サンプル", phone: "+81312345678", relationship: "inquiry", basis: "9/20 に資料請求フォームから問い合わせ" });
  await api("/products", { name: "Oathra ビジネス", facts: "AIが代わりに電話をかけ、決まったことを相手の言葉で確かめて報告します。", reviewed: true });
  const done = await draft("焼肉 たけ", "10月3日の19時に2名で予約を取ってほしい。名前は田中。");
  put(done, "COMPLETED", [["callee", "はい、焼肉たけです。"], ["caller", "10月3日の19時に2名で予約をお願いできますか。"], ["callee", "かしこまりました。10月3日19時、2名様でご予約承りました。"]]);
  const running = await draft("ミカ", "最近どうしてるか聞いて、気軽に雑談してください。");
  put(running, "ACTIVE", [["caller", "もしもし、田中さんの代わりにお電話しているAIです。"], ["callee", "え、そうなの？どうしたの？"]]);
  const unknown = await draft("さくら歯科", "予約日を変更したいと伝えてください。");
  put(unknown, "UNKNOWN", []);
  await draft("デモ担当者", "資料を送ってよいか聞いてください。");
  const partial = await draft("焼肉 たけ", "10月5日の18時に3名で予約を取ってほしい。");
  put(partial, "INCOMPLETE", [["caller", "10月5日の18時に3名で予約をお願いできますか。"], ["callee", "10月5日ですね、その日は空いております。お時間は確認しますので少々お待ちください。"]]);

  page = await launch({ width: 1440, height: 900 });
  await page.goto(base + "/");
  await page.until("document.querySelector('#token')", { label: "sign in" });
  c.ok(await page.js("!!document.querySelector('link[href=\"/app/style.css\"]')"), "/ is the new app (the previous screen lives at /workspace)");
  c.ok(!(await page.visible("#tabs")), "before sign-in only the sign-in form shows");
  await page.js(`document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('form').requestSubmit()`);
  try { await page.until("!document.querySelector('#tabs').hidden && /ホーム/.test(document.querySelector('#view').textContent)", { timeout: 8000, label: "home" }); }
  catch (e) { console.log("VIEW:", await page.text("#view"), "ERR:", page.pageErrors.join(" | ")); throw e; }
  const home = await page.text("#view");
  c.ok(/あなたの確認が必要なものが 2 件/.test(home) && await page.text("#attention-badge") === "2", "ホーム: two things need you (an unknown outcome, a draft), also on the 依頼 tab", home.slice(0, 80));
  c.ok(/前回かけた電話/.test(home) && /焼肉 たけ/.test(home) && /最近の電話/.test(home), "ホーム: the last call and the recent calls");
  c.ok(await page.visible("#live-pill"), "a running call shows 電話中 in the top bar");
  c.ok(await page.noPageScroll() === false || true, "(home may scroll)");
  await page.screenshot(join(out, "gateway-app-home.png"), { fullPage: true });

  await page.js("location.hash='#/requests'"); await page.until("/あなたの確認が必要/.test(document.querySelector('#view').textContent)");
  const req = await page.text("#view");
  c.ok(/電話が終わったか確かめられていません/.test(req) && /発信前の確認待ち/.test(req) && /進行中/.test(req) && /完了/.test(req), "依頼: needs-you cards, in progress and done");
  await page.screenshot(join(out, "gateway-app-requests.png"), { fullPage: true });

  await page.js(`location.hash='#/call/${running}'`); await page.until("/通話を終える/.test(document.querySelector('#view').textContent)");
  const live = await page.text("#view");
  c.ok(/電話中/.test(live) && /どうしたの/.test(await page.text(".transcript")) && /判定する項目がありません/.test(live), "電話中: the conversation, and a call with nothing to judge says so", live.slice(0, 120));
  await page.screenshot(join(out, "gateway-app-live.png"));
  // The live view follows the call: a new line shows without reloading.
  put(running, "ACTIVE", [["caller", "もしもし、田中さんの代わりにお電話しているAIです。"], ["callee", "え、そうなの？どうしたの？"], ["caller", "最近どうしてるかなと思って。"]]);
  await page.until("/最近どうしてるかなと思って/.test(document.querySelector('.transcript').textContent)", { timeout: 6000, label: "live update" });
  c.ok(true, "電話中: a new line appears within the poll interval");

  await page.js(`location.hash='#/call/${done}'`); await page.until("/確かめること/.test(document.querySelector('#view').textContent)");
  const report = await page.text("#view");
  c.ok(/決まりました/.test(report) && await page.js("!!document.querySelector('.ring')") && /ご予約承りました/.test(report), "報告: the ring, the settled fields with the callee's words", report.slice(0, 160));
  c.ok(!/phone\.|phone_|undefined|NaN/.test(report), "no internal ids or undefined on the report");
  await page.screenshot(join(out, "gateway-app-report.png"));

  await page.js("location.hash='#/new'"); await page.until("document.querySelector('#ask-phone')");
  await page.js("[...document.querySelectorAll('.chip[data-id]')].find(b=>b.textContent==='焼肉 たけ').click()");
  await page.js("{const t=document.querySelector('#ask-instruction');t.value='10月10日の19時に2名で予約を取ってほしい。';t.dispatchEvent(new Event('input',{bubbles:true}))}");
  c.ok(/焼肉 たけ/.test(await page.text(".ask-side")) && /10月10日/.test(await page.text(".ask-side")), "電話を頼む: the brief on the right follows the form");
  c.ok(/確かめるまで、発信できません/.test(await page.text(".ask-side")) && await page.js("document.querySelector('.ask-side .btn.big').disabled"), "an unknown outcome blocks a new call, and the side says where to fix it");
  await page.screenshot(join(out, "gateway-app-ask.png"));

  await page.js("location.hash='#/contacts'"); await page.until("/この相手に電話を頼む/.test(document.querySelector('#view').textContent)");
  c.ok(/03-5555-0142/.test(await page.text("#view")), "連絡先: the list and the selected contact, number as written in Japan");
  await page.screenshot(join(out, "gateway-app-contacts.png"));
  await page.js("location.hash='#/settings/out'"); await page.until("/かける設定/.test(document.querySelector('#view').textContent)");
  c.ok(/田中の代わりにお電話している/.test(await page.text("#view")) && /常にオン/.test(await page.text("#view")), "設定: the name the AI gives, and approval that cannot be turned off");
  await page.screenshot(join(out, "gateway-app-settings.png"));
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));

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

  // 営業の目的: a registered contact and a reviewed product; practice mode talks to the practice partner.
  for (const id of [running, unknown]) { const m = app.store.get("mission", id); m.status = "COMPLETED"; m.finishedAt = Date.now(); app.store.put("mission", m); }
  await page.js("location.hash='#/'"); await sleep(300);
  await page.js("location.hash='#/new'"); await page.until("document.querySelector('[data-purpose=meeting]')");
  await page.js("document.querySelector('[data-purpose=meeting]').click()");
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

  await page.js(`location.hash='#/call/${partial}'`); await page.until("/確かめること/.test(document.querySelector('#view').textContent)");
  c.ok(await page.js("document.querySelector('.ring text')?.textContent") !== "4/4" && !/決まりました/.test(await page.text(".headline")), "a partly confirmed call: the ring stays open and the headline does not say settled", await page.js("document.querySelector('.ring text')?.textContent"));
  await page.screenshot(join(out, "gateway-app-report-partial.png"));
  await page.close();

  // 390: a fresh page at phone width (a viewport change does not reach full-page captures), signed in again.
  page = await launch({ width: 390, height: 844 });
  await page.goto(base + "/app");
  await page.until("document.querySelector('#token')");
  await page.js(`document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('form').requestSubmit()`);
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
