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
const FIELD = { date: '日付', time: '時刻', partySize: '人数', price: '料金', confirmed: '相手の確認' };
const fmtValue = (field, v) => field === 'confirmed' ? (v ? 'はい' : 'いいえ') : field === 'partySize' ? `${v}名` : field === 'price' ? `${v}円` : field === 'date' ? fmtDate(v) : String(v);
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
  const [boot, history] = await Promise.all([api('/bootstrap'), api('/phone/history')]);
  app.boot = boot; app.history = history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const [name = '', id] = location.hash.split('?')[0].replace(/^#\/?/, '').split('/');
  const view = $('#view');
  for (const a of document.querySelectorAll('[data-tab]')) {
    const tab = a.dataset.tab, on = tab === (name || 'home') || (tab === 'requests' && ['new', 'call'].includes(name));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!app.boot) { try { await loadAll(); } catch (e) { if (e.status === 401) return renderLogin(); view.replaceChildren(el('div', { class: 'page' }, el('p', { class: 'errbox', text: e.message }))); return; } }
  $('#tabs').hidden = false; $('#bar-right').hidden = false;
  const render = routes[name] ?? home;
  try { view.replaceChildren(await render(id)); } catch (e) { if (e.status === 401) { app.boot = null; return renderLogin(); } view.replaceChildren(el('div', { class: 'page' }, el('p', { class: 'errbox', text: e.message }))); }
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
    : el('div', { class: 'card' }, el('div', { class: 'metric-k' }, el('span', { text: '費用の上限' })), el('div', { class: 'metric-v', text: `$${b.configuration.maxCallUsd}` }),
      el('p', { class: 'note', text: `1回の電話あたりの上限（米ドル）。通話は最長${Math.round(b.configuration.maxSeconds / 60)}分で切ります。` }));
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
      el('div', {}, el('div', { class: 'who' }, r.request.name, el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : '本番' })), el('div', { class: 'what', text: r.request.instruction.slice(0, 60) })),
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
async function ask() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!app.status) [app.status, app.templates] = await Promise.all([api('/phone/status'), api('/phone/templates')]);
  const st = app.status, b = app.boot, contacts = b.contacts.filter(c => c.phone);
  const from = app.history.find(r => r.id === (params.get('again') || params.get('draft')));
  const pre = from?.request ?? {}, preContact = params.get('contact') ? b.contacts.find(c => c.id === params.get('contact')) : null;
  const form = { phone: pre.phone ?? preContact?.phone ?? '', name: pre.name ?? preContact?.name ?? preContact?.company ?? '', instruction: pre.instruction ?? '', mode: pre.conversationMode ?? '', preset: pre.voicePreset ?? '' };
  let review = null;
  const actingReady = st.engines?.find(e => e.id === 'character-tts')?.ready === true;
  const engineFor = preset => preset?.startsWith('character-') && actingReady ? 'character-tts' : '';

  const phone = el('input', { type: 'tel', id: 'ask-phone', value: displayPhone(form.phone), autocomplete: 'off', placeholder: '090-1234-5678' });
  const name = el('input', { type: 'text', id: 'ask-name', value: form.name, placeholder: '相手の名前' });
  const instruction = el('textarea', { id: 'ask-instruction', placeholder: '例：10月3日（土）の夜に2名で予約を取ってほしい。できれば19時。名前は田中。' }); instruction.value = form.instruction;
  const template = el('select', { id: 'ask-template', 'aria-label': '例から選ぶ' }, el('option', { value: '', text: '例から選ぶ（任意）' }), ...app.templates.map(t => el('option', { value: t.id, text: t.title?.ja ?? t.id })));
  const voice = el('select', { id: 'ask-voice' }, el('option', { value: '', text: '標準の声（すぐ返事）' }),
    ...Object.entries(st.voicePresets ?? {}).map(([id, label]) => el('option', { value: id, text: `${label}${engineFor(id) ? '（演技・返事まで2〜3秒）' : ''}` })));
  voice.value = form.preset;
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': '連絡先から選ぶ' }, ...contacts.slice(0, 8).map(c => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.phone === form.phone), text: c.name || c.company,
    onclick: () => { phone.value = displayPhone(c.phone); name.value = c.name || c.company; changed(); } })));

  const side = el('aside', { class: 'ask-side', 'aria-label': 'AIへの指示書' });
  const consentBox = el('input', { type: 'checkbox', id: 'ask-ack' });
  const go = el('button', { class: 'btn primary big', type: 'button', text: 'この内容で電話をかける', disabled: true });
  const check = el('button', { class: 'btn big', type: 'button', text: '内容を確かめる' });
  const err = el('p', { class: 'errbox', role: 'alert', hidden: true });
  const blocked = app.history.find(r => r.state === 'unknown' && !r.resolvedAt);
  const liveNow = app.history.find(r => LIVE.includes(r.state));
  const consented = b.account?.consentVersion === b.configuration.consentVersion;
  const consentAgree = el('input', { type: 'checkbox', id: 'ask-consent' });

  function values() { return { phone: phone.value.trim(), name: name.value.trim(), instruction: instruction.value.trim(), preset: voice.value }; }
  function changed() { review = null; consentBox.checked = false; renderSide(); for (const c of chips.children) c.setAttribute('aria-pressed', String(c.textContent === name.value.trim())); }
  for (const n of [phone, name, instruction, voice]) n.addEventListener('input', changed);
  voice.addEventListener('change', changed);
  template.addEventListener('change', () => { const t = app.templates.find(x => x.id === template.value); if (!t) return; instruction.value = t.instruction?.ja ?? ''; form.mode = t.conversationMode ?? ''; changed(); });
  consentBox.addEventListener('change', () => { go.disabled = !review || !consentBox.checked; });

  function renderSide() {
    const v = values();
    const brief = el('div', { class: 'brief' },
      el('p', { class: 'nomargin' }, el('b', { text: v.name || '（相手）' }), v.phone ? el('span', { class: 'num', text: `（${displayPhone(v.phone)}）` }) : '', ' に電話して、次のことを頼みます。'),
      el('blockquote', { text: v.instruction || '（何をしてほしいか）' }),
      el('p', { text: `最初に、AIであること・${b.account?.callerName ? `${b.account.callerName}の代わりであること・` : ''}記録していることを伝えます。支払いの約束はしません。` }));
    const facts = el('dl', { class: 'defs left' },
      el('dt', { text: '通話の上限' }), el('dd', { text: `${Math.round((review?.mission.maxSeconds ?? 180) / 60)}分で切ります` }),
      el('dt', { text: '費用の目安' }), el('dd', { text: review ? (review.mission.creditQuote?.mode === 'credits' ? `${review.mission.creditQuote.amount} クレジット（確保）` : `最大 約$${review.mission.estimatedMaximumUsd.toFixed(2)}（上限 $${review.mission.maxUsd}）`) : '内容を確かめると表示します' }),
      el('dt', { text: '声' }), el('dd', { text: v.preset ? (st.voicePresets[v.preset] ?? v.preset) : '標準の声' }));
    const warns = [];
    // The setup details are for whoever runs the server: one line here, the details in 設定.
    if (!st.ready) warns.push(el('p', { class: 'warnbox' }, b.configuration.mode === 'live' ? '本番の電話の設定が終わっていないので、まだかけられません。' : '練習モードなので、実際の電話はかけられません。', el('a', { href: '#/settings', text: '設定で確かめる' })));
    if (blocked) warns.push(el('p', { class: 'warnbox' }, `${blocked.request.name}の電話が終わったか確かめるまで、発信できません。`, el('a', { href: '#/requests', text: '依頼一覧で確かめる' })));
    if (liveNow) warns.push(el('p', { class: 'warnbox' }, 'いまの電話が終わるまで、次の電話はかけられません。', el('a', { href: `#/call/${liveNow.id}`, text: '電話中の画面へ' })));
    const canCheck = !blocked && !liveNow && st.ready;
    check.disabled = !canCheck || Boolean(review);
    go.disabled = !review || !consentBox.checked;
    side.replaceChildren(
      el('div', { class: 'side-h' }, el('small', { text: 'AIへの指示書' }), el('b', { text: 'AIはこう電話します' })),
      brief, facts,
      ...(review?.readiness?.disclosure ? [el('p', { class: 'note', text: review.readiness.disclosure })] : []),
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
      review = await api('/phone/draft', { method: 'POST', body: { phone: v.phone, name: v.name, instruction: v.instruction,
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
      app.boot = null; location.hash = `#/call/${review.mission.id}`;
    } catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; }
  });
  renderSide();
  const field = (k, d, ...content) => el('div', { class: 'field' }, el('div', { class: 'k' }, el('b', { text: k }), d ? el('span', { text: d }) : null), el('div', {}, ...content));
  return el('div', { class: 'ask' },
    el('section', { class: 'ask-form' },
      el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' ›'), el('h1', { text: '電話を頼む' }),
      field('だれに', contacts.length ? '連絡先から選ぶか、番号を入れます' : '番号と名前を入れます', contacts.length ? chips : null,
        el('div', { class: 'two' }, el('div', {}, el('label', { class: 'lbl', for: 'ask-phone', text: '電話番号' }), phone), el('div', {}, el('label', { class: 'lbl', for: 'ask-name', text: '相手の名前' }), name))),
      field('何をしてほしいか', 'ふだんの言葉で', instruction, el('div', { class: 'two' }, template)),
      field('声', '話し方と声。判定は、どの声でも同じです', voice,
        el('p', { class: 'note', text: b.account?.callerName ? `AIは「${b.account.callerName}の代わり」と名乗ります。` : 'AIが名乗る名前は、設定の「かける設定」で決められます。' }))),
    side);
}

// ---------------------------------------------------------------- 電話中 / 報告
async function call(id) {
  const r = await api(`/phone/calls/${encodeURIComponent(id)}`);
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
    el('div', { class: 'crumb' }, el('a', { href: '#/requests', text: '依頼' }), ' › ', el('b', { text: r.request.name }), el('span', { class: 'tag', text: r.direction === 'inbound' ? '着信' : '本番' })),
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
      el('div', { class: 'who' }, t.source === 'callee' ? r.request.name : 'AI', typeof t.t === 'number' ? el('time', { text: mmss(t.t / 1000) }) : null), el('p', { text: t.text })))
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
async function practice() {
  return el('div', { class: 'page' }, el('div', { class: 'page-h' }, el('h1', { text: '練習' })),
    el('div', { class: 'card stack' },
      el('p', { class: 'about', text: '練習では、AIが練習用の相手（お店や窓口の役）と話します。電話はかからず、費用もかかりません。AIが「決まりました」と言っても、相手の言葉で確かめられるまで完了にならないことを試せます。' }),
      el('p', { class: 'about', text: '練習の画面（Arena）は、あなたのパソコンで開きます。' }),
      el('pre', { class: 'brief num', text: 'npx oathra demo' }),
      el('p', { class: 'note', text: 'このサーバーでの練習（レストラン予約・満席の罠など）は、次の段階でここから始められるようにします。' })));
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
    try { const saved = await api('/contacts', { method: 'POST', body: { name: f.get('name'), company: f.get('company'), phone: f.get('phone'), notes: f.get('notes') } }); app.boot = null; await loadAll(); location.hash = `#/contacts/${saved.id}`; toast('保存しました。'); }
    catch (err) { toast(err.message); }
  } }, el('h2', { text: '連絡先を追加' }),
    el('label', { class: 'lbl', text: '名前' }), el('input', { type: 'text', name: 'name' }),
    el('label', { class: 'lbl', text: '会社・お店（任意）' }), el('input', { type: 'text', name: 'company' }),
    el('label', { class: 'lbl', text: '電話番号（任意）' }), el('input', { type: 'tel', name: 'phone' }),
    el('label', { class: 'lbl', text: 'メモ（任意・AIには渡しません）' }), el('textarea', { name: 'notes' }),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit', text: '保存する' })));
  const calls = sel ? app.history.filter(r => r.request.phone === sel.phone) : [];
  const detail = sel ? el('div', { class: 'card' },
    el('div', { class: 'metric-k' }, el('div', { class: 'split' }, el('span', { class: 'avatar big', text: (sel.name || sel.company || '?').slice(0, 1) }), el('div', {}, el('h1', { class: 'headline', text: sel.name || sel.company }), el('span', { text: sel.name ? sel.company : '' }))),
      sel.phone ? el('a', { class: 'btn primary', href: `#/new?contact=${sel.id}`, text: 'この相手に電話を頼む' }) : null),
    el('dl', { class: 'defs left' }, el('dt', { text: '電話番号' }), el('dd', { class: 'num', text: displayPhone(sel.phone) || '—' }), el('dt', { text: 'メール' }), el('dd', { text: sel.email || '—' }), el('dt', { text: 'メモ' }), el('dd', { text: sel.notes || '—' })),
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
  const tabs = [['out', 'かける設定'], ['in', 'かけられた時の設定'], ['cost', '費用とクレジット'], ['voice', '声とAI'], ['view', '記録と表示']];
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
    body = [el('h2', { text: 'かけられた時の設定' }), el('p', { class: 'note', text: '発信元の番号に電話がかかってきたときの動きです。' }),
      row('いまの動き', 'サーバーの設定で決まっています', el('span', { text: st.reception ? `予約の受付（${st.reception}）` : '用件を聞いてメモに残すか、案内して切ります' })),
      el('p', { class: 'warnbox', text: 'この画面から変えられるようにするには、利用者ごとの設定を保存する仕組みが必要です（まだありません）。いまはサーバーの管理者が環境変数で設定します。' })];
  } else if (app.settingsTab === 'cost') {
    const ledger = b.credits?.enabled ? (await api('/credits/ledger')).entries : [];
    const labels = { grant: '追加', reserve: '確保', consume: '消費', release: '返却' };
    body = [el('h2', { text: '費用とクレジット' }),
      b.credits?.enabled ? row('クレジット残高', '', el('b', { class: 'num', text: `${b.credits.available}` }), el('span', { class: 'note', text: b.credits.held ? ` 確保中 ${b.credits.held}` : '' }))
        : row('費用', 'このサーバーはクレジット制ではありません', el('span', { text: `1回の上限 $${cfg.maxCallUsd}（見込みが上限を超える電話は発信しません）` })),
      ...(ledger.length ? [el('h2', { class: 'section-h', text: '履歴' }), el('div', { class: 'rows' }, ...ledger.slice(-30).reverse().map(e => el('div', { class: 'row' }, el('div', {}, el('div', { class: 'who', text: labels[e.kind] ?? e.kind })), el('div', { class: 'outcome num', text: `${e.amount}` }), el('time', { class: 'num', text: when(new Date(e.created).toISOString()) }))))] : []),
      el('p', { class: 'note', text: '月ごとの上限は、まだ設定できません（次の段階）。1回の電話の上限は、承認のときに確保する額で守られます。' })];
  } else if (app.settingsTab === 'voice') {
    body = [el('h2', { text: '声とAI' }), ...(st.engines ?? []).map(e => row(e.label, e.id === st.defaultEngine ? '標準' : '', el('span', { text: e.ready ? '使えます' : '使えません（キー未設定）' })))];
  } else {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    body = [el('h2', { text: '記録と表示' }),
      row('表示', '明るい／暗い', el('div', { class: 'chips' }, ...[['light', '明るい'], ['dark', '暗い']].map(([v, l]) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === v), text: l, onclick: () => { try { localStorage.setItem('oathra.theme', v); } catch { /* off */ } document.documentElement.dataset.theme = v; route(); } })))),
      row('会話の記録', '', el('span', { text: '文字起こしと結果を30日保存します。音声ファイルは保存しません。' })),
      row('ログアウト', '', el('button', { class: 'btn', type: 'button', text: 'ログアウト', onclick: async () => { await api('/session', { method: 'DELETE', body: {} }).catch(() => null); app.boot = null; location.hash = '#/'; renderLogin(); } }))];
  }
  return el('div', { class: 'page' }, el('div', { class: 'split-page' },
    el('div', { class: 'stack' }, el('div', { class: 'page-h' }, el('h1', { text: '設定' })), el('nav', { class: 'tabsv', 'aria-label': '設定の種類' }, ...tabs.map(([k, l]) => el('button', { type: 'button', 'aria-current': String(app.settingsTab === k), text: l, onclick: () => { location.hash = `#/settings/${k}`; } })))),
    el('div', { class: 'card' }, ...body)));
}

route();
setInterval(() => { if (app.boot) renderBar(); }, 1000);
