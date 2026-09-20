import { errorText } from './messages.js';
/** HTTP transport only. Mutations are never retried: the server owns execution and billing. */
export function createClient(session, onSessionLost) {
    return async function api(path, method = 'GET', body, key) {
        const captured = session();
        const current = () => captured.generation === session().generation;
        let response;
        try {
            response = await fetch('/v1' + path, {
                method,
                credentials: 'same-origin',
                signal: AbortSignal.timeout(30000),
                headers: {
                    ...(captured.owner ? {
                        'x-oathra-account': captured.owner
                    } : {}),
                    'content-type': 'application/json',
                    ...(key ? {
                        'idempotency-key': key
                    } : {}),
                },
                ...(body ? {
                    body: JSON.stringify(body)
                } : {}),
            });
            const data = await response.json();
            if (!current())
                throw Object.assign(Error('ログイン状態が変わりました。'), {
                    stale: true
                });
            if (!response.ok)
                throw Object.assign(Error(errorText[data.error] ?? data.error ?? '処理できませんでした。'), {
                    status: response.status,
                    code: data.error,
                });
            return data;
        }
        catch (error) {
            if (!current())
                throw Object.assign(Error('ログイン状態が変わりました。'), {
                    stale: true
                });
            if (captured.owner && (error.code === 'unauthorized' || error.code === 'session_account_changed')) {
                onSessionLost?.();
                throw Object.assign(error, { stale: true });
            }
            if (error.status)
                throw error;
            throw Object.assign(Error('接続を確認できませんでした。状況を更新してください。'), {
                cause: error, status: response?.status
            });
        }
    };
}
