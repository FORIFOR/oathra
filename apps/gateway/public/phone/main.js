import { createAccount } from './account.js';
import { createClient } from './client.js';
import { createContacts } from './contacts.js';
import { $, $$ } from './dom.js';
import { element, notice } from './dom.js';
import { labels, stateLabel, errorText } from './messages.js';
import { usageText, costText, costBreakdown } from './receipt.js';
import { renderNews } from './news.js';
/* Managed adapter for the original Arena phone UI. Provider credentials never enter this page. */
(async function () {
    'use strict';
    $$('[data-i18n]').forEach(n => {
        if (Object.hasOwn(labels, n.dataset.i18n))
            n.textContent = labels[n.dataset.i18n];
    });
    document.documentElement.lang = 'ja';
    document.documentElement.classList.add('board');
    $('#phone-instruction').after($('label[for=phone-template]'), $('#phone-template'));
    $('#phone-number').placeholder = '電話番号を入力';
    $('#phone-name').placeholder = '友人・お店・会社など';
    $('#phone-instruction').placeholder = '伝えたいこと、確認したいこと';
    $('#home-practice').closest('.home-choice').hidden = true;
    $('#contacts-resume').hidden = true;
    const screens = {
        login: $('#managed-login'), home: $('#screen-home'), phone: $('#screen-real'), contacts: $('#screen-contacts')
    };
    let generation = 0, account = null, review = null, active = null, templates = [], pending = false, preparing = false, readiness = null, poll, expiry, current = 'login';
    const navigation = [];
    let activeState = null, conversationMode = 'message', selectedTemplate = '', loadVersion = 0, historyVersion = 0, controlPending = false;
    const ongoing = r => ['starting', 'running', 'stopping', 'unknown'].includes(r.state);
    const draftKey = () => account ? 'oathra:phone:' + account.user.id : null;
    function draftValues() {
        return {
            phone: $('#phone-number').value, name: $('#phone-name').value, instruction: $('#phone-instruction').value, conversationMode, selectedTemplate, active
        };
    }
    function saveDraft() {
        const key = draftKey();
        if (!key)
            return;
        try {
            sessionStorage.setItem(key, JSON.stringify(draftValues()));
        }
        catch { /* Storage can be disabled; the server still retains submitted drafts. */
        }
    }
    function savedDraft() {
        try {
            return JSON.parse(sessionStorage.getItem(draftKey()));
        }
        catch {
            return null;
        }
    }
    function clearDraft() {
        try {
            sessionStorage.removeItem(draftKey());
        }
        catch {
        }
    }
    function setActive(id) {
        active = id;
        loadVersion++;
        saveDraft();
    }
    let templateUndo = null;
    const undoTemplate = element('button', '前の入力に戻す');
    undoTemplate.id = 'phone-template-undo'; undoTemplate.className = $('#phone-clear').className; undoTemplate.type = 'button'; undoTemplate.hidden = true;
    $('#phone-template').after(undoTemplate);
    undoTemplate.addEventListener('click', () => {
        if (!templateUndo) return;
        $('#phone-instruction').value = templateUndo.instruction;
        if(templateUndo.phone !== undefined)$('#phone-number').value=templateUndo.phone;
        if(templateUndo.name !== undefined)$('#phone-name').value=templateUndo.name;
        chatMode(templateUndo.conversationMode, templateUndo.selectedTemplate);
        templateUndo = null; undoTemplate.hidden = true; invalidate(); saveDraft();
    });
    const chatNote = element('p');
    chatNote.id = 'phone-chat-note';
    chatNote.className = 'note';
    chatNote.hidden = true;
    $('#phone-template').after(chatNote);
    function chatMode(mode, selection = '') {
        conversationMode = mode === 'chat' ? 'chat' : 'message';
        selectedTemplate = selection;
        $('#phone-template').value = selection;
        chatNote.hidden = conversationMode !== 'chat';
        chatNote.textContent = readiness?.newsAvailable === false ? '雑談できます。この接続では最新ニュースの検索は使えません。' : (readiness?.creditQuote?.tariff?.settlement === 'usage-rate-v1' ? '雑談・ニュースの質問ができます。検索も使用量に応じて消費します。' : '雑談・ニュースの質問ができます。検索費用は運営者負担。');
    }
    const api = createClient(() => ({
        generation, owner: account?.user.id
    }), () => {
        resetSession(false);
        notice('#managed-login-error', 'ログインの有効期限が切れたか、別の端末で変更されました。もう一度ログインしてください。');
        $('#managed-email').focus();
    });
    function on(id, event, fn) {
        $(id).addEventListener(event, async (e) => {
            e.preventDefault();
            try {
                await fn(e);
            }
            catch (err) {
                if (err.stale)
                    return;
                notice(current === 'login' ? '#managed-login-error' : current === 'contacts' ? '#contacts-error' : '#phone-error', err.message);
            }
        });
    }
    function show(name, remember = true) {
        if (remember && current !== name && current !== 'login')
            navigation.push(current);
        current = name;
        $$('.screen').forEach(s => s.hidden = s !== screens[name]);
        document.body.classList.toggle('contacts-view', name === 'contacts');
        $('#navigation-back').disabled = name === 'login' || (name === 'home' && !navigation.length);
        $('#home-open').setAttribute('aria-pressed', String(name === 'home'));
        $('#contacts-open').setAttribute('aria-pressed', String(name === 'contacts'));
        $('.tt-btn[data-transport=real]').classList.toggle('is-on', name === 'phone');
        window.scrollTo({
            top: 0
        });
    }
    function resetSession(forgetDraft = true) {
        if (forgetDraft) clearDraft();
        generation++;
        loadVersion++;
        historyVersion++;
        accountView.reset();
        $('#managed-login-form').reset();
        $('#managed-account').close();
        $('#managed-password-form').reset();
        $('#managed-account-email').textContent = '';
        contactEditor.reset(forgetDraft);
        account = null;
        review = null;
        active = null;
        activeState = null;
        pending = false;
        preparing = false;
        controlPending = false;
        templates = [];
        templateUndo = null; undoTemplate.hidden = true;
        $('#contact-use').disabled = true;
        $('#contact-history').replaceChildren();
        $('#phone-live-recipient').textContent = '';
        $('#phone-live-summary').textContent = '';
        $('#phone-live-cost').textContent = '';
        $('#phone-cost-details')?.remove();
        $('#phone-live-credits').textContent = '';
        $('#phone-live-balance').textContent = '';
        clearTimeout(poll);
        clearTimeout(expiry);
        navigation.length = 0;
        $('#phone-form').reset();
        templateUndo = null; undoTemplate.hidden = true;
        chatMode('message');
        $('#phone-news')?.remove();
        $('#contact-form').reset();
        $('#phone-review-fields').replaceChildren();
        $('#phone-history-list').replaceChildren();
        $('#phone-live-transcript').replaceChildren();
        $('#phone-memory')?.remove();
        $('#contacts-list').replaceChildren();
        $('#managed-ledger').replaceChildren();
        $('#managed-credits').close();
        $('#phone-live').hidden = true;
        invalidate();
        document.body.classList.remove('managed-signed-in');
        show('login', false);
    }
    function invalidate() {
        review = null;
        clearTimeout(expiry);
        $('#phone-review').close();
        $('#phone-review').hidden = true;
    }
    const creditAvailability = element('p');
    creditAvailability.id = 'phone-credit-availability';
    creditAvailability.className = 'note';
    creditAvailability.setAttribute('role', 'status');
    $('#phone-readiness').after(creditAvailability);
    function availability() {
        const metered = readiness?.creditQuote?.tariff?.settlement === 'usage-rate-v1';
        creditAvailability.hidden = !metered || !account;
        if (!metered || !account) return;
        const {available, held} = account.credits;
        creditAvailability.textContent = available > 0 ? `利用可能 ${available} クレジット · 上限で自動終了` : held > 0 ? `現在 ${held} クレジットを通話に確保中です。終了・精算後に残高が戻ります。` : '残高がありません。クレジットを追加すると電話できます。';
        $('#phone-form button[type=submit]').disabled = preparing || pending || (readiness.ready && available === 0);
    }
    function readyView(r) {
        readiness = r;
        $('#phone-form button[type=submit]').textContent = r.ready ? '電話する' : '下書きを保存';
        $('#phone-readiness').replaceChildren(element('strong', r.ready ? '発信設定済み' : '現在は発信できません'));
        if (r.issues.length) {
            const details = element('details');
            details.append(element('summary', '詳細'));
            r.issues.forEach(i => details.append(element('p', i)));
            $('#phone-readiness').append(details);
        }
        availability();
    }
    function sync() {
        if (!review)
            return;
        const quote = review.mission.creditQuote;
        const minimumShort = quote.minimumAmount !== undefined && quote.amount < quote.minimumAmount;
        const ready = review.readiness.ready, expired = Date.now() > review.expiresAt, short = quote.amount > account.credits.available;
        $('#phone-setup').hidden = !!ready;
        $('#phone-dial').hidden = false;
        $('#phone-dial').textContent = ready ? `同意して電話する · ${review.mission.creditQuote.policy === 'provider-cost-v1' ? '最大 ' : ''}${review.mission.creditQuote.amount} クレジット` : '電話する（接続準備中）';
        $('#phone-dial').disabled = pending || !ready || expired || short || minimumShort;
        notice('#phone-dial-hint', pending ? '発信を受け付けています…' : !ready ? '下書きを保存しました。接続が整うと、この画面から発信できます。' : expired ? '確認の有効期限が切れました。戻ってもう一度確認してください。' : minimumShort ? `この番号への発信には最低 ${quote.minimumAmount} クレジットが必要です（利用可能 ${account.credits.available}）。` : short ? '残高が別の通話に確保されました。戻って残高を確認してください。' : 'ボタンを押すと、上記に同意して発信します。');
    }
    async function balance() {
        account.credits = await api('/credits');
        $('#managed-credit-button').textContent = `${account.credits.available} クレジット${account.credits.held ? `（確保中 ${account.credits.held}）` : ''}`;
        $('#phone-live-balance').textContent = `現在の残高：${account.credits.available} クレジット`;
        availability();
        if (review)
            sync();
    }
    async function history() {
        const version = ++historyVersion;
        const records = await api('/phone/history');
        if (version !== historyVersion)
            return records;
        $('#phone-history-list').replaceChildren();
        for (const r of records) {
            const li = element('li');
            li.className = 'phone-history-item';
            li.append(element('strong', r.request.name), element('span', `${new Date(r.createdAt).toLocaleString()} · ${stateLabel[r.state]}`), element('p', r.request.instruction));
            const usage = element('p', usageText(r));
            usage.className = 'phone-history-credits';
            li.append(usage);
            const cost = costText(r);
            if (cost)
                li.append(element('p', cost));
            const breakdown = costBreakdown(r);
            if (breakdown)
                li.append(breakdown);
            const actions = element('div');
            actions.className = 'phone-live-actions';
            for (const [label, fn] of [['目的だけ使う', () => reuse(r, false)], ['相手と目的を使う', () => reuse(r, true)], ['前回の内容を引き継ぐ', () => reuseMemory(r)], ['状況を見る', () => {
                        if (pending)
                            return;
                        setActive(r.id);
                        render(r);
                        show('phone');
                        $('#phone-live').scrollIntoView({
                            block: 'start'
                        });
                        schedule(r);
                        load(r.id).catch(e => { if (!e.stale && active === r.id) notice('#phone-live-error', e.message); });
                    }]]) {
                const b = element('button', label);
                b.type = 'button';
                b.className = 'btn';
                b.onclick = fn;
                actions.append(b);
            }
            li.append(actions);
            $('#phone-history-list').append(li);
        }
        if (!records.length)
            $('#phone-history-list').append(element('li', '履歴はまだありません。'));
        return records;
    }
    function reuse(r, all) {
        templateUndo = draftValues(); undoTemplate.hidden = false;
        if (all) {
            $('#phone-number').value = r.request.phone;
            $('#phone-name').value = r.request.name;
        }
        $('#phone-instruction').value = r.request.instruction;
        chatMode(r.request.conversationMode, r.request.conversationMode === 'chat' ? 'chat' : '');
        invalidate();
        saveDraft();
        show('phone');
        $('#phone-instruction').focus();
    }
    function reuseMemory(r) {
        const notes=(r.memory?.notes??[]).map(n=>`${n.field}: ${JSON.stringify(n.value??n.requested)}（${n.status==='verified'?'前回の会話で確認':'未確認'}）`).join('、');
        const text=r.request.instruction+'\n前回の通話メモ（今回の通話で再確認してください。予約成立の証明ではありません）：'+notes;
        if(text.length>2000){notice('#phone-error','引き継ぐ内容が長いため、通話メモから必要な条件を目的欄へコピーしてください。');return;}
        reuse({...r,request:{...r.request,instruction:text}},true);
    }
    function renderMemory(r) {
        let area=$('#phone-memory');
        if(!area){area=element('details');area.id='phone-memory';$('#phone-live-transcript').before(area);}
        const same=area.dataset.call===r.id, originalOpen=same&&area.querySelector('[data-memory=original]')?.open, changesOpen=same&&area.querySelector('[data-memory=changes]')?.open;
        if(!same)area.open=false;area.dataset.call=r.id;
        area.replaceChildren(element('summary','通話メモ'));
        if(!r.memory){area.hidden=true;return;}area.hidden=false;
        area.append(element('p','空席確認・伝言の記録です。予約成立を保証するものではありません。'));
        const labels={date:'日付',time:'時刻',partySize:'人数',price:'料金',confirmed:'相手の確認発言'};
        for(const n of r.memory.notes){
            const row=element('div');row.append(element('strong',labels[n.field]??n.field));
            if(n.requested!==undefined)row.append(element('p','希望：'+String(n.requested)));
            row.append(element('p',(n.status==='verified'?'会話で確認：':n.status==='proposed'?'提案・未確認：':'未確認：')+String(n.value??'回答なし')));
            if(n.quote)row.append(element('blockquote',n.quote));area.append(row);
        }
        if(!r.memory.notes.length)area.append(element('p','条件の回答はまだ記録されていません。'));
        const original=element('details');original.dataset.memory='original';original.open=!!originalOpen;original.append(element('summary','元の依頼'),element('p',r.memory.originalRequest));area.append(original);
        const changes=element('details');changes.dataset.memory='changes';changes.open=!!changesOpen;changes.append(element('summary','条件の変更履歴'));
        for(const n of r.memory.history)changes.append(element('p',`${n.source==='callee'?'相手':'AI'} · ${labels[n.field]??n.field}：${String(n.value)} — ${n.quote}`));area.append(changes);
    }
    function render(r) {
        renderNews(r);
        const oldCost = $('#phone-cost-details'), sameCall = oldCost?.dataset.callId === r.id, wasOpen = sameCall && oldCost.open, unitsOpen = sameCall && oldCost.querySelector('details')?.open;
        oldCost?.remove();
        const breakdown = costBreakdown(r);
        if (breakdown) {
            breakdown.id = 'phone-cost-details';
            breakdown.dataset.callId = r.id;
            breakdown.open = !!wasOpen;
            breakdown.querySelector('details').open = !!unitsOpen;
            $('#phone-live-cost').after(breakdown);
        }
        activeState = r.state;
        $('#phone-live').hidden = false;
        $('#phone-live-state').textContent = stateLabel[r.state];
        $('#phone-live-credits').textContent = usageText(r);
        $('#phone-live-cost').textContent = costText(r);
        $('#phone-live-balance').textContent = '';
        $('#phone-live-recipient').textContent = `${r.request.name} · ${r.request.phone}`;
        $('#phone-live-summary').textContent = r.summary ?? r.request.instruction;
        renderMemory(r);
        notice('#phone-live-error', r.state === 'unknown' ? '結果を確認できていません。再発信せず、通信会社の状態を確認してください。' : errorText[r.error] ?? (r.error?.startsWith('realtime_') ? '音声AIでエラーが発生し、通話を終了しました。管理者に確認を依頼してください。' : r.error));
        $('#phone-live-transcript').replaceChildren(...r.transcript.map(t => element('p', `${t.source === 'callee' ? r.request.name : 'AI'}：${t.text}`)));
        $('#phone-hangup').hidden = !['starting', 'running', 'stopping', 'unknown'].includes(r.state);
        $('#phone-hangup').disabled = controlPending || r.state === 'stopping';
        $('#phone-resolve').hidden = r.state !== 'unknown';
    }
    function schedule(r) {
        clearTimeout(poll);
        if (['starting', 'running', 'stopping'].includes(r.state) || r.creditUsage?.status === 'pending') {
            const session = generation;
            poll = setTimeout(async () => {
                try {
                    await load(r.id);
                }
                catch (e) {
                    if (e.stale || session !== generation || active !== r.id)
                        return;
                    notice('#phone-live-error', e.message);
                    // Only retry a read. Never repeat start/cancel on a lost response.
                    if (e.status !== 401 && e.status !== 404)
                        schedule({
                            ...r, creditUsage: {
                                status: 'pending'
                            }, state: 'unknown'
                        });
                }
            }, r.creditUsage?.status === 'pending' && !['starting', 'running', 'stopping'].includes(r.state) ? 5000 : 1500);
        }
    }
    async function load(id) {
        const version = ++loadVersion;
        const r = await api('/phone/calls/' + encodeURIComponent(id));
        if (active !== id || version !== loadVersion)
            return;
        render(r);
        schedule(r);
        await balance();
        if (!ongoing(r))
            await history();
    }
    async function enter() {
        const session = generation;
        account = await api('/bootstrap');
        [templates] = await Promise.all([api('/phone/templates'), balance()]);
        $('#phone-template').replaceChildren(element('option', '使わない'));
        $('#phone-template').firstChild.value = '';
        templates.forEach(t => {
            const o = element('option', t.title.ja);
            o.value = t.id;
            $('#phone-template').append(o);
        });
        readyView(await api('/phone/status'));
        const records = await history();
        $('#managed-password').value = '';
        const saved = savedDraft();
        if (saved && typeof saved === 'object') {
            for (const key of ['phone', 'name', 'instruction'])
                if (typeof saved[key] === 'string')
                    $('#phone-' + (key === 'phone' ? 'number' : key)).value = saved[key];
            chatMode(saved.conversationMode, templates.some(t => t.id === saved.selectedTemplate) ? saved.selectedTemplate : '');
        }
        const requested = new URLSearchParams(location.search).get('call');
        const resume = requested ?? (typeof saved?.active === 'string' ? saved.active : null) ?? records.find(ongoing)?.id;
        if (resume) {
            setActive(resume);
            await load(resume).catch(e => {
                if (!e.stale)
                    notice('#phone-error', e.status === 404 ? 'この通話は表示できません。履歴から選んでください。' : e.message);
            });
        }
        if (session !== generation) return;
        contactEditor.restore();
        document.body.classList.add('managed-signed-in');
        $('#managed-credit-button').hidden = false;
        $('#managed-logout').hidden = false;
        $('#managed-account-button').hidden = false;
        show('phone');
    }
    on('#home-open', 'click', () => show('home'));
    on('#home-phone', 'click', () => show('phone'));
    on('.tt-btn[data-transport=real]', 'click', () => show('phone'));
    on('#real-back', 'click', () => show('home'));
    on('#navigation-back', 'click', () => {
        show(navigation.pop() ?? 'home', false);
        screens[current].querySelector('h1,h2')?.setAttribute('tabindex', '-1');
        screens[current].querySelector('h1,h2')?.focus();
    });
    on('#phone-clear', 'click', () => {
        $('#phone-form').reset();
        templateUndo = null; undoTemplate.hidden = true;
        chatMode('message');
        invalidate();
        saveDraft();
        notice('#phone-error', '');
    });
    $('#phone-form').addEventListener('input', () => {
        invalidate();
        saveDraft();
    });
    on('#phone-template', 'change', () => {
        const t = templates.find(t => t.id === $('#phone-template').value);
        if (!t) {
            chatMode('message');
            invalidate();
            saveDraft();
            return;
        }
        templateUndo = { instruction: $('#phone-instruction').value, conversationMode, selectedTemplate };
        undoTemplate.hidden = false;
        chatMode(t.conversationMode, t.id);
        $('#phone-instruction').value = t.instruction.ja;
        invalidate();
        saveDraft();
        $('#phone-instruction').focus();
        const first=t.instruction.ja.indexOf('{{');
        $('#phone-instruction').setSelectionRange(first<0?0:first,first<0?0:t.instruction.ja.indexOf('}}',first)+2);
        $('#phone-instruction').scrollTop=0;
    });
    on('#phone-form', 'submit', async () => {
        if (pending || preparing)
            return;
        invalidate();
        saveDraft();
        notice('#phone-error', '');
        const values = {
            phone: $('#phone-number').value, name: $('#phone-name').value, instruction: $('#phone-instruction').value, ...(conversationMode === 'chat' ? {
                conversationMode: 'chat'
            } : {})
        }, session = generation;
        preparing = true;
        const button = $('#phone-form button[type=submit]');
        button.disabled = true;
        button.textContent = '確認中…';
        try {
            const result = await api('/phone/draft', 'POST', values);
            if (values.phone !== $('#phone-number').value || values.name !== $('#phone-name').value || values.instruction !== $('#phone-instruction').value || (values.conversationMode ?? 'message') !== conversationMode)
                return;
            review = {
                ...result, key: crypto.randomUUID(), expiresAt: Date.now() + result.expiresInSeconds * 1000
            };
            $('#phone-review-fields').replaceChildren();
            for (const [label, value] of [...(review.mission.phoneRequest.conversationMode === 'chat' ? [['会話', '雑談']] : []), ['電話番号', review.mission.target.phone], ['相手', review.mission.target.name], ['目的', review.mission.request], [review.mission.creditQuote.policy === 'provider-cost-v1' ? '最大確保' : '利用クレジット', String(review.mission.creditQuote.amount) + (review.mission.creditQuote.creditUsd ? `（1クレジット = $${review.mission.creditQuote.creditUsd}）` : '')], ['通話の上限', review.mission.maxSeconds + '秒'], ...(review.mission.creditQuote.tariff?.carrierFx ? [['円建て回線の換算', `1 USD = ${review.mission.creditQuote.tariff.carrierFx.unitsPerUsdNano / 1e9}円（${review.mission.creditQuote.tariff.carrierFx.date} 基準）`]] : [])])
                $('#phone-review-fields').append(element('dt', label), element('dd', value));
            const t = review.mission.creditQuote.tariff;
            if (t?.settlement === 'usage-rate-v1') {
                for (const [label, value] of [['回線', `${t.carrierRate.currency} ${t.carrierRate.perMinute}/分（${t.carrierRate.incrementSeconds}秒単位）`], ['音声AI', t.model + ' · 使用トークン数で計算'], ...(review.mission.phoneRequest.conversationMode === 'chat' ? [['検索', `1回 $${t.search.perCallNanoUsd / 1e9} ＋ ${t.search.model} の使用量`]] : [])])
                    $('#phone-review-fields').append(element('dt', label), element('dd', value));
            }
            $('#phone-disclosure').textContent = review.readiness.disclosure + (review.mission.phoneRequest.conversationMode === 'chat' ? (review.readiness.newsAvailable === false ? ' この接続では最新ニュースの検索は使えません。' : ` 雑談でニュースを聞かれると、公開ニュースのカテゴリをOpenAIのWeb検索へ送ります。ニュース確認は1通話2回まで。${t?.settlement === 'usage-rate-v1' ? '検索回数と使用トークン数を利用額に含めます。' : '検索費用は運営者負担です。'}出典は履歴に保存します。`) : '');
            $('#phone-review').hidden = false;
            sync();
            expiry = setTimeout(sync, review.expiresInSeconds * 1000);
            $('#phone-review').showModal();
            $('#phone-review-title').tabIndex = -1;
            $('#phone-review-title').focus();
            await history();
        }
        finally {
            if (session === generation) {
                preparing = false;
                button.disabled = false;
                button.textContent = readiness?.ready ? '電話する' : '下書きを保存';
                availability();
            }
        }
    });
    on('#phone-edit', 'click', () => {
        invalidate();
        $('#phone-instruction').focus();
    });
    on('#phone-review', 'cancel', () => {
        invalidate();
        $('#phone-instruction').focus();
    });
    on('#phone-setup', 'click', () => {
        invalidate();
        const d = $('#phone-readiness details');
        if (d) {
            d.open = true;
            d.querySelector('summary').focus();
            d.scrollIntoView({
                block: 'center'
            });
        }
    });
    on('#phone-dial', 'click', async () => {
        sync();
        if ($('#phone-dial').disabled || !review)
            return;
        const r = review, session = generation, id = r.mission.id;
        let dispatched = false, accepted = false;
        pending = true;
        sync();
        try {
            await api('/consent', 'POST', {
                version: r.consentVersion
            });
            dispatched = true;
            setActive(id);
            await api('/missions/' + id + '/start', 'POST', {
                approvalToken: r.approvalToken, acknowledged: true
            }, r.key);
            accepted = true;
            invalidate();
            await load(id);
            $('#phone-live').focus();
            $('#phone-live').scrollIntoView({
                block: 'start'
            });
        }
        catch (e) {
            if (session !== generation)
                return;
            invalidate();
            const rejected = !dispatched || (!accepted && e.code && e.status >= 400 && e.status < 500);
            if (rejected) {
                if (dispatched)
                    await load(id).catch(() => {
                    });
                notice('#phone-error', e.message + ' 発信は受け付けられていません。入力を確認してもう一度進めてください。');
                $('#phone-error').scrollIntoView({
                    block: 'center'
                });
            }
            else {
                // Once start was sent, a lost response requires a read, never an automatic new call.
                render({
                    id, state: 'unknown', request: r.mission.phoneRequest, transcript: []
                });
                await load(id).catch(() => {
                });
                if (session !== generation)
                    return;
                notice('#phone-live-error', e.message + ' 発信を繰り返さず状況を確認してください。');
                $('#phone-live').focus();
                $('#phone-live').scrollIntoView({
                    block: 'start'
                });
            }
        }
        finally {
            if (session === generation) {
                pending = false;
                availability();
            }
        }
    });
    async function control(action, body) {
        if (!active || controlPending)
            return;
        const id = active, session = generation;
        controlPending = true;
        $('#phone-hangup').disabled = true;
        $('#phone-resolve').disabled = true;
        try {
            await api('/missions/' + id + '/' + action, 'POST', body);
            if (active === id)
                await load(id);
        }
        catch (e) {
            if (!e.stale && active === id)
                notice('#phone-live-error', e.message);
        }
        finally {
            if (session === generation) {
                controlPending = false;
                $('#phone-hangup').disabled = activeState === 'stopping';
                $('#phone-resolve').disabled = false;
            }
        }
    }
    on('#phone-refresh', 'click', async () => {
        if (active)
            await load(active).catch(e => { if (!e.stale) notice('#phone-live-error', e.message); });
    });
    on('#phone-hangup', 'click', () => activeState === 'unknown' ? control('reconcile', {
        acknowledged: true, stop: true
    }) : control('cancel', {}));
    on('#phone-resolve', 'click', () => control('reconcile', {
        acknowledged: true
    }));
    on('#phone-history-refresh', 'click', history);
    const contactEditor = createContacts({
        api, on, show, owner: () => account?.user.id, onSelect(c) {
            $('#phone-number').value = c.phone;
            $('#phone-name').value = c.name || c.company;
            invalidate();
            saveDraft();
            show('phone');
            $('#phone-instruction').focus();
        }
    });
    const accountView = createAccount({
        api, on, enter, balance, getAccount: () => account, beginLogin() {
            account = null;
            generation++;
        }, onLogout: resetSession
    });
    accountView.initialize();
    show('login', false);
    if (accountView.setupPending()) {
        $('#managed-email').focus();
        return;
    }
    try {
        await enter();
    }
    catch (e) {
        if (e.status !== 401)
            notice('#managed-login-error', '接続できませんでした。再読み込みしてください。');
    }
})();
