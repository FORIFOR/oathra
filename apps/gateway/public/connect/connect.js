import { createPublicAccess } from '/phone/public-service.js';
import { errorText } from '/phone/messages.js';

const $ = selector => document.querySelector(selector);
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const notice = (selector, text = '') => { $(selector).textContent = text; $(selector).hidden = !text; };
const messages = {
  mcp_disabled: 'このサーバーではAIツールとの接続を受け付けていません。',
  remote_mcp_disabled: 'このサーバーではAIツールとの接続を受け付けていません。',
  mcp_not_configured: 'AIツールとの接続は現在準備中です。',
  mcp_oauth_disabled: 'このサーバーではAIツールとの接続を受け付けていません。',
  mcp_requires_fixed_public_origin: '接続に必要なサーバーURLを準備しています。運営へお問い合わせください。',
  invalid_request: '接続の確認情報が正しくありません。接続するツールから認証をやり直してください。',
  invalid_client: '接続するツールを確認できません。ツール側で設定を確認してください。',
  invalid_scope: 'この接続では許可できない操作が含まれています。ツール側で設定を確認してください。',
  invalid_grant: '接続確認が期限切れか使用済みです。接続するツールから認証をやり直してください。',
  invalid_redirect_uri: '接続元の戻り先URLを確認できません。接続するツールの設定を確認してください。',
  access_denied: 'このアカウントではアクセスを許可できません。ログインと接続先を確認してください。',
  connection_capacity_reached: '許可できる接続数の上限に達しました。使っていない接続を解除してください。',
  consent_capacity_reached: '接続の確認が多いため、時間をおいて接続元からやり直してください。',
  oauth_request_expired: '接続確認の有効期限が切れました。接続するツールから認証をやり直してください。',
  authorization_expired: '接続確認の有効期限が切れました。接続するツールから認証をやり直してください。',
  csrf_mismatch: '確認情報が更新されました。接続するツールから認証をやり直してください。',
  session_account_changed: 'ログインしているアカウントが変わりました。もう一度ログインして内容を確認してください。',
  unauthorized: 'ログインの有効期限が切れました。もう一度ログインしてください。',
  contact_registration_required: 'この番号の連絡先登録が必要です。連絡する根拠を確認し、Oathraで登録してください。',
  privacy_consent_required: 'サービスの利用条件への同意が必要です。アプリの設定で確認してください。',
};
const scopeFallback = {
  'oathra:read': '登録した商品・連絡先・依頼と結果を確認する',
  'oathra:draft': '登録済みの情報を使って営業電話の下書きを作成する',
};
const missionStates = { DRAFT: '下書き・未発信', QUEUED: '発信を受け付けました', DIALING: '発信準備中', ACTIVE: '通話中', VERIFYING: '結果を確認中', HANDOFF_PENDING: '人への引き継ぎを準備中', HANDOFF_ACTIVE: '人への引き継ぎ中', COMPLETED: '処理が終了しました', FAILED: '処理に失敗しました', INCOMPLETE: '未完了', DECLINED: '相手が辞退しました', CANCELLED: '取り消しました', CANCEL_REQUESTED: '停止を受け付けました', UNKNOWN: '通話結果を確認できていません' };
const params = new URLSearchParams(location.search);
// Keep the appearance chosen in the app when following a connection or review link.
try {
  const theme = params.get('theme') ?? localStorage.getItem('oathra.theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
} catch { /* The light appearance also works with browser storage disabled. */ }
const authorizing = location.pathname === '/oauth/authorize' || params.has('client_id') || params.has('response_type');
const missionId = params.get('mission');
document.body.dataset.connectMode = authorizing ? 'authorize' : missionId ? 'mission' : 'setup';
if (authorizing || missionId) {
  $('#connect-title').textContent = authorizing ? 'つなぐ前に、許可を確認。' : '発信する前に、内容を確認。';
  $('#connect-intro').textContent = authorizing ? '接続するツールと、共有する情報を確かめてください。' : '相手・用件・費用を確かめて、この1件を発信するか決めてください。';
  $('#connect-path').hidden = true;
  $('#setup-panel').hidden = true;
  $('.connect-preparation').hidden = true;
}
let generation = 0, account = null, metadata = null, publicService = null, authorization = null, authorizationBusy = false;
let connections = [], revokeTarget = null, connectionsBusy = false, mission = null, callReview = null, phoneStatus = null, missionBusy = false, startUncertain = false, expiryTimer;

function clearSensitiveState() {
  generation++; account = null; authorization = null; authorizationBusy = false; callReview = null; mission = null; connections = []; revokeTarget = null; phoneStatus = null;
  connectionsBusy = false; missionBusy = false;
  clearTimeout(expiryTimer);
  $('#authorize-content').hidden = true; $('#mission-content').hidden = true; $('#connections-panel').hidden = true;
  $('#connections-list').replaceChildren(); $('#mission-facts').replaceChildren(); $('#authorize-facts').replaceChildren(); $('#authorize-scopes').replaceChildren();
  $('#mission-consent').checked = false; $('#mission-policy-consent').checked = false; $('#account-label').textContent = '';
  notice('#mission-summary'); notice('#mission-result'); notice('#mission-disclosure');
  notice('#authorize-loading', 'Oathraにログインすると、接続先と許可内容を確認できます。');
  notice('#mission-loading', 'Oathraにログインして下書きを確認してください。');
  $('#account-bar').hidden = true; $('#login-panel').hidden = false;
  $('#connections-refresh').disabled = false; $('#revoke-confirm').disabled = false; $('#revoke-cancel').disabled = false;
  if ($('#revoke-dialog').open) $('#revoke-dialog').close();
}
async function api(path, options = {}) {
  const captured = generation, method = options.method ?? 'GET', isPublic = path.startsWith('/public/'), owner = isPublic ? null : account?.user?.id;
  let response;
  try {
    response = await fetch('/v1' + path, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', ...(owner ? { 'x-oathra-account': owner } : {}), ...options.headers },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await response.json();
    if (!isPublic && captured !== generation) throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true });
    if (!response.ok) {
      const code = data.error ?? 'request_failed';
      if (owner && (response.status === 401 || code === 'session_account_changed')) clearSensitiveState();
      throw Object.assign(new Error(messages[code] ?? errorText[code] ?? '処理できませんでした。状況を更新して確認してください。'), { code, status: response.status, uncertain: method !== 'GET' && response.status >= 500 });
    }
    return data;
  } catch (error) {
    if (error.stale || error.status) throw error;
    if (!isPublic && captured !== generation) throw Object.assign(error, { stale: true });
    throw Object.assign(new Error('接続を確認できませんでした。通信状態を確認して、状況を更新してください。'), { uncertain: method !== 'GET' });
  }
}
const access = createPublicAccess({ api, idPrefix: 'connect', beforeSignIn: clearSensitiveState, onSignedIn: enter });
$('#access').replaceChildren(access.node);
$('#authorize-panel').hidden = !authorizing;
$('#mission-panel').hidden = !missionId || authorizing;

const clientTabs = [...document.querySelectorAll('.connect-tabs [role="tab"]')];
function selectClient(tab, focus = false) {
  for (const item of clientTabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    $('#' + item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of clientTabs) {
  tab.addEventListener('click', () => selectClient(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? clientTabs.length - 1 : (clientTabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + clientTabs.length) % clientTabs.length;
    selectClient(clientTabs[index], true);
  });
}

function publicEndpoint(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') return null;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
function scopeLabel(scope) {
  const description = metadata?.scopeDescriptions?.[scope];
  return typeof description === 'string' ? description : scopeFallback[scope] ?? scope;
}
function facts(container, rows) {
  container.replaceChildren();
  for (const [label, value] of rows) if (value !== undefined && value !== null && value !== '') container.append(node('dt', label), node('dd', String(value)));
}
function date(value) {
  if (!value) return '未確認';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '未確認' : parsed.toLocaleString('ja-JP');
}
async function loadPublic() {
  const [mcp, service] = await Promise.all([api('/public/mcp'), api('/public/service')]);
  metadata = mcp; publicService = service;
  const endpoint = publicEndpoint(mcp.endpoint);
  $('#mcp-endpoint').value = endpoint ?? '';
  $('#claude-command').value = endpoint ? `claude mcp add --transport http --scope user oathra ${endpoint}` : '';
  $('#copy-endpoint').disabled = !endpoint || !mcp.enabled;
  $('#copy-command').disabled = !endpoint || !mcp.enabled;
  const local = mcp.localOnly === true || (endpoint && new URL(endpoint).protocol === 'http:');
  $('#copy-endpoint').disabled = !endpoint || !mcp.enabled || local || mcp.publicReady === false;
  notice('#service-status', !endpoint ? '接続URLを確認できませんでした。運営へお問い合わせください。' : !mcp.enabled ? 'AIツールとの接続は現在準備中です。既存の許可はログインして確認できます。' : local ? 'ローカル検証用のURLです。同じ端末からの接続に使います。ChatGPT向けの公開URLは未設定です。' : mcp.publicReady === false ? '外部からの接続は現在準備中です。' : '接続URLを設定すると、Oathraへのログインとアクセス許可に進みます。');
  $('#endpoint-note').textContent = endpoint ? 'このURLにパスワードやAPIキーを追加しないでください。' : '接続URLを確認できませんでした。運営へお問い合わせください。';
  if (local || mcp.publicReady === false) $('#chatgpt-note').textContent = 'このサーバーにはChatGPTから直接接続できる公開URLが設定されていません。公開URLが整ってから接続してください。';
  syncCall();
}
for (const [button, input, message] of [['#copy-endpoint', '#mcp-endpoint', '接続URLをコピーしました。'], ['#copy-command', '#claude-command', 'Claude Codeの追加コマンドをコピーしました。']]) {
  $(button).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(input).value); notice('#page-status', message); }
    catch { $(input).focus(); $(input).select(); notice('#page-status', 'コピーできませんでした。選択された文字を手動でコピーしてください。'); }
  });
}

async function enter() {
  const bootstrap = await api('/bootstrap');
  if (!bootstrap.user?.id) throw new Error('アカウントを確認できませんでした。');
  account = bootstrap;
  $('#account-label').textContent = bootstrap.login?.email ?? 'ログイン済み';
  $('#account-bar').hidden = false; $('#login-panel').hidden = true; $('#connections-panel').hidden = false;
  const tasks = [loadConnections()];
  if (authorizing) tasks.push(previewAuthorization());
  else if (missionId) tasks.push(loadMission());
  await Promise.allSettled(tasks);
}
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try { await api('/session', { method: 'DELETE' }); clearSensitiveState(); access.reset(); notice('#page-status', 'ログアウトしました。'); }
  catch (error) { if (!error.stale) notice('#page-error', error.message); }
  finally { $('#logout').disabled = false; }
});

async function previewAuthorization() {
  authorization = null; $('#authorize-content').hidden = true;
  notice('#authorize-loading', '接続先と許可内容を確認しています…'); notice('#authorize-error');
  try {
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length || keys.some(key => ['access_token', 'refresh_token', 'client_secret', 'password', 'token'].includes(key))) throw new Error(messages.invalid_request);
    const preview = await api('/mcp/authorize/preview', { method: 'POST', body: { parameters: Object.fromEntries(params) } });
    if (!preview.requestId || !preview.csrf || !Array.isArray(preview.scopes) || !preview.scopes.length || !preview.scopes.every(scope => Object.hasOwn(scopeFallback, scope))) throw new Error(messages.invalid_scope);
    authorization = preview;
    authorizationBusy = false; $('#authorize-approve').disabled = false; $('#authorize-deny').disabled = false;
    facts($('#authorize-facts'), [['接続するツール', preview.clientName], ['認証後の戻り先', preview.redirectUri], ['Oathraアカウント', account?.login?.email ?? 'ログイン中のアカウント']]);
    $('#authorize-scopes').replaceChildren(...preview.scopes.map(scope => node('li', scopeLabel(scope))));
    $('#authorize-content').hidden = false; notice('#authorize-loading'); $('#authorize-title').focus();
  } catch (error) { if (!error.stale) { notice('#authorize-loading'); notice('#authorize-error', error.message); } }
}
async function decide(approved) {
  if (!authorization || authorizationBusy) return;
  const captured = authorization;
  authorizationBusy = true; $('#authorize-approve').disabled = true; $('#authorize-deny').disabled = true;
  notice('#authorize-error'); notice('#authorize-status', approved ? '許可を送信しています…' : '拒否を送信しています…');
  try {
    const result = await api('/mcp/authorize/decision', { method: 'POST', body: { requestId: captured.requestId, csrf: captured.csrf, approved } });
    const url = new URL(result.redirectUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('戻り先を確認できませんでした。接続元のツールで状況を確認してください。');
    authorization = null;
    notice('#authorize-status', approved ? 'アクセスを許可しました。接続元のツールに戻ります。' : 'アクセスを拒否しました。接続元のツールに戻ります。');
    location.assign(url.href);
  } catch (error) {
    if (!error.stale) { notice('#authorize-error', error.message); notice('#authorize-status', '受付結果をこの画面で確定できません。下の接続一覧を更新し、接続元のツールから状況を確認してください。'); }
    if (authorization === captured) authorization = null; // A lost response must never silently grant again.
  }
}
$('#authorize-approve').addEventListener('click', () => decide(true));
$('#authorize-deny').addEventListener('click', () => decide(false));

function renderConnections() {
  const root = $('#connections-list'); root.replaceChildren();
  if (!connections.length) { root.append(node('p', '許可した接続はまだありません。接続先で設定を進め、Oathraの確認画面で許可してください。', 'note')); return; }
  for (const item of connections) {
    const revoked = !!item.revokedAt || String(item.status).toLowerCase() === 'revoked';
    const expired = String(item.status).toLowerCase() === 'expired' || (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now());
    const invalidated = String(item.status).toLowerCase() === 'invalidated';
    const section = node('article', undefined, 'connect-connection'), heading = node('div', undefined, 'connect-connection-heading');
    const active = item.status === 'ACTIVE';
    heading.append(node('h3', item.clientName ?? '接続先名未確認'), node('span', revoked ? '解除済み' : expired ? '期限切れ' : invalidated ? '無効・再接続が必要' : active ? '許可中' : '状態未確認'));
    section.append(heading);
    const list = node('ul');
    for (const scope of item.scopes ?? []) list.append(node('li', scopeLabel(scope)));
    section.append(list, node('p', `許可日時：${date(item.createdAt)} / 有効期限：${date(item.expiresAt)}`, 'note'));
    if (item.lastUsedAt) section.append(node('p', `最終利用：${date(item.lastUsedAt)}`, 'note'));
    if (!revoked && !expired && !invalidated && active) {
      const button = node('button', '接続を解除', 'btn'); button.type = 'button';
      button.addEventListener('click', () => { revokeTarget = item; $('#revoke-name').textContent = item.clientName ?? 'この接続'; notice('#revoke-error'); $('#revoke-dialog').showModal(); $('#revoke-cancel').focus(); });
      section.append(button);
    }
    root.append(section);
  }
}
async function loadConnections() {
  if (!account || connectionsBusy) return;
  const captured = generation;
  connectionsBusy = true; $('#connections-refresh').disabled = true; notice('#connections-error');
  try {
    const result = await api('/mcp/connections');
    if (!Array.isArray(result.connections)) throw new Error('接続一覧を確認できませんでした。');
    connections = result.connections; renderConnections();
  } catch (error) { if (!error.stale) notice('#connections-error', error.message); }
  finally { if (captured === generation) { connectionsBusy = false; $('#connections-refresh').disabled = false; } }
}
$('#connections-refresh').addEventListener('click', loadConnections);
$('#revoke-cancel').addEventListener('click', () => $('#revoke-dialog').close());
$('#revoke-dialog').addEventListener('close', () => { revokeTarget = null; });
$('#revoke-dialog').addEventListener('cancel', event => { if ($('#revoke-confirm').disabled) event.preventDefault(); });
$('#revoke-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!revokeTarget || $('#revoke-confirm').disabled) return;
  const captured = generation, selected = revokeTarget; $('#revoke-confirm').disabled = true; $('#revoke-cancel').disabled = true; notice('#revoke-error');
  try {
    await api('/mcp/connections/' + encodeURIComponent(selected.id) + '/revoke', { method: 'POST', body: {} });
    connections = connections.map(item => item.id === selected.id ? { ...item, status: 'revoked' } : item);
    renderConnections(); $('#revoke-dialog').close(); notice('#connections-status', '接続を解除しました。');
  } catch (error) { if (!error.stale) notice('#revoke-error', error.message + (error.uncertain ? ' 接続一覧を更新して解除状況を確認してください。' : '')); }
  finally { if (captured === generation) { $('#revoke-confirm').disabled = false; $('#revoke-cancel').disabled = false; } }
});

function startKey() { return account && missionId ? `oathra:mcp-start:${account.user.id}:${missionId}` : null; }
function rememberUncertain(value) {
  startUncertain = value;
  try { const key = startKey(); if (key) { if (value) sessionStorage.setItem(key, 'pending'); else sessionStorage.removeItem(key); } } catch { /* The in-memory guard still prevents this page from redialling. */ }
}
function clearReview() { callReview = null; clearTimeout(expiryTimer); $('#mission-consent').checked = false; $('#mission-approval').hidden = true; }
function phoneConsentSaved() { return !!account?.configuration?.consentVersion && account.account?.consentVersion === account.configuration.consentVersion; }
function callReady() { return mission?.mode === 'live' && publicService?.phoneReady === true && phoneStatus?.ready === true && publicService?.prerelease?.paused !== true && !account?.account?.purchaseBlocked && phoneConsentSaved(); }
function syncCall() {
  if (!mission || !account) return;
  const draft = mission.status === 'DRAFT', unknown = mission.status === 'UNKNOWN' || mission.stopNeedsReconciliation || startUncertain;
  const currentReview = callReview && callReview.expiresAt > Date.now() && callReview.missionId === mission.id;
  $('#mission-review').hidden = !draft || unknown || !!currentReview;
  $('#mission-review').disabled = missionBusy;
  $('#mission-refresh').disabled = missionBusy;
  $('#mission-policy-form').hidden = !draft || phoneConsentSaved();
  $('#mission-policy-consent').disabled = missionBusy;
  $('#mission-policy-save').disabled = missionBusy || !$('#mission-policy-consent').checked || !phoneStatus?.disclosure || !account.configuration?.consentVersion;
  $('#mission-approval').hidden = !draft || unknown || !currentReview;
  $('#mission-consent').disabled = missionBusy || !callReady();
  $('#mission-start').disabled = missionBusy || !callReady() || !currentReview || !$('#mission-consent').checked || !Number.isSafeInteger(mission.creditQuote?.amount);
  notice('#mission-readiness', unknown ? '受付または通話の結果が未確認です。再発信せず、「状況を更新」で確認してください。解消しない場合は運営へ照会してください。' : !draft ? 'この依頼は下書きの状態ではありません。現在の状況を確認してください。' : mission.mode !== 'live' ? 'これはシミュレーターの下書きです。この画面から実電話は発信しません。' : publicService?.prerelease?.paused ? '事前プレリリースを一時休止しているため、現在は発信できません。下書きの内容は確認できます。' : account.account?.purchaseBlocked ? '購入について運営が確認中のため、現在は発信できません。' : publicService?.phoneReady !== true || phoneStatus?.ready !== true ? '電話の受付は現在準備中です。下書きの内容は確認できます。' : !phoneConsentSaved() ? '発信するには、下の電話・保存・送信先の説明を確認して同意を保存してください。' : currentReview ? '内容と上限を確認し、同意する場合だけ発信してください。この確認は5分で失効します。' : 'まだ発信していません。「発信内容・費用を確認」から、今回の内容と上限を確認してください。');
}
function renderMission(summary) {
  $('#mission-state').textContent = missionStates[mission.status] ?? `現在の状態：${mission.status}`;
  const quote = mission.creditQuote;
  facts($('#mission-facts'), [
    ['宛先', [mission.target?.name, mission.target?.phone].filter(Boolean).join('\n')], ['連絡の根拠', mission.target?.basis], ['商品', mission.product?.name], ['用件', mission.request],
    ['営業の目的', { meeting: '商談・打ち合わせの日程調整', materials: '資料の案内', introduce: '商品・サービスの紹介' }[mission.goal] ?? mission.goal],
    ['候補日時（タイムゾーン付き）', mission.candidateSlots?.length ? mission.candidateSlots.join('\n') : '指定なし'],
    ['通話時間の上限', Number.isFinite(mission.maxSeconds) ? `${mission.maxSeconds}秒` : '未確認'],
    ['消費クレジット', Number.isSafeInteger(quote?.amount) ? `${quote.policy === 'provider-cost-v1' ? '最大 ' : ''}${quote.amount} クレジット${quote.policy === 'provider-cost-v1' ? 'を一時確保し、精算後に残りを返却' : ''}` : '未確認'],
    ['運営側の費用見積', Number.isFinite(mission.estimatedMaximumUsd) ? `最大 $${mission.estimatedMaximumUsd.toFixed(3)}（内部費用の目安。クレジットの購入金額ではありません）` : null],
  ]);
  notice('#mission-summary', typeof summary === 'string' ? summary : '');
  const outcome = mission.result?.caveat ?? mission.result?.summary;
  notice('#mission-result', typeof outcome === 'string' ? outcome : '');
  notice('#mission-disclosure', typeof phoneStatus?.disclosure === 'string' ? phoneStatus.disclosure : '電話サービスの説明を取得できませんでした。状況を更新してください。');
  $('#mission-policy').open = !phoneConsentSaved();
  $('#mission-open').href = '/app/#/call/' + encodeURIComponent(mission.id); $('#mission-open').hidden = mission.status === 'DRAFT';
  $('#mission-content').hidden = false; notice('#mission-loading'); syncCall();
}
async function loadMission() {
  if (!account || missionBusy) return;
  const captured = generation;
  missionBusy = true; clearReview(); notice('#mission-error');
  try {
    if (!/^[a-f0-9-]{36}$/i.test(missionId ?? '')) throw new Error('下書きのURLを確認してください。');
    try { startUncertain = sessionStorage.getItem(startKey()) === 'pending'; } catch { /* retain current uncertainty */ }
    const [record, service, phone] = await Promise.all([api('/missions/' + encodeURIComponent(missionId)), api('/public/service'), api('/phone/status')]);
    if (captured !== generation) throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true });
    mission = record; publicService = service; phoneStatus = phone;
    if (record.status !== 'DRAFT') rememberUncertain(false);
    renderMission();
  } catch (error) { if (!error.stale) { notice('#mission-loading'); notice('#mission-error', error.message); } }
  finally { if (captured === generation) { missionBusy = false; syncCall(); } }
}
$('#mission-refresh').addEventListener('click', loadMission);
$('#mission-consent').addEventListener('change', syncCall);
$('#mission-policy-consent').addEventListener('change', syncCall);
$('#mission-policy-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#mission-policy-save').disabled || missionBusy || !account) return;
  const captured = generation;
  missionBusy = true; syncCall(); notice('#mission-error');
  try {
    await api('/consent', { method: 'POST', body: { version: account.configuration.consentVersion } });
    account = await api('/bootstrap');
    if (!phoneConsentSaved()) throw new Error('同意の保存を確認できませんでした。状況を更新してください。');
    $('#mission-policy-consent').checked = false; notice('#mission-status', '電話サービスへの同意を保存しました。発信する前に、この1件の内容と上限を確認してください。');
  } catch (error) { if (!error.stale) notice('#mission-error', error.message); }
  finally { if (captured === generation) { missionBusy = false; syncCall(); } }
});
$('#mission-review').addEventListener('click', async () => {
  if (!mission || missionBusy || mission.status !== 'DRAFT' || startUncertain) return;
  const captured = generation, targetMission = mission.id;
  missionBusy = true; clearReview(); syncCall(); notice('#mission-error'); notice('#mission-status');
  try {
    [publicService, phoneStatus] = await Promise.all([api('/public/service'), api('/phone/status')]);
    if (captured !== generation) throw Object.assign(new Error('ログイン状態が変わりました。'), { stale: true });
    const result = await api('/missions/' + encodeURIComponent(targetMission) + '/review', { method: 'POST', body: {} });
    if (!result.approvalToken || result.mission?.id !== targetMission || result.mission.status !== 'DRAFT') throw new Error('発信内容を確認できませんでした。状況を更新してください。');
    mission = result.mission;
    callReview = { approvalToken: result.approvalToken, missionId: mission.id, key: crypto.randomUUID(), expiresAt: Date.now() + Math.min(result.expiresInSeconds ?? 300, 300) * 1000 };
    renderMission(result.summary);
    expiryTimer = setTimeout(() => { clearReview(); syncCall(); notice('#mission-status', '確認の有効期限が切れました。内容と費用をもう一度確認してください。'); }, Math.max(0, callReview.expiresAt - Date.now()));
    $('#mission-title').focus();
  } catch (error) { if (!error.stale) notice('#mission-error', error.message); }
  finally { if (captured === generation) { missionBusy = false; syncCall(); } }
});
$('#mission-approval').addEventListener('submit', async event => {
  event.preventDefault(); syncCall();
  if ($('#mission-start').disabled || missionBusy || !callReview) return;
  const captured = generation, approved = callReview; missionBusy = true; rememberUncertain(true); syncCall(); notice('#mission-error'); notice('#mission-status', '発信の承認を送信しています…');
  try {
    const result = await api('/missions/' + encodeURIComponent(approved.missionId) + '/start', { method: 'POST', body: { approvalToken: approved.approvalToken, acknowledged: true }, headers: { 'Idempotency-Key': approved.key } });
    if (result.id !== approved.missionId || result.status === 'DRAFT') throw Object.assign(new Error('発信の受付結果を確認できませんでした。'), { uncertain: true });
    mission = result; rememberUncertain(false); clearReview(); renderMission();
    notice('#mission-status', '発信の承認を受け付けました。通話完了はまだ確認していません。「状況を更新」で確認してください。');
  } catch (error) {
    if (!error.stale) { if (!error.uncertain && error.status && error.status < 500) rememberUncertain(false); notice('#mission-error', error.message); notice('#mission-status', startUncertain ? '受付結果が未確認です。発信を繰り返さず、状況を更新してください。' : '発信は受け付けられませんでした。状況を更新して、内容をもう一度確認してください。'); }
    if (captured === generation) clearReview();
  } finally { if (captured === generation) { missionBusy = false; syncCall(); } }
});

window.addEventListener('hashchange', () => { if (/^#(?:setup|signup|verify|reset)=/.test(location.hash)) location.reload(); });
window.addEventListener('pagehide', () => { authorization = null; clearReview(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
await Promise.allSettled([
  loadPublic().catch(error => { if (!error.stale) { notice('#service-status', '接続設定を確認できませんでした。ページを再読み込みしてください。'); notice('#page-error', error.message); } }),
  access.pending() ? Promise.resolve() : enter().catch(error => { if (!error.stale && error.status !== 401) notice('#page-error', error.message); }),
]);
