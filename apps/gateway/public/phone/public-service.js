/** Public account and checkout views shared by / and /app. The server owns identity, price and payment state. */
const node = (tag, attrs = {}, ...children) => {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') result.textContent = value;
    else if (key.startsWith('on')) result.addEventListener(key.slice(2), value);
    else result.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== undefined && child !== null && child !== false) result.append(child instanceof Node ? child : String(child));
  return result;
};
export const prereleaseMessages = {
  prerelease_paused: '事前プレリリースを一時休止しています。新規登録・新しい発信・クレジット購入は再開までお待ちください。残高と履歴は確認できます。',
  prerelease_capacity_reached: '登録人数の上限に達したため、新規登録を停止しています。登録済みの方はログインできます。',
  prerelease_call_limit: 'このアカウントの過去24時間の発信上限に達しました。時間をおいてから、内容をもう一度確認してください。',
  prerelease_global_call_limit: 'サービス全体の過去24時間の発信上限に達しました。時間をおいてから、内容をもう一度確認してください。',
  prerelease_budget_limit: 'このアカウントの事前プレリリース利用上限に達しました。残高不足ではありません。時間をおいてからお試しください。',
  prerelease_global_budget_limit: 'サービス全体の事前プレリリース利用上限に達しました。残高不足ではありません。時間をおいてからお試しください。',
  prerelease_limits_changed_review_again: '事前プレリリースの利用上限が更新されました。依頼内容と費用をもう一度確認してください。',
  prerelease_inbound_disabled: '事前プレリリース中は着信を受け付けていません。',
};
/** Only public usage limits appear here. Provider cost-reservation limits are not user prices. */
export function prereleaseNotice(prerelease, registrationReason, { compact = false } = {}) {
  const box = node('aside', { class: 'public-prerelease', 'aria-label': '事前プレリリースの利用条件', hidden: !prerelease?.enabled });
  if (!prerelease?.enabled) return box;
  box.append(node('strong', { class: 'public-prerelease-title', text: prerelease.paused ? '事前プレリリース · 一時休止中' : '事前プレリリース' }));
  const limits = [];
  if (Number.isSafeInteger(prerelease.maxAccounts) && prerelease.maxAccounts > 0) limits.push(`登録は最大${prerelease.maxAccounts.toLocaleString('ja-JP')}人`);
  if (Number.isSafeInteger(prerelease.dailyCallsPerAccount) && prerelease.dailyCallsPerAccount > 0) limits.push(`発信は1人あたり24時間に${prerelease.dailyCallsPerAccount.toLocaleString('ja-JP')}回まで`);
  if (Number.isSafeInteger(prerelease.maxCallSeconds) && prerelease.maxCallSeconds > 0) {
    const minutes = Math.floor(prerelease.maxCallSeconds / 60), seconds = prerelease.maxCallSeconds % 60;
    limits.push(`1回の通話は最長${minutes ? `${minutes}分` : ''}${seconds ? `${seconds}秒` : ''}`);
  }
  if (prerelease.paused) box.append(node('p', { text: '新規登録・発信・クレジット購入を休止しています。ログイン後は残高と履歴を確認できます。' }));
  else if (registrationReason === 'prerelease_capacity_reached') box.append(node('p', { text: prereleaseMessages.prerelease_capacity_reached }));
  const details = compact ? node('details', { class: 'public-prerelease-details' }, node('summary', { text: '利用上限・着信について' })) : box;
  if (limits.length) details.append(node('p', { class: 'public-prerelease-limits', text: limits.join(' / ') }));
  if (prerelease.inboundEnabled === false) details.append(node('p', { class: 'note', text: '着信の受付は利用できません。' }));
  if (compact) box.append(details);
  return box;
}
const messages = {
  ...prereleaseMessages,
  session_account_changed: 'ログインしているアカウントが変わりました。ページを再読み込みしてください。',
  unauthorized: 'ログインの有効期限が切れました。ページを再読み込みしてログインしてください。',
  public_accounts_unavailable: '現在、新規登録・メールでの再設定は利用できません。既存のアカウントでログインするか、運営へお問い合わせください。',
  public_accounts_rate_limited: '試行が多いため、時間をおいてからお試しください。',
  email_delivery_unconfirmed: 'メールの送信を確認できませんでした。届いていない場合は、時間をおいて再度お試しください。',
  accept_current_terms: '現在の利用規約とプライバシーポリシーを確認して、同意にチェックしてください。',
  terms_changed_request_new_link: '利用規約が更新されました。確認メールをもう一度送信してください。',
  account_already_registered: 'このメールアドレスは登録済みです。ログインするか、パスワードを再設定してください。',
  purchase_account_under_review: '購入について運営が確認中です。残高と購入履歴を確認し、注文番号を添えてお問い合わせください。',
  purchase_account_blocked: '購入について運営が確認中のため、新しい発信を受け付けられません。残高と購入履歴をご確認ください。',
  purchases_not_configured: 'クレジットのオンライン購入は現在利用できません。',
  purchase_price_changed_review_again: '購入するクレジット数または価格が更新されました。購入履歴を確認してから、内容を選び直してください。',
  purchase_pending_reconcile: '確認中の購入があります。購入状況を確認してから続けてください。',
  review_purchase_price: '購入するクレジットと金額を確かめてください。',
  stripe_unavailable: '決済サービスに接続できませんでした。購入履歴から状況を確認してください。',
  credit_balance_limit: '保有できるクレジットの上限に達するため、追加できません。',
  registration_unavailable: '現在、新規登録の受付を準備しています。既存のアカウントではログインできます。',
  signup_disabled: '現在、新規登録は受け付けていません。',
  password_reset_unavailable: '現在、メールでの再設定を利用できません。運営へお問い合わせください。',
  reset_disabled: '現在、メールでの再設定を利用できません。運営へお問い合わせください。',
  email_delivery_failed: 'メールの送信を確認できませんでした。届いていない場合は、時間をおいて再度お試しください。',
  email_delivery_unavailable: 'メールの送信を確認できませんでした。届いていない場合は、時間をおいて再度お試しください。',
  invalid_email: 'メールアドレスを確かめてください。',
  invalid_login: 'メールアドレスかパスワードが違います。',
  password_length: 'パスワードは8文字以上にしてください。',
  login_link_expired: 'リンクが期限切れか使用済みです。メールをもう一度送信してください。',
  invalid_verification_code: 'リンクが期限切れか使用済みです。メールをもう一度送信してください。',
  terms_acceptance_required: '利用規約とプライバシーポリシーを確認して、同意にチェックしてください。',
  login_rate_limited: '試行が多いため、一度お待ちください。',
  registration_rate_limited: '試行が多いため、一度お待ちください。',
  purchase_unavailable: 'クレジットのオンライン購入は現在利用できません。',
  credit_purchases_unavailable: 'クレジットのオンライン購入は現在利用できません。',
  purchase_price_changed: '価格が更新されました。ページを更新して金額を確かめてください。',
  credit_price_changed: '価格が更新されました。ページを更新して金額を確かめてください。',
  purchase_in_progress: '購入を確認中です。購入履歴から状態を確認してください。',
};
const readable = error => messages[error.code] ?? error.message ?? '処理を確認できませんでした。もう一度状況を確認してください。';
function safeUrl(value, checkout = false) {
  try {
    const url = new URL(value, location.origin);
    if (url.username || url.password) return null;
    if (checkout) return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : null;
    return url.protocol === 'https:' || (url.origin === location.origin && url.protocol === 'http:') ? url.href : null;
  } catch { return null; }
}
export function policyLinks(policies = {}) {
  const links = node('nav', { class: 'public-policies', 'aria-label': '利用条件とお問い合わせ' });
  for (const [key, label] of [['termsUrl', '利用規約'], ['privacyUrl', 'プライバシー'], ['commerceUrl', '特定商取引法に基づく表記'], ['supportUrl', 'お問い合わせ']]) {
    const href = safeUrl(policies[key]);
    if (policies[key] && href) links.append(node('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }));
  }
  return links;
}
export function hasAccountLink() { return /^#(?:setup|signup|verify|reset)=/.test(location.hash); }
function takeAccountLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const mode of ['setup', 'signup', 'verify', 'reset']) {
    if (!params.has(mode)) continue;
    const code = params.get(mode);
    history.replaceState(null, '', location.pathname + location.search);
    return { mode: mode === 'signup' ? 'verify' : mode, code };
  }
  return null;
}
export function createPublicAccess({ api, onSignedIn, beforeSignIn = () => {}, idPrefix = 'public', operatorLogin, showOverview = false }) {
  let link = takeAccountLink(), mode = link?.mode ?? 'login', service = null, busy = false;
  const container = node('div', { class: 'public-access' });
  const overview = showOverview ? node('section', { class: 'public-overview', 'aria-label': 'Oathraでできること' },
    node('p', { class: 'public-eyebrow', text: '電話の依頼から、結果の確認まで' }),
    node('h1', {}, '相手の言葉で、', node('br'), '完了を確かめる。'),
    node('p', { class: 'public-overview-copy', text: 'AIの「できました」だけで終わらせない。何が決まり、何を確認すべきかを、通話の記録から確かめます。' }),
    node('ol', { class: 'public-workflow' },
      ...[['01', '内容と費用を確認', '宛先・用件を確認して、発信を承認。'], ['02', 'AIが電話を代行', '毎回の承認後に、指定した範囲で通話。'], ['03', '根拠とともに報告', '相手の発言から、完了と要確認を分けます。']].map(([n, title, detail]) => node('li', {}, node('span', { class: 'public-workflow-number', text: n, 'aria-hidden': true }), node('div', {}, node('strong', { text: title }), node('p', { text: detail }))))),
    node('nav', { class: 'public-entry-links', 'aria-label': '初めての方へ' },
      node('a', { href: 'https://forifor.github.io/oathra/check.html' }, node('span', {}, node('strong', { text: 'ログ検証を試す' }), node('small', { text: '公開ページ · ログイン不要' })), node('span', { text: '↗', 'aria-hidden': true })),
      node('a', { href: '/connect' }, node('span', {}, node('strong', { text: 'AIとの接続を設定する' }), node('small', { text: 'Claude Code・ChatGPT' })), node('span', { text: '→', 'aria-hidden': true })))) : null;
  const accountPane = node('section', { class: 'public-account-pane' });
  const ids = name => idPrefix + '-' + name;
  const error = node('p', { id: ids('login-error'), class: 'public-error', role: 'alert', hidden: true });
  const status = node('p', { class: 'public-status', role: 'status', hidden: true });
  const heading = node('h2', { id: ids('login-title') });
  const intro = node('p', { class: 'note public-access-intro' });
  const prerelease = node('div');
  const email = node('input', { id: ids('email'), type: 'email', name: 'username', autocomplete: 'username', maxlength: 254, autocapitalize: 'none', spellcheck: 'false', required: true });
  const emailRow = node('div', { class: 'public-field' }, node('label', { for: email.id, text: 'メールアドレス' }), email);
  const password = node('input', { id: ids('password'), type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 1024 });
  const passwordHelp = node('p', { id: ids('password-help'), class: 'note', text: '8文字以上。日本語やスペースも使えます。' });
  password.setAttribute('aria-describedby', passwordHelp.id);
  const passwordRow = node('div', { class: 'public-field' }, node('label', { for: password.id, text: 'パスワード' }), password, passwordHelp);
  const terms = node('input', { type: 'checkbox', id: ids('terms') });
  const termsRow = node('label', { class: 'public-check', for: terms.id }, terms, node('span', { text: '利用規約とプライバシーポリシーを確認し、同意します。' }));
  const policies = node('div');
  const submit = node('button', { type: 'submit', class: 'btn primary', id: ids('login-submit') });
  const form = node('form', { id: ids('login-form'), class: 'public-form' }, emailRow, passwordRow, policies, termsRow, error, status, submit);
  const navigation = node('div', { class: 'public-auth-actions' });
  const availability = node('p', { class: 'note public-availability', role: 'status', text: '新規登録・メール再設定の受付状況を確認しています…' });
  accountPane.setAttribute('aria-labelledby', heading.id);
  accountPane.append(heading, intro, prerelease, form, navigation, availability);
  if (overview) container.append(overview);
  container.append(accountPane);
  function setMode(next) {
    if (busy) return;
    link = null; mode = next; error.hidden = true; status.hidden = true; password.value = ''; terms.checked = false;
    render(); (next === 'verify' || next === 'reset' ? password : email).focus();
  }
  function render() {
    const needsEmail = ['login', 'register', 'forgot', 'setup'].includes(mode), needsPassword = ['login', 'setup', 'verify', 'reset'].includes(mode);
    const titles = { login: 'Oathra にログイン', register: 'アカウントを作成', forgot: 'パスワードを再設定', setup: 'ログイン方法を設定', verify: '登録を完了する', reset: '新しいパスワードを設定' };
    const actions = { login: 'ログイン', register: '確認メールを送信', forgot: '再設定メールを送信', setup: '設定して始める', verify: '同意して登録を完了', reset: 'パスワードを再設定' };
    const descriptions = { login: '依頼する内容と費用を確かめてから、AIに電話を任せられます。', register: 'メールアドレスを確認してから、パスワードを設定します。この操作で料金は発生しません。', forgot: '登録したメールアドレスに、再設定用のリンクを送ります。', setup: '次回から使うメールアドレスとパスワードを設定します。', verify: 'メールアドレスの確認リンクを受け取りました。パスワードを設定してください。', reset: 'このリンクでパスワードを変更します。ほかの端末はログアウトします。' };
    form.setAttribute('aria-busy', String(busy));
    container.classList.toggle('public-access-entry', !!overview && mode === 'login');
    if (overview) overview.hidden = mode !== 'login';
    heading.textContent = titles[mode]; intro.textContent = mode === 'login' ? '通話の記録・残高を確認します。' : descriptions[mode]; submit.textContent = busy ? '確認中…' : actions[mode]; submit.disabled = busy;
    emailRow.hidden = !needsEmail; email.disabled = !needsEmail || busy;
    passwordRow.hidden = !needsPassword; password.disabled = !needsPassword || busy;
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password'; password.minLength = mode === 'login' ? 1 : 8; passwordHelp.hidden = mode === 'login';
    termsRow.hidden = mode !== 'verify'; terms.required = mode === 'verify'; terms.disabled = mode !== 'verify' || busy;
    if (mode === 'register' && !service?.registration?.enabled) submit.disabled = true;
    if (mode === 'verify' && (!service?.registration?.enabled || !service.registration.termsVersion || !safeUrl(service.policies?.termsUrl) || !safeUrl(service.policies?.privacyUrl))) submit.disabled = true;
    prerelease.replaceChildren(prereleaseNotice(service?.prerelease, service?.registration?.reason, { compact: true }));
    policies.replaceChildren(policyLinks(service?.policies));
    policies.hidden = !policies.querySelector('a');
    navigation.replaceChildren();
    const action = (label, to) => navigation.append(node('button', { class: 'btn', type: 'button', disabled: busy, text: label, onclick: () => setMode(to) }));
    if (mode === 'login') {
      if (service?.registration?.enabled) action('初めての方：アカウントを作成', 'register');
      if (service?.registration?.recoveryEnabled) action('パスワードを忘れた方', 'forgot');
      if (operatorLogin) navigation.append(node('button', { type: 'button', class: 'public-text-button', disabled: busy, text: '管理者のトークンでログイン', onclick: operatorLogin }));
    } else {
      action('ログインへ戻る', 'login');
      if (['verify', 'reset'].includes(mode)) {
        if (mode === 'verify' && service?.registration?.enabled) action('確認メールをもう一度送る', 'register');
        if (mode === 'reset' && service?.registration?.recoveryEnabled) action('再設定メールをもう一度送る', 'forgot');
      }
    }
    navigation.hidden = !navigation.childElementCount;
    availability.hidden = !!service?.prerelease?.enabled && (service.prerelease.paused || service.registration?.reason === 'prerelease_capacity_reached');
    if (service) availability.textContent = prereleaseMessages[service.registration?.reason] ?? (service.registration?.enabled ? (service.phoneReady === false ? 'アカウント作成は無料です。電話サービスは現在準備中です。' : 'アカウント作成は無料です。電話にはクレジットと毎回の発信承認が必要です。') : '現在、新規登録の受付を準備しています。既存の利用者はログインできます。初回設定や再設定については運営へお問い合わせください。');
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    busy = true; error.hidden = true; status.hidden = true;
    const submittedMode = mode, payload = ['register', 'forgot'].includes(mode) ? { email: email.value.trim() }
      : mode === 'login' ? { email: email.value.trim(), password: password.value }
      : mode === 'setup' ? { code: link?.code, email: email.value.trim(), password: password.value }
      : { code: link?.code, password: password.value, ...(mode === 'verify' ? { acceptedTerms: terms.checked, termsVersion: service?.registration?.termsVersion } : {}) };
    render();
    try {
      const endpoint = { register: 'register', forgot: 'forgot', login: 'login', setup: 'setup', verify: 'verify', reset: 'reset' }[submittedMode];
      if (!['register', 'forgot'].includes(submittedMode)) beforeSignIn();
      await api('/auth/' + endpoint, { method: 'POST', body: payload });
      if (['register', 'forgot'].includes(submittedMode)) {
        status.textContent = submittedMode === 'register' ? '受付しました。登録を進められる場合は、確認メールが届きます。届かない場合は迷惑メールフォルダーも確認してください。すでに登録済みの方はログインしてください。' : '受付しました。このアドレスが登録されていれば、再設定メールが届きます。迷惑メールフォルダーも確認してください。';
        status.hidden = false;
      } else {
        link = null; mode = 'login'; password.value = ''; terms.checked = false;
        await onSignedIn();
      }
    } catch (e) { if (!e.stale) { error.textContent = readable(e); error.hidden = false; } }
    finally { password.value = ''; busy = false; render(); }
  });
  render();
  api('/public/service').then(value => { service = value; render(); }).catch(() => { availability.textContent = '新規登録の受付状況を確認できませんでした。既存のアカウントでログインするか、ページを再読み込みしてください。'; });
  return { node: container, pending: () => !!link, reset: () => setMode('login') };
}
function formatPrice(amount, currency) {
  // Stripe's amount representation differs from ISO/Intl for ISK and UGX.
  // https://docs.stripe.com/currencies#zero-decimal (charge amounts, not payout amounts)
  const zeroDecimal = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
  const scale = zeroDecimal.has(currency.toLowerCase()) ? 1 : 100;
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: currency.toUpperCase() }).format(amount / scale);
}
const purchaseState = { CREATING: '決済ページを準備中', OPEN: '支払い待ち', PENDING: '決済の確認待ち', PAID: '支払い確認・クレジット追加済み', EXPIRED: '支払い期限切れ', UNKNOWN: '決済結果を確認できていません', BLOCKED: '運営が確認中' };
export function createCreditPurchase({ api, owner, isBlocked = () => false, onBalanceChange = async () => {} }) {
  const transport = api;
  api = (path, options = {}) => transport(path, { ...options, headers: { ...options.headers, ...(owner ? { 'x-oathra-account': owner } : {}) } });
  const root = node('section', { class: 'public-purchase', 'aria-label': 'クレジットの購入' });
  const title = node('h3', { text: 'クレジットを購入' }), hint = node('p', { class: 'note', text: '購入できるクレジットを確認しています…' });
  const admission = node('p', { class: 'public-purchase-admission', hidden: true });
  const error = node('p', { class: 'public-error', role: 'alert', hidden: true }), status = node('p', { class: 'public-status', role: 'status', hidden: true });
  const choices = node('fieldset', { class: 'public-packs', disabled: true }, node('legend', { text: '購入するクレジット' }));
  const submit = node('button', { class: 'btn primary', type: 'submit', disabled: true, text: '支払いページへ進む' });
  const form = node('form', { class: 'public-form', hidden: true }, choices, submit);
  const list = node('div', { class: 'public-orders', 'aria-busy': 'true' }, node('p', { class: 'note', text: '購入履歴を確認しています…' })), refresh = node('button', { type: 'button', class: 'btn', text: '購入状況を確認', disabled: true });
  const policies = node('div');
  const reviewAttempt = node('button', { type: 'button', class: 'btn public-review-purchase', text: '購入履歴を確認して選び直す', hidden: true });
  root.append(title, hint, admission, error, status, reviewAttempt, form, policies, node('div', { class: 'public-order-heading' }, node('h3', { text: '購入履歴' }), refresh), list);
  let service, packs = [], orders = [], selected = null, busy = true, checkoutAttempt = null, attemptNeedsReview = false, historyReady = false, catalogReady = false;
  const unresolvedPurchase = () => orders.some(order => ['CREATING', 'OPEN', 'PENDING', 'UNKNOWN'].includes(order.status));
  const completeAttempt = value => value && typeof value.packId === 'string' && typeof value.key === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value.key) && Number.isSafeInteger(value.amount) && value.amount >= 0 && Number.isSafeInteger(value.credits) && value.credits > 0 && typeof value.currency === 'string' && /^[a-z]{3}$/i.test(value.currency);
  const matchesAttempt = pack => completeAttempt(checkoutAttempt) && pack.id === checkoutAttempt.packId && (pack.unitAmount ?? pack.amount) === checkoutAttempt.amount && pack.currency.toLowerCase() === checkoutAttempt.currency.toLowerCase() && pack.credits === checkoutAttempt.credits;
  const storageKey = 'oathra:checkout:' + (owner ?? 'session');
  const fail = e => { error.textContent = readable(e); error.hidden = false; };
  const saveAttempt = value => { checkoutAttempt = value; try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* in-memory key still prevents duplicate retries in this view */ } };
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey));
    if (stored) { checkoutAttempt = stored; attemptNeedsReview = !completeAttempt(stored); }
  } catch { /* storage is optional */ }
  function sync() {
    form.setAttribute('aria-busy', String(busy));
    const unresolved = unresolvedPurchase();
    const paused = service?.prerelease?.paused || service?.purchases?.reason === 'prerelease_paused';
    choices.disabled = busy || !historyReady || !service?.purchases?.enabled || paused || unresolved || isBlocked() || !!checkoutAttempt;
    submit.disabled = busy || !historyReady || !selected || !service?.purchases?.enabled || paused || unresolved || isBlocked() || attemptNeedsReview;
    refresh.disabled = busy;
    refresh.textContent = busy ? '確認中…' : '購入状況を確認';
    reviewAttempt.hidden = !attemptNeedsReview; reviewAttempt.disabled = busy || unresolved;
    submit.textContent = busy ? '確認中…' : checkoutAttempt ? '決済ページを再取得' : '支払いページへ進む';
    admission.hidden = !paused && !isBlocked();
    hint.hidden = !admission.hidden;
    if (paused) admission.textContent = '事前プレリリースの休止中は、クレジットを購入できません。残高と購入履歴は確認できます。';
    else if (isBlocked()) admission.textContent = '購入について運営が確認中です。残高と購入履歴は確認できます。注文番号を添えてお問い合わせください。';
    if (unresolved) { status.textContent = paused || isBlocked() ? '確認中の購入があります。「購入状況を確認」で状態を照会してください。' : '確認中の購入があります。購入履歴から支払いを続けるか、購入状況を確認してください。'; status.hidden = false; }
    else if (attemptNeedsReview) { status.textContent = '前回確認した購入内容を再送できません。購入履歴を照合してから、クレジット数と金額を選び直してください。'; status.hidden = false; }
  }
  function renderOrders() {
    list.replaceChildren();
    if (!orders.length) list.append(node('p', { class: 'public-purchase-empty', text: '購入履歴はまだありません。支払いを受け付けると、ここで状況を確認できます。' }));
    for (const order of orders) {
      const row = node('article', { class: 'public-order', 'data-state': order.status }, node('strong', { text: `${order.credits.toLocaleString('ja-JP')} クレジット · ${formatPrice(order.amount ?? order.unitAmount, order.currency)}` }), node('p', { class: 'public-order-state', text: purchaseState[order.status] ?? '状況を確認してください' }), node('p', { class: 'note', text: `${new Date(order.createdAt).toLocaleString('ja-JP')} · 注文番号 ${order.id}` }));
      const url = safeUrl(order.checkoutUrl, true);
      if (order.status === 'OPEN' && url && !service?.prerelease?.paused && service?.purchases?.reason !== 'prerelease_paused') row.append(node('a', { class: 'btn', href: url, text: '支払いを続ける', referrerpolicy: 'no-referrer' }));
      if (order.status === 'BLOCKED') row.append(node('p', { class: 'note', text: 'この注文は運営の確認が必要です。注文番号を添えてお問い合わせください。' }));
      list.append(row);
    }
  }
  async function loadOrders(reconcile = false) {
    let result = await api('/credits/purchases'); orders = result.purchases ?? result.orders ?? []; renderOrders(); sync();
    const returning = new URLSearchParams(location.search).get('purchase');
    if (reconcile || returning) {
      const pending = orders.filter(order => ['CREATING', 'OPEN', 'PENDING', 'UNKNOWN'].includes(order.status) || order.id === returning);
      for (const order of pending) await api('/credits/purchases/' + encodeURIComponent(order.id) + '/reconcile', { method: 'POST', body: {} });
      if (pending.length) { result = await api('/credits/purchases'); orders = result.purchases ?? result.orders ?? []; }
    }
    if (returning) {
      const returned = orders.find(order => order.id === returning);
      status.hidden = false;
      status.textContent = returned?.status === 'PAID' ? '支払いを確認し、クレジットを追加しました。' : returned?.status === 'EXPIRED' ? '支払い期限が切れました。新しい購入を選べます。' : returned?.status === 'BLOCKED' ? 'この購入は運営が確認中です。注文番号を添えてお問い合わせください。' : '支払い完了はまだ確認できていません。「購入状況を確認」で再確認できます。';
      if (returned && ['PAID', 'EXPIRED', 'BLOCKED'].includes(returned.status)) {
        const url = new URL(location.href); url.searchParams.delete('purchase'); url.searchParams.delete('cancelled'); history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    }
    if (orders.some(order => order.id === checkoutAttempt?.orderId && ['PAID', 'EXPIRED', 'BLOCKED'].includes(order.status))) { saveAttempt(null); attemptNeedsReview = false; }
    await onBalanceChange(); historyReady = true; renderOrders(); list.setAttribute('aria-busy', 'false'); sync();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled || busy) return;
    busy = true; error.hidden = true; status.hidden = true; sync();
    if (!checkoutAttempt) saveAttempt({ key: crypto.randomUUID(), packId: selected.id, amount: selected.unitAmount ?? selected.amount, currency: selected.currency, credits: selected.credits });
    try {
      const order = await api('/credits/checkout', { method: 'POST', body: { packId: checkoutAttempt.packId, amount: checkoutAttempt.amount, currency: checkoutAttempt.currency, credits: checkoutAttempt.credits }, headers: { 'Idempotency-Key': checkoutAttempt.key } });
      saveAttempt({ ...checkoutAttempt, orderId: order.orderId ?? order.id });
      if (order.status === 'PAID' || order.status === 'EXPIRED' || order.status === 'BLOCKED') {
        await loadOrders(); status.textContent = purchaseState[order.status]; status.hidden = false; return;
      }
      const url = safeUrl(order.url ?? order.checkoutUrl, true);
      if (!url) throw new Error('決済ページを確認できませんでした。購入状況を確認してください。');
      location.assign(url);
    } catch (e) {
      if (e.code === 'purchase_price_changed_review_again') attemptNeedsReview = true;
      fail(e);
      try { await loadOrders(); } catch { status.textContent = '受付結果が未確認です。再読み込みして購入履歴を確認してください。同じ購入の再取得には同じ受付番号を使います。'; status.hidden = false; }
    } finally { busy = false; sync(); }
  });
  refresh.addEventListener('click', async () => {
    if (busy) return; busy = true; error.hidden = true; status.hidden = true; sync();
    list.setAttribute('aria-busy', 'true');
    try { if (!catalogReady) await loadCatalog(); await loadOrders(true); if (status.hidden) { status.textContent = '購入状況と残高を更新しました。'; status.hidden = false; } }
    catch (e) { fail(e); if (!historyReady) list.replaceChildren(node('p', { class: 'note', text: '購入履歴を確認できていません。接続を確かめて、もう一度確認してください。' })); }
    finally { busy = false; list.setAttribute('aria-busy', 'false'); sync(); }
  });
  async function loadCatalog() {
    service = await api('/public/service'); policies.replaceChildren(policyLinks(service.policies));
    choices.replaceChildren(node('legend', { text: '購入するクレジット' })); selected = null;
    form.hidden = !service.purchases?.enabled;
    if (service.purchases?.enabled) {
      const data = await api('/credits/packs'); packs = data.packs ?? [];
      if (checkoutAttempt) attemptNeedsReview = !packs.some(matchesAttempt);
      for (const pack of packs) {
        const input = node('input', { type: 'radio', name: 'credit-pack', value: pack.id, required: true });
        if (checkoutAttempt && !attemptNeedsReview && matchesAttempt(pack)) { input.checked = true; selected = pack; }
        input.addEventListener('change', () => { selected = pack; sync(); });
        choices.append(node('label', { class: 'public-pack' }, input, node('span', {}, node('strong', { text: `${pack.credits.toLocaleString('ja-JP')} クレジット` }), node('span', { text: `${formatPrice(pack.unitAmount ?? pack.amount, pack.currency)}（${pack.currency.toUpperCase()}）` }))));
      }
      hint.textContent = data.live === false || service.purchases.live === false ? 'テスト決済の環境です。一般向けの購入受付は行っていません。' : '金額と利用条件を確認し、Stripeの決済ページでお支払いください。決済を確認してから残高に追加します。';
      if (!packs.length) hint.textContent = '現在、購入できるクレジットはありません。';
    } else {
      hint.textContent = service.purchases?.reason === 'prerelease_paused' || service.prerelease?.paused ? '事前プレリリースの休止中は、クレジットの購入を受け付けていません。残高と購入履歴は確認できます。' : 'クレジットのオンライン購入は現在利用できません。追加については運営へお問い合わせください。';
    }
    catalogReady = true;
  }
  reviewAttempt.addEventListener('click', async () => {
    if (busy || !attemptNeedsReview) return;
    busy = true; error.hidden = true; status.hidden = true; sync();
    try {
      await loadOrders(true);
      if (unresolvedPurchase()) return;
      // Never discard an unknown attempt before a successful history reconciliation.
      await loadCatalog(); saveAttempt(null); attemptNeedsReview = false; selected = null;
      for (const input of choices.querySelectorAll('input')) input.checked = false;
      status.textContent = '購入履歴を確認しました。現在のクレジット数と金額を確かめて選択してください。'; status.hidden = false;
    } catch (e) { fail(e); }
    finally { busy = false; sync(); }
  });
  const ready = (async () => {
    try { await loadCatalog(); await loadOrders(); }
    catch (e) { fail(e); hint.textContent = '購入できるクレジット・購入状況を確認できませんでした。「購入状況を確認」から読み直せます。'; list.replaceChildren(node('p', { class: 'note', text: '購入履歴を確認できていません。' })); }
    finally { busy = false; list.setAttribute('aria-busy', 'false'); sync(); }
  })();
  return { node: root, ready, refresh: () => loadOrders(true) };
}
