'use strict';
// Rendering and explicit human actions only. The server owns every saved state.
const $ = selector => document.querySelector(selector);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
};
const STATUS = { unhandled: '未対応', callback_pending: '折り返し待ち', done: '対応記録済み' };
const ACTION = { created: '合成例を取り込み', assign: '担当と期限を保存', confirm: '内容を人が確認', queue: '折り返し待ちへ', done: '対応結果を人が記録', reopen: '未対応に戻して再確認' };
const ERRORS = {
  unauthorized: 'ログインの有効期限が切れています。Oathraでログインしてから戻ってください。',
  session_account_changed: 'ログイン中のアカウントが変わりました。画面を再読み込みしてください。',
  intake_pilot_simulator_only: 'この練習は simulator モードだけで利用できます。本番の着信には接続していません。',
  read_only_account: 'このアカウントは閲覧専用です。',
  intake_changed_reload: 'ほかの画面で内容が変わりました。「保存内容を更新」で最新の状態を確認してください。',
  intake_missing_customer_evidence: 'お客さまの回答が足りません。確認済みにはできません。',
  intake_future_due_required: '期限は現在より後、30日以内で指定してください。',
  intake_assignment_required: '担当と期限を先に保存してください。',
  intake_assignee_required: 'デモ担当を選んでください。',
  intake_review_required: '内容の確認を先に記録してください。',
  intake_resolution_required: '練習の対応結果を選んでください。',
  intake_callback_required: '折り返し待ちにした相談だけ、対応結果を記録できます。',
  intake_invalid_transition: '今の状態ではこの操作はできません。保存内容を更新してください。',
  not_found: 'この相談は見つかりません。保存内容を更新してください。',
};
let data = null, account = null, writable = false, busy = false, uncertain = false, navigationEpoch = 0;
const date = value => new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const localDate = value => { const d = new Date(value - new Date(value).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function feedback(message, error = false) { $('#feedback').textContent = message; $('#feedback').classList.toggle('error', error); }
function clearPrivateView() { data = null; account = null; $('#workspace').hidden = true; $('#case-list').replaceChildren(); $('#case-detail').replaceChildren(); $('#unavailable').hidden = false; }
async function api(path, body) {
  let response;
  try {
    response = await fetch(`/v1${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(account ? { 'x-oathra-account': account } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    if (body) uncertain = true;
    throw new Error(body ? '保存できたか確認できません。「保存内容を更新」で確認してから続けてください。' : '保存内容を読み込めません。接続を確かめて、もう一度更新してください。');
  }
  let result;
  try { result = await response.json(); } catch { if (body) uncertain = true; throw new Error('応答を読み取れません。保存内容を更新して確認してください。'); }
  if (!response.ok) {
    if (response.status === 401 || result.error === 'session_account_changed') clearPrivateView();
    if (body && response.status >= 500) uncertain = true;
    throw new Error(ERRORS[result.error] ?? (body ? '保存できませんでした。入力を残しています。保存内容を更新してからお試しください。' : '読み込めませんでした。保存内容を更新してお試しください。'));
  }
  return result;
}
function lock() {
  for (const control of document.querySelectorAll('#workspace button, #workspace input, #workspace select')) {
    const navigation = control.id === 'filter' || control.classList.contains('case-button');
    control.disabled = busy || ((!writable || uncertain) && !navigation) || control.dataset.blocked === 'true';
  }
  $('#refresh').disabled = busy;
  $('#workspace').setAttribute('aria-busy', String(busy));
}
async function load() {
  if (busy) return;
  busy = true; lock(); feedback('保存内容を読み込んでいます…');
  try {
    const boot = await api('/bootstrap');
    account = boot.user.id; writable = ['admin', 'operator'].includes(boot.user.role);
    data = await api('/intake-pilot'); uncertain = false;
    $('#workspace').hidden = false; $('#unavailable').hidden = true;
    $('#fixture').replaceChildren(...data.fixtures.map(f => el('option', { value: f.id, text: f.title })));
    render(); feedback(writable ? '保存済みの状態です。合成例を選び、人の確認から練習できます。' : '閲覧専用です。保存された練習記録を確認できます。');
  } catch (error) { feedback(error.message, true); }
  finally { busy = false; lock(); }
}
async function mutate(path, body, message) {
  if (busy || uncertain || !writable) return;
  const submittedView = { epoch: navigationEpoch, hash: location.hash, filter: $('#filter').value };
  busy = true; lock(); feedback('保存しています…');
  try {
    const updated = await api(path, body);
    const sameView = submittedView.epoch === navigationEpoch && submittedView.hash === location.hash && submittedView.filter === $('#filter').value;
    data.cases = data.cases.some(c => c.id === updated.id)
      ? data.cases.map(c => c.id === updated.id ? updated : c)
      : sameView ? [updated, ...data.cases] : [...data.cases, updated];
    // Back/Forward can still happen while controls are disabled. A delayed save
    // must update its row without replacing a newer selection or filter.
    if (sameView) {
      $('#filter').value = 'all'; history.replaceState(null, '', `#${updated.id}`);
    }
    render(); feedback(sameView ? message : `${updated.title ?? '保存した相談'}: ${message}`);
  } catch (error) { feedback(error.message, true); }
  finally { busy = false; lock(); }
}
function change(c, action, extra = {}) {
  return mutate(`/intake-pilot/${c.id}`, { revision: c.revision, action, acknowledged: true, ...extra }, `${ACTION[action]}を保存しました。実際の電話は行っていません。`);
}
function button(id, text, handler, blocked = false, primary = false) {
  return el('button', { id, type: 'button', class: `btn${primary ? ' primary' : ''}`, text, 'data-blocked': String(blocked), disabled: blocked, onclick: handler });
}
function render() {
  if (!data) return;
  const filter = $('#filter').value, cases = data.cases.filter(c => filter === 'all' || c.status === filter);
  const selected = cases.find(c => c.id === location.hash.slice(1)) ?? cases[0];
  $('#case-count').textContent = `${data.cases.length}件（合成例）`;
  $('#case-list').replaceChildren(...(cases.length ? cases.map(c => {
    const overdue = c.status !== 'done' && c.dueAt && c.dueAt <= Date.now();
    return el('button', { type: 'button', class: 'case-button', 'aria-pressed': String(c.id === selected?.id), 'data-case': c.fixtureId, onclick: () => { location.hash = c.id; } },
      el('b', { text: c.title }), el('span', { text: `${STATUS[c.status]} · ${c.reviewState === 'confirmed' ? '内容確認済み' : '要確認'}` }),
      el('span', { text: c.assignee ? data.assignees[c.assignee] : '担当未設定' }),
      el('span', { class: overdue ? 'overdue' : '', text: c.dueAt ? `${overdue ? '期限超過 · ' : '期限 '}${date(c.dueAt)}` : '期限未設定' }));
  }) : [el('p', { class: 'note', text: data.cases.length ? 'この状態の相談はありません。' : 'まだ相談はありません。下の合成例を取り込むと、確認から練習できます。' })]));
  const detail = $('#case-detail');
  if (!selected) { detail.replaceChildren(el('div', { class: 'empty' }, el('h2', { text: '相談を選んで、次の一手を残す' }), el('p', { text: '回答の根拠 → 担当と期限 → 折り返し結果。' }), el('p', { text: '電話が終わっただけでは、対応済みになりません。' }))); lock(); return; }
  const c = selected, complete = Object.values(c.fields).every(f => f.value !== null);
  const fields = el('dl', { class: 'field-list' }, ...Object.entries(data.fields).map(([key, label]) => {
    const f = c.fields[key], index = c.transcript.findIndex(t => t.id === f.turnId);
    return el('div', {}, el('dt', { text: label }), el('dd', { class: f.value === null ? 'missing' : '', text: f.value ?? '聞き直しが必要' }),
      ...(f.value !== null ? [el('dd', {}, el('span', { class: 'evidence-ref', text: `合成会話 ${index + 1} の回答${c.reviewState === 'confirmed' ? '（人が確認を記録）' : '（人の確認が必要）'}` }))] : []));
  }));
  const confirm = button('confirm', '4項目を人が確認したと記録', () => change(c, 'confirm'), !complete || c.reviewState === 'confirmed' || c.status !== 'unhandled', true);
  const assignee = el('select', { id: 'assignee', required: true, 'data-blocked': String(c.status === 'done') }, el('option', { value: '', text: '担当を選ぶ' }), ...Object.entries(data.assignees).map(([key, label]) => el('option', { value: key, text: label })));
  assignee.value = c.assignee ?? '';
  const due = el('input', { id: 'due', type: 'datetime-local', required: true, value: c.dueAt ? localDate(c.dueAt) : '', 'aria-describedby': 'due-note', 'data-blocked': String(c.status === 'done') });
  const assignForm = el('form', { class: 'assignment', onsubmit: event => { event.preventDefault(); void change(c, 'assign', { assignee: assignee.value, dueAt: new Date(due.value).getTime() }); } },
    el('label', {}, '折り返し担当', assignee), el('label', {}, '対応期限（この端末の時刻）', due),
    el('button', { id: 'assign', type: 'submit', class: 'btn', text: '担当と期限を保存', 'data-blocked': String(c.status === 'done') }));
  const queue = button('queue', '折り返し待ちにする', () => change(c, 'queue'), c.reviewState !== 'confirmed' || !c.assignee || !c.dueAt || c.status !== 'unhandled', true);
  const outcome = el('select', { id: 'outcome', required: true }, el('option', { value: '', text: '対応結果を選ぶ' }), ...Object.entries(data.outcomes).map(([key, label]) => el('option', { value: key, text: label })));
  const resultForm = el('form', { class: 'resolution', hidden: c.status !== 'callback_pending', onsubmit: event => { event.preventDefault(); void change(c, 'done', { outcome: outcome.value }); } },
    el('label', {}, '折り返せた後の結果（練習）', outcome), el('button', { id: 'done', type: 'submit', class: 'btn primary', text: 'この結果で対応済みを記録' }));
  const sourceLabels = { customer: 'お客さま役', assistant: '受付AI役 · 回答の根拠にしない', unknown: '話者不明 · 回答の根拠にしない' };
  detail.replaceChildren(
    el('div', { class: 'detail-head' }, el('div', {}, el('span', { class: 'muted small', text: '合成例 · 実際の問い合わせではありません' }), el('h2', { text: c.title })), el('span', { class: `state${c.reviewState === 'needs_review' ? ' needs-review' : ''}`, text: `${STATUS[c.status]} / ${c.reviewState === 'confirmed' ? '内容確認済み' : '要確認'}` })),
    el('div', { class: 'detail-columns' },
      el('section', {}, el('h3', { text: '1. 回答と根拠を確かめる' }), fields, el('p', { class: 'note', text: '候補は例として用意したものです。AI抽出の精度を実証する画面ではありません。' }),
        el('div', { class: 'actions' }, confirm), el('p', { class: 'note', text: c.reviewState === 'confirmed' ? `人の確認を記録 · ${date(c.reviewedAt)}。見積・訪問日時は未確定です。` : complete ? '会話を読んだ担当者が、明示的に確認を記録します。' : '欠けた回答を推測して補いません。この例は要確認のまま保留します。' })),
      el('section', {}, el('h3', { text: '根拠になる合成会話' }), el('ol', { class: 'pilot-turns' }, ...c.transcript.map((t, i) => el('li', { class: t.source }, el('b', { text: `${i + 1}. ${sourceLabels[t.source] ?? '話者不明'}` }), el('p', { text: t.text }))))),
    ),
    el('section', { class: 'work-section' }, el('h3', { text: '2. 次に動く人と期限を決める' }), assignForm,
      el('p', { id: 'due-note', class: c.status !== 'done' && c.dueAt && c.dueAt <= Date.now() ? 'note overdue' : 'note', text: c.dueAt ? `保存済み: ${data.assignees[c.assignee]} / ${date(c.dueAt)}${c.status !== 'done' && c.dueAt <= Date.now() ? '（期限を過ぎています）' : ''}` : '期限は30日以内。設定しても通知や電話は送られません。' }),
      el('div', { class: 'actions' }, queue)),
    el('section', { class: 'work-section' }, el('h3', { text: '3. 折り返した結果を残す' }), el('p', { class: 'note', text: 'つながらなかった場合は折り返し待ちのまま、次の期限を保存します。対応結果は人の練習報告で、外部で検証された事実ではありません。' }), resultForm,
      ...(c.resolution ? [el('p', { id: 'resolution-summary', text: data.outcomes[c.resolution.outcome] }), el('p', { class: 'note', text: `人の練習報告 · ${date(c.resolution.at)} · 実電話の証明なし` })] : []),
      ...(c.status !== 'unhandled' ? [el('div', { class: 'actions' }, button('reopen', '未対応に戻して再確認する', () => change(c, 'reopen')))] : [])),
    el('details', {}, el('summary', { text: `保存した操作の履歴（${c.history.length}件）` }), el('ol', { class: 'history' }, ...c.history.map(h => el('li', { text: `${date(h.at)} · ${ACTION[h.action]}${h.assignee ? ` / ${data.assignees[h.assignee]} / ${date(h.dueAt)}` : ''}${h.outcome ? ` / ${data.outcomes[h.outcome]}` : ''}` })))));
  lock();
}
$('#refresh').addEventListener('click', load);
$('#filter').addEventListener('change', () => { navigationEpoch++; render(); });
$('#add').addEventListener('click', () => mutate('/intake-pilot', { fixtureId: $('#fixture').value, synthetic: true }, '合成例を保存しました。回答の根拠を確認してください。'));
window.addEventListener('hashchange', () => { navigationEpoch++; render(); $('#case-detail').focus({ preventScroll: true }); });
window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
void load();
