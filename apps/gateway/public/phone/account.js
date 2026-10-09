import { $, notice, element } from './dom.js';
import { createPublicAccess, createCreditPurchase } from './public-service.js';
/** Login, password and wallet views; authentication and accounting remain server-side. */
export function createAccount({ api, on, enter, beginLogin, onLogout, getAccount, balance }) {
    const publicApi = (path, options = {}) => api(path, options.method ?? 'GET', options.body, options.headers?.['Idempotency-Key']);
    const access = createPublicAccess({ api: publicApi, onSignedIn: async () => { await enter(); if (new URLSearchParams(location.search).has('purchase')) await showCredits(); }, beforeSignIn: beginLogin, idPrefix: 'managed', showOverview: true });
    $('#managed-access').replaceChildren(access.node);
    window.addEventListener('hashchange', () => {
        if (/^#(?:setup|signup|verify|reset)=/.test(location.hash)) location.reload();
    });
    on('#managed-account-button', 'click', () => {
        $('#managed-account-email').textContent = getAccount().login.email ?? '管理者のトークンでログイン中';
        $('#managed-account-username').value = getAccount().login.email ?? '';
        $('#managed-password-form').hidden = !getAccount().login.passwordLogin;
        $('#managed-password-section').hidden = !getAccount().login.passwordLogin;
        $('#managed-password-section').open = false;
        $('#managed-account-help').hidden = !!getAccount().login.passwordLogin;
        notice('#managed-account-error', '');
        notice('#managed-account-status', '');
        $('#managed-account').showModal();
        $('#managed-account').scrollTop = 0;
    });
    $('#managed-account').addEventListener('close', () => {
        $('#managed-password-form').reset();
        notice('#managed-account-error', '');
        notice('#managed-account-status', '');
    });
    on('#managed-account-close', 'click', () => $('#managed-account').close());
    on('#managed-password-form', 'submit', async () => {
        const button = $('#managed-password-form button');
        if (button.disabled)
            return;
        button.disabled = true;
        button.textContent = '変更中…';
        notice('#managed-account-error', '');
        notice('#managed-account-status', '');
        try {
            await api('/auth/password', 'POST', {
                currentPassword: $('#managed-current-password').value, newPassword: $('#managed-new-password').value
            });
            notice('#managed-account-status', 'パスワードを変更しました。');
        }
        catch (e) {
            if (!e.stale) notice('#managed-account-error', e.message);
        }
        finally {
            $('#managed-current-password').value = '';
            $('#managed-new-password').value = '';
            button.disabled = false;
            button.textContent = 'パスワードを変更';
        }
    });
    let ledgerCursor = 0, ledgerBusy = false, walletVersion = 0;
    async function ledger() {
        if (ledgerBusy) return;
        ledgerBusy = true;
        const version = walletVersion, more = $('#managed-more');
        more.disabled = true;
        notice('#managed-ledger-error', '');
        notice('#managed-ledger-status', '利用履歴を読み込んでいます…');
        try {
            const data = await api('/credits/ledger?after=' + ledgerCursor);
            if (version !== walletVersion) return;
            const names = { grant: '追加', reserve: '一時確保', consume: '消費', release: '残高へ返却' };
            data.entries.forEach(entry => {
                const row = element('li'), description = element('div'), date = element('time', new Date(entry.created).toLocaleString('ja-JP'));
                date.dateTime = new Date(entry.created).toISOString();
                description.append(element('strong', names[entry.kind] ?? entry.kind), date);
                const amount = element('span', `${entry.amount.toLocaleString('ja-JP')} クレジット`);
                row.append(description, amount);
                $('#managed-ledger').append(row);
                ledgerCursor = entry.seq;
            });
            more.hidden = data.entries.length < 100;
            more.textContent = '続きを読み込む';
            notice('#managed-ledger-status', ledgerCursor ? '' : '利用履歴はまだありません。');
        } catch (error) {
            if (!error.stale && version === walletVersion) {
                notice('#managed-ledger-status', '');
                notice('#managed-ledger-error', error.message);
                more.hidden = false; more.textContent = '利用履歴を読み直す';
            }
        } finally {
            if (version === walletVersion) { ledgerBusy = false; more.disabled = false; }
        }
    }
    let purchaseView = null;
    async function showCredits() {
        const version = ++walletVersion;
        if (!$('#managed-credits').open) $('#managed-credits').showModal();
        notice('#managed-credits-error', '');
        $('#managed-credits-retry').hidden = true;
        $('#managed-balance').textContent = '残高を確認しています…';
        $('#managed-balance').setAttribute('aria-busy', 'true');
        $('#managed-purchases').replaceChildren();
        $('#managed-ledger').replaceChildren();
        $('#managed-ledger-section').open = false;
        notice('#managed-ledger-status', '利用履歴はまだ読み込んでいません。');
        notice('#managed-ledger-error', '');
        $('#managed-more').hidden = true;
        ledgerCursor = 0; ledgerBusy = false;
        $('#managed-credits').scrollTop = 0;
        try {
            await balance();
            if (version !== walletVersion) return;
            const renderBalance = () => {
                if (version !== walletVersion) return;
                const credits = getAccount().credits, facts = element('dl');
                for (const [label, value] of [['利用できる残高', credits.available], ['確保中', credits.held]]) {
                    const fact = element('div'), amount = element('dd');
                    amount.append(element('strong', value.toLocaleString('ja-JP')), element('span', 'クレジット'));
                    fact.append(element('dt', label), amount); facts.append(fact);
                }
                $('#managed-balance').replaceChildren(facts);
                $('#managed-balance').setAttribute('aria-busy', 'false');
            };
            renderBalance();
            purchaseView = createCreditPurchase({ api: publicApi, owner: getAccount().user.id, isBlocked: () => getAccount()?.account?.purchaseBlocked === true, onBalanceChange: async () => { await balance(); renderBalance(); } });
            $('#managed-purchases').replaceChildren(purchaseView.node);
            await ledger();
        } catch (e) {
            if (!e.stale && version === walletVersion) {
                $('#managed-balance').textContent = '残高を確認できませんでした。';
                $('#managed-balance').setAttribute('aria-busy', 'false');
                notice('#managed-credits-error', e.message);
                $('#managed-credits-retry').hidden = false;
            }
        }
    }
    on('#managed-credit-button', 'click', showCredits);
    on('#managed-credits-retry', 'click', showCredits);
    on('#managed-more', 'click', ledger);
    on('#managed-credits-close', 'click', () => $('#managed-credits').close());
    $('#managed-credits').addEventListener('close', () => { if (!$('#managed-credits').open) { walletVersion++; ledgerBusy = false; } });
    on('#managed-logout', 'click', async () => {
        const button = $('#managed-logout');
        if (button.disabled) return;
        button.disabled = true; button.textContent = 'ログアウト中…';
        notice('#managed-account-error', '');
        try {
            await api('/session', 'DELETE');
            if ($('#managed-account').open) $('#managed-account').close();
            onLogout();
        } catch (error) { if (!error.stale) notice('#managed-account-error', error.message); }
        finally { button.disabled = false; button.textContent = 'この端末からログアウト'; }
    });
    return {
        setupPending() { return access.pending(); },
        initialize() {},
        async afterEnter() {
            if (new URLSearchParams(location.search).has('purchase')) await showCredits();
        },
        reset() {
            access.reset();
            purchaseView = null;
            $('#managed-credits').close();
            $('#managed-purchases').replaceChildren();
            ledgerCursor = 0;
        },
    };
}
