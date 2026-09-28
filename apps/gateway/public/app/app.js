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
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

const ERRORS = {
  unauthorized: 'トークンが違うか、期限が切れています。', invalid_token: 'トークンが違います。',
  cross_origin_request_denied: 'このページのアドレスが、サーバーの設定と違います。設定された公開アドレスから開いてください。',
  review_current_privacy_notice: '会話データの取り扱いへの同意が必要です。',
  approval_expired_or_used: '確認の有効期限が切れました。もう一度「内容を確かめる」を押してください。',
  mission_changed_review_again: '内容が変わりました。もう一度確かめてください。',
  voice_engine_unavailable: 'この声は、このサーバーではまだ使えません。標準の声を選んでください。',
  invalid_phone_request: '電話番号・相手の名前・頼むことを確かめてください（名前に数字や記号は使えません）。',
  invalid_caller_name: '名乗る名前は、数字や記号を入れずに40文字以内で入力してください。',
  phone_service_preview_only: 'このサーバーは練習モードです。実際の電話はかけられません。',
  estimated_cost_exceeds_budget: '見込みの費用が、1回の上限を超えています。',
  insufficient_credits: 'クレジットが足りません。',
  contact_name_or_company_required: '名前か会社名を入れてください。',
  contact_relationship_required: '営業の電話には、連絡先に「この相手との関係」（問い合わせ・既存のお客さま・同意済み）が必要です。連絡先で登録してください。',
  contact_basis_required: '営業の電話には、連絡先に「電話してよい根拠」が必要です。連絡先で書いてください。',
  select_one_reviewed_product: '紹介する商品を選んでください（設定の「商品」で登録できます）。',
  select_one_contact: '連絡先から相手を選んでください。', contact_phone_required: 'この相手には電話番号がありません。',
  product_facts_require_review: '内容を確かめたことにチェックを入れてください。',
  unknown_practice: 'この練習は見つかりません。',
  invalid_inbound_hours: '受ける時間は「09:00」のように、始まりと終わりを違う時刻で入れてください。',
  invalid_inbound_mode: '受け方を選んでください。', verify_your_phone_first: '先に、自分の電話番号を確認してください（従来の画面の「自分の電話番号を確認する」）。',
  forward_not_available_with_credits: 'クレジット制のサーバーでは、あなたにつなぐ設定は使えません。',
  monthly_cap_reached: '今月の上限を超えるので、この電話はかけられません。設定の「費用とクレジット」で上限を見直せます。',
  invalid_monthly_cap: '月の上限は 0.01 以上の金額（米ドル）で入れてください。空にすると上限なしになります。',
};
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch('/v1' + path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let value = null; try { value = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) { const e = new Error(ERRORS[value?.error] ?? `うまくいきませんでした。少し待ってもう一度お試しください。（問い合わせ用コード：${value?.error ?? r.status}）`); e.status = r.status; e.code = value?.error; throw e; }
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
const notesOf = r => (r.memory?.notes ?? []).filter(n => FIELD[n.field]);
function outcome(r) {
  const notes = notesOf(r), ok = notes.filter(n => n.status === 'verified').length;
  if (r.state === 'draft') return { text: '発信前の確認待ち', tone: 'warn' };
  if (r.state === 'unknown') return { text: '終わったか確かめられていません', tone: 'warn' };
  if (LIVE.includes(r.state)) return { text: '電話中', tone: 'live' };
  if (r.state === 'failed') return { text: 'つながらなかった・途中で終了', tone: 'dim' };
  if (r.direction === 'inbound') return { text: '用件を聞きました', tone: 'warn' };
  if (r.doNotContact) return { text: '今後は連絡しないでほしい、と言われました', tone: 'dim' };
  if (r.request?.conversationMode === 'chat') return { text: '話しました', tone: '' };
  if (notes.length && ok === notes.length) return { text: '決まりました', tone: 'ok' };
  if (ok) return { text: '一部だけ確かめられました', tone: 'warn' };
  if (notes.length) return { text: '決まりませんでした', tone: 'dim' };
  return { text: '電話が終わりました', tone: '' };
}
const needsYou = r => (r.state === 'unknown' && !r.resolvedAt) || r.state === 'draft';

// ---------------------------------------------------------------- state
const app = { boot: null, history: [], status: null, templates: [], contactSel: null, settingsTab: 'out', timer: null };
async function loadAll() {
  const [boot, history, month] = await Promise.all([api('/bootstrap'), api('/phone/history'), api('/account/month')]);
  app.boot = boot; app.month = month;
  app.history = [...history, ...boot.missions.filter(m => m.kind !== 'phone-request').map(fromSales)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderBar();
}
function renderBar() {
  const need = app.history.filter(needsYou).length, live = app.history.find(r => LIVE.includes(r.state));
  $('#attention-badge').hidden = !need; $('#attention-badge').textContent = String(need);
  $('#live-pill').hidden = !live;
  if (live) { $('#live-pill').href = `#/call/${live.id}`; $('#live-pill-time').textContent = mmss((Date.now() - Date.parse(live.createdAt)) / 1000); }
}

// ---------------------------------------------------------------- router
const routes = { '': home, requests, new: ask, call, practice, contacts, settings };
async function route() {
  clearTimeout(app.timer);
  const [name = '', id, sub] = location.hash.split('?')[0].replace(/^#\/?/, '').split('/');
  const view = $('#view');
  for (const a of document.querySelectorAll('[data-tab]')) {
    const tab = a.dataset.tab, on = tab === (name || 'home') || (tab === 'requests' && ['new', 'call'].includes(name));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!app.boot) { try { await loadAll(); } catch (e) { if (e.status === 401) return renderLogin(); view.replaceChildren(el('div', { class: 'page' }, el('p', { class: 'errbox', text: e.message }))); return; } }
  $('#tabs').hidden = false; $('#bar-right').hidden = false;
  const render = routes[name] ?? home;
  try { view.replaceChildren(await render(id, sub)); } catch (e) { if (e.status === 401) { app.boot = null; return renderLogin(); } view.replaceChildren(el('div', { class: 'page' }, el('p', { class: 'errbox', text: e.message }))); }
}
window.addEventListener('hashchange', () => { route(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- sign in
function renderLogin() {
  $('#tabs').hidden = true; $('#bar-right').hidden = true;
  const input = el('input', { type: 'password', id: 'token', autocomplete: 'current-password', required: true, 'aria-describedby': 'token-help' });
  const err = el('p', { class: 'errbox', role: 'alert', hidden: true });
  const form = el('form', { class: 'card login stack', onsubmit: async e => {
    e.preventDefault(); err.hidden = true;
    try {
      const r = await fetch('/v1/session', { method: 'POST', credentials: 'same-origin', headers: { Authorization: 'Bearer ' + input.value.trim(), 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) { const v = await r.json().catch(() => ({})); throw new Error(ERRORS[v.error] ?? `ログインできませんでした。（問い合わせ用コード：${v.error ?? r.status}）`); }
      input.value = ''; app.boot = null; await route();
    } catch (error) { err.textContent = error.message; err.hidden = false; }
  } },
    el('h1', { class: 'section-h', text: 'Oathra にログイン' }),
    el('label', { class: 'lbl', for: 'token', text: 'トークン' }), input,
    el('p', { class: 'note', id: 'token-help', text: 'サーバーの .oathra/operator-token.txt にある文字列です。ログインすると、このブラウザで8時間使えます。' }),
    err, el('button', { class: 'btn primary big', type: 'submit', text: 'ログイン' }));
  $('#view').replaceChildren(el('div', { class: 'page' }, form));
  input.focus();
}

// ---------------------------------------------------------------- ホーム
async function home() {
  await loadAll();
  const b = app.boot, hist = app.history, need = hist.filter(needsYou);
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const thisMonth = hist.filter(r => Date.parse(r.createdAt) >= month.getTime() && r.state !== 'draft');
  const settled = thisMonth.filter(r => { const n = notesOf(r); return n.length && n.every(x => x.status === 'verified'); }).length;
  const last = hist.find(r => r.direction !== 'inbound' && !needsYou(r) && !LIVE.includes(r.state));
  const page = el('div', { class: 'page' },
    el('div', { class: 'page-h' }, el('h1', { text: 'ホーム' }), el('span', { class: 'sub', text: new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }) })));
  if (need.length) page.append(el('div', { class: 'attention', role: 'status' }, el('span', { class: 'dot' }), `あなたの確認が必要なものが ${need.length} 件あります`, el('a', { class: 'btn', href: '#/requests', text: '依頼を見る' })));
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
  page.append(el('div', { class: 'grid-3' },
    el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: '本番の電話' })),
      el('div', { class: 'metric-v', text: b.configuration.mode === 'live' && b.configuration.liveReady ? 'かけられます' : b.configuration.mode === 'live' ? '設定待ち' : '練習モード' }),
      el('p', { class: 'note', text: b.configuration.mode === 'live' ? `発信元 ${displayPhone(b.configuration.callerId)}` : '練習モードでは、実際の電話はかかりません。' }), el('a', { class: 'btn', href: '#/settings', text: '設定' })),
    credit,
    el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: '今月の電話' })),
      el('div', { class: 'split' }, el('div', {}, el('b', { text: String(thisMonth.filter(r => r.direction !== 'inbound').length) }), el('span', { text: 'かけた' })), el('div', {}, el('b', { text: String(thisMonth.filter(r => r.direction === 'inbound').length) }), el('span', { text: 'かけられた' }))),
      el('p', { class: 'note' }, el('span', { class: 'tick', text: '✓' }), ` 相手の言葉で決まったもの ${settled} 件`))));
  const lower = el('div', { class: 'grid-2' });
  if (last) {
    // What was settled, as values; the callee's own 「はい」 is the settling, not one of the values.
    const notes = notesOf(last).filter(n => n.status === 'verified' && n.field !== 'confirmed');
    lower.append(el('div', { class: 'card' },
      el('div', { class: 'metric-k' }, el('b', { text: '前回かけた電話', class: 'section-h' }), el('time', { text: when(last.createdAt) })),
      el('p', { class: 'muted small', text: `${last.request.name}　${displayPhone(last.request.phone)}` }),
      el('h3', { class: 'headline', text: outcome(last).text }),
      el('p', { class: 'muted small', text: `頼んだこと：${last.request.instruction.slice(0, 80)}${last.request.instruction.length > 80 ? '…' : ''}` }),
      el('dl', { class: 'defs' },
        ...(notes.length ? [el('dt', { text: '決まったこと' }), el('dd', { text: notes.map(n => fmtValue(n.field, n.value)).join('・') })] : []),
        ...(last.billing?.durationSeconds ? [el('dt', { text: '通話時間' }), el('dd', { class: 'num', text: mmss(last.billing.durationSeconds) })] : [])),
      el('div', { class: 'actions' }, el('a', { class: 'btn primary', href: `#/call/${last.id}`, text: '報告を開く' }), el('a', { class: 'btn', href: `#/new?again=${last.id}`, text: '同じ相手にまた頼む' }))));
  } else lower.append(el('div', { class: 'card' }, el('b', { class: 'section-h', text: '前回かけた電話' }), el('p', { class: 'muted', text: 'まだありません。「＋ 電話を頼む」から始められます。' })));
  lower.append(el('div', { class: 'card' }, el('b', { class: 'section-h', text: 'Oathra がすること' }),
    el('p', { class: 'about', text: 'あなたの代わりに電話をかけ、決まったことを「相手の言葉」で確かめて報告します。AIが「決まりました」と言うだけでは完了にしません。本番の電話は毎回あなたの承認が必要です。' })));
  page.append(el('div', { class: 'stack' }, lower));
  page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '最近の電話' }), el('a', { class: 'link', href: '#/requests', text: 'すべての依頼' })));
  page.append(callRows(hist.filter(r => r.state !== 'draft').slice(0, 5), 'まだ電話はありません。'));
  return page;
}
function callRows(list, emptyText) {
  if (!list.length) return el('div', { class: 'rows' }, el('p', { class: 'empty', text: emptyText }));
  return el('div', { class: 'rows' }, ...list.map(r => {
    const o = outcome(r);
    return el('a', { class: 'row', href: `#/call/${r.id}` },
      el('div', {}, el('div', { class: 'who' }, r.request.name, el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : r.practice ? '練習' : '本番' })), el('div', { class: 'what', text: splitScope(r.request.instruction).body.slice(0, 60) })),
      el('div', { class: `outcome ${o.tone === 'warn' ? 'warn' : o.tone === 'dim' ? 'dim' : ''}` }, o.tone === 'ok' ? el('span', { class: 'tick', text: '✓' }) : null, o.text),
      el('time', { class: 'num', text: when(r.createdAt) }));
  }));
}

// ---------------------------------------------------------------- 依頼
async function requests() {
  await loadAll();
  const need = app.history.filter(needsYou), live = app.history.filter(r => LIVE.includes(r.state)), done = app.history.filter(r => !needsYou(r) && !LIVE.includes(r.state));
  const page = el('div', { class: 'page' });
  page.append(el('div', { class: 'page-h' }, el('h1', { text: 'あなたの確認が必要' }), need.length ? el('span', { class: 'sub', text: `${need.length}件` }) : null));
  page.append(need.length ? el('div', { class: 'need' }, ...need.map(needCard)) : el('p', { class: 'muted', text: '確認が必要なものはありません。' }));
  if (live.length) { page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '進行中' }))); page.append(callRows(live, '')); }
  page.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '完了' }), el('span', { class: 'sub', text: '開くと、決まったことと相手の言葉が見られます' })));
  page.append(callRows(done, 'まだ終わった電話はありません。'));
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
  const form = { phone: pre.phone ?? preContact?.phone ?? '', name: pre.name ?? preContact?.name ?? preContact?.company ?? '', instruction: pre.instruction ?? '', mode: pre.conversationMode ?? '', preset: pre.voicePreset ?? '',
    purpose: from?.sales ? from.goal : pre.conversationMode === 'chat' ? 'chat' : '', contactId: preContact?.id ?? (from ? b.contacts.find(c => c.phone === pre.phone)?.id : undefined) ?? null, productId: from?.product?.id ?? b.products[0]?.id ?? '' };
  const scoped = splitScope(form.instruction); form.instruction = scoped.body; form.ok = scoped.ok; form.hold = scoped.hold;
  let review = null, suggested = !form.instruction;
  // Purposes: a request in plain words, a chat, or one of the sales goals (a registered contact and a reviewed product).
  const PURPOSES = [['', '依頼（ふだんの言葉で）'], ['chat', '雑談'], ['meeting', '商談の日時を決める'], ['materials', '資料を送ってよいか聞く'], ['introduce', '商品を説明する']];
  const SALES_TEXT = { meeting: n => `${n}に商品を説明して、興味があれば15分の商談の日時を相談してください。`, materials: n => `${n}に商品を簡単に説明して、資料を送ってよいか聞いてください。`, introduce: n => `${n}に商品を簡単に説明してください。` };
  const isSales = () => Boolean(SALES_TEXT[form.purpose]);
  const actingReady = st.engines?.find(e => e.id === 'character-tts')?.ready === true;
  const engineFor = preset => preset?.startsWith('character-') && actingReady ? 'character-tts' : '';

  const phone = el('input', { type: 'tel', id: 'ask-phone', value: displayPhone(form.phone), autocomplete: 'off', placeholder: '090-1234-5678' });
  const name = el('input', { type: 'text', id: 'ask-name', value: form.name, placeholder: '相手の名前' });
  const instruction = el('textarea', { id: 'ask-instruction', placeholder: '例：10月3日（土）の夜に2名で予約を取ってほしい。できれば19時。名前は田中。' }); instruction.value = form.instruction;
  const template = el('select', { id: 'ask-template', 'aria-label': '例から選ぶ' }, el('option', { value: '', text: '例から選ぶ（任意）' }), ...app.templates.map(t => el('option', { value: t.id, text: t.title?.ja ?? t.id })));
  const voice = el('select', { id: 'ask-voice' }, el('option', { value: '', text: '標準の声（すぐ返事）' }),
    ...Object.entries(st.voicePresets ?? {}).map(([id, label]) => el('option', { value: id, text: `${label}${engineFor(id) ? '（演技・返事まで2〜3秒）' : ''}` })));
  voice.value = form.preset;
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': '連絡先から選ぶ' }, ...contacts.slice(0, 8).map(c => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.id === form.contactId), 'data-id': c.id, text: c.name || c.company,
    onclick: () => { phone.value = displayPhone(c.phone); name.value = c.name || c.company; form.contactId = c.id; suggest(); changed(); } })));
  const purposeChips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': '電話の目的' }, ...PURPOSES.map(([v, l]) => el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(form.purpose === v), 'aria-pressed': String(form.purpose === v), 'data-purpose': v, text: l,
    onclick: () => { form.purpose = v; form.mode = v === 'chat' ? 'chat' : ''; suggest(); changed(); } })));
  const product = el('select', { id: 'ask-product', 'aria-label': '紹介する商品' }, ...(b.products.length ? b.products.map(x => el('option', { value: x.id, text: x.name })) : [el('option', { value: '', text: '（商品がまだありません）' })]));
  product.value = form.productId;
  product.addEventListener('change', () => { form.productId = product.value; changed(); });
  const productRow = el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl', for: 'ask-product', text: '紹介する商品' }), product),
    el('p', { class: 'note' }, b.products.length ? '商品の説明は、確認済みの内容だけを使います。' : '営業の電話には、確認済みの商品が必要です。', el('a', { href: '#/settings/products', text: ' 設定で商品を登録' })));
  const scopeBox = el('div', { class: 'scopes' });
  const usesScope = () => form.purpose === '';
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

  function values() { const body = instruction.value.trim(); return { phone: phone.value.trim(), name: name.value.trim(), body, instruction: usesScope() && body ? withScope(body, form.ok, form.hold) : body, preset: voice.value }; }
  function changed() {
    review = null; consentBox.checked = false;
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.id === form.contactId));
    for (const c of purposeChips.children) { const on = c.dataset.purpose === form.purpose; c.setAttribute('aria-pressed', String(on)); c.setAttribute('aria-checked', String(on)); }
    productRow.hidden = !isSales(); voiceField.hidden = isSales(); scopeField.hidden = !usesScope();
    // The purposes write the request; examples only help a request in plain words.
    template.closest('.two').hidden = form.purpose !== '';
    renderSide();
  }
  // Typing a number by hand means it is not the chosen contact any more.
  phone.addEventListener('input', () => { form.contactId = contacts.find(c => displayPhone(c.phone) === phone.value.trim() || c.phone === phone.value.trim())?.id ?? null; });
  instruction.addEventListener('input', () => { suggested = false; });
  for (const n of [phone, name, instruction, voice]) n.addEventListener('input', changed);
  voice.addEventListener('change', changed);
  template.addEventListener('change', () => { const t = app.templates.find(x => x.id === template.value); if (!t) return; instruction.value = t.instruction?.ja ?? ''; suggested = false; form.mode = t.conversationMode ?? ''; form.purpose = form.mode === 'chat' ? 'chat' : ''; changed(); });
  consentBox.addEventListener('change', () => { go.disabled = !review || !consentBox.checked; });

  function renderSide() {
    const v = values();
    const brief = el('div', { class: 'brief' },
      el('p', { class: 'nomargin' }, el('b', { text: v.name || '（相手）' }), v.phone ? el('span', { class: 'num', text: `（${displayPhone(v.phone)}）` }) : '', ' に電話して、次のことを頼みます。'),
      ...(isSales() ? [el('p', { text: `紹介する商品：${b.products.find(x => x.id === form.productId)?.name ?? '（未選択）'}。確認済みの説明だけを使い、値引き・契約・支払いは約束しません。` })] : []),
      el('blockquote', { text: v.body || '（何をしてほしいか）' }),
      ...(usesScope() && form.ok.length ? [el('p', { class: 'nomargin' }, 'その場で決めてよいこと：', el('mark', { text: form.ok.join('、') }))] : []),
      ...(usesScope() && form.hold.length ? [el('p', { class: 'nomargin' }, '次の話が出たら、決めずに持ち帰ります：', el('mark', { class: 'hold', text: form.hold.join('、') }))] : []),
      el('p', { text: `最初に、AIであること・${b.account?.callerName ? `${b.account.callerName}の代わりであること・` : ''}記録していることを伝えます。支払いの約束はしません。` }));
    const facts = el('dl', { class: 'defs left' },
      el('dt', { text: '通話の上限' }), el('dd', { text: `${Math.round((review?.mission.maxSeconds ?? 180) / 60)}分で切ります` }),
      el('dt', { text: '費用の目安' }), el('dd', { text: review ? (review.mission.mode === 'simulator' ? '練習なので0円' : review.mission.creditQuote?.mode === 'credits' ? `${review.mission.creditQuote.amount} クレジット（確保）` : `最大 約$${review.mission.estimatedMaximumUsd.toFixed(2)}（上限 $${review.mission.maxUsd}）`) : '内容を確かめると表示します' }),
      el('dt', { text: '声' }), el('dd', { text: v.preset ? (st.voicePresets[v.preset] ?? v.preset) : '標準の声' }));
    const warns = [];
    // The setup details are for whoever runs the server: one line here, the details in 設定.
    if (!st.ready) warns.push(el('p', { class: 'warnbox' }, b.configuration.mode === 'live' ? '本番の電話の設定が終わっていないので、まだかけられません。' : '練習モードなので、実際の電話はかけられません。', el('a', { href: '#/settings', text: '設定で確かめる' })));
    if (blocked) warns.push(el('p', { class: 'warnbox' }, `${blocked.request.name}の電話が終わったか確かめるまで、発信できません。`, el('a', { href: '#/requests', text: '依頼一覧で確かめる' })));
    if (review && app.month.capUsd !== null && app.month.usedUsd + review.mission.estimatedMaximumUsd > app.month.capUsd + 1e-9)
      warns.push(el('p', { class: 'warnbox' }, `今月の上限（$${app.month.capUsd}）を超えるので、この電話はかけられません（今月 $${app.month.usedUsd.toFixed(2)}＋この電話 最大 $${review.mission.estimatedMaximumUsd.toFixed(2)}）。`, el('a', { href: '#/settings/cost', text: '上限を見直す' })));
    if (liveNow) warns.push(el('p', { class: 'warnbox' }, 'いまの電話が終わるまで、次の電話はかけられません。', el('a', { href: `#/call/${liveNow.id}`, text: '電話中の画面へ' })));
    // Sales calls also run in practice mode (the scripted partner answers); other requests need a real line.
    const practiceSales = isSales() && b.configuration.mode === 'simulator';
    if (practiceSales) warns.splice(0, warns.length, ...warns.filter(w => !/練習モードなので/.test(w.textContent)), el('p', { class: 'warnbox', text: '練習モード：実際の電話はかからず、練習用の相手と話します。費用はかかりません。' }));
    const canCheck = !blocked && !liveNow && (st.ready || practiceSales);
    check.disabled = !canCheck || Boolean(review);
    go.disabled = !review || !consentBox.checked;
    side.replaceChildren(
      el('div', { class: 'side-h' }, el('small', { text: 'AIへの指示書' }), el('b', { text: 'AIはこう電話します' })),
      brief, facts,
      // Where the data goes, for a real call; a practice call goes nowhere.
      ...(review?.readiness?.disclosure && review.mission.mode !== 'simulator' ? [el('p', { class: 'note', text: review.readiness.disclosure })] : []),
      ...warns, err,
      ...(!consented ? [el('label', { class: 'check' }, consentAgree, '会話データの取り扱い（電話会社と音声AIに音声と文字が渡り、記録はこのサーバーに30日保存）に同意します。')] : []),
      review ? el('label', { class: 'check' }, consentBox, '相手・頼むこと・費用を確かめました。この1件の発信を承認します。') : check,
      ...(review ? [go] : []),
      el('p', { class: 'note', text: review ? '押すまで電話はかかりません。承認はこの内容だけに有効です。' : 'まだ電話はかかりません。内容を確かめると、費用の見込みと承認のチェックが出ます。' }));
  }
  check.addEventListener('click', async () => {
    err.hidden = true; const v = values();
    try {
      if (!consented) { if (!consentAgree.checked) throw new Error('会話データの取り扱いへの同意にチェックを入れてください。'); await api('/consent', { method: 'POST', body: { version: b.configuration.consentVersion } }); b.account.consentVersion = b.configuration.consentVersion; }
      const engine = engineFor(v.preset);
      if (isSales()) {
        if (!form.contactId) throw new Error('営業の電話は、連絡先から相手を選んでください（連絡先の画面で登録できます）。');
        if (!form.productId) throw new Error('紹介する商品を選んでください（設定の「商品」で登録できます）。');
        const m = await api('/missions/draft', { method: 'POST', body: { request: v.body, productId: form.productId, goal: form.purpose, contactId: form.contactId, maxSeconds: Math.min(180, b.configuration.maxSeconds) } });
        review = { ...(await api(`/missions/${m.id}/review`, { method: 'POST', body: {} })), readiness: st };
      } else review = await api('/phone/draft', { method: 'POST', body: { phone: v.phone, name: v.name, instruction: v.instruction,
        ...(form.mode ? { conversationMode: form.mode } : {}), ...(b.account?.callerName ? { callerName: b.account.callerName } : {}), ...(v.preset ? { voicePreset: v.preset } : {}), ...(engine ? { engine } : {}) } });
      review.key = crypto.randomUUID();
      renderSide(); consentBox.focus();
    } catch (e) { err.textContent = e.message; err.hidden = false; renderSide(); }
  });
  go.addEventListener('click', async () => {
    if (!review || !consentBox.checked) return;
    go.disabled = true; err.hidden = true;
    try {
      await api(`/missions/${review.mission.id}/start`, { method: 'POST', body: { approvalToken: review.approvalToken, acknowledged: true }, headers: { 'Idempotency-Key': review.key } });
      app.boot = null; await loadAll(); location.hash = `#/call/${review.mission.id}`;
    } catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; }
  });
  let voiceField, scopeField;
  const field = (k, d, ...content) => el('div', { class: 'field' }, el('div', { class: 'k' }, el('b', { text: k }), d ? el('span', { text: d }) : null), el('div', {}, ...content));
  const view = el('div', { class: 'ask' },
    el('section', { class: 'ask-form' },
      el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'), el('h1', { text: '電話を頼む' }),
      field('だれに', contacts.length ? '連絡先から選ぶか、番号を入れます' : '番号と名前を入れます', contacts.length ? chips : null,
        el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl', for: 'ask-phone', text: '電話番号' }), phone), el('div', {}, el('label', { class: 'lbl', for: 'ask-name', text: '相手の名前' }), name))),
      field('何をしてほしいか', '目的を選び、ふだんの言葉で', purposeChips, el('div', { class: 'gap' }), instruction, el('div', { class: 'two' }, template), productRow),
      scopeField = field('任せる範囲', '相手に別の案を出されたときの、AIの動き方', scopeBox),
      voiceField = field('声', '話し方と声。判定は、どの声でも同じです', voice,
        el('p', { class: 'note', text: b.account?.callerName ? `AIは「${b.account.callerName}の代わり」と名乗ります。` : 'AIが名乗る名前は、設定の「かける設定」で決められます。' }))),
    side);
  if (form.purpose && !form.instruction) suggest();
  changed();
  return view;
}

// ---------------------------------------------------------------- 電話中 / 報告
async function call(id) {
  const known = app.history.find(x => x.id === id);
  const r = known?.sales ? fromSales(await api(`/missions/${encodeURIComponent(id)}`)) : await api(`/phone/calls/${encodeURIComponent(id)}`);
  const i = app.history.findIndex(x => x.id === r.id); if (i >= 0) app.history[i] = r;
  const live = LIVE.includes(r.state), notes = notesOf(r), ok = notes.filter(n => n.status === 'verified').length, o = outcome(r);
  const seconds = r.billing?.durationSeconds ?? (live ? (Date.now() - Date.parse(r.createdAt)) / 1000 : 0);
  const head = el('div', { class: 'head' },
    notes.length ? ringFor(notes.length, notes.map(n => n.status === 'verified')) : null,
    el('div', {},
      el('div', { class: `state-line ${live ? 'state-live' : ''}` }, live ? el('span', { class: 'dot' }) : null, live ? '電話中' : r.state === 'failed' || r.state === 'unknown' ? o.text : '電話が終わりました', seconds ? el('time', { class: 'num', text: ` ${mmss(seconds)}` }) : null,
        live ? el('span', { class: 'muted small', text: ' · 上限の時間になると、あいさつして切ります' }) : null),
      el('h1', { class: 'headline', text: live ? (r.transcript?.length ? '相手と話しています' : '発信しています') : o.text })));
  const main = el('section', { class: 'call-main' },
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' › ', el('b', { text: r.request.name }), el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : r.practice ? '練習' : '本番' })),
    head);
  if (notes.length) {
    main.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '確かめること' }), el('span', { class: 'sub', text: '相手の言葉で確かめられたら、輪が一区切り閉じます' })),
      el('div', { class: 'fields' }, ...notes.map((n, k) => el('div', { class: `fcard ${n.status === 'verified' ? 'ok' : ''}` },
        el('div', { class: 'k', text: `${k + 1} ${FIELD[n.field]}` }), n.status === 'verified' ? el('span', { class: 'tick', text: '✓', 'aria-label': '相手の言葉で確認済み' }) : null,
        el('div', { class: `v ${n.status === 'verified' ? '' : 'want'}`, text: n.value !== undefined ? fmtValue(n.field, n.value) : n.requested !== undefined ? fmtValue(n.field, n.requested) : '—' }),
        el('div', { class: 'q', text: n.status === 'verified' && n.quote ? `「${n.quote}」` : n.status === 'proposed' ? '提案中・まだ確かめていません' : 'まだ確かめていません' })))));
  } else {
    main.append(el('div', { class: 'card' }, el('h2', { text: 'この電話について' }),
      el('p', { class: 'about', text: r.request.conversationMode === 'chat' ? '雑談の電話です。決まったかどうかは判定しません。' : 'この電話には、決まったかどうかを判定する項目がありません。' }),
      el('dl', { class: 'defs left' }, el('dt', { text: '相手' }), el('dd', { text: r.request.name }), el('dt', { text: '番号' }), el('dd', { class: 'num', text: displayPhone(r.request.phone) }),
        el('dt', { text: '頼んだこと' }), el('dd', { text: r.request.instruction }))));
  }
  // What the AI decided within 任せる範囲, as it reported it: its own account, next to (never instead of) the verdict.
  if (splitScope(r.request.instruction).ok.length || r.decisions?.length) {
    main.append(el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: 'AIが判断したこと' }), el('span', { class: 'sub', text: 'AIの報告です。決まったかどうかは、相手の言葉だけで判定します' })),
      r.decisions?.length ? el('div', { class: 'rows' }, ...r.decisions.map(d => el('div', { class: 'row decision' }, el('div', {}, el('div', { class: 'who' }, el('span', { class: 'scope-ico', text: '○' }), ' ', d.decision), d.within ? el('div', { class: 'what', text: `任せた範囲「${d.within}」の中です` }) : null))))
        : el('p', { class: 'muted small', text: live ? 'まだありません。任せた範囲の外の話が出たら、決めずに持ち帰ります。' : 'ありませんでした。' }));
  }
  if (r.error) main.append(el('p', { class: 'errbox', text: r.error }));
  const foot = el('div', { class: 'call-foot' });
  if (live) foot.append(el('button', { class: 'btn danger', type: 'button', text: '通話を終える', onclick: async e => {
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
      el('div', { class: 'who' }, t.source === 'callee' ? r.request.name : 'AI', typeof t.t === 'number' ? el('time', { text: mmss(t.t / 1000) }) : null),
      marked(t.text, t.source === 'callee' ? notes.map((n, k) => ({ quote: n.status === 'verified' ? n.quote : '', n: k + 1 })) : [])))
      : [el('p', { class: 'empty', text: live ? 'つながると、ここに会話が出ます。' : '会話の記録はありません。' })]));
  const side = el('aside', { class: 'call-side', 'aria-label': '会話' }, el('div', { class: 'side-top' }, el('b', { text: '会話' }), el('span', { class: 'muted small', text: '文字起こしは自動・音声は保存しません' })), transcript);
  if (live) app.timer = setTimeout(async () => { if (location.hash.startsWith(`#/call/${r.id}`)) { const y = window.scrollY; const t = $('.transcript'); const atEnd = t && t.scrollHeight - t.scrollTop - t.clientHeight < 40; await route(); window.scrollTo(0, y); if (atEnd) { const n = $('.transcript'); if (n) n.scrollTop = n.scrollHeight; } } }, 1500);
  requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
  renderBar();
  return el('div', { class: 'call' }, main, side);
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

// ---------------------------------------------------------------- 練習
async function practice(id, sub) {
  app.practice ??= await api('/practice/scenarios');
  const list = app.practice, sel = list.find(x => x.id === id) ?? list[0];
  if (sub === 'run' && sel) return practiceRun(sel);
  let how = 'watch';
  const detail = sel ? el('div', { class: 'card stack' },
    el('span', { class: 'muted small', text: sel.difficulty }), el('h1', { class: 'headline', text: sel.title }),
    el('p', { class: 'about', text: sel.brief }),
    el('h2', { class: 'section-h', text: '確かめること' }), el('div', { class: 'chips' }, ...sel.require.map(f => el('span', { class: 'chip static', text: FIELD[f] ?? f }))),
    el('h2', { class: 'section-h', text: 'やり方' }),
    el('div', { class: 'two', role: 'radiogroup', 'aria-label': 'やり方' }, ...[['watch', 'AIの電話を見る', `AIが${sel.callee || '練習用の相手'}と話すのを見ます`], ['play', '自分が相手役', 'あなたが相手として答えます（Arena で）']].map(([v, l, d]) =>
      el('label', { class: 'option' }, el('input', { type: 'radio', name: 'how', value: v, checked: v === how, onchange: () => { how = v; } }), el('span', {}, el('b', { text: l }), el('span', { class: 'muted small', text: d }))))),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: '練習を始める', onclick: () => {
      if (how === 'play') { toast('自分が相手役の練習は、あなたのパソコンの Arena（npx oathra demo）で行えます。'); return; }
      location.hash = `#/practice/${sel.id}/run`;
    } })),
    el('p', { class: 'note', text: '電話はかからず、費用もかかりません。AIが「決まりました」と言っても、相手の言葉で確かめられるまで完了にはなりません。' }))
    : el('div', { class: 'card' }, el('p', { class: 'muted', text: '練習がありません。' }));
  return el('div', { class: 'page' }, el('div', { class: 'split-page' },
    el('div', { class: 'stack' }, el('div', { class: 'page-h' }, el('h1', { text: '練習' })),
      el('p', { class: 'note', text: 'AIが店員役などと話します。電話はかからず、費用もかかりません。' }),
      el('div', { class: 'list' }, ...list.map(x => el('button', { class: 'item', type: 'button', 'aria-current': String(x.id === sel?.id), onclick: () => { location.hash = `#/practice/${x.id}`; } },
        el('span', { class: 'grow' }, el('b', { text: x.title }), el('span', { text: x.brief.slice(0, 40) })), el('span', { class: 'muted small', text: x.difficulty }))))),
    detail));
}
async function practiceRun(sel) {
  const run = await api('/practice/run', { method: 'POST', body: { scenario: sel.id } });
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
    foot.replaceChildren(el('a', { class: 'btn primary', href: `#/practice/${sel.id}`, text: 'もう一度' }), el('a', { class: 'btn', href: '#/practice', text: '別の練習を選ぶ' }),
      el('p', { class: 'note', text: `${run.falseCompletion ? 'AIの勘違いで「決まった」にした項目：あり' : 'AIの勘違いで「決まった」にした項目：なし'}。練習の記録は、このサーバーには残しません。` }));
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
  if (still) { run.transcript.forEach((_, i) => show(i)); finish(); }
  else { let i = 0; const tick = () => { if (!location.hash.startsWith(`#/practice/${sel.id}/run`)) return; if (i < run.transcript.length) { show(i++); app.timer = setTimeout(tick, 1100); } else finish(); }; app.timer = setTimeout(tick, 300); }
  const main = el('section', { class: 'call-main' },
    el('div', { class: 'crumb' }, el('a', { href: '#/practice', text: '練習' }), ' › ', el('b', { text: run.scenario.title }), el('span', { class: 'tag', text: '練習' })),
    el('div', { class: 'head' }, ringBox, el('div', {}, stateLine, headline)),
    ...(fields.length ? [el('div', { class: 'page-h' }, el('h2', { class: 'section-h', text: '確かめること' }), el('span', { class: 'sub', text: '相手の言葉で確かめられたら、輪が一区切り閉じます' })), cards] : []),
    foot);
  return el('div', { class: 'call' }, main, el('aside', { class: 'call-side', 'aria-label': '会話' }, el('div', { class: 'side-top' }, el('b', { text: '会話' }), el('span', { class: 'muted small', text: '練習・電話はかかりません' })), lines));
}

// ---------------------------------------------------------------- 連絡先
async function contacts(id) {
  const list = app.boot.contacts, sel = list.find(c => c.id === (id || app.contactSel)) ?? list[0];
  app.contactSel = sel?.id;
  const q = el('input', { type: 'search', placeholder: '名前・会社・番号で探す', 'aria-label': '連絡先を探す' });
  const items = el('div', { class: 'list' });
  const draw = () => {
    const w = q.value.trim(), shown = list.filter(c => !w || [c.name, c.company, c.phone].some(x => x && x.includes(w)));
    items.replaceChildren(...(shown.length ? shown.map(c => el('button', { class: 'item', type: 'button', 'aria-current': String(c.id === sel?.id), onclick: () => { location.hash = `#/contacts/${c.id}`; } },
      el('span', { class: 'avatar', text: (c.name || c.company || '?').slice(0, 1) }), el('span', {}, el('b', { text: c.name || c.company }), el('span', { class: 'num', text: [c.company && c.name ? c.company : '', displayPhone(c.phone) || '電話番号なし'].filter(Boolean).join(' · ') }))))
      : [el('p', { class: 'empty', text: list.length ? '見つかりません。' : 'まだ連絡先がありません。' })]));
  };
  q.addEventListener('input', draw); draw();
  const addForm = el('form', { class: 'card stack', hidden: true, onsubmit: async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { const saved = await api('/contacts', { method: 'POST', body: { name: f.get('name'), company: f.get('company'), phone: f.get('phone'), notes: f.get('notes'), relationship: f.get('relationship'), basis: f.get('basis') } }); app.boot = null; await loadAll(); location.hash = `#/contacts/${saved.id}`; toast('保存しました。'); }
    catch (err) { toast(err.message); }
  } }, el('h2', { text: '連絡先を追加' }),
    el('label', { class: 'lbl', text: '名前' }), el('input', { type: 'text', name: 'name' }),
    el('label', { class: 'lbl', text: '会社・お店（任意）' }), el('input', { type: 'text', name: 'company' }),
    el('label', { class: 'lbl', text: '電話番号（任意）' }), el('input', { type: 'tel', name: 'phone' }),
    el('label', { class: 'lbl', text: 'この相手との関係（営業の電話に必要）' }), el('select', { name: 'relationship' }, el('option', { value: '', text: '指定しない' }), el('option', { value: 'inquiry', text: '問い合わせをもらった' }), el('option', { value: 'customer', text: '既存のお客さま' }), el('option', { value: 'consented', text: '電話の同意をもらった' })),
    el('label', { class: 'lbl', text: '電話してよい根拠（営業の電話に必要）' }), el('input', { type: 'text', name: 'basis', placeholder: '例：9/20 に資料請求フォームから問い合わせ' }),
    el('label', { class: 'lbl', text: 'メモ（任意・AIには渡しません）' }), el('textarea', { name: 'notes' }),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit', text: '保存する' })));
  const calls = sel ? app.history.filter(r => r.request.phone === sel.phone) : [];
  const detail = sel ? el('div', { class: 'card' },
    el('div', { class: 'metric-k' }, el('div', { class: 'split' }, el('span', { class: 'avatar big', text: (sel.name || sel.company || '?').slice(0, 1) }), el('div', {}, el('h1', { class: 'headline', text: sel.name || sel.company }), el('span', { text: sel.name ? sel.company : '' }))),
      sel.phone ? el('a', { class: 'btn primary', href: `#/new?contact=${sel.id}`, text: 'この相手に電話を頼む' }) : null),
    el('dl', { class: 'defs left' }, el('dt', { text: '電話番号' }), el('dd', { class: 'num', text: displayPhone(sel.phone) || '—' }), el('dt', { text: 'メール' }), el('dd', { text: sel.email || '—' }), el('dt', { text: 'メモ' }), el('dd', { text: sel.notes || '—' }),
      el('dt', { text: '関係' }), el('dd', { text: { inquiry: '問い合わせをもらった', customer: '既存のお客さま', consented: '電話の同意をもらった' }[sel.relationship] ?? '—（営業の電話には必要）' }), el('dt', { text: '根拠' }), el('dd', { text: sel.basis || '—' })),
    el('h2', { class: 'section-h', text: 'この番号への電話' }), el('p', { class: 'note', text: '電話番号で照合しています。メモや履歴は、AIに自動では渡しません。' }), callRows(calls, 'まだありません。'))
    : el('div', { class: 'card' }, el('p', { class: 'muted', text: '連絡先を追加すると、ここに出ます。' }));
  return el('div', { class: 'page' }, el('div', { class: 'split-page' },
    el('div', { class: 'stack' }, el('div', { class: 'page-h' }, el('h1', { text: '連絡先' }), el('button', { class: 'btn', type: 'button', text: '＋ 追加', onclick: () => { addForm.hidden = !addForm.hidden; if (!addForm.hidden) addForm.querySelector('input').focus(); } })), q, items),
    el('div', { class: 'stack' }, addForm, detail)));
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
      row('本番の電話', '接続を確かめてから発信します', el('b', { text: cfg.mode === 'live' ? (cfg.liveReady && st.ready ? '発信できます' : '設定が終わっていません') : '練習モード（電話はかかりません）' }), ...(st.issues ?? []).map(i => el('p', { class: 'note', text: i }))),
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
      ...(!inb ? [el('p', { class: 'warnbox', text: 'このサーバーでは、かかってきた電話を受ける設定がされていません（管理者の設定）。ここで決めた動きは、受ける設定がされたときと、あなたがかけた電話への折り返しに使います。' })]
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
    } }, el('label', { class: 'lbl', text: '商品名' }), el('input', { type: 'text', name: 'name', required: true }),
      el('label', { class: 'lbl', text: 'AIが説明してよいこと（確かめた事実だけ）' }), el('textarea', { name: 'facts', required: true }),
      el('label', { class: 'lbl', text: '出典のURL（任意）' }), el('input', { type: 'text', name: 'source' }),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'reviewed' }), '内容を確かめました。この事実だけを電話で使います。'),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit', text: '商品を保存する' })));
    body = [el('h2', { text: '商品（営業の電話）' }), el('p', { class: 'note', text: '「商談の日時を決める」「資料を送ってよいか聞く」「商品を説明する」で紹介する商品です。AIは、ここに書いた確認済みの事実だけを使い、値引き・契約・支払い・未確認の機能や納期は約束しません。' }),
      ...(b.products.length ? b.products.map(x => row(x.name, `確認 ${new Date(x.reviewedAt).toLocaleDateString('ja-JP')}`, el('p', { class: 'note', text: x.facts.slice(0, 160) }))) : [el('p', { class: 'muted', text: 'まだ商品がありません。' })]),
      el('h2', { class: 'section-h', text: '商品を追加' }), form];
  } else if (app.settingsTab === 'cost') {
    const ledger = b.credits?.enabled ? (await api('/credits/ledger')).entries : [];
    const labels = { grant: '追加', reserve: '確保', consume: '消費', release: '返却' };
    body = [el('h2', { text: '費用とクレジット' }),
      b.credits?.enabled ? row('クレジット残高', '', el('b', { class: 'num', text: `${b.credits.available}` }), el('span', { class: 'note', text: b.credits.held ? ` 確保中 ${b.credits.held}` : '' }))
        : row('費用', 'このサーバーはクレジット制ではありません', el('span', { text: `1回の上限 $${cfg.maxCallUsd}（見込みが上限を超える電話は発信しません）` })),
      ...(ledger.length ? [el('h2', { class: 'section-h', text: '履歴' }), el('div', { class: 'rows' }, ...ledger.slice(-30).reverse().map(e => el('div', { class: 'row' }, el('div', {}, el('div', { class: 'who', text: labels[e.kind] ?? e.kind })), el('div', { class: 'outcome num', text: `${e.amount}` }), el('time', { class: 'num', text: when(new Date(e.created).toISOString()) }))))] : []),
      row('月の上限', '承認した電話の見込みの上限の合計（日本時間の月ごと）', (() => {
        const cap = el('input', { type: 'text', inputmode: 'decimal', value: app.month.capUsd ?? '', placeholder: '例：30（空欄で上限なし）', 'aria-label': '月の上限（米ドル）' });
        return el('div', {}, el('div', { class: 'two' }, cap, el('button', { class: 'btn', type: 'button', text: '保存する', onclick: async () => {
          try { await api('/account/monthly-cap', { method: 'POST', body: { capUsd: cap.value.trim() === '' ? null : cap.value.trim() } }); await loadAll(); toast(cap.value.trim() ? '月の上限を保存しました。' : '月の上限をなくしました。'); route(); } catch (e) { toast(e.message); }
        } })), el('p', { class: 'note', text: `今月 $${app.month.usedUsd.toFixed(2)}${app.month.capUsd !== null ? ` / 上限 $${app.month.capUsd}` : '（上限なし）'}。見込みは実際の請求より多めです。` }));
      })()),
      el('p', { class: 'note', text: '1回の電話の上限は、承認のときの見込みで守られます。月の上限を超える電話は、承認の時点で止まります。' })];
  } else if (app.settingsTab === 'voice') {
    body = [el('h2', { text: '声とAI' }), ...(st.engines ?? []).map(e => row(e.label, e.id === st.defaultEngine ? '標準' : '', el('span', { text: e.ready ? '使えます' : '使えません（キー未設定）' })))];
  } else {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    body = [el('h2', { text: '記録と表示' }),
      row('表示', '明るい／暗い', el('div', { class: 'chips' }, ...[['light', '明るい'], ['dark', '暗い']].map(([v, l]) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === v), text: l, onclick: () => { try { localStorage.setItem('oathra.theme', v); } catch { /* off */ } document.documentElement.dataset.theme = v; route(); } })))),
      row('会話の記録', '', el('span', { text: '文字起こしと結果を30日保存します。音声ファイルは保存しません。' })),
      row('連携・転送・番号の確認', 'メールや予定の送信、自分への転送、番号のSMS確認、連絡停止', el('a', { class: 'btn', href: '/workspace', text: '従来の画面で開く' }), el('p', { class: 'note', text: 'これらはまだこの画面に移していません。' })),
      row('ログアウト', '', el('button', { class: 'btn', type: 'button', text: 'ログアウト', onclick: async () => { await api('/session', { method: 'DELETE', body: {} }).catch(() => null); app.boot = null; location.hash = '#/'; renderLogin(); } }))];
  }
  return el('div', { class: 'page' }, el('div', { class: 'split-page' },
    el('div', { class: 'stack' }, el('div', { class: 'page-h' }, el('h1', { text: '設定' })), el('nav', { class: 'tabsv', 'aria-label': '設定の種類' }, ...tabs.map(([k, l]) => el('button', { type: 'button', 'aria-current': String(app.settingsTab === k), text: l, onclick: () => { location.hash = `#/settings/${k}`; } })))),
    el('div', { class: 'card' }, ...body)));
}

route();
setInterval(() => { if (app.boot) renderBar(); }, 1000);
