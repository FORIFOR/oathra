import { $, notice, element } from './dom.js';
/** Login, password and wallet views; authentication and accounting remain server-side. */
export function createAccount({ api, on, enter, beginLogin, onLogout, getAccount, balance }) {
    let setupCode = new URLSearchParams(location.hash.slice(1)).get('setup');
    if (location.hash.startsWith('#setup='))
        window.history.replaceState(null, '', location.pathname + location.search);
    window.addEventListener('hashchange', () => {
        if (location.hash.startsWith('#setup='))
            location.reload();
    });
    function loginMode() {
        $('#managed-login-title').textContent = setupCode ? 'ログイン方法を設定' : 'ログイン';
        $('#managed-login-submit').textContent = setupCode ? '設定して始める' : 'ログイン';
        $('#managed-password').autocomplete = setupCode ? 'new-password' : 'current-password';
        $('#managed-password-help').hidden = !setupCode;
        $('#managed-login-back').hidden = !setupCode;
        $('#managed-login-help').hidden = !!setupCode;
    }
    on('#managed-login-back', 'click', () => {
        setupCode = null;
        loginMode();
        notice('#managed-login-error', '');
        $('#managed-password').value = '';
        $('#managed-email').focus();
    });
    on('#managed-login-form', 'submit', async () => {
        const button = $('#managed-login-submit');
        if (button.disabled)
            return;
        button.disabled = true;
        button.textContent = '確認中…';
        notice('#managed-login-error', '');
        beginLogin();
        try {
            await api(setupCode ? '/auth/setup' : '/auth/login', 'POST', {
                email: $('#managed-email').value, password: $('#managed-password').value, ...(setupCode ? {
                    code: setupCode
                } : {})
            });
            setupCode = null;
            loginMode();
            await enter();
        }
        finally {
            $('#managed-password').value = '';
            button.disabled = false;
            loginMode();
        }
    });
    on('#managed-account-button', 'click', () => {
        $('#managed-account-email').textContent = getAccount().login.email ?? '';
        $('#managed-account-username').value = getAccount().login.email ?? '';
        $('#managed-password-form').hidden = !getAccount().login.passwordLogin;
        $('#managed-account-help').hidden = !!getAccount().login.passwordLogin;
        notice('#managed-account-error', '');
        notice('#managed-account-status', '');
        $('#managed-account').showModal();
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
    let ledgerCursor = 0;
    async function ledger() {
        const data = await api('/credits/ledger?after=' + ledgerCursor);
        const names = {
            grant: '追加', reserve: '確保', consume: '消費', release: '返却'
        };
        data.entries.forEach(e => {
            $('#managed-ledger').append(element('p', `${new Date(e.created).toLocaleString()} · ${names[e.kind]} ${e.amount}`));
            ledgerCursor = e.seq;
        });
        $('#managed-more').hidden = data.entries.length < 100;
    }
    on('#managed-credit-button', 'click', async () => {
        await balance();
        $('#managed-balance').textContent = `残高 ${getAccount().credits.available} / 確保中 ${getAccount().credits.held}`;
        $('#managed-ledger').replaceChildren();
        ledgerCursor = 0;
        await ledger();
        $('#managed-credits').showModal();
    });
    on('#managed-more', 'click', ledger);
    on('#managed-credits-close', 'click', () => $('#managed-credits').close());
    on('#managed-logout', 'click', async () => {
        await api('/session', 'DELETE');
        if ($('#managed-account').open) $('#managed-account').close();
        onLogout();
    });
    return {
        setupPending() {
            return !!setupCode;
        },
        initialize() {
            loginMode();
        },
        reset() {
            setupCode = null;
            loginMode();
            ledgerCursor = 0;
        },
    };
}
