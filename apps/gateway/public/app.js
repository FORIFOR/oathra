'use strict';
// One page, read top to bottom: get ready → ask → see what happened → look back → settings.
// Everything is built with textContent; the page never inserts HTML from data.

const $ = id => document.getElementById(id);
let token = '', state = null, review = null, selected = null, followup = null, polling = false, showAll = false;

const STATUS = {
  DRAFT: '確認待ち', QUEUED: '発信の順番待ち', DIALING: '発信しています', ACTIVE: '通話中', VERIFYING: '結果を確かめています',
  COMPLETED: '決まりました', INCOMPLETE: 'まだ決まっていません', DECLINED: '断られました（今後は連絡しません）', FAILED: '電話できませんでした',
  CANCELLED: '取りやめました', CANCEL_REQUESTED: '終了しています', UNKNOWN: '回線の状態を確認してください',
  HANDOFF_PENDING: '担当者につないでいます', HANDOFF_ACTIVE: '担当者が話しています',
};
const FINISHED = ['COMPLETED', 'INCOMPLETE', 'DECLINED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
const PROGRESS = [['QUEUED', '順番待ち'], ['DIALING', '発信'], ['ACTIVE', '通話'], ['VERIFYING', '確認']];
// What the evidence fields mean, in the words of someone who has never seen the API.
const FACTS = {
  meeting_agreed_on_call: v => `商談の日時：${when(v)}`,
  material_send_allowed: () => '資料を送ってよい、と言われました',
  presentation_acknowledged: () => '説明を聞いてもらえました',
  do_not_contact: () => '今後は連絡しないでほしい、と言われました',
};
const MISSING = { meeting_agreed_on_call: '商談の日時', material_send_allowed: '資料を送ってよいか', presentation_acknowledged: '説明を聞いてもらえたか' };
const GOAL_TEXT = {
  meeting: name => `${name}に商品を説明して、興味があれば15分の商談の日時を相談してください。`,
  materials: name => `${name}に商品を簡単に説明して、資料を送ってよいか聞いてください。`,
  introduce: name => `${name}に商品を簡単に説明してください。`,
};
const ERRORS = {
  privacy_consent_required: '「はじめに」の「会話データの取り扱い」に同意してください。',
  select_one_reviewed_product: '紹介する商品を1つ登録して選んでください。',
  select_one_contact: '電話する相手を1人選んでください。',
  verify_your_phone_first: '設定の「自分の電話番号を確認する」を先に済ませてください。',
  live_provider_not_configured: '実電話の接続設定が足りません。管理者に確認してください。',
  approval_expired_or_used: '確認から5分たったか、すでに使われました。もう一度「内容を確認する」から進めてください。',
  recipient_suppressed: 'この相手には、もう電話しない設定になっています。',
  recipient_has_active_call: 'この相手への電話が進行中です。終わってからもう一度お試しください。',
  daily_limit_reached: '今日の上限に達しました。明日以降にお試しください。',
  estimated_cost_exceeds_budget: '見込みの費用が上限を超えています。「くわしい設定」で上限を見直してください。',
  phone_must_be_e164: '電話番号は「+81 90 1234 5678」のように国番号から入力してください。',
  phone_has_trunk_prefix_after_country_code: '国番号のあとの「0」は不要です。「+81 90…」のように入力してください。',
  followup_already_sent: 'この電話については、同じ種類のものをすでに送っています。',
  followup_outcome_unknown_reconcile_before_retry: '前回の送信結果がわかっていません。送り先のサービスで確認してからお試しください。',
  read_only_account: 'このアカウントは見るだけの権限です。',
  unauthorized: 'トークンが違うようです。もう一度貼り付けてください。',
  rate_limited: '操作が多すぎます。少し待ってからお試しください。',
  // Filling in forms
  invalid_text: '入力が空か、長すぎます。内容を確かめてください。',
  invalid_email: 'メールアドレスの形を確かめてください。',
  invalid_crm_contact_id: 'HubSpot Contact ID は数字だけで入力してください。',
  contact_relationship_required: '連絡する理由を選んでください。',
  product_facts_require_review: '「内容が正しいことを確認しました」にチェックを入れてください。',
  invalid_duration: '通話の上限（秒）が範囲の外です。「くわしい設定」で見直してください。',
  invalid_budget: '費用の上限が範囲の外です。「くわしい設定」で見直してください。',
  invalid_slots: '候補日時は8つまでです。',
  slot_requires_future_time_and_timezone: '候補日時は「2026-10-03T15:00:00+09:00」のように、これから先の日時を時差つきで入力してください。',
  invalid_goal: '電話の目的を選んでください。',
  review_current_privacy_notice: '会話データの取り扱いが更新されています。ページを読み込み直して、もう一度同意してください。',
  // Importing a product page
  unsafe_product_url: 'このURLは取り込めません。https:// で始まる公開ページを指定してください。',
  private_address_blocked: 'このURLは取り込めません。社内ネットワークなど、外から見えないページは対象外です。',
  product_page_unavailable: 'ページを開けませんでした。URLを確かめるか、内容を手で入力してください。',
  product_page_too_large: 'ページが大きすぎて取り込めません。内容を手で入力してください。',
  product_page_timeout: 'ページの応答が遅く、取り込めませんでした。内容を手で入力してください。',
  // Things that changed between confirming and calling
  mission_already_started: 'この電話はすでに始まっています。',
  mission_changed_review_again: '内容が変わったので、もう一度「内容を確認する」から進めてください。',
  product_changed_review_again: '商品の内容が変わったので、もう一度確認してください。',
  contact_changed_review_again: '相手の情報が変わったので、もう一度確認してください。',
  recipient_changed_review_again: '送り先が変わったので、もう一度確認してください。',
  plugin_changed_review_again: '接続先のサービスが更新されたので、もう一度確認してください。',
  call_plugin_changed_review_again: '電話の接続方法が更新されたので、もう一度確認してください。',
  configuration_changed: 'サーバーの設定が変わりました。もう一度「内容を確認する」から進めてください。',
  verified_phone_changed: '確認済みの自分の番号が変わりました。もう一度確認してください。',
  idempotency_conflict: '同じ操作が重なりました。ページを読み込み直してください。',
  explicit_call_approval_required: 'チェックを入れて、この1件の発信を承認してください。',
  // Own number and live calls
  phone_verification_not_configured: 'このサーバーでは、SMSで番号を確認する設定がまだ済んでいません。練習モードでは確認は不要です。',
  verification_sms_approval_required: 'チェックを入れて、確認用SMSの送信に同意してください。',
  invalid_verification_code: '確認コードは数字で入力してください。',
  verification_not_approved: '確認コードが違うようです。もう一度入力してください。',
  verification_expired: '確認コードの有効期限が切れました。もう一度SMSを送ってください。',
  verification_daily_limit: '今日はこれ以上SMSを送れません。明日お試しください。',
  verification_check_limit: 'コードの入力回数が上限に達しました。1時間ほど待ってからお試しください。',
  real_phone_verification_required: '実電話で自分にかけるには、SMSで確認した自分の番号が必要です。',
  simulator_contact_not_valid_for_live: 'この相手は練習用です。実電話では使えません。',
  // During and after a call
  handoff_not_available: 'いまは自分に代われません。通話中にだけ使えます。',
  call_not_ready_for_handoff: '相手がまだ続行を了承していないため、代われません。',
  insufficient_time_for_handoff: '通話の残り時間が少なく、代われません。',
  handoff_requires_real_verified_operator_number: '代わるには、SMSで確認した自分の番号が必要です（相手と同じ番号は使えません）。',
  handoff_outcome_unknown: '交代できたか確認できませんでした。「回線の状態を確認する」を押してください。',
  carrier_sid_unknown_check_provider_console: '回線の情報が残っていません。電話会社の管理画面で状態を確認してください。',
  stop_and_reconcile_call_before_deletion: 'この電話は状態がはっきりしていません。先に「回線の状態を確認する」を押してください。',
  // Follow-ups
  finished_real_call_required: 'メールや予定を送れるのは、実電話が終わったあとだけです（練習では送れません）。',
  integration_not_configured_for_this_account: 'このアカウントでは、その送り先のサービスが設定されていません。',
  followup_requires_business_contact: '自分へのテスト電話には送れません。',
  followup_attempt_limit: 'この電話について送れる回数の上限に達しました。',
  contact_permission_not_in_call_evidence: '相手が「送ってよい」と言った記録がないため、送れません。',
  future_meeting_agreement_required: '相手と決まった、これから先の商談日時がないため、予定を送れません。',
  calendar_time_must_match_evidence: '予定の日時は、電話で決まった日時と同じにしてください。',
  registered_crm_contact_id_required: 'この相手に HubSpot Contact ID が登録されていません。',
  contact_email_required: 'この相手にメールアドレスが登録されていません。',
  followup_expired_or_used: '確認から時間がたったか、すでに送りました。もう一度「送る内容を確認」から進めてください。',
  explicit_followup_approval_required: 'チェックを入れて、送る内容を承認してください。',
  google_authorization_failed: 'Googleへの接続に失敗しました。管理者に確認してください。',
  // Chat link, permissions, misc
  link_code_expired: '連携用メッセージの有効期限が切れました。もう一度作ってください。',
  channel_already_linked: 'このチャットは、別のアカウントとつながっています。',
  administrator_required: 'この操作は管理者だけができます。',
  not_found: '見つかりませんでした。ページを読み込み直してください。',
  request_too_large: '入力が大きすぎます。短くしてください。',
  cross_origin_request_denied: 'このページのアドレスが、サーバーの設定と違います。設定されたアドレスで開き直してください。',
};

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text); if (cls) n.className = cls; return n; };
const when = iso => new Date(iso).toLocaleString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const goal = () => document.querySelector('input[name="goal"]:checked').value;

function notice(message) {
  $('notice').textContent = message; $('notice').hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { $('notice').hidden = true; }, 9000);
}
async function api(path, method = 'GET', data, headers = {}) {
  const r = await fetch('/v1' + path, {
    method, redirect: 'error', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const value = await r.json();
  // A code the page has no words for still gets a sentence; the code stays for whoever is asked to help.
  if (!r.ok) throw Error(ERRORS[value.error] ?? `うまくいきませんでした。少し待ってもう一度お試しください。（問い合わせ用コード：${value.error ?? r.status}）`);
  return value;
}
/** Wire a form or button: disable while running, show failures as a message instead of throwing. */
function on(id, event, handler) {
  $(id).addEventListener(event, async e => {
    e.preventDefault();
    const b = e.submitter ?? (e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null);
    if (b) b.disabled = true;
    try { await handler(e); } catch (error) { notice(error.message); } finally { if (b) b.disabled = false; }
  });
}
function button(label, fn, cls = 'quiet') {
  const b = el('button', label, cls);
  b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (e) { notice(e.message); } finally { b.disabled = false; } });
  return b;
}
function options(id, values, placeholder) {
  const select = $(id), old = select.value;
  select.replaceChildren(...(values.length ? values : [{ id: '', name: placeholder }]).map(v => { const o = el('option', v.name); o.value = v.id; return o; }));
  if (values.some(v => v.id === old)) select.value = old;
}
/** Settings live in a panel over the page; opening one section closes the others so the panel stays short. */
function open(id) {
  for (const d of document.querySelectorAll('#settings > details')) d.open = d.id === id;
  if (!$('settings').open) $('settings').showModal();
  if (id) $(id).scrollIntoView({ block: 'nearest' });
}
const GOAL_HELP = {
  meeting: '相手が日時をはっきり了承したときだけ「決まった」になります。',
  materials: '了承があれば、あとでメールやSMSを送れます。',
  introduce: '説明を聞いてもらえたかを確認します。',
};

// ---------------------------------------------------------------------------------------------- setup

function renderSetup() {
  const consented = state.account.consentVersion === state.configuration.consentVersion;
  const steps = [
    { done: consented, text: '会話データの取り扱いを確認して同意する', label: '内容を読む', go: () => open('s-consent') },
    { done: state.products.length > 0, text: '紹介する商品を登録する', label: '登録する', go: () => open('s-product') },
    { done: state.contacts.length > 0, text: '電話する相手を登録する', label: '登録する', go: () => open('s-contact') },
  ].filter(s => !s.done);
  $('setup').hidden = steps.length === 0;
  $('setup-count').textContent = `あと${steps.length}つ`;
  $('setup-steps').replaceChildren(...steps.map(s => { const li = el('li'); li.append(el('span', s.text), button(s.label, s.go, 'small')); return li; }));
  $('consent-state').textContent = consented ? '同意済み' : '未同意';
  $('consent').hidden = consented;
  $('phone-state').textContent = state.account.verifiedPhone ? '確認済み' : '未確認';
  // Verifying a number sends a real SMS through the carrier. Where that is not set up, say so instead of offering a form that fails.
  const canVerify = state.available?.phoneVerification === true;
  $('phone-form').hidden = !canVerify; $('phone-unavailable').hidden = canVerify;
  $('phone-unavailable').textContent = state.configuration.mode === 'simulator'
    ? '練習モードでは番号の確認は必要ありません。練習用の番号が最初から入っているので、「まず自分の番号にかけて試す」もそのまま試せます（実際の電話はかかりません）。'
    : 'このサーバーでは、SMSで番号を確認する設定（Twilio Verify）がまだ済んでいません。管理者に確認してください。';
}

// ---------------------------------------------------------------------------------------------- page

async function refresh() {
  state = await api('/bootstrap');
  const c = state.configuration;
  $('mode').hidden = false;
  $('mode').textContent = c.mode === 'simulator' ? '練習モード（電話はかかりません）' : '実電話モード';
  $('mode').className = 'badge ' + (c.mode === 'simulator' ? 'practice' : 'live');
  $('readiness').textContent = c.mode === 'simulator'
    ? 'まだ電話はかかりません。練習モードなので、承認しても実際の電話はかからず、費用もかかりません。'
    : c.liveReady ? 'まだ電話はかかりません。次の画面で相手・目的・費用を確かめて、承認したときだけ発信します。' : '実電話の設定が終わっていません（未設定：' + c.missing.join('、') + '）';
  $('goal-help').textContent = GOAL_HELP[goal()];
  $('detail-empty').hidden = selected !== null;
  options('product', state.products, '（設定で商品を登録してください）');
  options('contact', state.contacts, '（設定で相手を登録してください）');
  options('suppress-contact', state.contacts, '（登録された相手がいません）');
  $('seconds').max = c.maxSeconds; $('budget').max = c.maxCallUsd;
  options('followup-kind', (state.plugins ?? []).filter(p => (state.integrations ?? []).includes(p.id)), '（使えるサービスがありません）');
  $('plugin-list').replaceChildren(...(state.plugins ?? []).map(p => el('p', `${p.name} — ${!p.enabled ? '無効' : p.configured ? '設定済み' : '設定待ち'}`)));
  renderSetup();
  renderHistory();
  if (!$('request').value.trim()) suggestRequest();
}
function suggestRequest() {
  const name = $('test-me').checked ? '自分' : $('contact').selectedOptions[0]?.textContent ?? '';
  if (!name || name.startsWith('（')) return;
  $('request').value = GOAL_TEXT[goal()](name); $('request').dataset.suggested = 'true';
}
// Keep the suggestion in step with the choices, but never overwrite what the person typed.
for (const n of document.querySelectorAll('input[name="goal"], #contact, #test-me')) n.addEventListener('change', () => { $('goal-help').textContent = GOAL_HELP[goal()]; if ($('request').dataset.suggested === 'true') suggestRequest(); });
$('request').addEventListener('input', () => { $('request').dataset.suggested = 'false'; });
$('test-me').addEventListener('change', () => { $('contact').disabled = $('test-me').checked; });

function renderHistory() {
  const all = state.missions, shown = showAll ? all : all.slice(0, 4), dest = $('history');
  dest.replaceChildren();
  if (!all.length) dest.append(el('p', 'まだありません。上のフォームから最初の電話を任せてみましょう。', 'muted'));
  for (const m of shown) {
    const b = el('button', undefined, 'item' + (m.id === selected ? ' selected' : ''));
    b.append(el('strong', m.target.name), el('span', STATUS[m.status] ?? m.status, 'state ' + tone(m.status)), el('small', `${m.product.name} ・ ${new Date(m.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${m.mode === 'simulator' ? ' ・ 練習' : ''}`));
    b.addEventListener('click', () => openMission(m.id).catch(e => notice(e.message)));
    dest.append(b);
  }
  $('more').hidden = showAll || all.length <= 4;
}
const tone = s => s === 'COMPLETED' ? 'good' : ['DECLINED', 'FAILED', 'UNKNOWN'].includes(s) ? 'bad' : FINISHED.includes(s) ? 'open' : 'busy';

// ---------------------------------------------------------------------------------------------- one call

async function openMission(id, scroll = true) {
  selected = id;
  renderDetail(await api('/missions/' + id));
  renderHistory();
  if (scroll && window.matchMedia('(max-width: 999px)').matches) $('current').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let lastDetail = '';
function renderDetail(m) {
  // The page polls; redraw only when something changed, so an open transcript stays open and nothing jumps.
  const snapshot = JSON.stringify([m, state.followups?.filter(f => f.missionId === m.id), state.integrations]);
  if (snapshot === lastDetail && $('detail').childElementCount) return; lastDetail = snapshot;
  const d = $('detail'); $('detail-empty').hidden = true; d.replaceChildren();
  d.append(el('p', `${m.target.name} への電話${m.mode === 'simulator' ? '（練習）' : ''}`, 'eyebrow'), el('h2', STATUS[m.status] ?? m.status, 'state-title ' + tone(m.status)));

  if (!FINISHED.includes(m.status) && m.status !== 'DRAFT') {
    const bar = el('ol', undefined, 'progress'), at = PROGRESS.findIndex(([s]) => s === m.status);
    PROGRESS.forEach(([, label], i) => bar.append(el('li', label, i < at ? 'done' : i === at ? 'now' : '')));
    d.append(bar);
  }
  d.append(el('p', m.request, 'request'));
  if (m.error) d.append(el('p', ERRORS[m.error] ?? `理由：${m.error}`, 'notice'));

  if (m.result) {
    const verified = Object.entries(m.result.verified ?? {}), stop = m.result.doNotContact;
    d.append(el('h3', '確認できたこと'));
    if (!verified.length && !stop) d.append(el('p', '相手の言葉で確認できたことは、まだありません。', 'muted'));
    const list = el('ul', undefined, 'facts');
    if (stop) list.append(el('li', FACTS.do_not_contact(), 'bad'));
    for (const [key, value] of verified) list.append(el('li', (FACTS[key] ?? (v => `${key}：${v}`))(value), 'good'));
    d.append(list);
    const missing = (m.result.missing ?? []).filter(() => !stop);
    if (missing.length) { d.append(el('h3', 'まだ決まっていないこと')); const ul = el('ul', undefined, 'facts'); for (const k of missing) ul.append(el('li', MISSING[k] ?? k, 'open')); d.append(ul); }
    const quotes = (m.result.evidence ?? []).filter(e => e.quote);
    if (quotes.length) {
      d.append(el('h3', '根拠になった相手の言葉'));
      for (const e of quotes) d.append(el('blockquote', `「${e.quote}」${e.confirmedProposal ? `（こちらの提案：「${e.confirmedProposal}」）` : ''}`));
    }
    if (m.result.caveat) d.append(el('p', m.result.caveat, 'hint'));
  }

  if (m.transcript?.length) {
    const details = el('details'); details.append(el('summary', '会話の文字起こしを見る'));
    for (const t of m.transcript) { const row = el('div', undefined, 'turn'); row.append(el('small', t.source === 'callee' ? '相手' : 'AI'), el('span', t.text)); details.append(row); }
    d.append(details);
  }

  for (const f of state.followups?.filter(f => f.missionId === m.id) ?? []) {
    const sent = { SUBMITTED: '送りました（相手が受け取ったか・承諾したかは別です）', UNKNOWN: '送れたかどうか不明です。送り先のサービスで確認してください', REJECTED: '送れませんでした', EXECUTING: '送っています', PREVIEW: '確認待ち' }[f.status] ?? f.status;
    d.append(el('p', `${f.kind}：${sent}${f.attendeeResponse ? ` ・ 招待への返事：${f.attendeeResponse}` : ''}`, 'followup'));
    if (f.kind === 'calendar' && f.providerId) d.append(button('招待への返事を確認', async () => { await api('/followups/' + f.id + '/refresh', 'POST', {}); await refresh(); await openMission(m.id, false); }));
    if (f.status === 'UNKNOWN' && !f.reconciledNotDelivered) d.append(button('確認したら送られていなかった', async () => { if (confirm('送り先のサービスで、送られていないことを確認しましたか？')) { await api('/followups/' + f.id + '/not-delivered', 'POST', { acknowledged: true }); await refresh(); await openMission(m.id, false); } }));
  }

  const actions = el('div', undefined, 'actions');
  if (m.status === 'DRAFT') actions.append(button('内容を確認して電話する', () => showReview(m.id), 'primary'));
  if (!FINISHED.includes(m.status) && m.status !== 'DRAFT') actions.append(button('この電話をやめる', async () => { await api('/missions/' + m.id + '/cancel', 'POST', {}); await openMission(m.id, false); }, 'danger'));
  if (m.mode === 'live' && m.status === 'ACTIVE') actions.append(button('自分に代わる', async () => { if (confirm('確認済みの自分の番号につなぎます。回線がもう1本ぶんの料金がかかります。続けますか？')) { await api('/missions/' + m.id + '/handoff', 'POST', { acknowledged: true }); await openMission(m.id, false); } }));
  if (m.mode === 'live' && m.carrierSid && ['UNKNOWN', 'HANDOFF_PENDING', 'HANDOFF_ACTIVE'].includes(m.status)) actions.append(button('回線の状態を確認する', async () => { await api('/missions/' + m.id + '/reconcile', 'POST', { acknowledged: true }); await openMission(m.id, false); }));
  if (['COMPLETED', 'INCOMPLETE'].includes(m.status) && state.integrations?.length) actions.append(button('メール・予定などを送る', () => { followup = null; $('followup-preview').textContent = ''; $('followup-send').disabled = true; $('followup-ack').checked = false; $('followup').showModal(); }));
  if (FINISHED.includes(m.status)) actions.append(button('同じ相手にもう一度', () => { $('contact').value = m.target.id; $('request').value = m.request; $('request').dataset.suggested = 'false'; $('request').focus(); }));
  if (['DRAFT', 'COMPLETED', 'INCOMPLETE', 'DECLINED', 'FAILED', 'CANCELLED'].includes(m.status)) actions.append(button('この記録を消す', async () => {
    if (!confirm('この電話の記録を消します。メールなど、すでに外部に送ったものは消えません。')) return;
    await api('/missions/' + m.id, 'DELETE'); selected = null; lastDetail = ''; $('detail').replaceChildren(); await refresh();
  }));
  d.append(actions);
}

async function showReview(id) {
  review = await api('/missions/' + id + '/review', 'POST', {}); review.key = crypto.randomUUID();
  const m = review.mission, list = el('dl', undefined, 'review-list');
  const rows = {
    '電話のかけ方': m.mode === 'simulator' ? '練習（実際の電話はかかりません）' : '実際に電話をかけます',
    '相手': `${m.target.name}　${m.target.phone}`,
    'こちらの番号': m.callerId,
    '伝えること': m.request,
    'AIが説明してよいこと': m.product.facts,
    'AIが約束しないこと': m.product.forbidden,
    '上限': `${m.maxSeconds}秒 ・ $${m.maxUsd}（見込みの最大 $${m.estimatedMaximumUsd.toFixed(2)}）`,
  };
  for (const [name, value] of Object.entries(rows)) list.append(el('dt', name), el('dd', value));
  $('review-content').replaceChildren(list, el('p', '電話の最初に、記録していることとAIであることを相手に伝えます。', 'hint'));
  $('call-ack').checked = false; $('review').showModal();
}

// ---------------------------------------------------------------------------------------------- wiring

on('login-form', 'submit', async () => {
  token = $('token').value.trim(); await refresh(); $('token').value = '';
  $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('open-settings').hidden = false; document.body.classList.add('signed-in');
  const running = state.missions.find(m => !FINISHED.includes(m.status) && m.status !== 'DRAFT');
  if (running) await openMission(running.id, false);
});
on('logout', 'click', () => { token = ''; state = null; selected = null; lastDetail = ''; $('detail').replaceChildren(); $('workspace').hidden = true; $('logout').hidden = true; $('open-settings').hidden = true; $('mode').hidden = true; $('login').hidden = false; document.body.classList.remove('signed-in'); });
on('open-settings', 'click', () => open(''));
on('refresh', 'click', refresh);
on('more', 'click', () => { showAll = true; renderHistory(); });
on('consent', 'click', async () => { await api('/consent', 'POST', { version: state.configuration.consentVersion }); await refresh(); $('settings').close(); notice('同意を保存しました。'); });
on('product-form', 'submit', async e => {
  await api('/products', 'POST', { name: $('product-name').value, facts: $('facts').value, source: $('product-url').value, reviewed: $('facts-reviewed').checked });
  e.target.reset(); await refresh(); $('settings').close(); notice('商品を保存しました。');
});
on('import-form', 'submit', async () => { const r = await api('/products/import', 'POST', { url: $('product-url').value }); $('facts').value = r.content; $('facts-reviewed').checked = false; notice('取り込みました。内容を確かめて、必要なら直してください。まだ電話には使われません。'); });
on('contact-form', 'submit', async e => {
  const saved = await api('/contacts', 'POST', { name: $('contact-name').value, phone: $('contact-phone').value, email: $('contact-email').value, relationship: $('relationship').value, basis: $('contact-basis').value, crmId: $('crm-id').value });
  e.target.reset(); await refresh(); $('contact').value = saved.id; $('settings').close(); suggestRequest(); notice(`${saved.name} を登録しました。`);
});
on('phone-form', 'submit', async () => { const r = await api('/phone/verify', 'POST', { phone: $('my-phone').value, code: $('phone-code').value, acknowledged: $('verify-ack').checked }); await refresh(); notice(r.verified ? '電話番号を確認しました。' : '確認用のSMSを送りました。届いたコードを入力して、もう一度押してください。'); });
on('link', 'click', async () => { const r = await api('/links', 'POST', {}); $('link-code').textContent = r.message; });
on('suppress', 'click', async () => { if (!confirm('この相手には、だれからも二度と電話しなくなります。よろしいですか？')) return; await api('/suppressions', 'POST', { contactId: $('suppress-contact').value, acknowledged: true }); notice('この相手への電話を停止しました。'); });
on('mission-form', 'submit', async () => {
  const m = await api('/missions/draft', 'POST', {
    request: $('request').value, productId: $('product').value, goal: goal(), testOnMe: $('test-me').checked,
    ...($('test-me').checked ? {} : { contactId: $('contact').value }),
    maxSeconds: Number($('seconds').value), maxUsd: Number($('budget').value), candidateSlots: $('slots').value.split('\n').map(s => s.trim()).filter(Boolean),
  });
  await refresh(); await openMission(m.id, false); await showReview(m.id);
});
on('start-call', 'click', async () => {
  if (!$('call-ack').checked) throw Error('チェックを入れて、この1件の発信を承認してください。');
  const m = await api('/missions/' + review.mission.id + '/start', 'POST', { approvalToken: review.approvalToken, acknowledged: true }, { 'Idempotency-Key': review.key });
  $('review').close(); $('request').value = ''; await refresh(); await openMission(m.id);
});
on('followup-form', 'submit', async () => {
  const extra = JSON.parse($('followup-extra').value.trim() || '{}');
  if (!extra || Array.isArray(extra) || typeof extra !== 'object' || Object.keys(extra).some(k => ['__proto__', 'constructor', 'prototype', 'recipient', 'missionId', 'kind'].includes(k))) throw Error('追加項目のJSONを確認してください。');
  followup = await api('/followups/preview', 'POST', { ...extra, missionId: selected, kind: $('followup-kind').value, subject: $('followup-title').value, title: $('followup-title').value, body: $('followup-body').value, minutes: Number($('followup-minutes').value), contactPermissionBasis: $('followup-basis').value });
  followup.key = crypto.randomUUID(); $('followup-preview').textContent = JSON.stringify(followup.details, null, 2); $('followup-send').disabled = false; $('followup-ack').checked = false;
});
on('followup-send', 'click', async () => {
  if (!$('followup-ack').checked) throw Error('チェックを入れて、送る内容を承認してください。');
  const result = await api('/followups/' + followup.id + '/execute', 'POST', { approvalToken: followup.approvalToken, acknowledged: true }, { 'Idempotency-Key': followup.key });
  $('followup').close(); notice(result.status === 'SUBMITTED' ? '送りました。相手が受け取ったか・承諾したかは別です。' : '送れたかどうか確認できませんでした。送り先のサービスで確認してください。');
  await refresh(); await openMission(selected, false);
});

// While a call is running the page follows it; nothing to click.
setInterval(async () => {
  if (!token || document.hidden || polling) return; polling = true;
  try { await refresh(); if (selected) renderDetail(await api('/missions/' + selected)); } catch { /* the next tick tries again */ } finally { polling = false; }
}, 3000);
