import { createPublicAccess, createCreditPurchase, hasAccountLink, prereleaseNotice, prereleaseMessages } from '/phone/public-service.js';
'use strict';
// Oathra app (/app): ホーム・依頼・電話を頼む・電話中/報告・練習・連絡先・設定, from the design "Oathra App.dc.html".
// Plain JS, no inline script or style (CSP). Talks to the same /v1 API as the workspace and the phone page:
// a token signs in once and becomes a browser session cookie; nothing is kept in page storage but the theme.
// Nothing here decides an outcome: what was settled comes from the call record's memory (the evidence engine).

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : String(kid));
  return n;
};
// A line with the words that settled a field underlined and numbered (the field's number in 確かめること).
function marked(text, marks) {
  const p = el('p'); let rest = String(text);
  const hits = marks.filter(m => m.quote && m.quote.length < rest.length && rest.includes(m.quote)).sort((a, b) => rest.indexOf(a.quote) - rest.indexOf(b.quote));
  let at = 0;
  for (const m of hits) {
    const i = rest.indexOf(m.quote, at); if (i < 0) continue;
    p.append(rest.slice(at, i), el('mark', { class: 'proof' }, m.quote, el('sup', { text: String(m.n) }))); at = i + m.quote.length;
  }
  p.append(rest.slice(at));
  return p;
}
// A bar filled to a share (0–1). The width is set through the style object, which the CSP allows (no inline style).
function meter(share) { const pct = Math.max(0, Math.min(100, Math.round(share * 100))), i = el('i'); i.style.width = `${pct}%`; return el('div', { class: 'bar-meter', role: 'img', 'aria-label': `上限の${pct}%` }, i); }
// 00:24.310 — where a line sits in the call (the runtime's audio clock).
const clock = ms => { const t = Math.max(0, Math.round(ms)); return `${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`; };
// The AI saying it is done is never evidence: its lines that claim so are marked on screen (the verdict ignores them anyway).
const CLAIMS_DONE = /(できました|承りました|お取りしました|決まりました|完了しました|確定しました|booked|confirmed)/;
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

const ERRORS = {
  ...prereleaseMessages,
  unauthorized: 'トークンが違うか、期限が切れています。', invalid_token: 'トークンが違います。',
  cross_origin_request_denied: 'このページのアドレスが、サーバーの設定と違います。設定された公開アドレスから開いてください。',
  review_current_privacy_notice: '会話データの取り扱いへの同意が必要です。',
  approval_expired_or_used: '確認の有効期限が切れました。もう一度「内容を確かめる」を押してください。',
  mission_changed_review_again: '内容が変わりました。もう一度確かめてください。',
  voice_engine_unavailable: 'この声は、このサーバーではまだ使えません。標準の声を選んでください。',
  invalid_phone_request: '電話番号・相手の名前・頼むことを確かめてください（名前に数字や記号は使えません）。',
  invalid_caller_name: '名乗る名前は、数字や記号を入れずに40文字以内で入力してください。',
  practice_busy: '練習が混み合っています。しばらくしてからお試しください。', practice_ended: 'この練習は終わっています。', invalid_reply: '答えを500文字以内で入力してください。',
  invalid_login: 'メールアドレスかパスワードが違います。', password_length: 'パスワードは8文字以上にしてください。', login_link_expired: 'このリンクは使えません（期限切れか使用済み）。もう一度発行してください。',
  email_already_registered: 'このメールアドレスは、ほかのアカウントで使われています。', login_rate_limited: '試行が多すぎます。しばらく待ってからお試しください。', login_changed_retry: 'ログインの設定が変わりました。もう一度お試しください。', invalid_email: 'メールアドレスを確かめてください。',
  phone_service_preview_only: 'このサーバーは練習モードです。実際の電話はかけられません。',
  estimated_cost_exceeds_budget: '見込みの費用が、1回の上限を超えています。',
  insufficient_credits: 'クレジットが足りません。設定の「費用とクレジット」から追加できます。',
  purchase_account_blocked: '購入について運営が確認中のため、新しい発信を受け付けられません。設定の「費用とクレジット」で購入履歴を確認し、運営へお問い合わせください。',
  contact_name_or_company_required: '名前か会社名を入れてください。',
  contact_relationship_required: '営業の電話には、連絡先に「この相手との関係」（問い合わせ・既存のお客さま・同意済み）が必要です。連絡先で登録してください。',
  contact_basis_required: '営業の電話には、連絡先に「電話してよい根拠」が必要です。連絡先で書いてください。',
  select_one_reviewed_product: '紹介する商品を選んでください（設定の「商品」で登録できます）。',
  contact_has_active_call: 'この相手への電話が進行中です。終わってから削除してください。',
  invalid_contact_phone: '電話番号を確かめてください（例：090-1234-5678、03-5555-0142、+81 90-1234-5678）。',
  phone_has_trunk_prefix_after_country_code: '+81 のあとの最初の 0 は外してください（例：+81 90-1234-5678）。',
  select_one_contact: '連絡先から相手を選んでください。', contact_phone_required: 'この相手には電話番号がありません。',
  product_facts_require_review: '内容を確かめたことにチェックを入れてください。',
  unknown_practice_brain: 'このAIは、いまの起動では使えません。', unknown_practice_record: 'この記録は見つかりません。', unknown_practice: 'この練習は見つかりません。',
  invalid_inbound_hours: '受ける時間は「09:00」のように、始まりと終わりを違う時刻で入れてください。',
  invalid_inbound_mode: '受け方を選んでください。', verify_your_phone_first: '先に、自分の電話番号を確認してください（従来の画面の「自分の電話番号を確認する」）。',
  forward_not_available_with_credits: 'クレジット制のサーバーでは、あなたにつなぐ設定は使えません。',
  monthly_cap_reached: '今月の上限を超えるので、この電話はかけられません。設定の「費用とクレジット」で上限を見直せます。',
  invalid_monthly_cap: '月の上限は 0.01 以上の金額（米ドル）で入れてください。空にすると上限なしになります。',
  // 定期の電話・チーム・連絡先の取り込みと連絡停止
  schedule_recipient_must_be_contact: '定期の電話は、連絡先に保存した相手だけにかけられます。先に連絡先へ保存してください。',
  schedule_contact_basis_required: '定期の電話には、連絡先に「電話してよい根拠」（本人や家族の同意など）が必要です。連絡先に書いてから、もう一度お試しください。',
  schedule_time_outside_calling_hours: 'かける時刻は、電話してよい時間帯の中にしてください（決まりがなければ 7:00〜21:00）。夜間の時刻は登録できません。',
  care_schedule_requires_alert_webhook: 'ゆっくり・やさしく話す電話を定期にするには、要確認の知らせを受け取る通知先が必要です。このサーバーにはまだ設定がありません。管理者に設定を頼んでください。',
  schedule_cannot_reserve: '予約を取る電話は、定期にはできません。',
  schedule_end_required_within_92_days: '終了日は、明日から92日以内の日にしてください。',
  invalid_schedule_times: '時刻は「09:00」の形で、1〜4個、重ならないように入れてください。',
  invalid_schedule_weekdays: '曜日を1つ以上選んでください。', invalid_schedule_retries: 'かけ直しは0〜3回、間隔は10〜180分で選んでください。',
  recipient_suppressed: 'この相手は連絡停止中です。電話はかけられません。',
  schedule_limit: '定期の電話が上限（200件）に達しています。使っていないものを終了してください。',
  privacy_consent_required: '会話データの取り扱いへの同意が必要です。「電話を頼む」で同意してから、もう一度お試しください。',
  explicit_schedule_approval_required: '決まりを読んだことにチェックを入れてください。',
  schedule_ended: 'この定期の電話は、すでに終了しています。', idempotency_conflict: '内容が変わりました。もう一度お試しください。',
  recipient_opted_out: '相手が通話中にボタンを押して連絡を止めたため、解除できません。', not_suppressed: 'この相手は、連絡停止になっていません。',
  batch_1_to_100_contacts: '名簿は1〜100人で作ってください。', batch_has_no_callable_contact: 'かけられる相手がいません。連絡先の電話番号・関係・根拠を確かめてください。',
  batch_cannot_reserve: '予約を取る電話は、名簿ではかけられません。', invalid_batch_retry: 'かけ直しは0〜2回、間隔は30分〜24時間で選んでください。',
  explicit_batch_approval_required: '決まりを読んだことにチェックを入れてください。', batch_ended: 'この名簿は、すでに終わっています。',
  insufficient_connection_credits: 'クレジットが足りません。設定の「費用とクレジット」から追加できます。', outside_calling_hours: '電話をかけてよい時間の外です。',
  callback_already_done: 'この依頼は、すでに折り返し済みです。',
  supervisor_required: 'この操作は、管理者かマネージャーだけができます。', release_reason_required: '解除する理由を5〜300文字で書いてください。',
  suppression_confirmation_required: '確かめたことにチェックを入れてください。', import_1_to_500_rows: '一度に取り込めるのは1〜500件です。',
  invalid_contact_row: '読み取れない行です。列の名前と内容を確かめてください。',
};
// A screen that shows at once and fills in when its data arrives. A late answer never lands on a screen the person
// has since left (the same version guard as route()); a failed read offers the read again.
function loadInto(box, load, draw) {
  const version = routeVersion;
  const run = async () => {
    const turn = box.reading = {};
    const left = () => version !== routeVersion || box.reading !== turn;
    box.setAttribute('aria-busy', 'true');
    if (!box.firstChild) box.replaceChildren(el('p', { class: 'muted', role: 'status', text: '読み込んでいます…' }));
    try { const data = await load(); if (left()) return; box.removeAttribute('aria-busy'); box.replaceChildren(...[draw(data)].flat()); }
    catch (e) {
      if (left() || e.stale) return;
      box.removeAttribute('aria-busy');
      if (e.status === 401) { app.boot = null; return renderLogin(); }
      box.replaceChildren(el('p', { class: 'errbox', role: 'alert', text: e.message }), el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'もう一度読み込む', onclick: run })));
    }
  };
  run();
  return box;
}
const isSupervisor = () => ['manager', 'admin'].includes(app.boot?.user?.role);
let sessionOwner = null, sessionEpoch = 0;
function sessionChanged() {
  ++sessionEpoch; ++routeVersion;
  clearTimeout(app.timer);
  app.boot = null; app.history = []; app.status = null; app.contactSel = null;
  $('#tabs').hidden = true; $('#bar-right').hidden = true; prereleaseBanner.hidden = true;
  $('#view').replaceChildren(el('div', { class: 'page' }, el('p', { role: 'status', text: 'ログイン状態が変わりました。画面を読み直しています…' })));
  // Recreate all forms under the current cookie; never submit old-account inputs under a new owner.
  history.replaceState(null, '', '/app/' + location.search + '#/');
  location.reload();
}
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const epoch = sessionEpoch;
  let r;
  try {
    r = await fetch('/v1' + path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { ...(sessionOwner ? { 'x-oathra-account': sessionOwner } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch (cause) {
    if (epoch !== sessionEpoch) throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true });
    const readOnlyRetry = ['GET', 'HEAD'].includes(method);
    throw Object.assign(new Error(readOnlyRetry
      ? '接続を確認できませんでした。通信を確認して、もう一度お試しください。'
      : '応答を確認できませんでした。保存や送信の結果が不明です。履歴や現在の状態を確認してください。', { cause }), { readOnlyRetry });
  }
  let value = null; try { value = await r.json(); } catch { /* not JSON */ }
  if (epoch !== sessionEpoch) throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true });
  if (sessionOwner && (r.status === 401 || value?.error === 'session_account_changed')) sessionChanged();
  if (!r.ok) { const e = new Error(ERRORS[value?.error] ?? `うまくいきませんでした。少し待ってもう一度お試しください。（問い合わせ用コード：${value?.error ?? r.status}）`); e.status = r.status; e.code = value?.error; e.readOnlyRetry = ['GET', 'HEAD'].includes(method); throw e; }
  return value;
}
let toastTimer;
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

// ---------------------------------------------------------------- theme (light by default, ?theme=dark remembered)
(() => {
  let theme = new URLSearchParams(location.search).get('theme');
  try { if (theme === 'light' || theme === 'dark') localStorage.setItem('oathra.theme', theme); else theme = localStorage.getItem('oathra.theme'); } catch { /* storage may be off */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
})();

// ---------------------------------------------------------------- words
const FIELD = { date: '日付', time: '時刻', partySize: '人数', price: '料金', confirmed: '相手の確認', breakfast: '朝食', smoking: '喫煙', serial: 'シリアル番号',
  meeting_agreed_on_call: '商談の日時', material_send_allowed: '資料を送ってよいか', presentation_acknowledged: '説明を聞いてもらえたか' };
const fmtValue = (field, v) => ['confirmed', 'material_send_allowed', 'presentation_acknowledged'].includes(field) ? (v ? 'はい' : 'いいえ')
  : ['breakfast', 'smoking'].includes(field) ? (v ? 'あり' : 'なし') : field === 'partySize' ? `${v}名` : field === 'price' ? `${Number(v).toLocaleString('ja-JP')}円`
  : field === 'date' ? fmtDate(v) : field === 'meeting_agreed_on_call' ? fmtMeeting(v) : String(v);
function fmtMeeting(v) { const d = new Date(v); return isNaN(d) ? String(v) : `${fmtDate(new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10))} ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}`; }
// A sales call (商談・資料・説明) as the same record shape as a phone request; its one field comes from the sales verdict.
const SALES_FIELD = { meeting: 'meeting_agreed_on_call', materials: 'material_send_allowed', introduce: 'presentation_acknowledged' };
const SALES_STATE = { DRAFT: 'draft', QUEUED: 'starting', DIALING: 'starting', ACTIVE: 'running', CANCEL_REQUESTED: 'stopping', UNKNOWN: 'unknown', FAILED: 'failed' };
function fromSales(m) {
  const field = SALES_FIELD[m.goal], value = m.result?.verified?.[field], quote = (m.result?.evidence ?? []).find(e => e.field === field)?.quote;
  return { id: m.id, sales: true, goal: m.goal, product: m.product, practice: m.mode === 'simulator', direction: 'outbound', request: { name: m.target?.name ?? '', phone: m.target?.phone ?? '', instruction: m.request ?? '' },
    state: SALES_STATE[m.status] ?? (m.status === 'HANDOFF_PENDING' || m.status === 'HANDOFF_ACTIVE' ? 'running' : 'ended'), createdAt: new Date(m.createdAt).toISOString(),
    transcript: m.transcript ?? [], error: m.error, creditUsage: m.creditUsage, doNotContact: m.result?.doNotContact === true,
    memory: field ? { notes: [{ field, status: value !== undefined ? 'verified' : 'missing', ...(value !== undefined ? { value } : {}), ...(quote ? { quote } : {}) }] } : { notes: [] } };
}
function fmtDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); if (!m) return String(v); const d = new Date(`${v}T00:00:00+09:00`); return `${Number(m[2])}月${Number(m[3])}日（${'日月火水木金土'[d.getDay()]}）`; }
// A Japanese number as people write it: 090-1234-5678, 03-5555-0142, 0120-123-456. Others stay as dialled.
function displayPhone(p) {
  if (!/^\+81\d{9,10}$/.test(p || '')) return p || '';
  const d = `0${p.slice(3)}`;
  if (/^0[5789]0/.test(d) && d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0120|^0800/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (/^0[36]/.test(d) && d.length === 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
}
const when = iso => { const d = new Date(iso); if (isNaN(d)) return ''; const today = new Date(); const same = d.toDateString() === today.toDateString(); return same ? `今日 ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : `${d.getMonth() + 1}月${d.getDate()}日`; };
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const LIVE = ['starting', 'running', 'stopping'];
// A wellbeing call is read by what was said (its check-in); a date the memory only guessed at is not a thing to settle.
const notesOf = r => (r.memory?.notes ?? []).filter(n => FIELD[n.field] && (!r.checkIn || n.status === 'verified'));
function outcome(r) {
  const notes = notesOf(r), ok = notes.filter(n => n.status === 'verified').length;
  if (r.state === 'draft') return { text: '発信前の確認待ち', tone: 'warn' };
  if (r.state === 'unknown') return { text: '終わったか確かめられていません', tone: 'warn' };
  if (LIVE.includes(r.state)) return { text: '電話中', tone: 'live' };
  if (r.state === 'failed') return { text: 'つながらなかった・途中で終了', tone: 'dim' };
  if (r.direction === 'inbound') return { text: '用件を聞きました', tone: 'warn' };
  if (unanswered(r)) return { text: '応答がありませんでした', tone: 'warn' };
  if (r.doNotContact) return { text: '今後は連絡しないでほしい、と言われました', tone: 'dim' };
  if (r.request?.conversationMode === 'chat') return { text: '話しました', tone: '' };
  if (r.checkIn?.answered && !notes.length) { const level = attentionOf(r); return { text: level === 'emergency' ? '緊急の確認があります' : level ? '要確認があります' : '話を聞きました', tone: level ? 'warn' : '' }; }
  if (notes.length && ok === notes.length) return { text: '決まりました', tone: 'ok' };
  if (ok) return { text: '一部だけ確かめられました', tone: 'warn' };
  if (notes.length) return { text: '決まりませんでした', tone: 'dim' };
  return { text: '電話が終わりました', tone: '' };
}
// A wellbeing or standing call that nobody answered: that is itself what the call found.
const unanswered = r => r.answered === false && Boolean(r.checkIn || r.scheduled);
const isPaused = configuration => configuration?.prerelease?.enabled && configuration.prerelease.paused;
const needsYou = r => (r.state === 'unknown' && !r.resolvedAt) || r.state === 'draft';

// ---------------------------------------------------------------- state
const app = { boot: null, history: [], status: null, templates: [], contactSel: null, settingsTab: 'out', timer: null };
const prereleaseBanner = el('div', { class: 'public-prerelease-wrap', hidden: true });
$('#view').before(prereleaseBanner);
async function loadAll() {
  const boot = await api('/bootstrap');
  if (sessionOwner && sessionOwner !== boot.user.id) { sessionChanged(); throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true }); }
  sessionOwner = boot.user.id;
  const [history, month] = await Promise.all([api('/phone/history'), api('/account/month')]);
  app.boot = boot; app.month = month;
  const notice = prereleaseNotice(boot.configuration?.prerelease, undefined, { compact: true });
  const conditions = notice.querySelector('summary');
  if (conditions) conditions.textContent = '利用条件';
  const pauseMessage = notice.querySelector(':scope > p');
  if (isPaused(boot.configuration) && pauseMessage) pauseMessage.textContent = '発信・登録・購入は停止中です。履歴と残高は確認できます。';
  prereleaseBanner.replaceChildren(notice);
  prereleaseBanner.hidden = !boot.configuration?.prerelease?.enabled;
  app.history = [...history, ...boot.missions.filter(m => m.kind !== 'phone-request').map(fromSales)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderBar();
}
function renderBar() {
  const need = app.history.filter(needsYou).length, live = app.history.find(r => LIVE.includes(r.state));
  $('#attention-badge').hidden = !need; $('#attention-badge').textContent = String(need);
  $('#live-pill').hidden = !live;
  if (live) { $('#live-pill').href = `#/call/${live.id}`; $('#live-pill-time').textContent = `・${live.request.name} ${mmss((Date.now() - Date.parse(live.createdAt)) / 1000)}`; }
}

// ---------------------------------------------------------------- router
const routes = { '': home, requests, schedule, new: ask, call, practice, contacts, settings, standing, team: (id) => id ? call(id, undefined, true) : team(), lists: (id) => id === 'new' ? listNew() : lists(), callbacks };
let routeVersion = 0;
function renderRouteError(view, error) {
  const retry = error.readOnlyRetry === false ? el('a', { class: 'btn primary', href: '#/', text: 'ホームで状態を確認' }) : el('button', { class: 'btn primary', type: 'button', text: 'もう一度読み込む', onclick: async () => {
    retry.disabled = true; retry.textContent = '読み込んでいます…'; await route();
  } });
  view.replaceChildren(el('div', { class: 'page' },
    el('h1', { text: '画面を読み込めませんでした' }),
    el('p', { class: 'errbox', role: 'alert', text: error.message }), retry));
}
async function route() {
  const version = ++routeVersion;
  const current = () => version === routeVersion;
  clearTimeout(app.timer);
  if (hasAccountLink()) return renderLogin();
  // A sign-in link from `oathra demo` (another device): the token rides in the fragment, never in a request line.
  const linked = /^#token=([A-Za-z0-9_-]{32,128})$/.exec(location.hash)?.[1];
  if (linked) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    try { await signIn('/v1/session', {}, { Authorization: 'Bearer ' + linked }); app.boot = null; }
    catch (e) { if (current()) { renderLogin('token'); toast(e.message); } return; }
    if (!current()) return;
  }
  const paymentReturn = new URLSearchParams(location.search).has('purchase');
  const routeHash = paymentReturn && !location.hash ? '#/settings/cost' : location.hash;
  const [name = '', id, sub] = routeHash.split('?')[0].replace(/^#\/?/, '').split('/');
  const view = $('#view');
  for (const a of document.querySelectorAll('[data-tab]')) {
    const tab = a.dataset.tab, on = tab === (name || 'home') || (tab === 'requests' && ['new', 'call', 'standing', 'team', 'lists', 'callbacks'].includes(name) && !(name === 'lists' && id === 'new')) || (tab === 'contacts' && name === 'lists' && id === 'new');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!app.boot) {
    try { await loadAll(); }
    catch (e) {
      if (!current()) return;
      if (e.status === 401) return renderLogin();
      renderRouteError(view, e); return;
    }
  }
  if (!current()) return;
  document.body.classList.add('workspace-active');
  $('#tabs').hidden = false; $('#bar-right').hidden = false;
  const render = routes[name] ?? home;
  try {
    const content = await render(id, sub);
    // An older request may finish after the person has chosen another screen.
    if (current()) view.replaceChildren(content);
  } catch (e) {
    if (!current()) return;
    if (e.status === 401) { app.boot = null; return renderLogin(); }
    renderRouteError(view, e);
  }
}
window.addEventListener('hashchange', () => { route(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- voice samples
// Recorded samples of GPT-Live's voices (served with Range for Safari). One plays at a time.
let sampleAudio = null;
function sampleButton(url, label = '声を聞く') {
  const b = el('button', { class: 'btn small sample', type: 'button', 'aria-pressed': 'false', text: '▶ ' + label });
  const stop = () => { sampleAudio?.pause(); document.querySelectorAll('.sample[aria-pressed="true"]').forEach(n => { n.setAttribute('aria-pressed', 'false'); n.textContent = n.textContent.replace(/^■ 止める/, '▶ ' + (n.dataset.label ?? '声を聞く')); }); sampleAudio = null; };
  b.dataset.label = label;
  b.addEventListener('click', () => {
    const again = sampleAudio?.dataset.url === b.dataset.url; stop(); if (again) return;
    const audio = new Audio(b.dataset.url); audio.dataset.url = b.dataset.url; sampleAudio = audio;
    b.setAttribute('aria-pressed', 'true'); b.textContent = '■ 止める';
    audio.addEventListener('ended', stop); audio.play().catch(() => { stop(); toast('音声を再生できませんでした。'); });
  });
  b.dataset.url = url ?? ''; b.hidden = !url;
  return b;
}

// ---------------------------------------------------------------- sign in
// Email and password for everyone; the operator token stays for the administrator (setup, API, channels).
// A #setup=<code> link (from 設定, or the administrator's login-setup) sets the password.
async function signIn(path, body, headers = {}) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!r.ok) { const v = await r.json().catch(() => ({})); throw new Error(ERRORS[v.error] ?? `ログインできませんでした。（問い合わせ用コード：${v.error ?? r.status}）`); }
  ++sessionEpoch; sessionOwner = null;
}
function renderLogin(mode = 'email') {
  ++sessionEpoch; sessionOwner = null;
  app.boot = null; app.history = []; app.status = null; app.contactSel = null;
  document.body.classList.remove('workspace-active');
  prereleaseBanner.hidden = true;
  $('#tabs').hidden = true; $('#bar-right').hidden = true;
  const done = async () => {
    ++sessionEpoch; sessionOwner = null;
    app.status = null; app.contactSel = null;
    app.boot = null;
    const next = new URLSearchParams(location.search).has('purchase') ? '#/settings/cost' : '#/';
    history.replaceState(null, '', location.pathname + location.search + next);
    await route();
  };
  let form;
  if (mode === 'token' && !hasAccountLink()) {
    const err = el('p', { class: 'errbox', role: 'alert', hidden: true });
    const input = el('input', { type: 'password', id: 'token', autocomplete: 'off', required: true, 'aria-describedby': 'token-help' });
    const submit = el('button', { class: 'btn primary big', type: 'submit', text: 'ログイン' });
    form = el('form', { class: 'card login stack', onsubmit: async e => {
      e.preventDefault(); if (submit.disabled) return; submit.disabled = true; err.hidden = true;
      try { await signIn('/v1/session', {}, { Authorization: 'Bearer ' + input.value.trim() }); await done(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      finally { input.value = ''; submit.disabled = false; }
    } },
      el('h1', { class: 'section-h', text: '管理者のトークンでログイン' }),
      el('label', { class: 'lbl', for: 'token', text: 'トークン' }), input,
      el('p', { class: 'note', id: 'token-help', text: 'サーバー管理者用のログインです。通常の利用にはメールアドレスをお使いください。' }),
      err, submit, el('button', { class: 'link', type: 'button', text: 'メールアドレスでログイン', onclick: () => renderLogin('email') }));
  } else {
    const access = createPublicAccess({ api, onSignedIn: done, operatorLogin: () => renderLogin('token'), showOverview: true });
    form = el('div', { class: 'login-entry' }, access.node);
  }
  $('#view').replaceChildren(el('div', { class: 'page' }, form));
  // Opening the page must not summon a mobile keyboard before the service state can be read.
  if (mode === 'token') form.querySelector('input:not(:disabled)')?.focus();
}

// ---------------------------------------------------------------- ホーム
async function home() {
  await loadAll();
  const b = app.boot, hist = app.history, need = hist.filter(needsYou);
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const thisMonth = hist.filter(r => Date.parse(r.createdAt) >= month.getTime() && r.state !== 'draft');
  const settled = thisMonth.filter(r => { const n = notesOf(r); return n.length && n.every(x => x.status === 'verified'); }).length;
  const last = hist.find(r => r.direction !== 'inbound' && !needsYou(r) && !LIVE.includes(r.state));
  const page = el('div', { class: 'page home-page' },
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: 'ホーム' }), el('p', { class: 'page-intro', text: '依頼の状況と、相手の言葉から確かめられたこと。' })), el('time', { class: 'sub', text: new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }) })));
  if (need.length) page.append(el('div', { class: 'attention', role: 'status' }, el('span', { class: 'dot' }), el('span', { text: `あなたの確認が必要な依頼が ${need.length} 件あります` }), el('a', { class: 'btn', href: '#/requests', text: '確認する' })));
  const credit = b.credits?.enabled
    ? el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: 'クレジット残高' })), el('div', { class: 'metric-v', text: String(b.credits.available ?? 0) }),
      el('p', { class: 'note', text: b.credits.held ? `確保中 ${b.credits.held}` : '本番の電話1回ごとに、承認のときに確保して終わったら精算します。' }), el('a', { class: 'btn', href: '#/settings/cost', text: 'クレジットと費用' }))
    : app.month.capUsd !== null
      ? el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: '今月の費用（見込みの上限）' }), el('span', { class: 'num', text: `${new Date(app.month.since).getMonth() + 1}月` })),
        el('div', { class: 'metric-v' }, `$${app.month.usedUsd.toFixed(2)}`, el('span', { class: 'muted small', text: ` / 上限 $${app.month.capUsd}` })),
        meter(app.month.usedUsd / app.month.capUsd),
        el('p', { class: 'note', text: '承認した電話の、費用の見込みの上限の合計です。これを超える電話は承認できません。' }))
      : el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: '費用の上限' })), el('div', { class: 'metric-v', text: `$${b.configuration.maxCallUsd}` }),
        el('p', { class: 'note', text: `1回の電話あたりの上限（米ドル）。通話は最長${Math.round(b.configuration.maxSeconds / 60)}分で切ります。月の上限は設定で決められます。` }), el('a', { class: 'btn', href: '#/settings/cost', text: '月の上限を決める' }));
  const main = el('div', { class: 'home-main' });
  if (last) {
    const notes = notesOf(last).filter(n => n.status === 'verified' && n.field !== 'confirmed');
    const evidence = notes.find(n => n.quote);
    main.append(el('section', { class: 'card latest-report', 'aria-label': '最新の報告' },
      el('div', { class: 'metric-k' }, el('h2', { class: 'section-h', text: '最新の報告' }), el('time', { text: when(last.createdAt) })),
      el('p', { class: 'report-recipient' }, last.request.name, el('span', { class: 'tag', text: last.practice ? '練習' : '本番' })),
      el('h3', { class: 'headline', text: outcome(last).text }),
      el('p', { class: 'latest-request', text: splitScope(last.request.instruction).body.slice(0, 120) + (splitScope(last.request.instruction).body.length > 120 ? '…' : '') }),
      el('dl', { class: 'defs' },
        ...(notes.length ? [el('dt', { text: '決まったこと' }), el('dd', { text: notes.map(n => fmtValue(n.field, n.value)).join('・') })] : []),
        ...(last.billing?.durationSeconds ? [el('dt', { text: '通話時間' }), el('dd', { class: 'num', text: mmss(last.billing.durationSeconds) })] : [])),
      evidence ? el('blockquote', { class: 'latest-proof' }, el('span', { text: '相手の言葉' }), el('p', { text: evidence.quote })) : null,
      el('div', { class: 'actions' }, el('a', { class: 'btn primary', href: `#/call/${last.id}`, text: '報告を開く' }), el('a', { class: 'btn', href: `#/new?again=${last.id}`, text: '同じ相手にまた頼む' }))));
  } else main.append(el('section', { class: 'card latest-report' }, el('h2', { text: 'まだ報告はありません' }), el('p', { class: 'about', text: '電話の依頼を作り、相手・用件・費用を確認してから発信を承認します。終わったら、この画面で報告を確認できます。' }), el('a', { class: 'btn primary', href: '#/new', text: '依頼の内容を入力' })));
  main.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '最近の依頼' }), el('a', { class: 'link', href: '#/requests', text: 'すべて見る' })), callRows(hist.filter(r => r.state !== 'draft').slice(0, 5), 'まだ依頼はありません。'));
  const paused = isPaused(b.configuration);
  const side = el('aside', { class: 'home-side', 'aria-label': '利用状況' },
    el('section', { class: 'service-status' }, el('h2', { class: 'section-h', text: '発信の状態' }),
      el('p', { class: 'service-state', text: paused ? '受付停止中' : b.configuration.mode === 'live' && b.configuration.liveReady ? '発信できます' : b.configuration.mode === 'live' ? '設定待ち' : '練習モード' }),
      el('p', { class: 'note', text: paused ? '新しい発信は一時停止しています。保存済みの依頼と報告は確認できます。' : b.configuration.mode === 'live' ? `発信元 ${displayPhone(b.configuration.callerId)}` : '実際の電話はかかりません。' }), el('a', { class: 'link', href: '#/settings', text: '発信の設定を見る' })),
    credit,
    el('section', { class: 'monthly-activity' }, el('h2', { class: 'section-h', text: '今月の依頼' }),
      el('div', { class: 'split' }, el('div', {}, el('b', { text: String(thisMonth.filter(r => r.direction !== 'inbound').length) }), el('span', { text: '発信の依頼' })), el('div', {}, el('b', { text: String(thisMonth.filter(r => r.direction === 'inbound').length) }), el('span', { text: '着信の記録' }))),
      el('p', { class: 'note' }, el('span', { class: 'tick', text: '✓' }), ` 相手の言葉で決まったもの ${settled} 件`), el('p', { class: 'note', text: '発信の依頼には、接続前に終了したものも含みます。' })),
    el('section', { class: 'home-guide' }, el('h2', { class: 'section-h', text: '下書きをAIと作る' }), el('p', { class: 'note', text: 'Claude Code・ChatGPTから依頼を準備できます。発信の承認は、このアプリで行います。' }), el('a', { class: 'link', href: '/connect', text: 'AIとの接続を設定' })));
  page.append(el('div', { class: 'home-layout' }, main, side));
  return page;
}
function callRows(list, emptyText) {
  if (!list.length) return el('div', { class: 'rows' }, el('p', { class: 'empty', text: emptyText }));
  return el('div', { class: 'rows' }, ...list.map(r => {
    const o = outcome(r);
    return el('a', { class: 'row', href: `#/call/${r.id}` },
      el('div', {}, el('div', { class: 'who' }, r.request.name, el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : r.practice ? '練習' : '本番' })), el('div', { class: 'what', text: splitScope(r.request.instruction).body.slice(0, 60) })),
      el('div', { class: `outcome ${o.tone === 'warn' ? 'warn' : o.tone === 'dim' ? 'dim' : ''}` }, o.tone === 'ok' ? el('span', { class: 'tick', text: '✓' }) : null, o.text),
      el('time', { class: 'num', datetime: r.createdAt, text: when(r.createdAt) }));
  }));
}

// ---------------------------------------------------------------- 依頼
async function requests() {
  await loadAll();
  // People who could not get through and asked for a call back: the open count, when there is one (never blocks the page).
  const callbackOpen = (await api('/callbacks').catch(() => null))?.open ?? 0;
  const need = app.history.filter(needsYou), live = app.history.filter(r => LIVE.includes(r.state)), done = app.history.filter(r => !needsYou(r) && !LIVE.includes(r.state));
  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '依頼' }), el('p', { class: 'page-intro', text: '発信前の確認と、終わった電話の報告をまとめています。' })),
    el('div', { class: 'actions page-actions' }, el('a', { class: 'btn', href: '#/standing', text: '定期の電話' }), el('a', { class: 'btn', href: '#/lists', text: '名簿の電話' }),
      el('a', { class: 'btn', href: '#/callbacks' }, '折り返しの依頼', callbackOpen ? el('span', { class: 'badge', 'aria-label': `未対応 ${callbackOpen}件`, text: String(callbackOpen) }) : null), isSupervisor() ? el('a', { class: 'btn', href: '#/team', text: 'チームの電話' }) : null)));
  page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'あなたの確認が必要' }), need.length ? el('span', { class: 'sub', text: `${need.length}件` }) : null));
  page.append(need.length ? el('div', { class: 'need' }, ...need.map(needCard)) : el('p', { class: 'muted', text: '確認が必要なものはありません。' }));
  if (live.length) { page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '進行中' }))); page.append(callRows(live, '')); }
  page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '終了した電話' }), el('span', { class: 'sub', text: '相手の言葉を確かめるには、各報告を開きます'  })));
  page.append(callRows(done, 'まだ終わった電話はありません。'));
  // The same session cookie as the calendar file: a plain link, saved by the browser.
  if (done.length) page.append(el('div', { class: 'actions' }, el('a', { class: 'btn', href: '/v1/calls.csv', download: 'oathra-calls.csv', text: '電話の記録をCSVで保存' })),
    el('p', { class: 'note', text: 'あなたが頼んだ電話の一覧です（相手・電話番号・結果・応答）。会話の内容は含みません。保存したことは記録されます。' }));
  return page;
}
function needCard(r) {
  if (r.state === 'unknown') {
    return el('div', { class: 'card warn' }, el('div', {},
      el('div', { class: 'k' }, el('span', { class: 'attention-dot dot' }), '電話が終わったか確かめられていません'),
      el('h3', { text: `${r.request.name}　${r.request.instruction.slice(0, 24)}` }),
      el('p', { class: 'note', text: `${when(r.createdAt)} · 途中で接続が切れました。通話会社の記録で終わったことを確かめてから押してください。` })),
      el('button', { class: 'btn', type: 'button', text: '確かめました', onclick: async () => {
        if (!confirm('通話会社の記録で、この電話が終わっていることを確かめましたか？')) return;
        try { await api(`/missions/${r.id}/reconcile`, { method: 'POST', body: { acknowledged: true } }); toast('確認しました。'); await route(); } catch (e) { toast(e.message); }
      } }));
  }
  return el('div', { class: 'card' }, el('div', {},
    el('div', { class: 'k dim', text: '発信前の確認待ち' }),
    el('h3', { text: `${r.request.name}　${r.request.instruction.slice(0, 24)}` }),
    el('p', { class: 'note', text: `${when(r.createdAt)} に作成 · あなたが承認するまで電話はかかりません。` })),
    el('a', { class: 'btn primary', href: `#/new?draft=${r.id}`, text: '内容を見る' }));
}

// ---------------------------------------------------------------- 電話を頼む
// 任せる範囲 (design: Oathra App.dc.html). Written into the instruction as plain words, so the engine and the
// saved request carry it with no schema change; the verdict still comes only from the other party's words.
const SCOPE_HEAD = '【任せる範囲】', SCOPE_OK = 'その場で決めてよい：', SCOPE_HOLD = '決めずに持ち帰る（相手に「確認して折り返します」と伝える）：', SCOPE_NEVER = 'しない：';
const OK_SUGGEST = ['時間は第一希望から2時間以内', '席の種類はどれでも', '人数を1名増やすのは可'];
const HOLD_SUGGEST = ['日付を変える案', 'コースや前金が必要と言われた', 'キャンセル料の話'];
const NEVER_DO = ['支払い・カード番号を伝える', 'AIであることを隠す'];
function splitScope(text) {
  const [body, scope = ''] = String(text ?? '').split('\n\n' + SCOPE_HEAD);
  const pick = head => (scope.split('\n').find(l => l.startsWith(head))?.slice(head.length) ?? '').split('、').map(s => s.trim()).filter(Boolean);
  return { body, ok: scope ? pick(SCOPE_OK) : [], hold: scope ? pick(SCOPE_HOLD) : HOLD_SUGGEST.slice(0, 2) };
}
function withScope(body, ok, hold) {
  const lines = [body.trim(), '', SCOPE_HEAD];
  if (ok.length) lines.push(SCOPE_OK + ok.join('、'));
  if (hold.length) lines.push(SCOPE_HOLD + hold.join('、'));
  lines.push(SCOPE_NEVER + NEVER_DO.join('、'));
  return lines.join('\n').slice(0, 2000);
}

async function ask() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  // Fresh state: a call that just ended or was confirmed must not keep blocking the next one.
  await loadAll();
  if (!app.status) [app.status, app.templates] = await Promise.all([api('/phone/status'), api('/phone/templates')]);
  const st = app.status, b = app.boot, contacts = b.contacts.filter(c => c.phone);
  const from = app.history.find(r => r.id === (params.get('again') || params.get('draft')));
  const pre = from?.request ?? {}, preContact = params.get('contact') ? b.contacts.find(c => c.id === params.get('contact')) : null;
  const form = { phone: pre.phone ?? preContact?.phone ?? '', name: pre.name ?? preContact?.name ?? preContact?.company ?? '', instruction: pre.instruction ?? '', mode: pre.conversationMode ?? '', preset: pre.voicePreset ?? '', voiceName: pre.voice ?? '', engine: pre.engine ?? '',
    purpose: from?.sales ? from.goal : pre.conversationMode === 'chat' ? 'chat' : '', contactId: preContact?.id ?? (from ? b.contacts.find(c => c.phone === pre.phone)?.id : undefined) ?? null, productId: from?.product?.id ?? b.products[0]?.id ?? '' };
  const scoped = splitScope(form.instruction); form.instruction = scoped.body; form.ok = scoped.ok; form.hold = scoped.hold;
  let review = null, suggested = !form.instruction;
  // Purposes: a request in plain words, a chat, or one of the sales goals (a registered contact and a reviewed product).
  // What kind of call: grouped the way people think of them. A template kind brings fields for its {{…}} blanks;
  // the sales kinds need a contact and a product; 自由に書く is a request in plain words.
  const GROUPS = [['shop', 'お店・窓口', ['reserve', 'availability', 'opening-hours', 'stock', 'delivery', 'lost-property', 'change-policy', 'business-contact']],
    ['people', '知り合い', ['friend-check-in', 'meetup', 'late', 'callback', 'thanks', 'chat', 'ai-news']],
    ['care', '見守り・介護', ['wellbeing-check', 'medication-reminder', 'visit-notice']], ['trade', '取引先への確認', ['delivery-date', 'quote-request']], ['work', '仕事（営業）', ['meeting', 'materials', 'introduce']], ['free', '自由に書く', ['']]];
  const SALES_TITLE = { meeting: '商談の日時を決める', materials: '資料を送ってよいか聞く', introduce: '商品を説明する' };
  const kindTitle = k => k === '' ? '自由に書く' : SALES_TITLE[k] ?? app.templates.find(t => t.id === k)?.title?.ja ?? k;
  const tpl = () => app.templates.find(t => t.id === form.kind);
  const blanks = () => [...new Set([...(tpl()?.instruction?.ja ?? '').matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]))];
  form.kind = from?.sales ? from.goal : pre.task === 'reservation' ? 'reserve' : pre.conversationMode === 'chat' ? (pre.instruction && pre.instruction === app.templates.find(t => t.id === 'ai-news')?.instruction?.ja ? 'ai-news' : 'chat') : (params.get('kind') ?? '');
  form.fill = {};
  // ゆっくり・やさしく: on for the kinds made for it (見守り, お薬の声かけ) and for a request that was saved with it.
  form.pace = pre.pace === 'gentle' || (!from && app.templates.find(t => t.id === form.kind)?.pace === 'gentle');
  const SALES_TEXT = { meeting: n => `${n}に商品を説明して、興味があれば15分の商談の日時を相談してください。`, materials: n => `${n}に商品を簡単に説明して、資料を送ってよいか聞いてください。`, introduce: n => `${n}に商品を簡単に説明してください。` };
  const isSales = () => Boolean(SALES_TEXT[form.purpose]);
  if (tpl()) { form.mode = tpl().conversationMode ?? ''; if (form.kind === 'chat') form.purpose = 'chat'; }
  if (SALES_TEXT[form.kind]) form.purpose = form.kind;
  const setKind = k => { form.kind = k; form.purpose = SALES_TEXT[k] ? k : k === 'chat' ? 'chat' : ''; form.mode = tpl()?.conversationMode ?? ''; form.fill = {}; form.pace = tpl()?.pace === 'gentle'; gentle.checked = form.pace; suggested = true; drawKind(); syncEngine(); suggest(); changed(); };
  // 音声AI: which engine speaks, shown with its model (gpt-live-1, gemini-3.8-live). The acting voice is the slow one.
  const engineName = e => e.id === 'character-tts' ? '演技する声（Gemini TTS）' : e.label.replace(/\s*\((.+)\)$/, '（$1）');
  const engineNote = e => !e.ready ? '（このサーバーでは使えません）' : e.id === 'character-tts' ? ' · 返事まで2〜3秒' : ' · すぐ返事';
  const engineSel = el('select', { id: 'ask-engine', 'aria-describedby': 'ask-engine-note' }, ...(st.engines ?? []).map(e => el('option', { value: e.id, disabled: !e.ready, text: engineName(e) + engineNote(e) })));
  const firstReady = (st.engines ?? []).find(e => e.id === (form.engine || st.defaultEngine) && e.ready) ?? (st.engines ?? []).find(e => e.ready);
  engineSel.value = firstReady?.id ?? st.defaultEngine ?? '';
  const engineFor = () => engineSel.value;
  const engineLabel = id => { const e = (st.engines ?? []).find(x => x.id === id); return e ? engineName(e) : id; };

  const phone = el('input', { type: 'tel', id: 'ask-phone', value: displayPhone(form.phone), autocomplete: 'off', placeholder: '090-1234-5678' });
  const name = el('input', { type: 'text', id: 'ask-name', value: form.name, placeholder: '相手の名前' });
  const instruction = el('textarea', { id: 'ask-instruction', 'aria-labelledby': 'ask-instruction-label', placeholder: '例：10月3日（土）の夜に2名で予約を取ってほしい。できれば19時。名前は田中。' }); instruction.value = form.instruction;

  const gentle = el('input', { type: 'checkbox', id: 'ask-gentle', checked: form.pace, 'aria-describedby': 'ask-gentle-note', onchange: () => { form.pace = gentle.checked; changed(); } });
  const voice = el('select', { id: 'ask-voice' }, el('option', { value: '', text: '標準' }),
    ...Object.entries(st.voicePresets ?? {}).map(([id, label]) => el('option', { value: id, text: label })));
  voice.value = form.preset;
  // 声: every voice the chosen engine accepts (GPT-Live 22, Gemini 30). おまかせ keeps the 話し方's own voice.
  const PITCH_JA = { low: '低め', mid: 'ふつう', high: '高め', 'very-high': 'かなり高め' };
  const voiceName = el('select', { id: 'ask-voice-name', 'aria-describedby': 'ask-voice-note' });
  const voiceNote = el('p', { class: 'note', id: 'ask-voice-note' });
  // The voice last chosen for each engine comes back when that engine is chosen again.
  const voiceByEngine = {};
  function fillVoices() {
    const eng = (st.engines ?? []).find(e => e.id === engineFor()), keep = voiceByEngine[engineFor()] ?? form.voiceName;
    voiceName.replaceChildren(el('option', { value: '', text: 'おまかせ（話し方に合わせる）' }), ...(eng?.voices ?? []).map(v => {
      const d = st.voiceDetails?.[v], trait = eng.voiceTraits?.[v] ?? (d ? `高さ ${PITCH_JA[d.pitch] ?? d.pitch}` : '');
      return el('option', { value: v, text: [v, trait, v === eng.defaultVoice ? '標準' : ''].filter(Boolean).join(' · ') });
    }));
    voiceName.value = (eng?.voices ?? []).includes(keep) ? keep : '';
    form.voiceName = voiceName.value;
    noteVoice();
  }
  // A chosen voice outranks the 話し方's own voice; the 話し方 then sets only the way of speaking.
  function noteVoice() {
    voiceNote.textContent = voiceName.value
      ? `声は ${voiceName.value} を使います。話し方は口調だけに効きます。${st.voiceDetails?.[voiceName.value]?.sample ? '' : 'この声は試聴できません。'}`
      : '試聴できるのは、計測済みの GPT-Live の声だけです。';
  }
  const sampleFor = preset => { const id = engineFor(), eng = (st.engines ?? []).find(e => e.id === id); if (id !== 'gpt-live' || !eng) return ''; const v = voiceName.value || (preset && eng.presetVoices?.[preset]) || eng.defaultVoice; return st.voiceDetails?.[v]?.sample ?? ''; };
  const voiceSample = sampleButton(sampleFor(form.preset));
  const resample = () => { sampleAudio?.pause(); voiceSample.dataset.url = sampleFor(voice.value); voiceSample.hidden = !voiceSample.dataset.url; voiceSample.setAttribute('aria-pressed', 'false'); voiceSample.textContent = '▶ 声を聞く'; };
  fillVoices(); resample();
  engineSel.addEventListener('change', () => { form.engine = engineSel.value; fillVoices(); resample(); changed(); });
  voiceName.addEventListener('change', () => { form.voiceName = voiceName.value; voiceByEngine[engineFor()] = voiceName.value; noteVoice(); resample(); changed(); });
  // AIニュースを届ける needs the news lookup, which only GPT-Live has; the other voices would have to say they cannot check.
  const engineHint = el('p', { class: 'note', id: 'ask-engine-note', hidden: true });
  let engineBeforeNews = null;
  function syncEngine() {
    const news = form.kind === 'ai-news', live = (st.engines ?? []).find(e => e.id === 'gpt-live');
    for (const o of engineSel.options) o.disabled = !(st.engines ?? []).find(e => e.id === o.value)?.ready || (news && o.value !== 'gpt-live');
    if (news && live?.ready && engineSel.value !== 'gpt-live') { engineBeforeNews = engineSel.value; engineSel.value = 'gpt-live'; form.engine = 'gpt-live'; fillVoices(); resample(); }
    // Leaving AIニュース gives back the voice AI chosen before it.
    if (!news && engineBeforeNews) { engineSel.value = engineBeforeNews; form.engine = engineBeforeNews; engineBeforeNews = null; fillVoices(); resample(); }
    engineHint.hidden = !news;
    engineHint.textContent = live?.ready ? 'ニュースを調べられるのは GPT-Live だけなので、この電話は GPT-Live で話します。' : 'このサーバーでは GPT-Live が使えないため、この電話ではニュースを調べられません。';
  }
  syncEngine();
  voice.addEventListener('change', resample);
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': '連絡先から選ぶ' }, ...contacts.slice(0, 8).map(c => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.id === form.contactId), 'data-id': c.id, text: c.name || c.company,
    onclick: () => { phone.value = displayPhone(c.phone); name.value = c.name || c.company; form.contactId = c.id; suggest(); changed(); } })));
  let group = GROUPS.find(g => g[2].includes(form.kind))?.[0] ?? 'shop';
  const groupChips = el('div', { class: 'chips', role: 'group', 'aria-label': '電話の種類の分類' });
  const kindCards = el('div', { class: 'kinds', role: 'group', 'aria-label': '電話の種類' });
  const blankBox = el('div', { class: 'two blanks' });
  function drawKind() {
    groupChips.replaceChildren(...GROUPS.map(([g, l]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === group), 'data-group': g, text: l, onclick: () => { group = g; if (g === 'free') setKind(''); else drawKind(); } })));
    const kinds = GROUPS.find(x => x[0] === group)[2];
    kindCards.hidden = group === 'free';
    kindCards.replaceChildren(...kinds.filter(k => k !== '').map(k => el('button', { type: 'button', class: 'kind', 'aria-pressed': String(form.kind === k), 'data-kind': k, text: kindTitle(k), onclick: () => setKind(k) })));
    // The template's blanks as fields; the request text is written from them.
    const own = b.account?.callerName ?? '';
    blankBox.replaceChildren(...blanks().map(label => { const v = form.fill[label] ?? (/自分の名前|予約の名前/.test(label) ? own : ''); form.fill[label] = v;
      const input = el('input', { type: 'text', value: v, 'data-blank': label, 'aria-label': label });
      input.addEventListener('input', () => { form.fill[label] = input.value; suggest(); changed(); });
      return el('div', {}, el('label', { class: 'lbl', text: label }), input); }));
    blankBox.hidden = !blanks().length;
  }
  const purposeChips = el('div', {}, groupChips, el('div', { class: 'gap' }), kindCards, el('div', { class: 'gap' }), blankBox);
  const product = el('select', { id: 'ask-product', 'aria-label': '紹介する商品' }, ...(b.products.length ? b.products.map(x => el('option', { value: x.id, text: x.name })) : [el('option', { value: '', text: '（商品がまだありません）' })]));
  product.value = form.productId;
  product.addEventListener('change', () => { form.productId = product.value; changed(); });
  const productRow = el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl', for: 'ask-product', text: '紹介する商品' }), product),
    el('p', { class: 'note' }, b.products.length ? '商品の説明は、確認済みの内容だけを使います。' : '営業の電話には、確認済みの商品が必要です。', el('a', { href: '#/settings/products', text: ' 設定で商品を登録' })));
  const scopeBox = el('div', { class: 'scopes' });
  // Deciding on the spot matters for a request in plain words and for a booking.
  const usesScope = () => form.kind === '' || form.kind === 'reserve';
  function renderScope() {
    const col = (key, title, cls, mark, sug) => {
      const next = sug.find(x => !form[key].includes(x));
      return el('div', { class: `scope ${cls}` }, el('b', { class: 'scope-h' }, el('span', { class: 'scope-ico', text: mark }), title),
        ...form[key].map(t => el('span', { class: 'scope-item' }, t, el('button', { type: 'button', 'aria-label': `${t} を外す`, text: '×', onclick: () => { form[key] = form[key].filter(x => x !== t); renderScope(); changed(); } }))),
        next ? el('button', { type: 'button', class: 'scope-add', text: '＋ ' + next, onclick: () => { form[key].push(next); renderScope(); changed(); } }) : null);
    };
    scopeBox.replaceChildren(col('ok', 'AIが決めてよい', 'ok', '○', OK_SUGGEST), col('hold', '決めずに持ち帰る', 'hold', '△', HOLD_SUGGEST),
      el('div', { class: 'scope never' }, el('b', { class: 'scope-h' }, el('span', { class: 'scope-ico', text: '×' }), 'しない'), ...NEVER_DO.map(t => el('span', { class: 'scope-item', text: t })), el('span', { class: 'note', text: 'この2つは常にしません' })));
  }
  renderScope();
  function suggest() {
    // Keep the wording in step with the purpose and the person, but never overwrite what was typed.
    if (!suggested && instruction.value.trim()) return;
    const who = name.value.trim() || '相手';
    if (tpl() && form.kind !== 'chat') {
      const text = (tpl().instruction?.ja ?? '').replace(/\{\{([^{}]+)\}\}/g, (_, k) => (form.fill[k] ?? '').trim() || `（${k}）`);
      instruction.value = text; suggested = true; return;
    }
    const t = SALES_TEXT[form.purpose]?.(who) ?? (form.purpose === 'chat' ? (app.templates.find(x => x.id === 'chat')?.instruction?.ja ?? `${who}と近況を話して、気軽に雑談してください。`) : '');
    if (t) { instruction.value = t; suggested = true; }
  }

  const side = el('aside', { class: 'ask-side', 'aria-label': 'AIへの指示書' });
  const consentBox = el('input', { type: 'checkbox', id: 'ask-ack' });
  const go = el('button', { class: 'btn primary big', type: 'button', text: 'この内容で電話をかける', disabled: true });
  const check = el('button', { class: 'btn big', type: 'button', text: '内容を確かめる' });
  const err = el('p', { class: 'errbox', role: 'alert', hidden: true });
  const blocked = app.history.find(r => r.state === 'unknown' && !r.resolvedAt);
  const liveNow = app.history.find(r => LIVE.includes(r.state));
  const consented = b.account?.consentVersion === b.configuration.consentVersion;
  const consentAgree = el('input', { type: 'checkbox', id: 'ask-consent' });

  // Who the AI says it calls for. A kind that names a facility or requester of its own (見守り, お薬の声かけ) uses that
  // one name, so the call does not introduce two different callers; a name the request cannot carry is left out.
  const callerFor = () => { const own = Object.entries(form.fill).find(([k]) => /^施設名/.test(k))?.[1]?.trim();
    return own === undefined ? (b.account?.callerName ?? '') : own.length <= 40 && !/[\d@<>{}]|https?:/i.test(own) ? own : ''; };
  function values() { const body = instruction.value.trim(); return { phone: phone.value.trim(), name: name.value.trim(), body, instruction: usesScope() && body ? withScope(body, form.ok, form.hold) : body, preset: voice.value, voiceName: voiceName.value, engine: engineSel.value }; }
  function changed() {
    review = null; err.hidden = true; consentBox.checked = false; rep.on = false; rep.key = null; repOn.checked = false; repAck.checked = false; repGo.disabled = true;
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.id === form.contactId));
    for (const c of kindCards.children) c.setAttribute('aria-pressed', String(c.dataset.kind === form.kind));
    fitText(); productRow.hidden = !isSales(); voiceField.hidden = isSales(); paceField.hidden = isSales(); scopeField.hidden = !usesScope();
    renderSide();
  }
  // Typing a number by hand means it is not the chosen contact any more.
  phone.addEventListener('input', () => { form.contactId = contacts.find(c => displayPhone(c.phone) === phone.value.trim() || c.phone === phone.value.trim())?.id ?? null; });
  instruction.addEventListener('input', () => { suggested = false; });
  const fitText = () => { if (!instruction.isConnected) return; instruction.style.height = 'auto'; instruction.style.height = `${instruction.scrollHeight + 2}px`; };
  instruction.addEventListener('input', fitText);
  for (const n of [phone, name, instruction, voice]) n.addEventListener('input', changed);
  voice.addEventListener('change', changed);

  consentBox.addEventListener('change', () => { go.disabled = !review || !consentBox.checked || isPaused(b.configuration); });
  // 定期の電話: the reviewed request, repeated at set times until an end date. Offered for a phone request to a saved
  // contact only (never a sales call or a booking); the server checks the same and each call again when it is due.
  const tokyoDay = (offset = 0) => new Date(Date.now() + 9 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
  const rep = { on: false, key: null };
  const repOn = el('input', { type: 'checkbox', id: 'rep-on', onchange: () => { rep.on = repOn.checked; rep.key = null; repAck.checked = false; repChanged(); renderSide(); (rep.on ? repTimes.querySelector('input') : repOn)?.focus(); } });
  const repTimes = el('div', { class: 'rep-times' });
  const timeRow = value => { const input = el('input', { type: 'time', value, 'aria-label': 'かける時刻', required: true });
    const row = el('div', { class: 'play-row' }, input, el('button', { class: 'btn', type: 'button', text: '外す', 'aria-label': 'この時刻を外す', onclick: () => { row.remove(); repChanged(); } })); return row; };
  const addTime = el('button', { class: 'link rep-add', type: 'button', text: '＋ 時刻を増やす（4つまで）', onclick: () => { repTimes.append(timeRow('')); repChanged(); repTimes.lastChild.querySelector('input').focus(); } });
  repTimes.append(timeRow('09:00'));
  const repDays = el('div', { class: 'chips rep-days', role: 'group', 'aria-label': 'かける曜日' }, ...'日月火水木金土'.split('').map((d, i) => el('button', { type: 'button', class: 'chip day-chip', 'aria-pressed': 'true', 'data-day': String(i), 'aria-label': `${d}曜日`, text: d,
    onclick: e => { e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')); repChanged(); } })));
  const repUntil = el('input', { type: 'date', id: 'rep-until', value: tokyoDay(30), min: tokyoDay(1), max: tokyoDay(91), required: true });
  const repCount = el('select', { id: 'rep-count' }, ...[['0', 'かけ直さない'], ['1', '1回かけ直す'], ['2', '2回までかけ直す'], ['3', '3回までかけ直す']].map(([v, l]) => el('option', { value: v, text: l })));
  const repGap = el('select', { id: 'rep-gap', 'aria-label': 'かけ直すまでの間隔' }, ...[10, 15, 30, 60, 120, 180].map(n => el('option', { value: String(n), text: `${n}分後に` })));
  repGap.value = '30';
  const repBound = el('p', { class: 'rep-bound', role: 'status' });
  const hours = b.scheduleHours ?? { from: '07:00', to: '21:00' };
  const repHours = el('p', { class: 'note', id: 'rep-hours' }), repSum = el('dl', { class: 'defs left rep-sum', 'aria-label': '承認する内容' });
  const repAck = el('input', { type: 'checkbox', id: 'rep-ack' });
  const repGo = el('button', { class: 'btn primary big', type: 'button', text: '定期の電話を登録する', disabled: true });
  const repValues = () => ({ times: [...repTimes.querySelectorAll('input')].map(i => i.value).filter(Boolean), weekdays: [...repDays.children].filter(c => c.getAttribute('aria-pressed') === 'true').map(c => Number(c.dataset.day)),
    until: repUntil.value, count: Number(repCount.value), minutes: Number(repGap.value) });
  function repChanged() {
    rep.key = null; repAck.checked = false;
    const v = repValues(), rows = repTimes.querySelectorAll('.play-row');
    addTime.hidden = rows.length >= 4; for (const r of rows) r.querySelector('button').hidden = rows.length <= 1;
    repGap.hidden = v.count === 0;
    // The most it can do, counted as the server counts it: the days it rings on from today to the end date (Japan time),
    // times a day, with every retry.
    let days = 0, occ = 0; const end = v.until ? Date.parse(`${v.until}T23:59:59+09:00`) : 0, now = Date.now();
    for (let t = now, n = 0; n < 100; t += 86400e3, n++) {
      const d = new Date(t + 9 * 3600e3); if (!v.weekdays.includes(d.getUTCDay())) continue;
      const ahead = v.times.filter(time => { const at = Date.parse(`${d.toISOString().slice(0, 10)}T${time}:00+09:00`); return at >= now && at < end; }).length;
      if (ahead) { days++; occ += ahead; }
    }
    const ready = v.times.length && v.weekdays.length && occ, most = occ * (1 + v.count);
    const parts = `これからの${occ}回${v.count ? ` × かけ直しを含め${1 + v.count}回` : ''}・かける日 ${days}日`;
    repBound.textContent = ready ? `終了日までに、最大 ${most} 回かけます（${parts}）。` : '時刻・曜日・終了日を入れると、かける回数の上限が出ます。';
    const late = v.times.filter(t => t < hours.from || t >= hours.to);
    repHours.textContent = late.length ? `${late.join('、')} は登録できません。かけられる時刻は ${hours.from}〜${hours.to} です。` : `かけられる時刻は ${hours.from}〜${hours.to} です（夜間は登録できません）。`;
    repHours.classList.toggle('warn', late.length > 0);
    repSum.replaceChildren(
      el('dt', { text: '相手' }), el('dd', {}, name.value.trim(), ' ', el('span', { class: 'num', text: displayPhone(phone.value.trim()) })),
      el('dt', { text: 'かける時刻' }), el('dd', { class: 'num', text: v.times.length ? [...v.times].sort().join('、') : '未入力' }),
      el('dt', { text: '曜日' }), el('dd', { text: v.weekdays.length === 7 ? '毎日' : v.weekdays.length ? `毎週 ${v.weekdays.map(d => WEEK[d]).join('・')}` : '未選択' }),
      el('dt', { text: 'いつまで' }), el('dd', { text: v.until ? `${fmtDate(v.until)}まで` : '未入力' }),
      el('dt', { text: '回数の上限' }), el('dd', { text: ready ? `最大 ${most} 回（${parts}）` : '—' }),
      el('dt', { text: '出ないとき' }), el('dd', { text: `${v.count ? `${v.minutes}分後にかけ直す（${v.count}回まで）。それでも出なかった回` : 'かけ直さない。出なかった回'}は、報告に「要確認」と出ます。AIは、だれにも電話や連絡をしません。` }),
      el('dt', { text: '止め方' }), el('dd', { text: '「依頼」›「定期の電話」で、いつでも一時停止・終了できます。' }));
    repGo.disabled = true;
  }
  for (const n of [repUntil, repCount, repGap]) n.addEventListener('change', repChanged);
  repTimes.addEventListener('change', repChanged);
  repAck.addEventListener('change', () => { repGo.disabled = !review || !repAck.checked || isPaused(b.configuration); });
  repChanged();
  const repRules = ['連絡先に保存し、「電話してよい根拠」が書かれている相手だけにかけます。予約を取る電話は定期にできません。', '終了日を過ぎると、自動で終わります（最長92日）。', '1回ごとに、ふつうの電話と同じ確認をして、同じように費用がかかります。',
    'かけ直すのは、相手が出なかったときだけです。', 'かけ直しても出なかった回は、報告に「要確認」と出ます。通知先が設定されていれば、そこへ知らせます。AIは、だれにも電話や連絡をしません。', '時刻を過ぎてかけられなかった回は、遅れてかけずに見送ります。', '相手が「もう電話しないで」と言えば、そこで終わります。', 'いつでも「定期の電話」の画面で、一時停止・終了できます。'];
  const repPanel = el('div', { class: 'rep-panel stack tight' },
    el('span', { class: 'lbl', text: 'かける時刻（日本時間）' }), repTimes, repHours, addTime,
    el('span', { class: 'lbl', text: 'かける曜日' }), repDays,
    el('label', { class: 'lbl', for: 'rep-until', text: '終了日（この日まで）' }), repUntil,
    el('label', { class: 'lbl', for: 'rep-count', text: '相手が出なかったとき' }), el('div', { class: 'two rep-retry' }, repGap, repCount),
    repBound,
    el('ul', { class: 'rep-rules' }, ...repRules.map(t => el('li', { text: t }))),
    el('span', { class: 'lbl', text: '承認する内容' }), repSum,
    el('label', { class: 'check' }, repAck, '上の決まりを読みました。終了日まで、この内容で繰り返し電話をかけることを承認します。'), repGo);
  repGo.addEventListener('click', async () => {
    if (!review?.request || !repAck.checked || isPaused(b.configuration)) return;
    const v = repValues(); err.hidden = true;
    if (!v.times.length || new Set(v.times).size !== v.times.length) { err.textContent = ERRORS.invalid_schedule_times; err.hidden = false; return; }
    if (!v.weekdays.length) { err.textContent = ERRORS.invalid_schedule_weekdays; err.hidden = false; return; }
    if (v.times.some(t => t < hours.from || t >= hours.to)) { err.textContent = `かける時刻は ${hours.from}〜${hours.to} の間にしてください。夜間の時刻は登録できません。`; err.hidden = false; return; }
    if (!v.until) { err.textContent = ERRORS.schedule_end_required_within_92_days; err.hidden = false; return; }
    repGo.disabled = true; rep.key ??= crypto.randomUUID();
    try {
      await api('/schedules', { method: 'POST', headers: { 'Idempotency-Key': rep.key }, body: { request: review.request, times: v.times, weekdays: v.weekdays, until: `${v.until}T23:59:59+09:00`, retries: { count: v.count, minutes: v.minutes }, acknowledged: true } });
      // The one-off draft made for the review is not a call waiting for approval any more.
      await api(`/missions/${review.mission.id}`, { method: 'DELETE' }).catch(() => null);
      app.boot = null; toast('定期の電話を登録しました。'); location.hash = '#/standing';
    } catch (e) {
      // A refusal is final for this key; an unknown outcome keeps it, so pressing again cannot register twice.
      if (e.status) rep.key = null;
      err.textContent = e.code === 'schedule_time_outside_calling_hours' ? `かける時刻は ${hours.from}〜${hours.to} の間にしてください。夜間の時刻は登録できません。` : e.message; err.hidden = false; repGo.disabled = !repAck.checked;
    }
  });

  const steps = el('ol', { class: 'steps', 'aria-label': '手順' });
  function renderSide() {
    const at = review ? 2 : 1;
    steps.replaceChildren(...['内容', '確認して発信', '報告'].map((l, i) => el('li', { class: i + 1 === at ? 'on' : i + 1 < at ? 'done' : '', 'aria-current': i + 1 === at ? 'step' : null, text: `${'①②③'[i]} ${l}` })));
    const v = values();
    const brief = el('div', { class: 'brief' },
      el('p', { class: 'nomargin' }, el('b', { text: v.name || '（相手）' }), v.phone ? el('span', { class: 'num', text: `（${displayPhone(v.phone)}）` }) : '', ' に電話して、次のことを頼みます。'),
      ...(form.kind === 'reserve' ? [el('p', { class: 'nomargin' }, el('mark', { text: 'AIが予約を取ります。' }), '日時・人数・名前を復唱し、相手がはっきり了承したときだけ成立とします。支払い・カード番号は伝えません。')] : []),
      ...(isSales() ? [el('p', { text: `紹介する商品：${b.products.find(x => x.id === form.productId)?.name ?? '（未選択）'}。確認済みの説明だけを使い、値引き・契約・支払いは約束しません。` })] : []),
      el('blockquote', { text: v.body || '入力した用件がここに表示されます。' }),
      ...(usesScope() && form.ok.length ? [el('p', { class: 'nomargin' }, 'その場で決めてよいこと：', el('mark', { text: form.ok.join('、') }))] : []),
      ...(usesScope() && form.hold.length ? [el('p', { class: 'nomargin' }, '次の話が出たら、決めずに持ち帰ります：', el('mark', { class: 'hold', text: form.hold.join('、') }))] : []),
      el('p', { text: `最初に、AIであること・${callerFor() ? `${callerFor()}の代わりであること・` : ''}記録していることを伝えます。支払いの約束はしません。` }));
    const facts = el('dl', { class: 'defs left' },
      el('dt', { text: '通話の上限' }), el('dd', { text: `${Math.round((review?.mission.maxSeconds ?? Math.min(180, b.configuration.maxSeconds)) / 60)}分で切ります` }),
      el('dt', { text: '費用の目安' }), el('dd', { text: review ? (review.mission.mode === 'simulator' ? '練習なので0円' : review.mission.creditQuote?.mode === 'credits' ? `${review.mission.creditQuote.amount} クレジット（確保）` : `最大 約$${review.mission.estimatedMaximumUsd.toFixed(2)}（上限 $${review.mission.maxUsd}）`) : '内容を確かめると表示します' }),
      ...(v.engine && v.engine !== st.defaultEngine ? [el('dt', { text: '音声AI' }), el('dd', { text: engineLabel(v.engine).replace(/（[^）]*）$/, '') })] : []),
      ...(form.pace && !v.preset && !isSales() ? [] : [el('dt', { text: '話し方' }), el('dd', { text: v.preset ? (v.voiceName ? (st.voicePresets[v.preset] ?? v.preset).replace(/・(女性|男性)声$/, '（口調のみ）') : (st.voicePresets[v.preset] ?? v.preset)) : '標準' })]),
      el('dt', { text: '声' }), el('dd', { class: 'num', text: v.voiceName || 'おまかせ' }),
      ...(form.pace && !isSales() ? [el('dt', { text: '話す速さ' }), el('dd', { text: 'ゆっくり・やさしく話す' })] : []));
    const warns = [];
    // The setup details are for whoever runs the server: one line here, the details in 設定.
    if (isPaused(b.configuration)) warns.push(el('p', { class: 'warnbox', text: '発信の受付を一時停止しています。保存済みの依頼内容と過去の報告は確認できます。' }));
    else if (!st.ready) warns.push(el('p', { class: 'warnbox' }, b.configuration.mode === 'live' ? '本番の電話の設定が終わっていないので、まだかけられません。' : '練習モードなので、実際の電話はかけられません。', el('a', { href: '#/settings', text: '設定で確かめる' })));
    if (blocked) warns.push(el('p', { class: 'warnbox' }, `${blocked.request.name}の電話が終わったか確かめるまで、発信できません。`, el('a', { href: '#/requests', text: '依頼一覧で確かめる' })));
    if (review && app.month.capUsd !== null && app.month.usedUsd + review.mission.estimatedMaximumUsd > app.month.capUsd + 1e-9)
      warns.push(el('p', { class: 'warnbox' }, `今月の上限（$${app.month.capUsd}）を超えるので、この電話はかけられません（今月 $${app.month.usedUsd.toFixed(2)}＋この電話 最大 $${review.mission.estimatedMaximumUsd.toFixed(2)}）。`, el('a', { href: '#/settings/cost', text: '上限を見直す' })));
    if (liveNow) warns.push(el('p', { class: 'warnbox' }, 'いまの電話が終わるまで、次の電話はかけられません。', el('a', { href: `#/call/${liveNow.id}`, text: '電話中の画面へ' })));
    // Sales calls also run in practice mode (the scripted partner answers); other requests need a real line.
    const practiceSales = isSales() && b.configuration.mode === 'simulator';
    if (practiceSales) warns.splice(0, warns.length, ...warns.filter(w => !/練習モードなので/.test(w.textContent)), el('p', { class: 'warnbox', text: '練習モード：実際の電話はかからず、練習用の相手と話します。費用はかかりません。' }));
    // AIニュースを届ける is pointless without the news lookup: no GPT-Live, no such call.
    const newsBlocked = form.kind === 'ai-news' && !(st.engines ?? []).find(e => e.id === 'gpt-live')?.ready;
    if (newsBlocked && st.ready) warns.push(el('p', { class: 'warnbox', text: 'このサーバーでは GPT-Live が使えないため、ニュースを調べられません。この種類の電話はかけられません。' }));
    const canCheck = !blocked && !liveNow && !newsBlocked && (st.ready || practiceSales);
    check.disabled = !canCheck || Boolean(review);
    go.disabled = !review || !consentBox.checked || isPaused(b.configuration);
    side.classList.toggle('rep-open', Boolean(review && rep.on));
    side.replaceChildren(
      el('div', { class: 'side-h' }, el('small', { text: 'AIへの指示書' }), el('b', { text: review ? '発信前の最終確認' : '依頼内容を確認' })),
      brief, facts,
      // Where the data goes, for a real call; a practice call goes nowhere.
      ...(review?.readiness?.disclosure && review.mission.mode !== 'simulator' ? [el('p', { class: 'note', text: review.readiness.disclosure })] : []),
      ...warns, err,
      ...(!consented ? [el('label', { class: 'check' }, consentAgree, '会話データの取り扱い（電話会社と音声AIに音声と文字が渡り、記録はこのサーバーに30日保存）に同意します。')] : []),
      ...(review && rep.on ? [] : [review ? el('label', { class: 'check' }, consentBox, '相手・頼むこと・費用を確かめました。この1件の発信を承認します。') : check]),
      ...(review && !rep.on ? [go] : []),
      ...(review && !rep.on ? [el('p', { class: 'note', text: '押すまで電話はかかりません。承認はこの内容だけに有効です。' })] : !review ? [el('p', { class: 'note', text: 'まだ電話はかかりません。内容を確かめると、費用の見込みと承認のチェックが出ます。' })] : []),
      // Repeating it: only a reviewed phone request (review.request), never a sales call.
      ...(review?.request ? [el('div', { class: 'rep' },
        form.kind === 'reserve' ? el('p', { class: 'note', text: '予約を取る電話は、定期の電話にできません。' })
          : !form.contactId ? el('p', { class: 'note' }, '定期の電話（決めた時刻に繰り返す）にできるのは、連絡先に保存した相手だけです。', el('a', { href: '#/contacts', text: ' 連絡先へ' }))
          : !b.contacts.find(x => x.id === form.contactId)?.basis?.trim() ? el('p', { class: 'note' }, '定期の電話にするには、この相手の連絡先に「電話してよい根拠」（本人や家族の同意など）を書いてください。', el('a', { href: `#/contacts/${form.contactId}`, text: ' 連絡先を開く' }))
          : form.pace && !b.alertsConfigured ? el('p', { class: 'note', text: 'ゆっくり・やさしく話す電話を定期にするには、要確認の知らせを受け取る通知先が必要です。このサーバーにはまだ設定がありません。管理者に設定を頼んでください。' })
          : el('label', { class: 'check' }, repOn, el('span', {}, el('b', { text: '定期の電話にする' }), el('span', { class: 'note rep-help', text: '1回だけではなく、決めた時刻に繰り返しかけます。' }))),
        ...(rep.on ? [repPanel] : []))] : []));
  }
  check.addEventListener('click', async () => {
    err.hidden = true; const v = values();
    try {
      if (!consented) { if (!consentAgree.checked) throw new Error('会話データの取り扱いへの同意にチェックを入れてください。'); await api('/consent', { method: 'POST', body: { version: b.configuration.consentVersion } }); b.account.consentVersion = b.configuration.consentVersion; }
      // Only an engine this server runs is sent; in practice mode none is, and the practice partner answers.
      const engine = (st.engines ?? []).find(e => e.id === v.engine)?.ready ? v.engine : '';
      if (isSales()) {
        if (!form.contactId) throw new Error('営業の電話は、連絡先から相手を選んでください（連絡先の画面で登録できます）。');
        if (!form.productId) throw new Error('紹介する商品を選んでください（設定の「商品」で登録できます）。');
        const m = await api('/missions/draft', { method: 'POST', body: { request: v.body, productId: form.productId, goal: form.purpose, contactId: form.contactId, maxSeconds: Math.min(180, b.configuration.maxSeconds) } });
        review = { ...(await api(`/missions/${m.id}/review`, { method: 'POST', body: {} })), readiness: st };
      } else {
        const left = blanks().filter(k => v.body.includes(`（${k}）`));
        if (left.length) throw new Error(`「${left.join('」「')}」を入れてください（文の中に、まだ（${left[0]}）が残っています）。`);
        const empty = blanks().filter(k => !(form.fill[k] ?? '').trim());
        if (tpl() && form.kind !== 'chat' && suggested && empty.length) throw new Error(`「${empty.join('」「')}」を入れてください。`);
        const requestBody = { phone: v.phone, name: v.name, instruction: v.instruction, ...(form.kind === 'reserve' ? { task: 'reservation' } : {}),
        ...(form.mode ? { conversationMode: form.mode } : {}), ...(callerFor() ? { callerName: callerFor() } : {}), ...(v.preset ? { voicePreset: v.preset } : {}), ...(engine ? { engine } : {}), ...(engine && v.voiceName ? { voice: v.voiceName } : {}), ...(form.pace ? { pace: 'gentle' } : {}) };
        review = await api('/phone/draft', { method: 'POST', body: requestBody });
        review.request = requestBody;
      }
      review.key = crypto.randomUUID();
      renderSide(); consentBox.focus();
    } catch (e) { err.textContent = e.message; err.hidden = false; renderSide(); }
  });
  go.addEventListener('click', async () => {
    if (!review || !consentBox.checked || isPaused(b.configuration)) return;
    go.disabled = true; err.hidden = true;
    try {
      await api(`/missions/${review.mission.id}/start`, { method: 'POST', body: { approvalToken: review.approvalToken, acknowledged: true }, headers: { 'Idempotency-Key': review.key } });
      app.boot = null; await loadAll(); location.hash = `#/call/${review.mission.id}`;
    } catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = isPaused(b.configuration); }
  });
  let voiceField, scopeField, paceField;
  const field = (k, d, ...content) => el('div', { class: 'field' }, el('div', { class: 'k' }, el('b', { text: k, ...(k === '何をしてほしいか' ? { id: 'ask-instruction-label' } : {}) }), d ? el('span', { text: d }) : null), el('div', {}, ...content));
  const view = el('div', { class: 'ask' },
    el('section', { class: 'ask-form' },
      el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'), el('div', { class: 'ask-h' }, el('h1', { text: '電話を頼む' }), steps),
      field('だれに', contacts.length ? '連絡先から選ぶか、番号を入れます' : '番号と名前を入れます', contacts.length ? chips : null,
        el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl', for: 'ask-phone', text: '電話番号' }), phone), el('div', {}, el('label', { class: 'lbl', for: 'ask-name', text: '相手の名前' }), name))),
      field('何の電話か', '種類を選ぶと、必要なことを聞きます', purposeChips),
      field('何をしてほしいか', 'ふだんの言葉で。種類から作った文も書き換えられます', instruction, productRow),
      scopeField = field('任せる範囲', '相手に別の案を出されたときの、AIの動き方', scopeBox),
      paceField = field('話す速さ', '', el('label', { class: 'check' }, gentle, 'ゆっくり・やさしく話す'),
        el('p', { class: 'note', id: 'ask-gentle-note', text: '高齢の方や、耳の遠い方に。ゆっくり、やさしい言葉で話し、返事を長めに待ちます。' })),
      voiceField = el('details', { class: 'voice-options' }, el('summary', {}, el('b', { text: '声と話し方を調整' }), el('span', { text: '任意 · 選んだ設定は確認欄に表示されます' })), field('声', '話すAIと声。判定は、どれでも同じです', el('div', { class: 'stack tight' },
        el('label', { class: 'lbl', for: 'ask-engine', text: '音声AI' }), engineSel, engineHint,
        el('label', { class: 'lbl', for: 'ask-voice', text: '話し方' }), voice,
        el('label', { class: 'lbl', for: 'ask-voice-name', text: '声' }), el('div', { class: 'play-row' }, voiceName, voiceSample), voiceNote),
        el('p', { class: 'note', text: b.account?.callerName ? `AIは「${b.account.callerName}の代わり」と名乗ります。` : 'AIが名乗る名前は、設定の「かける設定」で決められます。' })))),
    side);
  drawKind();
  if ((form.purpose || tpl()) && !form.instruction) suggest();
  changed();
  requestAnimationFrame(fitText);
  return view;
}

// ---------------------------------------------------------------- 電話中 / 報告
// What a wellbeing call heard, in plain words. Always "said", never "did": the call only knows what was said on the phone.
const CHECK_TOPIC = { condition: '体調', meal: '食事', medication: '服薬', sleep: '睡眠', help: '相談や困りごと' };
const CHECK_SAID = { condition: { yes: '元気・変わりないと話しました', no: '不調や困りごとを話しました' }, meal: { yes: '食べたと話しました', no: 'まだ食べていないと話しました' },
  medication: { yes: '飲んだと話しました', no: 'まだ飲んでいないと話しました' }, sleep: { yes: '眠れたと話しました', no: '眠れなかったと話しました' }, help: { yes: '相談や困りごとを話しました', no: '特にないと話しました' } };
const checkSaid = (topic, answer) => answer === 'unclear' ? 'はっきりしない返事でした' : answer === 'no_answer' ? '返答なし' : answer === 'not_asked' ? '聞いていません' : CHECK_SAID[topic]?.[answer] ?? '—';
// One call as a row (team list, a person's history): how the call went, in call words for every row.
const callWent = c => c.status === 'FAILED' ? missTag('かけられませんでした') : c.status === 'DECLINED' ? missTag('断られました') : c.status === 'UNKNOWN' ? missTag('要照合') : c.answered === false ? missTag('応答なし')
  : c.answered === true || c.status === 'COMPLETED' ? '話せました' : c.status === 'CANCELLED' ? '取り消しました' : c.status === 'INCOMPLETE' ? '応答の記録なし' : '進行中';
// What a wellbeing call heard, in the report table's own words (things said, never facts). Not links, so not underlined.
const saidGlance = c => { const parts = Object.entries(c ?? {}).filter(([, a]) => a !== 'not_asked').map(([t, a]) => el('span', { class: checkWorry(t, a) ? 'worry' : '' }, `${CHECK_TOPIC[t]?.slice(0, 2) ?? t}：`, el('b', { text: checkSaid(t, a) })));
  return parts.length ? el('span', { class: 'glance' }, ...parts) : null; };
// An answer a person should read: trouble said, something raised, or nothing clear.
const checkWorry = (topic, answer) => answer === 'unclear' || answer === 'no_answer' || (topic === 'help' ? answer === 'yes' : answer === 'no');
const SIGNAL = { life: '助けを求める言葉・動けない', self_harm: '死にたい気持ちの言葉', breathing: '息や胸の苦しさ・しびれ', fall: '転んだ・ぶつけた', pain: '痛み・つらさ', illness: '体調がよくない', intake: '食事や薬がとれていない', mood: '眠れない・不安・さびしさ' };
const LEVEL = { emergency: '緊急', concern: '要確認' };
const levelTag = (level, text = LEVEL[level]) => el('span', { class: `lvl ${level}`, text });
// A word and a mark for a call that did not reach the person (never colour alone).
const missTag = text => el('span', { class: 'lvl miss', text });
// The level of each flagged line, so the banner, the check-in row and the conversation say the same thing about it.
const signalLevels = r => { const m = new Map(); for (const x of r.attention?.signals ?? r.checkIn?.signals ?? []) if (x.turn && m.get(x.turn) !== 'emergency') m.set(x.turn, x.level === 'emergency' ? 'emergency' : 'concern'); return m; };
// With the answers the table marks 要確認: banner, table and conversation then agree line by line.
const turnLevels = r => { const m = signalLevels(r); for (const i of worryRows(r)) if (i.turn && !m.has(i.turn)) m.set(i.turn, 'concern'); return m; };
const japanTime = iso => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const worryRows = r => r.checkIn?.answered ? r.checkIn.items.filter(i => i.answer !== 'not_asked' && checkWorry(i.topic, i.answer)) : [];
// 要確認 whenever a line was flagged, an answer in the table needs a look, or a wellbeing call was not answered.
const attentionOf = r => r.attention?.level ?? (r.checkIn && r.checkIn.attention !== 'none' ? r.checkIn.attention : worryRows(r).length || unanswered(r) ? 'concern' : null);
// Lines a person should read now, quoted from the conversation. It never says what happened, only what was said.
function attentionBand(r) {
  const level = attentionOf(r); if (!level) return null;
  const missed = unanswered(r), flaggedTurns = signalLevels(r), others = worryRows(r).filter(i => !flaggedTurns.has(i.turn)).length;
  const signals = r.attention?.signals?.length ? r.attention.signals : r.checkIn?.signals ?? [];
  const byTurn = new Map();
  for (const sig of signals) { const k = sig.turn ?? sig.quote ?? sig.phrase; if (!byTurn.has(k)) byTurn.set(k, []); byTurn.get(k).push(sig); }
  const items = [...byTurn.values()].map(list => {
    const turn = r.transcript?.find(t => t.id === list[0].turn), words = turn?.text ?? list[0].quote ?? list[0].phrase;
    const worst = list.some(x => x.level === 'emergency') ? 'emergency' : 'concern', at = typeof turn?.startMs === 'number' ? turn.startMs : typeof turn?.t === 'number' ? turn.t : null;
    return el('li', {}, el('div', { class: 'band-k' }, levelTag(worst), el('span', { text: [...new Set(list.map(x => SIGNAL[x.category] ?? ''))].filter(Boolean).join('、') }), at !== null ? el('time', { text: mmss(at / 1000) }) : null),
      el('blockquote', { text: `「${words}」` }));
  });
  return el('section', { class: `band ${level}`, 'aria-label': level === 'emergency' ? '緊急の確認' : '要確認' },
    el('h2', {}, levelTag(level), level === 'emergency' ? 'ご本人の様子を、すぐに確かめてください' : 'ご本人の様子を確かめてください'),
    missed ? el('p', { text: `電話に出なかったか、何も話しませんでした。${r.attempt ? (r.attempt.last ? `${r.attempt.number}回目の電話で、この回のかけ直しはここまでです。` : `${r.attempt.number}回目の電話です。時間をおいて、もう一度かけ直します。`) : ''}` }) : null,
    items.length ? el('ul', { class: 'band-lines' }, ...items) : null,
    // The banner quotes the flagged lines; answers that need a look without a flagged line are counted here and marked in the table.
    others ? el('p', { class: 'band-more', text: items.length ? `ほかに要確認が${others}件あります（下の表）。` : `要確認の返事が${others}件あります（下の表）。` }) : null,
    el('p', { class: 'band-act', text: 'AIはどこにも連絡していません。ご本人の様子は、人が確かめてください。' }),
    missed ? null : el('p', { class: 'band-note', text: 'これは診断ではありません。電話で話された言葉に、人が確かめたほうがよい表現があったことだけを示しています。' }));
}
function checkInTable(r) {
  const c = r.checkIn; if (!c || !c.answered) return null;
  const levels = turnLevels(r), worry = i => checkWorry(i.topic, i.answer) && i.answer !== 'not_asked';
  return el('section', { class: 'checkin' },
    el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '見守りの聞き取り' }), el('span', { class: 'sub', text: '電話で本人が話したことです。実際の様子を確かめたものではありません' })),
    el('table', { class: 'checkin-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '項目' }), el('th', { scope: 'col', text: '返事' }), el('th', { scope: 'col', text: '本人の言葉' }))),
      el('tbody', {}, ...c.items.map(i => el('tr', { class: worry(i) ? 'worry' : '' },
        el('th', { scope: 'row', text: CHECK_TOPIC[i.topic] ?? i.topic }),
        el('td', { 'data-label': '返事' }, el('span', { class: i.answer === 'not_asked' ? 'muted' : '', text: checkSaid(i.topic, i.answer) }), levels.get(i.turn) === 'emergency' ? levelTag('emergency') : worry(i) || levels.has(i.turn) ? levelTag('concern') : null),
        el('td', { 'data-label': '本人の言葉', class: 'said' }, i.quote ? `「${i.quote}」` : el('span', { class: 'muted', text: '—' })))))));
}
// `team`: a supervisor reading a teammate's call (#/team/<id>). The same report, with nothing to press but the way back.
async function call(id, _sub, team = false) {
  const known = app.history.find(x => x.id === id);
  const r = team ? await api(`/team/calls/${encodeURIComponent(id)}`) : known?.sales ? fromSales(await api(`/missions/${encodeURIComponent(id)}`)) : await api(`/phone/calls/${encodeURIComponent(id)}`);
  const i = team ? -1 : app.history.findIndex(x => x.id === r.id); if (i >= 0) app.history[i] = r;
  const here = `#/${team ? 'team' : 'call'}/${r.id}`;
  const live = LIVE.includes(r.state), notes = notesOf(r), ok = notes.filter(n => n.status === 'verified').length, o = outcome(r);
  const seconds = r.billing?.durationSeconds ?? (live ? (Date.now() - Date.parse(r.createdAt)) / 1000 : 0);
  const head = el('div', { class: 'head' },
    notes.length ? ringFor(notes.length, notes.map(n => n.status === 'verified')) : null,
    el('div', {},
      r.createdAt ? el('p', { class: 'call-when num' }, el('time', { datetime: r.createdAt, text: japanTime(r.createdAt) }), r.attempt ? `　定期の電話・${r.attempt.number}回目` : '') : null,
      el('div', { class: `state-line ${live ? 'state-live' : ''}` }, live ? el('span', { class: 'dot' }) : null, live ? '電話中' : r.state === 'failed' || r.state === 'unknown' ? o.text : '電話が終わりました', seconds ? el('time', { class: 'num', text: ` ${mmss(seconds)}` }) : null,
        live ? el('span', { class: 'muted small', text: ' · 上限の時間になると、あいさつして切ります' }) : null),
      el('h1', { class: 'headline', text: live ? (r.transcript?.length ? '相手と話しています' : '発信しています') : o.text })));
  const main = el('section', { class: 'call-main' },
    el('div', { class: 'crumb' }, team ? el('a', { href: '#/team', text: 'チームの電話' }) : el('a', { href: '#/requests', text: '依頼' }), ' › ', el('b', { text: r.request.name }), el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : r.practice ? '練習' : '本番' }), r.scheduled ? el('span', { class: 'tag', text: '定期' }) : null),
    ...(team ? [el('p', { class: 'note', text: `頼んだ人：${r.owner === app.boot.user.id ? '自分' : app.teamNames?.[r.owner] || r.owner}。読むだけの画面です。${r.owner === app.boot.user.id ? '' : '開いたことは記録されます。'}` })] : []),
    attentionBand(r),
    head,
    !live ? checkInTable(r) : null);
  const flagged = turnLevels(r);
  const turnOf = id => r.transcript?.find(t => t.id === id);
  if (notes.length && !live && r.state !== 'unknown') {
    // The report: when and what it cost, the verdict and a one-line summary, then one row per field with the value,
    // what was asked for, the callee's words that settled it and where they are in the call.
    const summary = [r.request.name, ...notes.filter(n => n.status === 'verified' && n.field !== 'confirmed').map(n => fmtValue(n.field, n.value) + (n.field === 'time' ? 'から' : ''))].join(' · ');
    const meta = [japanTime(r.createdAt), seconds ? `通話 ${Math.round(seconds)}秒` : '', r.creditUsage?.consumed ? `${r.creditUsage.consumed} クレジット` : '', r.voiceSetting?.model ? `${r.voiceSetting.model}${r.voiceSetting.voiceSent ? `（${r.voiceSetting.voiceSent}）` : ''}` : ''].filter(Boolean).join(' · ');
    head.replaceChildren(el('div', { class: 'report-top' },
      el('div', {}, el('p', { class: 'meta num', text: meta }), el('h1', { class: 'verdict', text: o.text }), el('p', { class: 'summary', text: summary })),
      ringFor(notes.length, notes.map(n => n.status === 'verified'))));
    main.append(el('div', { class: 'report-rows' }, ...notes.map(n => {
      const t = turnOf(n.turnId), words = n.span || n.quote, asked = n.requested !== undefined && n.value !== undefined && String(n.requested) !== String(n.value);
      return el('div', { class: `rrow ${n.status === 'verified' ? 'ok' : ''}` },
        el('span', { class: 'rk', text: FIELD[n.field] }),
        el('div', { class: 'rv' }, el('b', { text: n.value !== undefined ? fmtValue(n.field, n.value) : n.requested !== undefined ? fmtValue(n.field, n.requested) : '—' }), asked ? el('span', { class: 'muted small', text: `頼んだのは ${fmtValue(n.field, n.requested)}` }) : null),
        el('div', { class: 'rq' }, n.status === 'verified' && words ? [el('span', { class: 'said' }, '「', el('mark', { class: 'proof-fill', text: words }), '」'), t?.startMs !== undefined ? el('span', { class: 'span num', text: `${clock(t.startMs)} – ${clock(t.endMs)}` }) : null] : el('span', { class: 'muted small', text: n.status === 'proposed' ? '提案中・まだ確かめていません' : 'まだ確かめていません' })),
        n.status === 'verified' ? el('span', { class: 'tick big', text: '✓', 'aria-label': '相手の言葉で確認済み' }) : el('span', { class: 'tick no big' }));
    })));
    if (notes.some(n => ['date', 'time'].includes(n.field) && n.status === 'verified')) main.append(el('p', { class: 'caveat', text: '確かめたのは、電話での合意までです。お店や相手のシステムへの登録は、別に確かめてください。' }));
  } else if (notes.length) {
    main.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '確かめること' }), el('span', { class: 'sub', text: '相手の言葉で確かめられたら、輪が一区切り閉じます' })),
      el('div', { class: 'fields' }, ...notes.map((n, k) => el('div', { class: `fcard ${n.status === 'verified' ? 'ok' : ''}` },
        el('div', { class: 'k', text: `${k + 1} ${FIELD[n.field]}` }), n.status === 'verified' ? el('span', { class: 'tick', text: '✓', 'aria-label': '相手の言葉で確認済み' }) : null,
        el('div', { class: `v ${n.status === 'verified' ? '' : 'want'}`, text: n.value !== undefined ? fmtValue(n.field, n.value) : n.requested !== undefined ? fmtValue(n.field, n.requested) : '—' }),
        el('div', { class: 'q', text: n.status === 'verified' && n.quote ? `「${n.quote}」` : n.status === 'proposed' ? '提案中・まだ確かめていません' : 'まだ確かめていません' })))));
  } else if (!r.checkIn) {
    main.append(el('div', { class: 'card' }, el('h2', { text: 'この電話について' }),
      el('p', { class: 'about', text: r.request.conversationMode === 'chat' ? '雑談の電話です。決まったかどうかは判定しません。' : 'この電話には、決まったかどうかを判定する項目がありません。' }),
      el('dl', { class: 'defs left' }, el('dt', { text: '相手' }), el('dd', { text: r.request.name }), el('dt', { text: '番号' }), el('dd', { class: 'num', text: displayPhone(r.request.phone) }))));
  }
  // What the AI decided within 任せる範囲, as it reported it: its own account, next to (never instead of) the verdict.
  if (splitScope(r.request.instruction).ok.length || r.decisions?.length) {
    main.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'AIが判断したこと' }), el('span', { class: 'sub', text: 'AIの報告です。決まったかどうかは、相手の言葉だけで判定します' })),
      r.decisions?.length ? el('div', { class: 'rows' }, ...r.decisions.map(d => el('div', { class: 'row decision' }, el('div', {}, el('div', { class: 'who' }, el('span', { class: 'scope-ico', text: '○' }), ' ', d.decision), d.within ? el('div', { class: 'what', text: `任せた範囲「${d.within}」の中です` }) : null))))
        : el('p', { class: 'muted small', text: live ? 'まだありません。任せた範囲の外の話が出たら、決めずに持ち帰ります。' : 'ありませんでした。' }));
  }
  if (r.error) main.append(el('p', { class: 'errbox', text: r.error }));
  main.append(el('details', { class: 'request-details', open: live }, el('summary', { text: '依頼した内容を見る' }),
    el('dl', { class: 'defs left' }, el('dt', { text: '相手' }), el('dd', { text: r.request.name }), el('dt', { text: '番号' }), el('dd', { class: 'num', text: displayPhone(r.request.phone) })),
    el('p', { class: 'request-text', text: r.request.instruction })));
  const foot = el('div', { class: 'call-foot' });
  if (team) foot.append(el('a', { class: 'btn', href: '#/team', text: 'チームの電話に戻る' }));
  else if (live) foot.append(el('button', { class: 'btn danger', type: 'button', text: '通話を終える', onclick: async e => {
    e.currentTarget.disabled = true;
    try { await api(`/missions/${r.id}/cancel`, { method: 'POST', body: {} }); } catch (err) { toast(err.message); }
    route();
  } }), el('p', { class: 'note', text: '終えると、ここまでの内容で報告を作ります。' }));
  else {
    if (r.state === 'unknown' && !r.resolvedAt) foot.append(needCard(r).querySelector('button'));
    foot.append(el('a', { class: 'btn primary', href: `#/new?again=${r.id}`, text: '同じ相手にまた頼む' }));
    if (notes.some(n => n.field === 'date' && n.status === 'verified')) foot.append(el('a', { class: 'btn', href: `/v1/phone/calls/${r.id}/calendar.ics`, text: 'カレンダーに入れる' }));
    const used = r.creditUsage; if (used?.consumed) foot.append(el('p', { class: 'note', text: `消費 ${used.consumed} クレジット` }));
    if (!live && notes.length) foot.append(el('p', { class: 'note', text: ok === notes.length ? '輪が閉じました。相手の言葉で確かめられています。' : `${notes.length}項目中 ${ok} 項目を相手の言葉で確かめました。` }));
  }
  main.append(foot);
  const transcript = el('div', { class: 'transcript', 'aria-live': live ? 'polite' : 'off' },
    ...(r.transcript?.length ? r.transcript.map(t => el('div', { class: `line ${t.source === 'callee' ? 'callee' : ''}` },
      el('div', { class: 'who' }, t.source === 'callee' ? r.request.name : 'AI', typeof t.startMs === 'number' ? el('time', { text: mmss(t.startMs / 1000) }) : typeof t.t === 'number' ? el('time', { text: mmss(t.t / 1000) }) : null),
      marked(t.text, t.source === 'callee' ? notes.map((n, k) => ({ quote: n.status === 'verified' && n.turnId === t.id ? (n.span || n.quote) : n.status === 'verified' && !n.turnId ? n.quote : '', n: k + 1 })) : []),
      t.source !== 'callee' && CLAIMS_DONE.test(t.text) ? el('span', { class: 'claim', text: 'AIの発言・判定に数えません' }) : null,
      flagged.has(t.id) ? el('div', { class: 'flag-line' }, levelTag(flagged.get(t.id), flagged.get(t.id) === 'emergency' ? '緊急の発言' : '要確認の発言')) : null,
      !live && !r.checkIn && typeof t.startMs === 'number' && typeof t.endMs === 'number' ? el('span', { class: 'span num', text: `${clock(t.startMs)} – ${clock(t.endMs)}` }) : null))
      : [el('p', { class: 'empty', text: live ? 'つながると、ここに会話が出ます。' : '会話の記録はありません。' })]));
  const side = el('aside', { class: 'call-side', 'aria-label': live ? '会話' : '会話の記録' }, el('div', { class: 'side-top' }, el('b', { text: live ? '会話' : '会話の記録' }), el('span', { class: 'muted small', text: live ? '文字起こしは自動・音声は保存しません' : '相手とAIの発言・時刻' })), transcript);
  if (live) app.timer = setTimeout(async () => { if (location.hash.startsWith(here)) { const y = window.scrollY; const t = $('.transcript'); const atEnd = t && t.scrollHeight - t.scrollTop - t.clientHeight < 40; await route(); if (!location.hash.startsWith(here)) return; window.scrollTo(0, y); if (atEnd) { const n = $('.transcript'); if (n) n.scrollTop = n.scrollHeight; } } }, 1500);
  if (live) requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
  if (!team) renderBar();
  return el('div', { class: live ? 'call' : 'call finished' }, main, side);
}
function ringFor(n, flags) {
  const s = svg('svg', { class: 'ring', viewBox: '0 0 48 48', role: 'img', 'aria-label': `${n}項目中 ${flags.filter(Boolean).length} 項目を確認` });
  const r = 19, c = 2 * Math.PI * r, q = c / n, gap = n > 1 ? Math.min(3, q * 0.18) : 0, on = flags.filter(Boolean).length;
  const g = svg('g', { transform: 'rotate(-90 24 24)' });
  g.append(svg('circle', { class: 'track', cx: 24, cy: 24, r, fill: 'none', 'stroke-width': 4 }));
  if (on === n) g.append(svg('circle', { class: 'on', cx: 24, cy: 24, r, fill: 'none', 'stroke-width': 4 }));
  else flags.forEach((f, i) => { if (f) g.append(svg('circle', { class: 'on', cx: 24, cy: 24, r, fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': `${q - gap} ${c - q + gap}`, 'stroke-dashoffset': -(i * q + gap / 2) })); });
  const t = svg('text', { x: 24, y: 23, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9, 'font-weight': 600 }); t.textContent = `${on}/${n}`;
  const t2 = svg('text', { x: 24, y: 31, 'text-anchor': 'middle', 'font-size': 4 }); t2.textContent = '確認';
  s.append(g, t, t2);
  return s;
}

// ---------------------------------------------------------------- 予定
// Dates and times that calls settled or proposed, from each call's record (the evidence engine's notes, the sales
// verdict). 確定 only when the other party's words settled both the day and the time; otherwise 未確定.
function scheduleEntries() {
  const out = [];
  for (const r of app.history) {
    if (r.state === 'draft') continue;
    const notes = notesOf(r), meeting = notes.find(n => n.field === 'meeting_agreed_on_call' && n.value !== undefined);
    if (meeting) { const d = new Date(meeting.value); if (!isNaN(d)) out.push({ r, at: d, time: d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }), settled: meeting.status === 'verified', what: '商談' }); continue; }
    const date = notes.find(n => n.field === 'date' && n.value !== undefined), time = notes.find(n => n.field === 'time' && n.value !== undefined);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date.value))) continue;
    const hhmm = time && /^\d{2}:\d{2}$/.test(String(time.value)) ? String(time.value) : null;
    const party = notes.find(n => n.field === 'partySize' && n.value !== undefined);
    out.push({ r, at: new Date(`${date.value}T${hhmm ?? '00:00'}:00+09:00`), time: hhmm, settled: date.status === 'verified' && time?.status === 'verified' && notes.every(n => n.field !== 'confirmed' || n.status === 'verified'),
      what: [r.sales ? '商談' : r.request?.conversationMode === 'chat' ? '約束' : '予約', party ? `${party.value}名` : ''].filter(Boolean).join(' ・ ') });
  }
  return out.sort((a, b) => a.at - b.at);
}
async function schedule(monthKey) {
  await loadAll();
  const entries = scheduleEntries(), now = new Date(), tokyo = d => new Date(d.getTime() + 9 * 3600e3);
  const today = tokyo(now).toISOString().slice(0, 10);
  const [y, m] = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey.split('-').map(Number) : [tokyo(now).getUTCFullYear(), tokyo(now).getUTCMonth() + 1];
  const dayKey = e => tokyo(e.at).toISOString().slice(0, 10), key = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
  const prev = m === 1 ? key(y - 1, 12) : key(y, m - 1), next = m === 12 ? key(y + 1, 1) : key(y, m + 1);
  // The month as a grid: a day with a settled entry gets a jade dot, one only proposed an amber ring.
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = first.getUTCDay();
  const byDay = new Map(); for (const e of entries) { const k = dayKey(e); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
  const grid = el('div', { class: 'cal', role: 'grid', 'aria-label': `${y}年${m}月` }, ...'日月火水木金土'.split('').map(w => el('div', { class: 'cal-h', role: 'columnheader', text: w })),
    ...Array.from({ length: lead }, () => el('div', { class: 'cal-d empty' })),
    ...Array.from({ length: days }, (_, i) => { const k = `${key(y, m)}-${String(i + 1).padStart(2, '0')}`, list = byDay.get(k) ?? [];
      return el(list.length ? 'button' : 'div', { class: `cal-d ${k === today ? 'today' : ''}`, role: 'gridcell', ...(list.length ? { type: 'button', onclick: () => document.getElementById(`day-${k}`)?.scrollIntoView({ block: 'start' }) } : {}), 'aria-label': `${m}月${i + 1}日${list.length ? `、予定${list.length}件` : ''}` },
        el('span', { class: 'n', text: String(i + 1) }), el('span', { class: 'dots' }, ...list.slice(0, 3).map(e => el('i', { class: e.settled ? 'ok' : 'wait' })))); }));
  const upcoming = entries.filter(e => dayKey(e) >= today), past = entries.filter(e => dayKey(e) < today).reverse();
  const dayList = list => { const groups = new Map(); for (const e of list) { const k = dayKey(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    return [...groups].map(([k, items]) => el('section', { class: 'day', id: `day-${k}` }, el('h3', { class: 'section-h', text: fmtDate(k) + (k === today ? '　今日' : '') }),
      el('div', { class: 'rows' }, ...items.map(e => el('a', { class: 'row', href: `#/call/${e.r.id}` },
        el('div', {}, el('div', { class: 'who' }, el('span', { class: 'num', text: e.time ?? '時刻未定' }), '　', e.r.request.name), el('div', { class: 'what', text: e.what })),
        el('div', { class: `outcome ${e.settled ? '' : 'warn'}` }, e.settled ? el('span', { class: 'tick', text: '✓' }) : null, e.settled ? '相手の言葉で確定' : '未確定（提案・確認待ち）')))))); };
  return el('div', { class: 'page' },
    el('div', { class: 'page-h' }, el('h1', { text: '予定' }), el('span', { class: 'sub', text: '電話で決まった日時です。確定は、相手の言葉で日時が確かめられたものだけです。' })),
    el('div', { class: 'grid-2' },
      el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('a', { class: 'link', href: `#/schedule/${prev}`, text: '‹ 前の月' }), el('b', { class: 'section-h', text: `${y}年${m}月` }), el('a', { class: 'link', href: `#/schedule/${next}`, text: '次の月 ›' })), grid,
        el('p', { class: 'note' }, el('i', { class: 'legend ok' }), ' 相手の言葉で確定　', el('i', { class: 'legend wait' }), ' 未確定')),
      el('div', { class: 'card' }, el('h2', { text: 'カレンダーに入れる' }), el('p', { class: 'about', text: '報告の画面の「カレンダーに入れる」から、1件ずつあなたのカレンダー（iPhone・Google など）に読み込めます。未確定のものは「未確定」と書かれた仮の予定になります。' }))),
    el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'これからの予定' })),
    upcoming.length ? el('div', { class: 'stack' }, ...dayList(upcoming)) : el('p', { class: 'muted', text: 'これからの予定はありません。予約や商談の電話で日時が決まると、ここに並びます。' }),
    ...(past.length ? [el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'これまで' })), el('div', { class: 'stack' }, ...dayList(past.slice(0, 20)))] : []));
}

// ---------------------------------------------------------------- 定期の電話
// Standing requests: approved once with bounds, each call checked again when it is due (lib/schedules.mjs).
const WEEK = '日月火水木金土';
const SCHED_STATE = { ACTIVE: '有効', PAUSED: '一時停止中', ENDED: '終了' };
const SCHED_ENDED = { ended_by_owner: 'あなたが終了しました。', reached_end_date: '終了日になりました。', recipient_asked_not_to_be_called: '相手から、電話しないでほしいと言われました。', recipient_suppressed: '相手が連絡停止になりました。',
  contact_changed_review_again: '連絡先の内容が変わったため、止めました。もう一度登録してください。', privacy_consent_required: '会話データの取り扱いへの同意が必要になりました。', unauthorized: 'このアカウントでは発信できなくなりました。', read_only_account: 'このアカウントでは発信できなくなりました。', unlinked_account: 'このアカウントでは発信できなくなりました。', not_found: '連絡先かアカウントが見つからなくなりました。' };
const RUN_STATE = { RUNNING: 'かけています', ANSWERED: '応答あり', UNANSWERED: '応答なし', SKIPPED: '見送り', FAILED: 'かけられませんでした', DECLINED: '相手に断られました', CANCELLED: '取り消しました' };
const RUN_REASON = { window_passed: '時刻を過ぎたため、遅れてかけずに見送りました。', service_was_not_running: 'サービスが止まっていたため、この回はかけていません。', schedule_deleted: '定期の電話が削除されています。', record_deleted: '電話の記録が削除されています。', unknown_state_needs_reconciliation: '電話が終わったか確かめられていません。「依頼」で確かめてください。',
  recipient_has_active_call: '同じ相手への電話が進行中でした。', schedule_deleted: 'この定期の電話は、もうありません。', recipient_asked_not_to_be_called: '相手から、電話しないでほしいと言われました。', dispatch_failed: '発信の準備ができませんでした。', contact_changed_review_again: '連絡先の内容が変わっていました。' };
const runReason = run => !run.reason ? (run.state === 'DECLINED' ? '相手から、電話しないでほしいと言われました。' : '') : RUN_REASON[run.reason] ?? ERRORS[run.reason] ?? `（問い合わせ用コード：${run.reason}）`;
const schedDays = s => s.weekdays.length === 7 ? '毎日' : `毎週 ${s.weekdays.map(d => WEEK[d]).join('・')}`;
// The next time it is due, from its own times, weekdays and end date (Japan time). A time already run today is not next.
function nextRun(s) {
  if (s.status !== 'ACTIVE') return null;
  const now = Date.now(), until = Date.parse(s.until);
  for (let d = 0; d < 8; d++) {
    const day = new Date(now + 9 * 3600e3 + d * 86400e3), date = day.toISOString().slice(0, 10);
    if (!s.weekdays.includes(day.getUTCDay())) continue;
    for (const time of s.times) { const at = Date.parse(`${date}T${time}:00+09:00`); if (at > now && at <= until && !s.runs.some(r => r.date === date && r.time === time)) return `${fmtDate(date)} ${time}`; }
  }
  return null;
}
function scheduleCard(s) {
  const act = (path, done, ask) => async e => {
    if (ask && !confirm(ask)) return;
    const b = e.currentTarget; b.disabled = true;
    try { const next = scheduleCard(await api(`/schedules/${s.id}/${path}`, { method: 'POST', body: {} })); node.replaceWith(next); toast(done); (next.querySelector('.actions .btn') ?? next.querySelector('summary'))?.focus(); }
    catch (x) { toast(x.message); b.disabled = false; }
  };
  const next = nextRun(s);
  const node = el('article', { class: 'card sched', 'data-status': s.status },
    el('div', { class: 'sched-h' }, el('h2', { text: s.request.name }), el('span', { class: `tag sched-state ${s.status === 'ACTIVE' ? 'on' : ''}`, text: SCHED_STATE[s.status] ?? s.status })),
    el('p', { class: 'sched-when' }, schedDays(s), ' ', el('span', { class: 'num', text: s.times.join('、') })),
    el('dl', { class: 'defs left' },
      ...(s.status === 'ENDED' ? [el('dt', { text: '終了の理由' }), el('dd', { text: SCHED_ENDED[s.endedReason] ?? '終了しました。' })] : [el('dt', { text: '次の回' }), el('dd', { text: next ?? (s.status === 'PAUSED' ? '一時停止中はかけません' : '8日以内の予定はありません') })]),
      el('dt', { text: s.status === 'ENDED' ? '予定していた終了日' : '終了日' }), el('dd', { text: fmtDate(new Date(Date.parse(s.until) + 9 * 3600e3).toISOString().slice(0, 10)) }),
      el('dt', { text: '出ないとき' }), el('dd', { text: s.retries.count ? `${s.retries.minutes}分後にかけ直す（${s.retries.count}回まで）` : 'かけ直さない' }),
      ...(s.status === 'ENDED' ? [] : [el('dt', { text: '回数の上限' }), el('dd', { text: `終了日までに最大 ${s.bounds.callsUpperBound} 回（これからの${s.bounds.occurrences}回${s.retries.count ? ` × かけ直しを含め${1 + s.retries.count}回` : ''}・かける日 ${s.bounds.days}日）` })]),
      ...(s.request.pace === 'gentle' ? [el('dt', { text: '話す速さ' }), el('dd', { text: 'ゆっくり・やさしく話す' })] : [])),
    el('h3', { class: 'section-h', text: 'これまでの回' }),
    s.runs.length ? el('ul', { class: 'runs' }, ...s.runs.slice(0, 7).map(run => el('li', {},
      el('time', { text: `${fmtDate(run.date)} ${run.time}` }), ['UNANSWERED', 'FAILED', 'DECLINED', 'SKIPPED'].includes(run.state) ? missTag(RUN_STATE[run.state]) : el('b', { class: 'run-state', text: RUN_STATE[run.state] ?? run.state }),
      el('span', { class: 'run-why', text: [runReason(run), run.attempts > 1 ? `${run.attempts}回かけました。` : ''].filter(Boolean).join(' ') }),
      run.missionId && run.reason !== 'record_deleted' ? el('a', { class: 'link', href: `#/call/${run.missionId}`, text: '報告を開く' }) : null)))
      : el('p', { class: 'muted small', text: 'まだかけていません。' }),
    el('details', { class: 'request-details' }, el('summary', { text: '依頼した内容を見る' }),
      el('dl', { class: 'defs left' }, el('dt', { text: '相手' }), el('dd', { text: s.request.name }), el('dt', { text: '番号' }), el('dd', { class: 'num', text: displayPhone(s.request.phone) })),
      el('p', { class: 'request-text', text: s.request.instruction })),
    s.status === 'ENDED' ? null : el('div', { class: 'actions' },
      s.status === 'ACTIVE' ? el('button', { class: 'btn', type: 'button', text: '一時停止', onclick: act('pause', '一時停止しました。') }) : el('button', { class: 'btn primary', type: 'button', text: '再開する', onclick: act('resume', '再開しました。') }),
      el('button', { class: 'btn danger', type: 'button', text: '終了する', onclick: act('end', '終了しました。', `「${s.request.name}」への定期の電話を終了しますか？\n終了すると、再開できません。`) })));
  return node;
}
async function standing() {
  const box = el('div', { class: 'sched-list' });
  loadInto(box, () => api('/schedules'), list => list.length ? list.map(scheduleCard)
    : el('div', { class: 'card' }, el('h2', { text: 'まだ定期の電話はありません' }),
      el('p', { class: 'about', text: '「電話を頼む」で内容を確かめたあと、「定期の電話にする」を選ぶと登録できます。連絡先に保存した相手だけにかけられます。' }), el('a', { class: 'btn primary', href: '#/new', text: '依頼の内容を入力' })));
  return el('div', { class: 'page' },
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'),
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '定期の電話' }), el('p', { class: 'page-intro', text: '一度承認した内容で、決めた時刻に繰り返しかける電話です。1回ごとに、ふつうの電話と同じ確認をします。' }))),
    box);
}

// ---------------------------------------------------------------- 名簿にまとめて電話
// One approval for the same call to many saved contacts (lib/batches.mjs). The calls leave one at a time, each through
// the ordinary checks. Who will and will not be called comes from the server's preview (nothing is created by it), so it is
// on screen before the approval; the server decides again when the list is registered.
const SKIP_WHY = { contact_phone_required: '電話番号がありません', recipient_suppressed: '連絡停止中です', simulator_contact_not_valid_for_live: '練習用の連絡先です', contact_relationship_required: '「この相手との関係」が登録されていません',
  contact_basis_required: '「電話してよい根拠」が書かれていません', ended_by_owner: '名簿を終了したため、かけていません', batch_expired: '7日の期限が過ぎたため、かけていません' };
const LIST_GOAL = { materials: ['資料を送ってよいか聞く', '商品を簡単に説明して、資料を送ってよいか聞いてください。'], meeting: ['商談の日時を決める', '商品を説明して、興味があれば15分の商談の日時を相談してください。'], introduce: ['商品を説明する', '商品を簡単に説明してください。'] };
async function listNew() {
  await loadAll();
  const b = app.boot, picked = b.contacts.filter(c => app.listPick?.has(c.id));
  if (!picked.length) return el('div', { class: 'page' }, el('div', { class: 'page-h' }, el('h1', { text: '名簿にまとめて電話' })),
    el('p', { class: 'about', text: '先に、連絡先の画面で「名簿にまとめて電話」を押して、相手を選んでください。' }), el('div', { class: 'actions' }, el('a', { class: 'btn primary', href: '#/contacts', text: '連絡先で相手を選ぶ' })));
  const form = { kind: 'request', key: null }, live = b.configuration.mode === 'live', consented = b.account?.consentVersion === b.configuration.consentVersion;
  const kindPick = el('div', { class: 'two', role: 'radiogroup', 'aria-label': '何の電話か' }, ...[['request', 'ふつうの依頼', '同じ用件を、ひとりずつに頼みます（納期の確認など）'], ['sales', '営業の電話', b.products.length ? '確認済みの商品を1つ紹介します' : '先に、設定で商品を登録してください']].map(([v, l, d]) =>
    el('label', { class: 'option' }, el('input', { type: 'radio', name: 'list-kind', value: v, checked: v === form.kind, disabled: v === 'sales' && !b.products.length, onchange: () => { form.kind = v; changed(); } }), el('span', {}, el('b', { text: l }), el('span', { class: 'muted small', text: d })))));
  const product = el('select', { id: 'list-product' }, ...b.products.map(x => el('option', { value: x.id, text: x.name })));
  const goal = el('select', { id: 'list-goal' }, ...Object.entries(LIST_GOAL).map(([v, [l]]) => el('option', { value: v, text: l })));
  const salesText = el('textarea', { id: 'list-sales-text', maxlength: '2000' }); salesText.value = LIST_GOAL.materials[1];
  let salesEdited = false; salesText.addEventListener('input', () => { salesEdited = true; });
  goal.addEventListener('change', () => { if (!salesEdited) salesText.value = LIST_GOAL[goal.value][1]; });
  const text = el('textarea', { id: 'list-text', maxlength: '2000', placeholder: '例：ご注文いただいている品の、納品の予定日を確認してください。日付を復唱して確かめてください。' });
  const gentle = el('input', { type: 'checkbox', id: 'list-gentle' });
  const count = el('select', { id: 'list-retry' }, ...[['0', 'かけ直さない'], ['1', '1回かけ直す'], ['2', '2回までかけ直す']].map(([v, l]) => el('option', { value: v, text: l })));
  const gap = el('select', { id: 'list-gap', 'aria-label': 'かけ直すまでの間隔' }, ...[[30, '30分後に'], [60, '1時間後に'], [120, '2時間後に'], [240, '4時間後に'], [1440, '翌日に']].map(([v, l]) => el('option', { value: String(v), text: l })));
  gap.value = '60';
  const salesBox = el('div', { class: 'stack tight' }, el('label', { class: 'lbl', for: 'list-product', text: '紹介する商品' }), product, el('label', { class: 'lbl', for: 'list-goal', text: '電話の目的' }), goal,
    el('label', { class: 'lbl', for: 'list-sales-text', text: 'AIに頼むこと' }), salesText, el('p', { class: 'note', text: '商品の説明は、確認済みの内容だけを使います。値引き・契約・支払いは約束しません。' }));
  const requestBox = el('div', { class: 'stack tight' }, el('label', { class: 'lbl', for: 'list-text', text: '頼むこと（全員に同じ内容。相手の名前は、ひとりずつ入ります）' }), text,
    el('label', { class: 'check' }, gentle, 'ゆっくり・やさしく話す'), el('p', { class: 'note', text: '高齢の方や、耳の遠い方に。ゆっくり、やさしい言葉で話し、返事を長めに待ちます。予約を取る電話は、名簿ではかけられません。' }));
  const side = el('aside', { class: 'ask-side rep-open', 'aria-label': '名簿の確認' });
  const ack = el('input', { type: 'checkbox', id: 'list-ack' }), err = el('p', { class: 'errbox', role: 'alert', hidden: true });
  const go = el('button', { class: 'btn primary big', type: 'button', text: 'この名簿で電話を始める', disabled: true });
  const paused = isPaused(b.configuration);
  const version = routeVersion, previews = {};
  const sync = () => { go.disabled = !ack.checked || !previews[form.kind]?.callable || paused || !consented; };
  const preview = async kind => {
    try { previews[kind] = await api('/batches/preview', { method: 'POST', body: { kind, contactIds: picked.map(c => c.id) } }); } catch (e) { if (e.stale) return; previews[kind] = { failed: e.message }; }
    if (version === routeVersion && form.kind === kind) changed();
  };
  ack.addEventListener('change', sync);
  const who = c => c.name || c.company;
  function changed() {
    form.key = null; ack.checked = false; err.hidden = true;
    salesBox.hidden = form.kind !== 'sales'; requestBox.hidden = form.kind !== 'request'; gap.hidden = count.value === '0';
    const pv = previews[form.kind], phoneOf = id => displayPhone(picked.find(c => c.id === id)?.phone);
    if (!pv || pv.failed) {
      if (!pv) preview(form.kind);
      side.replaceChildren(el('div', { class: 'side-h' }, el('small', { text: '名簿の確認' }), el('b', { text: '発信前の最終確認' })),
        pv?.failed ? el('p', { class: 'errbox', role: 'alert', text: `かける相手を確かめられませんでした。${pv.failed}` }) : el('p', { class: 'muted', role: 'status', text: 'かける相手を確かめています…' }),
        pv?.failed ? el('button', { class: 'btn', type: 'button', text: 'もう一度確かめる', onclick: () => { delete previews[form.kind]; changed(); } }) : null);
      return sync();
    }
    const yes = pv.items.filter(i => i.state === 'PENDING'), no = pv.items.filter(i => i.state !== 'PENDING'), tries = 1 + Number(count.value);
    const retry = count.value === '0' ? 'かけ直さない' : `${gap.selectedOptions[0].textContent}、${count.value}回までかけ直す`;
    const hoursText = pv.hours ? `${pv.hours.from}〜${pv.hours.to} の間だけかけます。時間の外では、かけずに待ちます。` : 'かける時間帯の決まりはありません。';
    side.replaceChildren(
      el('div', { class: 'side-h' }, el('small', { text: '名簿の確認' }), el('b', { text: '発信前の最終確認' })),
      el('h2', { class: 'section-h list-h', text: `電話をかける相手　${yes.length}人` }),
      yes.length ? el('ul', { class: 'list-who' }, ...yes.map(i => el('li', {}, el('b', { text: i.name }), el('span', { class: 'num', text: phoneOf(i.contactId) })))) : el('p', { class: 'warnbox', text: 'かけられる相手がいません。' }),
      ...(no.length ? [el('h2', { class: 'section-h list-h', text: `かけない相手　${no.length}人` }),
        el('ul', { class: 'list-who no' }, ...no.map(i => el('li', {}, el('b', { text: i.name }), el('span', { text: SKIP_WHY[i.reason] ?? '対象外です' })))),
        el('p', { class: 'note', text: '連絡先を直すと、次の名簿からかけられます。登録するときに、もう一度確かめます。' })] : []),
      el('dl', { class: 'defs left' }, el('dt', { text: '内容' }), el('dd', { text: form.kind === 'sales' ? `営業の電話（${b.products.find(x => x.id === product.value)?.name ?? '商品'}・${LIST_GOAL[goal.value][0]}）` : `ふつうの依頼${gentle.checked ? '（ゆっくり・やさしく話す）' : ''}` }),
        el('dt', { text: '電話の回数' }), el('dd', { text: `最大 ${yes.length * tries} 回（かける${yes.length}人${tries > 1 ? ` × かけ直しを含め${tries}回` : ' × 1回'}）` }),
        el('dt', { text: 'いつから' }), el('dd', { text: pv.hours ? `承認するとすぐ、${pv.hours.from}〜${pv.hours.to} の間に順にかけ始めます` : '承認するとすぐ、順にかけ始めます' }),
        el('dt', { text: '出ないとき' }), el('dd', { text: retry }), el('dt', { text: '期限' }), el('dd', { text: '登録から7日で終わる' })),
      el('ul', { class: 'rep-rules' }, ...['1件ごとに、ふつうの電話と同じ確認をして、同じように費用がかかります。電話は1件ずつ順にかけます。',
        hoursText,
        'クレジットや月の上限が足りなくなると、名簿は一時停止します。', '登録から7日たつと、残りはかけずに終わります。', '断った相手には、もうかけません。その番号は連絡停止になります。', '「名簿の電話」の画面で、いつでも一時停止・終了できます。'].map(t => el('li', { text: t }))),
      ...(live ? [] : [el('p', { class: 'warnbox', text: '練習モード：実際の電話はかかりません。費用もかかりません。' })]),
      ...(paused ? [el('p', { class: 'warnbox', text: '発信の受付を一時停止しています。名簿は登録できません。' })] : []),
      ...(consented ? [] : [el('p', { class: 'warnbox' }, '会話データの取り扱いへの同意が必要です。', el('a', { href: '#/new', text: '「電話を頼む」で同意する' }))]),
      err,
      el('label', { class: 'check' }, ack, `上の決まりを読みました。この${yes.length}人に、同じ内容で電話をかけることを承認します。`), go);
    sync();
  }
  for (const n of [product, goal, gentle, count, gap]) n.addEventListener('change', changed);
  go.addEventListener('click', async () => {
    const body = form.kind === 'sales' ? salesText.value.trim() : text.value.trim(); err.hidden = true;
    if (!body) { err.textContent = '頼むことを書いてください。'; err.hidden = false; (form.kind === 'sales' ? salesText : text).focus(); return; }
    go.disabled = true; form.key ??= crypto.randomUUID();
    try {
      await api('/batches', { method: 'POST', headers: { 'Idempotency-Key': form.key }, body: { kind: form.kind, contactIds: picked.map(c => c.id),
        ...(form.kind === 'sales' ? { sales: { productId: product.value, request: body, goal: goal.value } } : { request: { instruction: body, ...(gentle.checked ? { pace: 'gentle' } : {}), ...(b.account?.callerName ? { callerName: b.account.callerName } : {}) } }),
        retry: { count: Number(count.value), minutes: Number(gap.value) }, acknowledged: true } });
      app.listPick = null; app.boot = null; toast('名簿を登録しました。順に電話をかけます。'); location.hash = '#/lists';
    } catch (e) { if (e.status) form.key = null; err.textContent = e.message; err.hidden = false; sync(); }
  });
  for (const n of [text, salesText]) n.addEventListener('input', () => { form.key = null; });
  const field = (k, d, ...content) => el('div', { class: 'field' }, el('div', { class: 'k' }, el('b', { text: k }), d ? el('span', { text: d }) : null), el('div', {}, ...content));
  changed();
  return el('div', { class: 'ask' },
    el('section', { class: 'ask-form' },
      el('div', { class: 'crumb' }, el('a', { href: '#/contacts', text: '連絡先' }), ' ›'), el('div', { class: 'ask-h' }, el('h1', { text: '名簿にまとめて電話' }),
        el('ol', { class: 'steps', 'aria-label': '手順' }, el('li', { class: 'done', text: '① 相手を選ぶ' }), el('li', { class: 'on', 'aria-current': 'step', text: '② 内容を決めて確認' }), el('li', { text: '③ 進み具合を見る' }))),
      field('だれに', `連絡先で選んだ ${picked.length}人`, el('p', { class: 'list-picked', text: picked.map(who).join('、') }), el('a', { class: 'link', href: '#/contacts', text: '相手を選び直す' })),
      field('何の電話か', '全員に同じ内容でかけます', kindPick, el('div', { class: 'gap' }), salesBox, requestBox),
      field('出なかったとき', 'だれも出なかった相手だけ。断られた相手にはかけ直しません', el('div', { class: 'two' }, gap, count))),
    side);
}
const BATCH_STATE = { ACTIVE: '進行中', PAUSED: '一時停止中', ENDED: '終了', FINISHED: '完了' };
function batchCard(bt) {
  const act = (path, done, ask) => async e => {
    if (ask && !confirm(ask)) return;
    const btn = e.currentTarget; btn.disabled = true;
    try { const next = batchCard(await api(`/batches/${bt.id}/${path}`, { method: 'POST', body: {} })); node.replaceWith(next); toast(done); (next.querySelector('.actions .btn') ?? next.querySelector('a'))?.focus(); }
    catch (x) { toast(x.message); btn.disabled = false; }
  };
  const total = bt.items.length, toCall = total - bt.counts.skipped, called = bt.counts.done + bt.counts.failed, bar = el('i'); bar.style.width = `${toCall ? Math.round(called / toCall * 100) : 0}%`;
  const progress = `かける${toCall}人のうち${called}人にかけ終えました${bt.counts.skipped ? `（かけない相手 ${bt.counts.skipped}人）` : ''}`;
  // Whether the person was reached, said once: the state is the result, the detail only adds what the state does not say.
  const state = i => i.state === 'CALLING' ? '電話中' : i.state === 'PENDING' ? (i.attempts ? 'かけ直しを待っています' : 'これからかけます')
    : i.state === 'SKIPPED' ? missTag('かけていません') : i.state === 'FAILED' || i.outcome === 'FAILED' ? missTag('かけられませんでした') : i.outcome === 'UNANSWERED' ? missTag('応答なし') : i.outcome === 'DECLINED' ? missTag('断られました')
    : i.outcome === 'UNKNOWN' ? missTag('要照合') : i.outcome === 'CANCELLED' ? '取り消しました' : i.outcome === 'RECORD_DELETED' ? '記録なし' : '話せました';
  const more = i => [i.state === 'SKIPPED' ? (SKIP_WHY[i.reason] ?? '対象外です') : i.state === 'FAILED' ? (ERRORS[i.reason] ?? `（問い合わせ用コード：${i.reason}）`) : i.outcome === 'UNKNOWN' ? '電話が終わったか確かめられていません。「依頼」で確かめてください。'
    : i.outcome === 'DECLINED' ? '今後はかけません。' : i.outcome === 'INCOMPLETE' ? '決まっていないことがあります。' : i.outcome === 'RECORD_DELETED' ? '電話の記録が削除されています。' : '',
    i.attempts > 1 ? `${i.attempts}回かけました。` : ''].filter(Boolean).join(' ');
  const node = el('article', { class: 'card sched', 'data-status': bt.status },
    el('div', { class: 'sched-h' }, el('h2', { text: `${bt.kind === 'sales' ? `営業の電話「${app.boot?.products.find(x => x.id === bt.spec.productId)?.name ?? '商品'}」` : `「${(bt.spec.instruction ?? '').slice(0, 20)}${(bt.spec.instruction ?? '').length > 20 ? '…' : ''}」`}・${total}人の名簿` }), el('span', { class: `tag sched-state ${bt.status === 'ACTIVE' ? 'on' : ''}`, text: BATCH_STATE[bt.status] ?? bt.status })),
    el('p', { class: 'sched-when' }, progress),
    el('div', { class: 'bar-meter', role: 'img', 'aria-label': progress }, bar),
    el('p', { class: 'note', text: `電話中 ${bt.counts.calling}人・これから ${bt.counts.pending}人${bt.counts.failed ? `・かけられなかった ${bt.counts.failed}人` : ''}` }),
    bt.status === 'PAUSED' && bt.pausedReason ? el('p', { class: 'warnbox', text: `一時停止の理由：${ERRORS[bt.pausedReason] ?? `（問い合わせ用コード：${bt.pausedReason}）`} 解消したら「再開する」を押してください。` }) : null,
    el('dl', { class: 'defs left' }, el('dt', { text: '登録' }), el('dd', { text: japanTime(new Date(bt.createdAt).toISOString()) }), el('dt', { text: '期限' }), el('dd', { text: `${japanTime(bt.expiresAt)} まで` }),
      el('dt', { text: '出ないとき' }), el('dd', { text: bt.retry?.count ? `${bt.retry.minutes >= 60 ? `${bt.retry.minutes / 60}時間` : `${bt.retry.minutes}分`}後にかけ直す（${bt.retry.count}回まで）` : 'かけ直さない' }),
      ...(bt.kind === 'sales' ? [el('dt', { text: '商品' }), el('dd', { text: app.boot?.products.find(x => x.id === bt.spec.productId)?.name ?? '—' })] : bt.spec.pace === 'gentle' ? [el('dt', { text: '話す速さ' }), el('dd', { text: 'ゆっくり・やさしく話す' })] : [])),
    el('div', { class: 'team-wrap list-items' }, el('table', { class: 'team-table' },
      el('thead', {}, el('tr', {}, ...['相手', '状態', 'くわしく', '報告'].map(h => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, ...bt.items.map(i => { const why = more(i); return el('tr', {},
        el('th', { scope: 'row', text: i.name || '（名前なし）' }), el('td', { 'data-label': '状態' }, state(i)),
        el('td', { 'data-label': 'くわしく', class: why ? '' : 'none' }, why || el('span', { class: 'muted', text: '—' })),
        el('td', { 'data-label': '報告', class: i.missionId && i.outcome !== 'RECORD_DELETED' ? '' : 'none' }, i.missionId && i.outcome !== 'RECORD_DELETED' ? el('a', { class: 'link', href: `#/call/${i.missionId}`, text: '報告を開く' }) : el('span', { class: 'muted', text: '—' }))); })))),
    el('details', { class: 'request-details' }, el('summary', { text: '頼んだ内容を見る' }), el('p', { class: 'request-text', text: bt.spec.instruction ?? bt.spec.request ?? '' })),
    ['ENDED', 'FINISHED'].includes(bt.status) ? null : el('div', { class: 'actions' },
      bt.status === 'ACTIVE' ? el('button', { class: 'btn', type: 'button', text: '一時停止', onclick: act('pause', '一時停止しました。') }) : el('button', { class: 'btn primary', type: 'button', text: '再開する', onclick: act('resume', '再開しました。') }),
      el('button', { class: 'btn danger', type: 'button', text: '終了する', onclick: act('end', '終了しました。', `この名簿を終了しますか？\nまだかけていない相手には、かけません。終了すると、再開できません。`) })));
  return node;
}
async function lists() {
  await loadAll();
  const box = el('div', { class: 'sched-list' });
  loadInto(box, () => api('/batches'), list => list.length ? list.map(batchCard)
    : el('div', { class: 'card' }, el('h2', { text: 'まだ名簿の電話はありません' }),
      el('p', { class: 'about', text: '連絡先の画面で「名簿にまとめて電話」を押し、相手を選ぶと、同じ内容の電話を順にかけられます。' }), el('a', { class: 'btn primary', href: '#/contacts', text: '連絡先で相手を選ぶ' })));
  return el('div', { class: 'page' },
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'),
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '名簿の電話' }), el('p', { class: 'page-intro', text: '一度承認した内容で、名簿の相手に順にかける電話です。1件ごとに、ふつうの電話と同じ確認をします。' })),
      el('a', { class: 'btn', href: '#/contacts', text: '新しい名簿を作る' })),
    box);
}

// ---------------------------------------------------------------- 折り返しの依頼
// People who rang a business line that could not answer and pressed 1 to be called back. The one screen that shows
// a caller's number: the staff need it to ring back.
const CALLBACK_WHY = { busy: '回線がふさがっていて、つながりませんでした。', outside_business_hours: '受付時間の外でした。', rate_limited: '着信が多く、受けられませんでした。' };
function callbackRow(c) {
  const me = app.boot.user.id, who = id => id === me ? '自分' : app.teamNames?.[id] || shortId(id);
  const node = el('div', { class: `row callback ${c.status === 'DONE' ? 'done' : ''}`, 'data-status': c.status },
    el('div', {}, el('div', { class: 'who' }, el('a', { class: 'num', href: `tel:${c.phone}`, text: displayPhone(c.phone) })), el('div', { class: 'what', text: CALLBACK_WHY[c.reason] ?? 'つながりませんでした。' })),
    c.status === 'DONE' ? el('div', { class: 'outcome dim', text: `折り返し済み（${who(c.doneBy)}・${japanTime(c.doneAt)}）` })
      : el('button', { class: 'btn primary', type: 'button', text: '折り返しました', onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try { await api(`/callbacks/${c.id}/done`, { method: 'POST', body: {} }); const next = callbackRow({ ...c, status: 'DONE', doneBy: me, doneAt: new Date().toISOString() }); node.replaceWith(next); next.querySelector('a')?.focus(); toast('折り返し済みにしました。'); }
        catch (x) { toast(x.message); b.disabled = false; }
      } }),
    el('time', { class: 'num', datetime: c.createdAt, text: japanTime(c.createdAt) }));
  return node;
}
async function callbacks() {
  const box = el('div', { class: 'callback-list' });
  loadInto(box, () => api('/callbacks'), d => { const list = [...d.callbacks].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return list.length ? el('div', { class: 'rows' }, ...list.map(callbackRow)) : el('div', { class: 'rows' }, el('p', { class: 'empty', text: '折り返しの依頼はありません。' })); });
  return el('div', { class: 'page' },
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'),
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '折り返しの依頼' }), el('p', { class: 'page-intro', text: '電話がつながらなかった方が、折り返しを希望して残した番号です。新しい順に並べています。' }))),
    el('p', { class: 'caveat callback-note', text: 'かけてきた方には「折り返しの希望を担当に伝えます」とだけ案内しています。折り返すことは約束していません。折り返しの電話は、あなたがかけてください。' }),
    box);
}

// ---------------------------------------------------------------- チームの電話
// A manager or administrator sees the calls of their own team (lib/team.mjs): no phone numbers, no speech in the list.
const TEAM_STATUS = { COMPLETED: '確認済み', INCOMPLETE: '未確定', DECLINED: '辞退・連絡停止', FAILED: '発信できず', UNKNOWN: '要照合', CANCELLED: '取消' };
const shortId = v => String(v).length > 14 ? `${String(v).slice(0, 8)}…` : String(v);
async function team() {
  if (!isSupervisor()) return el('div', { class: 'page' }, el('div', { class: 'page-h' }, el('h1', { text: 'チームの電話' })),
    el('p', { class: 'muted', text: 'この画面は、管理者とマネージャーだけが開けます。' }), el('div', { class: 'actions' }, el('a', { class: 'btn', href: '#/', text: 'ホームへ' })));
  let only = app.teamAttention === true;
  const box = el('div', { class: 'team-box' }), me = app.boot.user.id;
  const filter = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(only), text: '要確認だけ', onclick: () => { only = !only; app.teamAttention = only; filter.setAttribute('aria-pressed', String(only)); read(); } });
  const total = el('span', { class: 'sub', role: 'status' });
  // The verdict, only where a call had something to settle (a sales call), as a small label apart from how the call went.
  const verdict = c => c.kind === 'sales' && ['COMPLETED', 'INCOMPLETE'].includes(c.status) ? el('span', { class: 'verdict-tag', text: c.status === 'COMPLETED' ? '決まりました' : '決まっていません' }) : null;
  const rank = c => c.attention === 'emergency' ? 0 : c.attention ? 1 : 2;
  const cell = (label, content) => el('td', { 'data-label': label, class: content ? '' : 'none' }, content ?? el('span', { class: 'muted', text: '—' }));
  const draw = data => {
    // What needs a look first (緊急, then 要確認), then by time as the server sent them.
    data.calls.sort((x, y) => rank(x) - rank(y));
    app.teamNames = Object.fromEntries(data.calls.map(c => [c.owner, c.ownerName]));
    filter.textContent = `要確認だけ（${data.needsAttention}件）`;
    total.textContent = data.total > data.calls.length ? `${data.total}件のうち、新しい${data.calls.length}件` : `${data.total}件`;
    if (!data.calls.length) return el('div', { class: 'rows' }, el('p', { class: 'empty', text: only ? '要確認の電話はありません。' : 'まだチームの電話はありません。' }));
    return el('div', { class: 'rows team-wrap' }, el('table', { class: 'team-table' },
      el('thead', {}, el('tr', {}, ...['日時', '頼んだ人', '相手', '電話の結果', '要確認', '話したこと（見守りの返事）'].map(h => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, ...data.calls.map(c => el('tr', { class: c.attention ? `need-${c.attention}` : '' },
        el('td', { 'data-label': '日時' }, el('time', { datetime: c.createdAt, text: new Date(c.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })),
        el('td', { 'data-label': '頼んだ人', text: c.owner === me ? '自分' : c.ownerName || shortId(c.owner) }),
        el('th', { scope: 'row', 'data-label': '相手' }, c.kind === 'request' ? el('a', { href: `#/team/${c.id}`, text: c.recipient || '（名前なし）' }) : el('span', { text: c.recipient || '（名前なし）' }),
          c.kind === 'sales' ? el('span', { class: 'tag', text: '営業' }) : null, c.direction === 'inbound' ? el('span', { class: 'tag', text: '着信' }) : null, c.scheduled ? el('span', { class: 'tag', text: '定期' }) : null),
        cell('電話の結果', [callWent(c), verdict(c)]),
        cell('要確認', c.attention ? levelTag(c.attention) : null),
        cell('話したこと（見守りの返事）', saidGlance(c.checkIn)))))));
  };
  const read = () => loadInto(box, () => api(`/team/calls${only ? '?attention=1' : ''}`), draw);
  read();
  // この7日間: plain numbers. The answer rate is of the calls where it is known whether anyone picked up.
  const sum = el('section', { class: 'team-sum', 'aria-label': 'この7日間' });
  loadInto(sum, () => api('/team/summary?days=7'), d => {
    const t = d.total, known = t.answered + t.unanswered, by = new Map(d.byDay.map(x => [x.date, x]));
    const tile = (k, v, note) => el('div', { class: 'sum-tile' }, el('dt', { text: k }), el('dd', {}, el('b', { text: v }), note ? el('span', { text: note }) : null));
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + 9 * 3600e3 - (6 - i) * 86400e3).toISOString().slice(0, 10));
    return [el('h2', { class: 'section-h', text: 'この7日間' }),
      el('dl', { class: 'sum-tiles' }, tile('電話', `${t.calls}件`),
        tile('応答', t.answerRatePercent === null ? '—' : `${t.answerRatePercent}%`, known ? `だれかが出たかを記録した${known}件のうち、${t.answered}件で応答。${t.calls > known ? `それより前の電話${t.calls - known}件には、この記録がありません。` : ''}` : 'だれかが出たかを記録した電話は、まだありません。'),
        tile('応答なし', `${t.unanswered}件`), tile('要確認', `${t.attention}件`, `うち緊急 ${t.emergency}件`)),
      el('ol', { class: 'sum-days', 'aria-label': '日ごとの件数' }, ...days.map(date => { const x = by.get(date);
        return el('li', { class: x?.attention ? 'has' : '' }, el('time', { datetime: date, text: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` }), el('span', { class: 'wd', text: WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()] }),
          el('b', { text: `${x?.calls ?? 0}件` }), el('span', { class: 'at', text: x?.attention ? `要確認${x.attention}` : '' }), el('span', { class: 'at', text: x?.emergency ? `（うち緊急${x.emergency}）` : '' })); }))];
  });
  return el('div', { class: 'page team-page' },
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'),
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: 'チームの電話' }), el('p', { class: 'page-intro', text: '同じチームの人が頼んだ電話です。一覧に電話番号と会話は出ません。相手の名前から報告を開けます（開いたことは記録されます）。' })),
      el('a', { class: 'btn', href: '/v1/team/calls.csv', download: 'oathra-team-calls.csv', text: 'CSVで保存' })),
    sum,
    el('div', { class: 'team-tools' }, filter, total),
    box,
    el('p', { class: 'note', text: '「話したこと」は、見守りの電話で本人が話した返事です。実際の様子を確かめたものではありません。営業の電話の報告は、頼んだ本人の画面で開きます。CSVに電話番号と会話は入りません。保存したことは記録されます。' }));
}

// ---------------------------------------------------------------- 練習
const FREE_NOTE = 'AIが「決まりました」と言っても、相手の言葉で確かめられるまで完了にはなりません。';
async function practice(id, sub) {
  app.practice ??= await api('/practice/scenarios');
  app.practiceBrains ??= await api('/practice/brains');
  if (id === 'record' && sub) return runView(await api(`/practice/records/${encodeURIComponent(sub)}`), { back: '#/practice', animate: false });
  const list = app.practice, sel = list.find(x => x.id === id) ?? list[0];
  const params = new URLSearchParams(location.hash.split('?')[1] ?? ''), chosen = params.get('ai') ?? '';
  if (sub === 'run' && sel) return practiceRun(sel, chosen);
  if (sub === 'play' && sel) return practicePlay(sel, chosen);
  const records = await api('/practice/records');
  let how = 'watch', brain = 'scripted';
  const brains = app.practiceBrains;
  const brainPick = brains.length > 1 ? el('div', { class: 'stack' },
    el('label', { class: 'lbl', for: 'practice-ai', text: '電話するAI' }),
    (() => { const sl = el('select', { id: 'practice-ai' }, ...brains.map(x => el('option', { value: x.id, text: x.paid ? `${x.label}（外部のAI・料金がかかります）` : x.label }))); sl.addEventListener('change', () => { brain = sl.value; const paid = !!brains.find(x => x.id === brain)?.paid; paidNote.hidden = !paid; costNote.textContent = paid ? `電話はかかりません。${FREE_NOTE}` : `電話はかからず、費用もかかりません。${FREE_NOTE}`; }); return sl; })()) : null;
  const costNote = el('p', { class: 'note', text: `電話はかからず、費用もかかりません。${FREE_NOTE}` });
  const paidNote = el('p', { class: 'note warn', hidden: true, text: '外部のAIを選ぶと、会話の内容がそのAIの会社に送られ、あなたのAPIキーに料金がかかります。電話はかかりません。' });
  const detail = sel ? el('div', { class: 'card stack' },
    el('span', { class: 'muted small', text: sel.difficulty }), el('h1', { class: 'headline', text: sel.title }),
    el('p', { class: 'about', text: sel.brief }),
    el('h2', { class: 'section-h', text: '確かめること' }), el('div', { class: 'chips' }, ...sel.require.map(f => el('span', { class: 'chip static', text: FIELD[f] ?? f }))),
    el('h2', { class: 'section-h', text: 'やり方' }),
    el('div', { class: 'two', role: 'radiogroup', 'aria-label': 'やり方' }, ...[['watch', 'AIの電話を見る', `AIが${sel.callee || '練習用の相手'}と話すのを見ます`], ['play', '自分が相手役', `あなたが${sel.callee || '相手'}として、文字で答えます`]].map(([v, l, d]) =>
      el('label', { class: 'option' }, el('input', { type: 'radio', name: 'how', value: v, checked: v === how, onchange: () => { how = v; } }), el('span', {}, el('b', { text: l }), el('span', { class: 'muted small', text: d }))))),
    ...(brainPick ? [brainPick, paidNote] : []),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '練習を始める', onclick: () => {
      location.hash = `#/practice/${sel.id}/${how === 'play' ? 'play' : 'run'}${brain !== 'scripted' ? `?ai=${encodeURIComponent(brain)}` : ''}`;
    } })),
    costNote)
    : el('div', { class: 'card' }, el('p', { class: 'muted', text: '練習がありません。' }));
  return el('div', { class: 'page' }, el('div', { class: 'split-page' },
    el('div', { class: 'stack' }, el('div', { class: 'page-h' }, el('h1', { text: '練習' })),
      el('p', { class: 'note', text: 'AIが店員役などと話します。電話はかからず、費用もかかりません。' }),
      el('div', { class: 'list' }, ...list.map(x => el('button', { class: 'item', type: 'button', 'aria-current': String(x.id === sel?.id), onclick: () => { location.hash = `#/practice/${x.id}`; } },
        el('span', { class: 'grow' }, el('b', { text: x.title }), el('span', { text: x.brief.slice(0, 40) })), el('span', { class: 'muted small', text: x.difficulty })))),
      ...(records.length ? [el('h2', { class: 'section-h', text: '記録' }), el('p', { class: 'note', text: 'このパソコンに保存した練習です（ターミナルの oathra play も含みます）。' }),
        el('div', { class: 'list' }, ...records.slice(0, 30).map(r => el('a', { class: 'item', href: `#/practice/record/${encodeURIComponent(r.id)}` },
          el('span', { class: 'grow' }, el('b', { text: r.title }), el('span', { text: [r.at ? new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '', r.brain && r.brain !== 'scripted' ? r.brain : ''].filter(Boolean).join(' · ') })),
          el('span', { class: `muted small`, text: r.complete ? '決まった' : '決まらず' }))))] : [])),
    detail));
}
async function practiceRun(sel, brain) {
  const b = (app.practiceBrains ?? []).find(x => x.id === brain);
  $('#view').replaceChildren(el('div', { class: 'page' }, el('p', { class: 'muted', role: 'status', text: b && b.id !== 'scripted' ? `${b.label} が電話しています。終わるまで数十秒かかることがあります…` : '練習の電話を準備しています…' })));
  const run = await api('/practice/run', { method: 'POST', body: { scenario: sel.id, ...(brain && brain !== 'scripted' ? { brain } : {}) } });
  return runView(run, { back: `#/practice/${sel.id}`, again: true, animate: true });
}
// A finished practice call, replayed line by line (or all at once for reduced motion / a saved record).
function runView(run, { back, again = false, animate = true }) {
  const here = location.hash;
  const fields = run.require, byTurn = new Map(), settled = new Map();
  for (const s of run.settled) { if (!byTurn.has(s.turnId)) byTurn.set(s.turnId, []); byTurn.get(s.turnId).push(s); }
  const ringBox = el('div'), cards = el('div', { class: 'fields' }), lines = el('div', { class: 'transcript', 'aria-live': 'polite' });
  const stateLine = el('div', { class: 'state-line state-live' }, el('span', { class: 'dot' }), '練習中'), headline = el('h1', { class: 'headline', text: `${run.scenario.callee || '相手'}と話しています` });
  const foot = el('div', { class: 'call-foot' });
  const drawFields = () => {
    ringBox.replaceChildren(fields.length ? ringFor(fields.length, fields.map(f => settled.has(f))) : '');
    cards.replaceChildren(...fields.map((f, k) => { const s = settled.get(f); return el('div', { class: `fcard ${s ? 'ok' : ''}` },
      el('div', { class: 'k', text: `${k + 1} ${FIELD[f] ?? f}` }), s ? el('span', { class: 'tick', text: '✓', 'aria-label': '相手の言葉で確認済み' }) : null,
      el('div', { class: `v ${s ? '' : 'want'}`, text: s ? fmtValue(f, s.value) : '—' }), el('div', { class: 'q', text: s ? `「${s.quote}」` : 'まだ確かめていません' })); }));
  };
  const finish = () => {
    stateLine.className = 'state-line'; stateLine.replaceChildren('練習が終わりました');
    headline.textContent = run.complete ? '決まりました' : '決まりませんでした';
    foot.replaceChildren(...(again ? [el('a', { class: 'btn primary', href: back, text: 'もう一度' })] : []), el('a', { class: 'btn', href: '#/practice', text: again ? '別の練習を選ぶ' : '練習に戻る' }),
      el('p', { class: 'note', text: [run.falseCompletion === undefined ? '' : `AIの勘違いで「決まった」にした項目：${run.falseCompletion ? 'あり' : 'なし'}。`, run.saved ? 'この練習は「記録」に保存しました。' : again ? '練習の記録は、このサーバーには残しません。' : ''].join('') }));
  };
  const show = i => {
    const t = run.transcript[i];
    const marks = t.source === 'callee' ? (byTurn.get(t.id) ?? []).map(s => ({ quote: s.quote, n: fields.indexOf(s.field) + 1 })) : [];
    lines.append(el('div', { class: `line ${t.source === 'callee' ? 'callee' : ''}` }, el('div', { class: 'who', text: t.source === 'callee' ? run.scenario.callee || '相手' : 'AI' }), marked(t.text, marks)));
    for (const s of byTurn.get(t.id) ?? []) settled.set(s.field, s);
    drawFields(); lines.scrollTop = lines.scrollHeight;
  };
  drawFields();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !animate) { run.transcript.forEach((_, i) => show(i)); finish(); }
  if (!again) {
    // Seek a saved call to a moment of the call clock: postMessage {type:"oathra.seek", ms, id} → {type:"oathra.seeked", id, ok}.
    // The video templates (video/*.html) drive the record view in an iframe with it.
    const end = Math.max(0, ...run.transcript.map(t => t.t ?? 0));
    const onSeek = e => {
      const d = e.data; if (!d || d.type !== 'oathra.seek') return;
      if (location.hash !== here) { window.removeEventListener('message', onSeek); return; }
      lines.replaceChildren(); settled.clear();
      run.transcript.forEach((t, i) => { if ((t.t ?? 0) <= d.ms) show(i); });
      drawFields();
      if (d.ms >= end) finish(); else { stateLine.className = 'state-line state-live'; stateLine.replaceChildren(el('span', { class: 'dot' }), '練習中'); headline.textContent = `${run.scenario.callee || '相手'}と話しています`; }
      e.source?.postMessage?.({ type: 'oathra.seeked', ms: d.ms, id: d.id, ok: true }, '*');
    };
    window.addEventListener('message', onSeek);
  }
  else if (still || !animate) { /* shown above */ }
  else { let i = 0; const tick = () => { if (location.hash !== here) return; if (i < run.transcript.length) { show(i++); app.timer = setTimeout(tick, 1100); } else finish(); }; app.timer = setTimeout(tick, 300); }
  const main = el('section', { class: 'call-main' },
    el('div', { class: 'crumb' }, el('a', { href: '#/practice', text: '練習' }), ' › ', el('b', { text: run.scenario.title }), el('span', { class: 'tag', text: again ? '練習' : '練習の記録' }), run.brain && run.brain !== 'scripted' ? el('span', { class: 'tag', text: run.brain }) : ''),
    el('div', { class: 'head' }, ringBox, el('div', {}, stateLine, headline)),
    ...(fields.length ? [el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '確かめること' }), el('span', { class: 'sub', text: '相手の言葉で確かめられたら、輪が一区切り閉じます' })), cards] : []),
    foot);
  return el('div', { class: 'call' }, main, el('aside', { class: 'call-side', 'aria-label': '会話' }, el('div', { class: 'side-top' }, el('b', { text: '会話' }), el('span', { class: 'muted small', text: '練習・電話はかかりません' })), lines));
}

// 自分が相手役: the AI (the offline scripted agent) calls you, and you answer as the shop in text. The verdict is the
// evidence engine's, as in every call: the ring closes only on what you, the callee, actually said.
async function practicePlay(sel, brain) {
  let st = await api('/practice/play', { method: 'POST', body: { scenario: sel.id, ...(brain && brain !== 'scripted' ? { brain } : {}) } });
  const fields = st.require, shown = new Set(), who = st.scenario.callee || '相手';
  const ringBox = el('div'), cards = el('div', { class: 'fields' }), lines = el('div', { class: 'transcript', 'aria-live': 'polite' });
  const stateLine = el('div', { class: 'state-line state-live' }, el('span', { class: 'dot' }), '練習中'), headline = el('h1', { class: 'headline', text: `AIが${who}に電話しています` });
  const foot = el('div', { class: 'call-foot' });
  const text = el('input', { type: 'text', id: 'play-text', autocomplete: 'off', maxlength: '500', 'aria-label': `${who}として答える` });
  const sendBtn = el('button', { class: 'btn primary', type: 'submit', text: '答える' });
  const hang = el('button', { class: 'btn', type: 'button', text: '電話を切る', onclick: async () => { hang.disabled = true; await api(`/practice/play/${st.id}/hangup`, { method: 'POST', body: {} }).catch(() => null); } });
  const form = el('form', { class: 'play-form', onsubmit: async e => {
    e.preventDefault(); const said = text.value.trim(); if (!said) return;
    sendBtn.disabled = true;
    try { await api(`/practice/play/${st.id}/reply`, { method: 'POST', body: { text: said } }); text.value = ''; }
    catch (err) { toast(err.message); } finally { sendBtn.disabled = false; text.focus(); }
  } }, el('label', { class: 'lbl', for: 'play-text', text: `${who}として答える（例：「はい、${who}です。」）` }), el('div', { class: 'play-row' }, text, sendBtn));
  const draw = () => {
    const settled = new Map(st.settled.map(s => [s.field, s])), byTurn = new Map();
    for (const s of st.settled) { if (!byTurn.has(s.turnId)) byTurn.set(s.turnId, []); byTurn.get(s.turnId).push(s); }
    ringBox.replaceChildren(fields.length ? ringFor(fields.length, fields.map(f => settled.has(f))) : '');
    cards.replaceChildren(...fields.map((f, k) => { const s = settled.get(f); return el('div', { class: `fcard ${s ? 'ok' : ''}` },
      el('div', { class: 'k', text: `${k + 1} ${FIELD[f] ?? f}` }), s ? el('span', { class: 'tick', text: '✓', 'aria-label': 'あなたの言葉で確認済み' }) : null,
      el('div', { class: `v ${s ? '' : 'want'}`, text: s ? fmtValue(f, s.value) : '—' }), el('div', { class: 'q', text: s ? `「${s.quote}」` : 'まだ確かめていません' })); }));
    const key = `${st.transcript.length}:${st.settled.length}`;
    if (key !== lines.dataset.key) { lines.dataset.key = key; lines.replaceChildren(); shown.clear(); }
    for (const t of st.transcript) {
      if (shown.has(t.id)) continue; shown.add(t.id);
      const marks = t.source === 'callee' ? (byTurn.get(t.id) ?? []).map(s => ({ quote: s.quote, n: fields.indexOf(s.field) + 1 })) : [];
      lines.append(el('div', { class: `line ${t.source === 'callee' ? 'callee' : ''}` }, el('div', { class: 'who', text: t.source === 'callee' ? `あなた（${who}）` : 'AI' }), marked(t.text, marks)));
      lines.scrollTop = lines.scrollHeight;
    }
    if (st.status !== 'running') {
      form.hidden = true; hang.hidden = true;
      stateLine.className = 'state-line'; stateLine.replaceChildren(st.status === 'error' ? '練習を続けられませんでした' : '練習が終わりました');
      headline.textContent = st.complete ? '決まりました' : '決まりませんでした';
      foot.replaceChildren(el('a', { class: 'btn primary', href: `#/practice/${sel.id}`, text: 'もう一度' }), el('a', { class: 'btn', href: '#/practice', text: '別の練習を選ぶ' }),
        el('p', { class: 'note', text: `AIが「決まりました」と言っても、あなた（相手）の言葉で確かめられた項目だけが決まったことになります。${st.saved ? 'この練習は「記録」に保存しました。' : '練習の記録は、このサーバーには残しません。'}` }));
    }
  };
  draw();
  const here = location.hash;
  const poll = async () => {
    if (location.hash !== here) { if (st.status === 'running') api(`/practice/play/${st.id}/hangup`, { method: 'POST', body: {} }).catch(() => null); return; }
    try { st = await api(`/practice/play/${st.id}`); draw(); } catch { /* next tick */ }
    if (st.status === 'running') app.timer = setTimeout(poll, 900);
  };
  app.timer = setTimeout(poll, 900);
  foot.replaceChildren(hang);
  setTimeout(() => text.focus(), 0);
  const main = el('section', { class: 'call-main' },
    el('div', { class: 'crumb' }, el('a', { href: '#/practice', text: '練習' }), ' › ', el('b', { text: st.scenario.title }), el('span', { class: 'tag', text: '練習・自分が相手役' })),
    el('div', { class: 'head' }, ringBox, el('div', {}, stateLine, headline)),
    el('p', { class: 'note play-note', text: `AIがあなたに電話をかけます。あなたは${who}として、ふつうに答えてください。空きがない・名前を聞くなど、困らせてもかまいません。` }),
    ...(fields.length ? [el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'AIが確かめること' }), el('span', { class: 'sub', text: 'あなたの言葉で確かめられたら、輪が一区切り閉じます' })), cards] : []),
    foot);
  return el('div', { class: 'call' }, main, el('aside', { class: 'call-side', 'aria-label': '会話' }, el('div', { class: 'side-top' }, el('b', { text: '会話' }), el('span', { class: 'muted small', text: '練習・電話はかかりません' })), lines, form));
}

// ---------------------------------------------------------------- 連絡先
// A CSV file as rows of cells: quoted cells, commas and line breaks inside quotes, "" for a quote, CRLF or LF.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch !== '"') cell += ch; else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
    else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const CSV_HEAD = { 名前: 'name', 氏名: 'name', name: 'name', 会社: 'company', 会社名: 'company', company: 'company', 電話番号: 'phone', 電話: 'phone', phone: 'phone', 関係: 'relationship', relationship: 'relationship',
  根拠: 'basis', basis: 'basis', メール: 'email', メールアドレス: 'email', email: 'email', メモ: 'notes', notes: 'notes' };
const CSV_RELATION = { 問い合わせ: 'inquiry', 問い合わせをもらった: 'inquiry', 既存のお客さま: 'customer', 既存客: 'customer', 顧客: 'customer', 同意済み: 'consented', 同意: 'consented', 電話の同意をもらった: 'consented' };
const IMPORT_WHY = { contact_phone_required: '電話番号がありません。', invalid_contact_phone: '電話番号を確かめてください。', phone_has_trunk_prefix_after_country_code: '+81 のあとの最初の 0 は外してください。',
  contact_name_or_company_required: '名前か会社名がありません。', contact_relationship_required: '関係は「問い合わせ」「既存のお客さま」「同意済み」のどれかにしてください。', invalid_contact_row: '読み取れない行です。' };
/** The rows of a contacts file as the import expects them, or a message saying why it cannot be read. */
function contactsFromCsv(text) {
  const rows = parseCsv(text); if (!rows.length) throw new Error('ファイルが空です。');
  const keys = rows[0].map(h => CSV_HEAD[h.trim().toLowerCase()] ?? CSV_HEAD[h.trim()] ?? null);
  if (!keys.includes('phone')) throw new Error('「電話番号」の列が見つかりません。1行目に列の名前（名前、会社、電話番号 など）を入れてください。');
  const list = rows.slice(1).map(cells => { const c = {}; keys.forEach((k, i) => { if (k && c[k] === undefined) c[k] = (cells[i] ?? '').trim(); }); if (c.relationship) c.relationship = CSV_RELATION[c.relationship] ?? c.relationship; return c; });
  if (!list.length) throw new Error('列の名前の下に、連絡先の行がありません。');
  if (list.length > 500) throw new Error(`${list.length}件あります。一度に取り込めるのは500件までです。ファイルを分けてください。`);
  return { list, skipped: rows[0].filter((_, i) => !keys[i]).map(h => h.trim()).filter(Boolean) };
}
async function contacts(id) {
  const list = app.boot.contacts, sel = list.find(c => c.id === (id || app.contactSel)) ?? list[0];
  app.contactSel = sel?.id;
  const q = el('input', { type: 'search', placeholder: '名前・会社・番号で探す', 'aria-label': '連絡先を探す' });
  const items = el('div', { class: 'list' });
  // 名簿にまとめて電話: the list turns into checkboxes; the choice is carried to the next screen (never to the server yet).
  const picking = () => app.listPick instanceof Set;
  const pickInfo = el('p', { class: 'pick-count', role: 'status' }), pickNext = el('a', { class: 'btn primary', href: '#/lists/new', text: '内容を決める' });
  const pickSync = () => { const n = app.listPick?.size ?? 0; pickInfo.textContent = n > 100 ? `${n}人を選んでいます。名簿は100人までです。` : `${n}人を選んでいます（100人まで）。`; pickNext.toggleAttribute('aria-disabled', n < 1 || n > 100); };
  pickNext.addEventListener('click', e => { if (pickNext.hasAttribute('aria-disabled')) e.preventDefault(); });
  const pickBar = el('div', { class: 'card pick-bar', hidden: !picking() }, el('h2', { text: '名簿の相手を選ぶ' }), pickInfo,
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '表示中の全員を選ぶ', onclick: () => { for (const c of shownNow) app.listPick.add(c.id); draw(); } }),
      el('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { app.listPick = null; route(); } }), pickNext));
  let shownNow = [];
  const draw = () => {
    const w = q.value.trim(), shown = list.filter(c => !w || [c.name, c.company, c.phone].some(x => x && x.includes(w)));
    shownNow = shown; pickSync();
    if (picking()) return items.replaceChildren(...(shown.length ? shown.map(c => el('label', { class: 'item pick' },
      el('input', { type: 'checkbox', checked: app.listPick.has(c.id), onchange: e => { if (e.currentTarget.checked) app.listPick.add(c.id); else app.listPick.delete(c.id); pickSync(); } }),
      el('span', { class: 'grow' }, el('b', { text: c.name || c.company }), c.company && c.name ? el('span', { text: c.company }) : null, el('span', { class: 'num tel', text: displayPhone(c.phone) || '電話番号なし' })), c.suppressed ? el('span', { class: 'tag stopped', text: '連絡停止中' }) : null))
      : [el('p', { class: 'empty', text: '見つかりません。' })]));
    items.replaceChildren(...(shown.length ? shown.map(c => el('button', { class: 'item', type: 'button', 'aria-current': String(c.id === sel?.id), onclick: () => { if (keepEdits()) location.hash = `#/contacts/${c.id}`; } },
      el('span', { class: 'avatar', text: (c.name || c.company || '?').slice(0, 1) }), el('span', { class: 'grow' }, el('b', { text: c.name || c.company }), c.company && c.name ? el('span', { text: c.company }) : null, el('span', { class: 'num tel', text: displayPhone(c.phone) || '電話番号なし' })), c.suppressed ? el('span', { class: 'tag stopped', text: '連絡停止中' }) : null))
      : [el('p', { class: 'empty', text: list.length ? '見つかりません。' : 'まだ連絡先がありません。' })]));
  };
  q.addEventListener('input', draw); draw();
  // One form adds a contact or edits the selected one; editing sends its id and every field shown.
  let editing = null, dirty = false;
  // Unsaved typing is not dropped silently: leaving it asks first.
  const keepEdits = () => addForm.hidden || !dirty || confirm('保存していない変更があります。変更を捨てますか？');
  const formTitle = el('h2', { text: '連絡先を追加' });
  const addForm = el('form', { class: 'card stack contact-form', hidden: true, oninput: () => { dirty = true; }, onsubmit: async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { const saved = await api('/contacts', { method: 'POST', body: { ...(editing ? { id: editing.id } : {}), name: f.get('name'), company: f.get('company'), phone: f.get('phone'), notes: f.get('notes'), relationship: f.get('relationship'), basis: f.get('basis') } }); app.boot = null; await loadAll(); if (location.hash === `#/contacts/${saved.id}`) route(); else location.hash = `#/contacts/${saved.id}`; toast('保存しました。'); }
    catch (err) { toast(err.message); }
  } }, formTitle,
    el('label', { class: 'lbl', for: 'contact-name', text: '名前' }), el('input', { type: 'text', id: 'contact-name', name: 'name' }),
    el('label', { class: 'lbl', for: 'contact-company', text: '会社・お店（任意）' }), el('input', { type: 'text', id: 'contact-company', name: 'company' }),
    el('label', { class: 'lbl', for: 'contact-phone', text: '電話番号（任意）' }), el('input', { type: 'tel', id: 'contact-phone', name: 'phone' }),
    el('label', { class: 'lbl', for: 'contact-relationship', text: 'この相手との関係（営業の電話に必要）' }), el('select', { id: 'contact-relationship', name: 'relationship' }, el('option', { value: '', text: '指定しない' }), el('option', { value: 'inquiry', text: '問い合わせをもらった' }), el('option', { value: 'customer', text: '既存のお客さま' }), el('option', { value: 'consented', text: '電話の同意をもらった' })),
    el('label', { class: 'lbl', for: 'contact-basis', text: '電話してよい根拠（営業の電話に必要）' }), el('input', { type: 'text', id: 'contact-basis', name: 'basis', placeholder: '例：9/20 に資料請求フォームから問い合わせ' }),
    el('label', { class: 'lbl', for: 'contact-notes', text: 'メモ（任意・AIには渡しません）' }), el('textarea', { id: 'contact-notes', name: 'notes' }),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { if (keepEdits()) closeForm(); } }), el('button', { class: 'btn primary', type: 'submit', text: '保存する' })));
  const closeForm = () => { addForm.hidden = true; dirty = false; if (detail) detail.hidden = false; };
  const openForm = c => {
    if (!keepEdits()) return;
    editing = c; dirty = false; if (detail) detail.hidden = !!c; formTitle.textContent = c ? '連絡先を編集' : '連絡先を追加'; addForm.reset();
    if (c) for (const [k, v] of Object.entries({ name: c.name, company: c.company, phone: displayPhone(c.phone), relationship: c.relationship, basis: c.basis, notes: c.notes })) addForm.elements[k].value = v ?? '';
    addForm.hidden = false; addForm.querySelector('input').focus();
  };
  const remove = async () => {
    if (!confirm(`「${sel.name || sel.company}」を連絡先から削除しますか？\n過去の通話の記録と、「今後は連絡しない」の設定は残ります。`)) return;
    try { await api(`/contacts/${sel.id}`, { method: 'DELETE' }); app.contactSel = null; app.boot = null; await loadAll(); if (location.hash === '#/contacts') route(); else location.hash = '#/contacts'; toast('削除しました。'); }
    catch (err) { toast(err.message); }
  };
  // CSVから取り込む: read and checked in the browser, sent as rows; the server answers row by row.
  let parsed = null;
  const importErr = el('p', { class: 'errbox', role: 'alert', hidden: true }), importInfo = el('p', { class: 'import-info', role: 'status', text: 'ファイルを選ぶと、件数を確かめてから取り込めます。' });
  const importGo = el('button', { class: 'btn primary', type: 'button', text: '取り込む', disabled: true });
  const importFile = el('input', { type: 'file', id: 'contact-csv', accept: '.csv,text/csv', 'aria-describedby': 'contact-csv-help' });
  importFile.addEventListener('change', async () => {
    parsed = null; importGo.disabled = true; importGo.textContent = '取り込む'; importErr.hidden = true; importInfo.textContent = '';
    const file = importFile.files?.[0]; if (!file) { importInfo.textContent = 'ファイルを選ぶと、件数を確かめてから取り込めます。'; return; }
    try {
      if (file.size > 2_000_000) throw new Error('ファイルが大きすぎます（2MBまで）。');
      let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { throw new Error('UTF-8 として読めませんでした。Shift_JIS のファイルは読めません。Excel では「CSV UTF-8（コンマ区切り）」で保存し直してください。'); }
      if (importFile.files?.[0] !== file) return;
      parsed = contactsFromCsv(text);
      const names = parsed.list.slice(0, 3).map(c => c.name || c.company || c.phone).filter(Boolean).join('、');
      importInfo.textContent = `${parsed.list.length}件を読みました${names ? `（${names}${parsed.list.length > 3 ? ' ほか' : ''}）` : ''}。${parsed.skipped.length ? `使わない列：${parsed.skipped.join('、')}。` : ''}`;
      importGo.textContent = `${parsed.list.length}件を取り込む`; importGo.disabled = false;
    } catch (e) { importErr.textContent = e.message; importErr.hidden = false; }
  });
  importGo.addEventListener('click', async () => {
    if (!parsed) return; const sent = parsed.list;
    importGo.disabled = true; importGo.textContent = '取り込んでいます…'; importErr.hidden = true;
    try {
      const out = await api('/contacts/import', { method: 'POST', body: { contacts: sent } });
      app.importResult = { created: out.created, duplicate: out.duplicate, invalid: out.invalid, rows: out.results.filter(x => x.status === 'invalid').map(x => ({ n: x.index + 1, who: sent[x.index]?.name || sent[x.index]?.company || sent[x.index]?.phone || '', why: IMPORT_WHY[x.error] ?? `取り込めませんでした（問い合わせ用コード：${x.error}）。` })) };
      app.boot = null; await loadAll(); route();
    } catch (e) { importErr.textContent = e.message; importErr.hidden = false; importGo.disabled = false; importGo.textContent = `${sent.length}件を取り込む`; }
  });
  const importCard = el('section', { class: 'card stack import-card', hidden: true, 'aria-label': 'CSVから取り込む' }, el('h2', { text: 'CSVから取り込む' }),
    el('p', { class: 'note', id: 'contact-csv-help', text: '1行目に列の名前を入れます：名前、会社、電話番号、関係、根拠、メール、メモ（name, company, phone, relationship, basis, email, notes でも読めます）。電話番号のない行は取り込めません。一度に500件まで。文字コードは UTF-8 です。Shift_JIS のファイルは読めません。' }),
    el('label', { class: 'lbl', for: 'contact-csv', text: 'CSVファイル' }), importFile, importInfo, importErr,
    el('p', { class: 'note', text: 'すでにある電話番号は、変更も二重登録もしません。同じファイルをもう一度取り込んでも安全です。' }),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { importCard.hidden = true; importOpen.focus(); } }), importGo));
  const importOpen = el('button', { class: 'btn', type: 'button', text: 'CSVから取り込む', onclick: () => { importCard.hidden = !importCard.hidden; if (!importCard.hidden) importFile.focus(); } });
  const done = app.importResult; app.importResult = null;
  const importDone = done ? el('section', { class: 'card import-result', role: 'status', 'aria-label': '取り込みの結果' }, el('h2', { text: '取り込みの結果' }),
    el('dl', { class: 'defs left' }, el('dt', { text: '追加した' }), el('dd', { text: `${done.created}件` }), el('dt', { text: 'すでにあった' }), el('dd', { text: `${done.duplicate}件（変更していません）` }), el('dt', { text: '取り込めなかった' }), el('dd', {}, done.invalid ? el('b', { text: `${done.invalid}件` }) : '0件')),
    done.rows.length ? el('ul', { class: 'import-rows' }, ...done.rows.map(x => el('li', {}, el('span', { class: 'num', text: `${x.n}件目` }), x.who ? el('b', { class: /^[\d+() -]+$/.test(x.who) ? 'tel' : '', text: x.who }) : null, el('span', { text: x.why })))) : null,
    done.rows.length ? el('p', { class: 'note', text: '件数は、列の名前の行を除いて数えています。ファイルを直して、もう一度取り込めます。' }) : null,
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '閉じる', onclick: () => { importDone.remove(); importOpen.focus(); } }))) : null;
  // 連絡停止の解除: a supervisor's decision with a written reason. A stop the person made by pressing a key stays.
  const releaseErr = el('p', { class: 'errbox', role: 'alert', hidden: true });
  const byRecipient = sel?.suppressedBy === 'recipient';
  const releaseForm = sel?.suppressed && !byRecipient && isSupervisor() ? el('form', { class: 'stack tight release-form', hidden: true, onsubmit: async e => {
    e.preventDefault(); const f = e.currentTarget, reason = f.elements.reason.value.trim(), send = f.querySelector('[type=submit]');
    releaseErr.hidden = true;
    if (reason.length < 5 || reason.length > 300) { releaseErr.textContent = ERRORS.release_reason_required; releaseErr.hidden = false; f.elements.reason.focus(); return; }
    if (!f.elements.ack.checked) { releaseErr.textContent = ERRORS.suppression_confirmation_required; releaseErr.hidden = false; f.elements.ack.focus(); return; }
    send.disabled = true;
    try {
      const out = await api('/suppressions/release', { method: 'POST', body: { contactId: sel.id, acknowledged: true, reason } });
      app.boot = null; await loadAll(); if (!out.suppressed) app.released = sel.id; toast(out.suppressed ? 'このチームの連絡停止は解除しました。ほかのチームが止めているため、まだ電話はかけられません。' : '連絡停止を解除しました。'); route();
    } catch (x) { releaseErr.textContent = x.message; releaseErr.hidden = false; send.disabled = false; }
  } },
    el('label', { class: 'lbl', for: 'release-reason', text: '解除する理由（5〜300文字）' }), el('textarea', { id: 'release-reason', name: 'reason', maxlength: '300', placeholder: '例：本人から電話で、連絡を再開してよいと言われた（10/2）' }),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'ack' }), 'この相手に電話してよいことを確かめました。'),
    el('p', { class: 'note', text: '解除した人と理由は記録されます。' }), releaseErr,
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { releaseForm.hidden = true; releaseOpen.hidden = false; releaseOpen.focus(); } }), el('button', { class: 'btn primary', type: 'submit', text: '連絡停止を解除する' }))) : null;
  const releaseOpen = releaseForm ? el('button', { class: 'btn', type: 'button', text: '連絡停止を解除', onclick: () => { releaseForm.hidden = false; releaseOpen.hidden = true; releaseForm.elements.reason.focus(); } }) : null;
  // How and when the calls were stopped, as the server recorded it. It does not record which staff member did it by hand.
  const stopDay = sel?.suppressedAt ? (d => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日、`)(new Date(Date.parse(sel.suppressedAt) + 9 * 3600e3)) : '';
  const stopHow = { key_press: 'ご本人が通話中にボタンを押して、電話を止めました。', said: '通話中に「かけないでほしい」と話したため、止めています。', manual: 'こちらで止めました。' }[sel?.suppressedHow] ?? '止めたきっかけは記録がありません。';
  const stopped = sel?.suppressed ? el('div', { class: 'warnbox stopped-box' }, el('p', {}, el('b', { text: '連絡停止中' }), '　この相手には電話をかけません。'),
    el('p', { class: 'stop-how', text: `${stopDay}${stopHow}${sel.suppressedAt ? '' : '止めた日時は記録がありません。'}` }),
    byRecipient ? el('p', { text: 'ご本人の意思なので、この停止は解除できません。' })
      : releaseForm ? [releaseOpen, releaseForm] : el('p', { text: '解除は、管理者かマネージャーに頼んでください。' })) : null;
  // これまでの電話（30日）: this person's calls over time, newest first. Nothing is shown for a contact with no calls.
  const past = sel?.phone ? el('section', { class: 'past', 'aria-label': 'これまでの電話（30日）' }) : null;
  if (past) loadInto(past, () => api(`/contacts/${sel.id}/history?days=30`), h => {
    const t = h.summary; if (!t.calls) return [];
    return [el('h2', { class: 'section-h', text: 'これまでの電話（30日）' }),
      t.missedInARow >= 2 ? el('p', { class: 'past-missed' }, levelTag('concern'), el('b', { text: `${t.missedInARow}回続けて応答がありません` })) : null,
      el('p', { class: 'note', text: `${t.calls}回の電話のうち、話せました ${t.answered}回・応答なし ${t.unanswered}回・要確認 ${t.attention}回${t.emergency ? `（うち緊急 ${t.emergency}回）` : ''}。「話したこと」は本人の返事で、実際の様子を確かめたものではありません。` }),
      el('ul', { class: 'past-rows' }, ...[...h.calls].reverse().map(c => el('li', { class: c.attention ? `need-${c.attention}` : '' },
        el('a', { class: 'num', href: `#/call/${c.id}`, 'aria-label': `${japanTime(c.createdAt)} の報告を開く` }, el('time', { datetime: c.createdAt, text: japanTime(c.createdAt) })),
        el('span', { class: 'past-went' }, callWent(c)), c.attention ? levelTag(c.attention) : null, saidGlance(c.checkIn))))].filter(Boolean);
  });
  const calls = sel ? app.history.filter(r => r.request.phone === sel.phone) : [];
  const detail = sel ? el('div', { class: 'card contact-detail' },
    el('div', { class: 'metric-k' }, el('div', { class: 'split' }, el('span', { class: 'avatar big', text: (sel.name || sel.company || '?').slice(0, 1) }), el('div', {}, el('h2', { class: 'headline', text: sel.name || sel.company }), el('span', { text: sel.name ? sel.company : '' }))),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', text: '編集', onclick: () => openForm(sel) }), el('button', { class: 'btn', type: 'button', text: '削除', onclick: remove }),
        sel.phone && !sel.suppressed ? el('a', { class: 'btn primary', href: `#/new?contact=${sel.id}`, text: 'この相手に電話を頼む' }) : null)),
    stopped,
    sel && !sel.suppressed && app.released === sel.id ? el('p', { class: 'caveat released', role: 'status', text: '連絡停止を解除しました。解除した理由は記録されました。この相手に、また電話を頼めます。' }) : null,
    el('dl', { class: 'defs left' }, el('dt', { text: '電話番号' }), el('dd', { class: 'num', text: displayPhone(sel.phone) || '—' }), el('dt', { text: 'メール' }), el('dd', { text: sel.email || '—' }), el('dt', { text: 'メモ' }), el('dd', { text: sel.notes || '—' }),
      el('dt', { text: '関係' }), el('dd', { text: { inquiry: '問い合わせをもらった', customer: '既存のお客さま', consented: '電話の同意をもらった' }[sel.relationship] ?? '—（営業の電話には必要）' }), el('dt', { text: '根拠' }), el('dd', { text: sel.basis || '—' })),
    past,
    el('h2', { class: 'section-h', text: 'この番号への電話' }), el('p', { class: 'note', text: '電話番号で照合しています。メモや履歴は、AIに自動では渡しません。' }), callRows(calls, 'まだありません。'))
    : el('div', { class: 'card' }, el('p', { class: 'muted', text: '連絡先を追加すると、ここに出ます。' }));
  return el('div', { class: 'page contacts-page' },
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '連絡先' }), el('p', { class: 'page-intro', text: '相手との関係と、これまでの依頼を確認できます。' })), el('div', { class: 'actions page-actions' }, list.length ? el('button', { class: 'btn', type: 'button', text: '名簿にまとめて電話', 'aria-pressed': String(picking()), onclick: () => { if (!keepEdits()) return; app.listPick = picking() ? null : new Set(); route(); } }) : null, importOpen, el('button', { class: 'btn', type: 'button', text: '＋ 連絡先を追加', onclick: () => { if (addForm.hidden || editing) openForm(null); else if (keepEdits()) closeForm(); } }))),
    el('div', { class: 'import-zone stack' }, importDone, importCard),
    el('div', { class: 'split-page contacts-layout' }, el('div', { class: 'stack' }, pickBar, q, items), el('div', { class: 'stack' }, addForm, detail)));
}

// ---------------------------------------------------------------- 設定
async function settings(tab) {
  if (!app.status) [app.status, app.templates] = await Promise.all([api('/phone/status'), api('/phone/templates')]);
  app.settingsTab = tab || app.settingsTab;
  const b = app.boot, st = app.status, cfg = b.configuration;
  const tabs = [['out', 'かける設定'], ['in', 'かけられた時の設定'], ['products', '商品（営業の電話）'], ['cost', '費用とクレジット'], ['voice', '声とAI'], ['view', '記録と表示']];
  const row = (k, d, ...v) => el('div', { class: 'set-row' }, el('div', {}, el('b', { text: k }), d ? el('span', { class: 'd', text: d }) : null), el('div', {}, ...v));
  let body;
  if (app.settingsTab === 'out') {
    const nameInput = el('input', { type: 'text', value: b.account?.callerName ?? '', 'aria-label': '名乗る名前', maxlength: '40' });
    body = [el('h2', { text: 'かける設定' }), el('p', { class: 'note', text: 'AIがあなたの代わりに電話をかけるときの決まりです。' }),
      row('本番の電話', '接続を確かめてから発信します', el('b', { text: isPaused(cfg) ? '受付停止中' : cfg.mode === 'live' ? (cfg.liveReady && st.ready ? '発信できます' : '設定が終わっていません') : '練習モード（電話はかかりません）' }), ...(st.issues?.length ? [el('details', { class: 'connection-details' }, el('summary', { text: '接続の詳細を確認' }), ...st.issues.map(i => el('p', { class: 'note', text: i })))] : [])),
      row('発信元の番号', '相手の画面に表示される番号', el('span', { class: 'num', text: cfg.mode === 'live' ? displayPhone(cfg.callerId) : '練習用' })),
      row('名乗り方', '最初に必ず伝えます', el('div', { class: 'two' }, nameInput, el('button', { class: 'btn', type: 'button', text: '保存する', onclick: async () => {
        try { await api('/account/caller-name', { method: 'POST', body: { callerName: nameInput.value } }); app.boot = null; await loadAll(); toast('名乗る名前を保存しました。'); } catch (e) { toast(e.message); }
      } })), el('p', { class: 'note', text: `「${nameInput.value || '〇〇'}の代わりにお電話している、AIアシスタントです。この通話は記録しています。」` })),
      row('1回の通話の上限', 'これを過ぎると、あいさつして切ります', el('span', { text: `${Math.round(cfg.maxSeconds / 60)}分（サーバーの設定）` })),
      row('発信前の確認', '本番は毎回、あなたの承認が必要です（外せません）', el('span', { class: 'muted', text: '常にオン' }))];
  } else if (app.settingsTab === 'in') {
    const inb = cfg.inbound, pref = b.account?.inbound ?? { mode: 'ai', hours: null, name: null };
    const canForward = Boolean(b.account?.verifiedPhone) && b.account?.phoneVerificationProvider !== 'simulator' && !b.credits?.enabled;
    const mode = el('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'かかってきたとき' }, ...[['ai', 'AIが用件を聞く', '用件を聞いてメモにし、依頼の一覧に残します。'], ['forward', 'あなたにつなぐ', canForward ? `確認済みのあなたの番号（${displayPhone(b.account.verifiedPhone)}）へ転送します。記録はしません。` : '確認済みの自分の番号が必要です（クレジット制のサーバーでは使えません）。'], ['decline', '出ない', 'この番号の案内を流して切ります。']].map(([v, l, d]) =>
      el('label', { class: 'option' }, el('input', { type: 'radio', name: 'inb-mode', value: v, checked: pref.mode === v, disabled: v === 'forward' && !canForward }), el('span', {}, el('b', { text: l }), el('span', { class: 'muted small', text: d })))));
    const always = el('input', { type: 'checkbox', checked: !pref.hours });
    const hFrom = el('input', { type: 'text', value: pref.hours?.from ?? '09:00', 'aria-label': '受ける時間の始まり', inputmode: 'numeric' }), hTo = el('input', { type: 'text', value: pref.hours?.to ?? '21:00', 'aria-label': '受ける時間の終わり', inputmode: 'numeric' });
    const syncHours = () => { hFrom.closest('.two') && (hFrom.closest('.two').hidden = always.checked); };
    always.addEventListener('change', syncHours); queueMicrotask(syncHours);
    const nameIn = el('input', { type: 'text', value: pref.name ?? '', placeholder: b.account?.callerName ?? '（かける設定の名前）', maxlength: '40', 'aria-label': '受けるときの名前' });
    body = [el('h2', { text: 'かけられた時の設定' }), el('p', { class: 'note', text: '発信元の番号に電話がかかってきたときの動きです。' }),
      ...(cfg.prerelease?.enabled ? [el('p', { class: 'warnbox', text: '事前プレリリースでは着信を受け付けません。ここで保存した設定は、着信の受付開始後に使います。' })] : !inb ? [el('p', { class: 'warnbox', text: 'このサーバーでは、かかってきた電話を受ける設定がされていません（管理者の設定）。ここで決めた動きは、受ける設定がされたときと、あなたがかけた電話への折り返しに使います。' })]
        : inb.restaurant ? [el('p', { class: 'warnbox', text: 'この番号は店の予約受付として動いています。受付の動きは管理者の設定で決まります。' })]
        : !inb.owner ? [el('p', { class: 'note', text: 'この番号の着信はほかの人宛てです。ここで決めた動きは、あなたがかけた電話への折り返しに使います。' })] : []),
      row('かかってきたとき', '', mode),
      row('受ける時間', '日本時間。外の時間は案内を流して切ります', el('label', { class: 'check' }, always, 'いつでも'), el('div', { class: 'two' }, hFrom, hTo)),
      row('名乗る名前', 'AIが「〇〇の電話です」と答える名前', nameIn),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '保存する', onclick: async () => {
        const m = document.querySelector('input[name=inb-mode]:checked')?.value ?? 'ai';
        try { await api('/account/inbound', { method: 'POST', body: { mode: m, hours: always.checked ? null : { from: hFrom.value.trim(), to: hTo.value.trim() }, name: nameIn.value.trim() } }); await loadAll(); toast('かけられた時の設定を保存しました。'); route(); } catch (e) { toast(e.message); }
      } }))];
  } else if (app.settingsTab === 'products') {
    const form = el('form', { class: 'stack', onsubmit: async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      try { await api('/products', { method: 'POST', body: { name: f.get('name'), facts: f.get('facts'), source: f.get('source'), reviewed: f.get('reviewed') === 'on' } }); app.boot = null; await loadAll(); toast('商品を保存しました。'); route(); }
      catch (err) { toast(err.message); }
    } }, el('label', { class: 'lbl', for: 'product-name', text: '商品名' }), el('input', { type: 'text', id: 'product-name', name: 'name', required: true }),
      el('label', { class: 'lbl', for: 'product-facts', text: 'AIが説明してよいこと（確かめた事実だけ）' }), el('textarea', { id: 'product-facts', name: 'facts', required: true }),
      el('label', { class: 'lbl', for: 'product-source', text: '出典のURL（任意）' }), el('input', { type: 'text', id: 'product-source', name: 'source' }),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'reviewed' }), '内容を確かめました。この事実だけを電話で使います。'),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit', text: '商品を保存する' })));
    body = [el('h2', { text: '商品（営業の電話）' }), el('p', { class: 'note', text: '「商談の日時を決める」「資料を送ってよいか聞く」「商品を説明する」で紹介する商品です。AIは、ここに書いた確認済みの事実だけを使い、値引き・契約・支払い・未確認の機能や納期は約束しません。' }),
      ...(b.products.length ? b.products.map(x => row(x.name, `確認 ${new Date(x.reviewedAt).toLocaleDateString('ja-JP')}`, el('p', { class: 'note', text: x.facts.slice(0, 160) }))) : [el('p', { class: 'muted', text: 'まだ商品がありません。' })]),
      el('h2', { class: 'section-h', text: '商品を追加' }), form];
  } else if (app.settingsTab === 'cost') {
    const ledger = b.credits?.enabled ? (await api('/credits/ledger')).entries : [];
    const labels = { grant: '追加', reserve: '確保', consume: '消費', release: '返却' };
    const purchaseView = createCreditPurchase({ api, owner: b.user.id, isBlocked: () => app.boot?.account?.purchaseBlocked === true, onBalanceChange: async () => { await loadAll(); if (balanceLabel.isConnected) balanceLabel.textContent = String(app.boot.credits.available); } });
    const balanceLabel = el('b', { class: 'num', text: `${b.credits?.available ?? 0}` });
    body = [el('h2', { text: '費用とクレジット' }),
      b.credits?.enabled ? row('クレジット残高', '', balanceLabel, el('span', { class: 'note', text: b.credits.held ? ` 確保中 ${b.credits.held}` : '' }))
        : row('費用', 'このサーバーはクレジット制ではありません', el('span', { text: `1回の上限 $${cfg.maxCallUsd}（見込みが上限を超える電話は発信しません）` })),
      purchaseView.node,
      ...(ledger.length ? [el('h2', { class: 'section-h', text: '履歴' }), el('div', { class: 'rows' }, ...ledger.slice(-30).reverse().map(e => el('div', { class: 'row' }, el('div', {}, el('div', { class: 'who', text: labels[e.kind] ?? e.kind })), el('div', { class: 'outcome num', text: `${e.amount}` }), el('time', { class: 'num', text: when(new Date(e.created).toISOString()) }))))] : []),
      row('月の上限', '承認した電話の見込みの上限の合計（日本時間の月ごと）', (() => {
        const cap = el('input', { type: 'text', inputmode: 'decimal', value: app.month.capUsd ?? '', placeholder: '例：30（空欄で上限なし）', 'aria-label': '月の上限（米ドル）' });
        return el('div', {}, el('div', { class: 'two' }, cap, el('button', { class: 'btn', type: 'button', text: '保存する', onclick: async () => {
          try { await api('/account/monthly-cap', { method: 'POST', body: { capUsd: cap.value.trim() === '' ? null : cap.value.trim() } }); await loadAll(); toast(cap.value.trim() ? '月の上限を保存しました。' : '月の上限をなくしました。'); route(); } catch (e) { toast(e.message); }
        } })), el('p', { class: 'note', text: `今月 $${app.month.usedUsd.toFixed(2)}${app.month.capUsd !== null ? ` / 上限 $${app.month.capUsd}` : '（上限なし）'}。見込みは実際の請求より多めです。` }));
      })()),
      el('p', { class: 'note', text: '1回の電話の上限は、承認のときの見込みで守られます。月の上限を超える電話は、承認の時点で止まります。' })];
  } else if (app.settingsTab === 'voice') {
    const live = (st.engines ?? []).find(e => e.id === 'gpt-live'), PITCH = { low: '低め', mid: 'ふつう', high: '高め', 'very-high': 'かなり高め' }, PACE = { fast: '速め', medium: 'ふつう', slow: 'ゆっくり' };
    body = [el('h2', { text: '声とAI' }), ...(st.engines ?? []).map(e => row(e.label, e.id === st.defaultEngine ? '標準' : '', el('span', { text: e.ready ? '使えます' : '使えません（キー未設定）' }))),
      ...(live ? [el('h2', { class: 'section-h', text: 'GPT-Live の声を聞く' }), el('p', { class: 'note', text: '電話で使う前に、声を聞き比べられます。録音済みの見本で、お金はかかりません。' }),
        el('div', { class: 'voice-list' }, ...live.voices.filter(v => st.voiceDetails?.[v]?.sample).map(v => { const d = st.voiceDetails[v];
          return el('div', { class: 'voice-item' }, el('span', { class: 'grow' }, el('b', { text: v }), el('span', { class: 'muted small', text: [`高さ ${PITCH[d.pitch] ?? d.pitch}`, `速さ ${PACE[d.pace] ?? d.pace}`, v === live.defaultVoice ? '標準' : ''].filter(Boolean).join(' · ') })), sampleButton(d.sample, '聞く')); }))] : [])];
  } else {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    body = [el('h2', { text: '記録と表示' }),
      row('表示', '明るい／暗い', el('div', { class: 'chips' }, ...[['light', '明るい'], ['dark', '暗い']].map(([v, l]) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === v), text: l, onclick: () => { try { localStorage.setItem('oathra.theme', v); } catch { /* off */ } document.documentElement.dataset.theme = v; route(); } })))),
      row('会話の記録', '', el('span', { text: '文字起こしと結果を30日保存します。音声ファイルは保存しません。' })),
      row('連携・転送・番号の確認', 'メールや予定の送信、自分への転送、番号のSMS確認、連絡停止', el('a', { class: 'btn', href: '/workspace', text: '従来の画面で開く' }), el('p', { class: 'note', text: 'これらはまだこの画面に移していません。' })),
      row('メールとパスワードでログイン', app.boot.login?.passwordLogin ? app.boot.login.email ?? '' : 'まだ設定していません', el('button', { class: 'btn', type: 'button', text: app.boot.login?.passwordLogin ? 'パスワードを設定し直す' : '設定する', onclick: async () => { const r = await api('/account/password-link', { method: 'POST', body: {} }).catch(e => (toast(e.message), null)); if (r) location.hash = '#setup=' + r.code; } })),
      row('Claude Code・ChatGPTと連携', 'AIで営業電話の下書きを作成し、発信はOathraで確認します。', el('a', { class: 'btn', href: '/connect', text: '接続を設定する' })),
      row('ログアウト', '', el('button', { class: 'btn', type: 'button', text: 'ログアウト', onclick: async () => { await api('/session', { method: 'DELETE', body: {} }).catch(() => null); app.boot = null; location.hash = '#/'; renderLogin(); } }))];
  }
  return el('div', { class: 'page settings-page' },
    el('div', { class: 'page-h' }, el('div', {}, el('h1', { text: '設定' }), el('p', { class: 'page-intro', text: '電話のルール、費用、保存する記録を管理します。' }))),
    el('div', { class: 'settings-layout' },
      el('nav', { class: 'settings-nav', 'aria-label': '設定の種類' }, ...tabs.map(([k, l]) => el('a', { href: `#/settings/${k}`, 'aria-current': app.settingsTab === k ? 'page' : null, text: l }))),
      el('section', { class: 'card settings-content' }, ...body)));
}

route();
setInterval(() => { if (app.boot) renderBar(); }, 1000);
