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
            phone: $('#phone-number').value, name: $('#phone-name').value, instruction: $('#phone-instruction').value, conversationMode, selectedTemplate, voice: $('#phone-voice')?.value ?? '', active
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
    // Which voice speaks. The list comes from the server; a voice is fixed for the whole call.
    const voiceField = element('div'), voiceLabel = element('label', 'AIの声'), voiceSelect = element('select'), voiceNote = element('p', '声は通話の途中では変えられません。選んだ声はこの端末に覚えておきます。声の高さと速さは、同じ一文の録音を測った目安です。★ 推奨は、標準の声（実際の通話で確認済み）と、電話の音質に通しても正確に聞き取れ・音量が十分で・速さがふつうの声です。実際の印象は試聴で確かめてください。'), voicePreview = element('button', 'この声を試聴');
    voiceField.id = 'phone-voice-field'; voiceLabel.htmlFor = 'phone-voice'; voiceSelect.id = 'phone-voice'; voiceSelect.name = 'voice'; voiceNote.className = 'note'; voiceNote.id = 'phone-voice-note';
    voiceSelect.setAttribute('aria-describedby', 'phone-voice-note');
    voicePreview.type = 'button'; voicePreview.id = 'phone-voice-preview'; voicePreview.className = $('#phone-clear').className;
    voiceField.append(voiceLabel, voiceSelect, voicePreview, voiceNote);
    // How high and how fast, from the measured sample. Not who: a recording cannot say that.
    const pitchWord = { low: '低めの声（男性に多い高さ）', mid: '中くらいの高さの声', high: '高めの声（女性に多い高さ）', 'very-high': 'かなり高めの声' }, paceWord = { fast: 'やや速め', medium: 'ふつうの速さ', slow: 'ゆっくりめ' };
    const describeVoice = v => { const d = readiness?.voiceDetails?.[v]; return d ? `${d.recommended ? '★ 推奨 ' : ''}${v} — ${pitchWord[d.pitch]}・${paceWord[d.pace]}${d.quiet ? '・音量は小さめ' : ''}` : v; };
    let previewAudio = null;
    voicePreview.addEventListener('click', () => {
        const sample = readiness?.voiceDetails?.[voiceSelect.value]?.sample;
        if (!sample) return;
        previewAudio?.pause();
        previewAudio = new Audio(sample);
        voicePreview.textContent = '再生中…';
        const reset = () => { voicePreview.textContent = 'この声を試聴'; };
        previewAudio.addEventListener('ended', reset); previewAudio.addEventListener('error', () => { reset(); notice('#phone-error', '試聴を再生できませんでした。'); });
        previewAudio.play().catch(reset);
    });
    // After the template's own undo, so that control stays beside the field it belongs to.
    undoTemplate.after(voiceField);
    const voiceKey = () => account ? 'oathra:phone-voice:' + account.user.id : null;
    const voices = () => readiness?.voices ?? [], defaultVoice = () => readiness?.defaultVoice ?? voices()[0] ?? '';
    function setVoice(value) {
        voiceSelect.value = voices().includes(value) ? value : defaultVoice();
    }
    function rememberedVoice() {
        try { return voiceKey() ? localStorage.getItem(voiceKey()) : null; } catch { return null; }
    }
    voiceSelect.addEventListener('change', () => {
        try { if (voiceKey()) localStorage.setItem(voiceKey(), voiceSelect.value); } catch { /* A private window still uses the choice for this call. */ }
        invalidate(); saveDraft();
    });
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
        setVoice(rememberedVoice());
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
    // Why the main button is unavailable is said right under it, not a screen away.
    const submitReason = element('p');
    submitReason.id = 'phone-submit-reason';
    submitReason.className = 'note';
    submitReason.setAttribute('role', 'status');
    submitReason.hidden = true;
    $('#phone-form button[type=submit]').after(submitReason);
    function availability() {
        const metered = readiness?.creditQuote?.tariff?.settlement === 'usage-rate-v1';
        // A call whose result is unknown must be checked first; a second dial could ring the same person twice.
        const unresolved = activeState === 'unknown';
        $('#phone-form button[type=submit]').disabled = preparing || pending || unresolved;
        submitReason.hidden = true;
        if (unresolved) {
            submitReason.textContent = '前の電話の結果を確認するまで、新しい電話はかけられません。下の「電話の状況」をご覧ください。';
            submitReason.hidden = false;
            creditAvailability.hidden = false;
            creditAvailability.textContent = '前の電話の結果を確認できていません。下の「電話の状況」で確認が済むまで、新しい電話はかけられません。';
            return;
        }
        creditAvailability.hidden = !metered || !account;
        if (!metered || !account) return;
        const {available, held} = account.credits;
        if (readiness.ready && available === 0) {
            submitReason.textContent = held > 0 ? '残高を別の通話に確保中です。精算が終わるとかけられます。' : '残高がありません。管理者にクレジットの追加を依頼してください。';
            submitReason.hidden = false;
        }
        creditAvailability.textContent = available > 0 ? `残高 ${available} クレジット · 上限に達すると自動で終了します` : held > 0 ? `現在 ${held} クレジットを通話に確保中です。終了・精算後に残高が戻ります。` : '残高がありません。クレジットを追加すると電話できます。';
        $('#phone-form button[type=submit]').disabled = preparing || pending || (readiness.ready && available === 0);
    }
    function readyView(r) {
        readiness = r;
        if (voiceSelect.options.length !== voices().length) {
            const keep = voiceSelect.value;
            const option = v => { const o = element('option', describeVoice(v) + (v === defaultVoice() ? '（標準）' : '')); o.value = v; return o; };
            // Grouped by how high the voice is; inside a group the recommended voice comes first, then lowest first.
            const details = r.voiceDetails ?? {}, groups = [['低めの声', ['low']], ['中くらいの高さの声', ['mid']], ['高めの声', ['high', 'very-high']]];
            const grouped = groups.map(([label, kinds]) => { const g = element('optgroup'); g.label = label; g.append(...voices().filter(v => kinds.includes(details[v]?.pitch)).sort((a, b) => (details[b].recommended ? 1 : 0) - (details[a].recommended ? 1 : 0) || details[a].pitchHz - details[b].pitchHz).map(option)); return g; }).filter(g => g.children.length);
            voiceSelect.replaceChildren(...grouped, ...voices().filter(v => !details[v]).map(option));
            voicePreview.hidden = !Object.keys(r.voiceDetails ?? {}).length;
            setVoice(keep || rememberedVoice());
        }
        voiceField.hidden = voices().length < 2;
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
    /** What an ordinary caller needs first; exact unit prices stay one tap away for anyone who wants to check them. */
    function renderReview() {
        const m = review.mission, quote = m.creditQuote, t = quote.tariff, chat = m.phoneRequest.conversationMode === 'chat';
        const minutes = Math.floor(m.maxSeconds / 60), limit = minutes >= 1 && m.maxSeconds % 60 === 0 ? `最長${minutes}分（${m.maxSeconds}秒）` : `最長${m.maxSeconds}秒`;
        const purpose = element('dd', m.request);
        purpose.className = 'phone-review-purpose';
        const fields = $('#phone-review-fields');
        fields.replaceChildren();
        for (const [label, value] of [...(chat ? [['会話', '雑談']] : []), ['電話番号', m.target.phone], ['相手', m.target.name]])
            fields.append(element('dt', label), element('dd', value));
        fields.append(element('dt', '目的'), purpose);
        if (m.request.length > 90) {
            const more = element('button', '全文を表示');
            more.type = 'button';
            more.className = 'phone-review-more';
            more.setAttribute('aria-expanded', 'false');
            more.addEventListener('click', () => {
                const open = purpose.classList.toggle('open');
                more.textContent = open ? '短く表示' : '全文を表示';
                more.setAttribute('aria-expanded', String(open));
            });
            fields.append(more);
        }
        // A chosen voice is confirmed on the same line as the length: one more row would push what is being agreed to out of the first view.
        const chosenVoice = m.phoneRequest.voice && m.phoneRequest.voice !== defaultVoice() ? m.phoneRequest.voice : null;
        fields.append(element('dt', chosenVoice ? '通話の長さ・声' : '通話の長さ'), element('dd', chosenVoice ? `${limit} · AIの声 ${chosenVoice}` : limit));
        $('#phone-cost-summary')?.remove();
        $('#phone-price-details')?.remove();
        const summary = element('p');
        summary.id = 'phone-cost-summary';
        const yen = usd => t?.carrierFx ? `（約${Math.round(usd * t.carrierFx.unitsPerUsdNano / 1e9).toLocaleString('ja-JP')}円）` : '';
        if (t?.settlement === 'usage-rate-v1') {
            const perMinuteNano = t.carrierRate.perMinuteNanoUsd + t.mediaPerMinuteNanoUsd + t.voicePerMinuteNanoUsd;
            const tooLittle = quote.minimumAmount !== undefined && quote.amount < quote.minimumAmount;
            const ceiling = quote.spendingLimit === 'balance-v1' && account?.credits && quote.amount >= account.credits.available ? `いまの残高 ${quote.amount} クレジット${yen(quote.amount * quote.creditUsd)}` : `1回の通話の上限 ${quote.amount} クレジット${yen(quote.amount * quote.creditUsd)}`;
            summary.append(element('strong', `1分あたり 約${Math.ceil(perMinuteNano / t.creditNanoUsd)}クレジット${yen(perMinuteNano / 1e9)}`),
                element('span', tooLittle ? `いまの残高 ${quote.amount} クレジットでは、この番号への最初の1分に足りません。` : `${ceiling}を一時的に確保します。そこに達すると通話は自動で終わり、使わなかった分は通話後すぐに返却します。${chat ? 'ニュースなどを調べた場合は、1回につき数クレジットが加わります。' : ''}`));
        } else if (quote.policy === 'provider-cost-v1')
            summary.append(element('strong', `最大 ${quote.amount} クレジット${yen(quote.amount * quote.creditUsd)}を一時的に確保`), element('span', '通話後に実際の料金で精算し、使わなかった分を返却します。'));
        else
            summary.append(element('strong', `${quote.amount} クレジットを使います`));
        const prices = element('details');
        prices.id = 'phone-price-details';
        const list = element('dl');
        const rows = [];
        if (quote.creditUsd) rows.push(['1クレジット', `$${quote.creditUsd}`]);
        if (t?.settlement === 'usage-rate-v1') {
            const carrier = t.carrierRate.currency === 'JPY' ? `${t.carrierRate.perMinute}円/分` : `$${t.carrierRate.perMinute}/分`;
            rows.push(['電話回線', `${carrier}（${t.carrierRate.incrementSeconds}秒単位）`], ['音声の中継', `$${t.mediaPerMinuteNanoUsd / 1e9}/分`], ['音声AI', `$${t.voicePerMinuteNanoUsd / 1e9}/分（1分単位・${t.model}）`]);
            if (chat) rows.push(['検索', `1回 $${t.search.perCallNanoUsd / 1e9} ＋ 検索AI（${t.search.model}）の使用量`]);
        }
        if (t?.carrierFx) rows.push(['円とドルの換算', `1 USD = ${t.carrierFx.unitsPerUsdNano / 1e9}円（${t.carrierFx.date} 基準）`]);
        for (const [label, value] of rows) list.append(element('dt', label), element('dd', value));
        prices.append(element('summary', '料金の内訳'), list);
        // Nothing to unfold under the fixed per-call price.
        fields.after(summary, ...(rows.length ? [prices] : []));
        const news = chat ? (review.readiness.newsAvailable === false ? ' この接続では最新ニュースの検索は使えません。' : ` 雑談でニュースや調べものを頼まれると、公開ニュースのカテゴリ、または「任天堂 株価」のような公開されている短い検索語をOpenAIのWeb検索へ送ります。相手やあなたの名前・電話番号・住所、会話の文そのものは送りません。ニュース・天気・イベントの確認は1通話8回まで。${t?.settlement === 'usage-rate-v1' ? '検索回数と使用トークン数を利用額に含めます。' : '検索費用は運営者負担です。'}出典は履歴に保存します。`) : '';
        // The full disclosure stays in view before consent; one sentence per line instead of a single block.
        const points = element('ul');
        for (const sentence of (review.readiness.disclosure + news).split('。').map(x => x.trim()).filter(Boolean)) points.append(element('li', sentence + '。'));
        $('#phone-disclosure').replaceChildren(points);
    }
    function sync() {
        if (!review)
            return;
        const quote = review.mission.creditQuote;
        const minimumShort = quote.minimumAmount !== undefined && quote.amount < quote.minimumAmount;
        const ready = review.readiness.ready, expired = Date.now() > review.expiresAt, short = quote.amount > account.credits.available;
        $('#phone-setup').hidden = !!ready;
        $('#phone-dial').hidden = false;
        $('#phone-dial').textContent = !ready ? '電話する（接続準備中）' : minimumShort ? 'クレジットが足りません' : `同意して電話する · ${review.mission.creditQuote.policy === 'provider-cost-v1' ? '最大 ' : ''}${review.mission.creditQuote.amount} クレジット`;
        $('#phone-dial').disabled = pending || !ready || expired || short || minimumShort;
        $('#phone-dial-hint').classList.toggle('blocked', !pending && !!ready && (expired || short || minimumShort));
        notice('#phone-dial-hint', pending ? '発信を受け付けています…' : !ready ? '下書きを保存しました。接続が整うと、この画面から発信できます。' : expired ? '確認の有効期限が切れました。戻ってもう一度確認してください。' : minimumShort ? `クレジットが足りません。この番号への発信には最低 ${quote.minimumAmount} クレジットが必要です（残高 ${account.credits.available}）。管理者にクレジットの追加を依頼してください。` : short ? '残高が別の通話に確保されました。戻って残高を確認してください。' : 'AI代理であることを相手に伝え、番号・音声・文字起こしを Twilio と OpenAI へ送り、会話を保存します。この説明に同意して発信します。');
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
        if (all) setVoice(r.request.voice ?? defaultVoice());
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
        // The memo is the result, not part of the transcript: it sits above that fold, never inside it.
        if(!area){area=element('details');area.id='phone-memory';$('#phone-live-transcript').closest('details').before(area);}
        const same=area.dataset.call===r.id, originalOpen=same&&area.querySelector('[data-memory=original]')?.open, changesOpen=same&&area.querySelector('[data-memory=changes]')?.open;
        // What was confirmed and what is only an offer is what the caller came for: shown without a tap once there is something to show.
        if(!same)area.open=!!r.memory?.notes?.length;area.dataset.call=r.id;
        area.replaceChildren(element('summary','通話メモ'));
        // Nothing has been said about the conditions yet: an empty fold during a call only adds noise.
        if(!r.memory||(!r.memory.notes.length&&['starting','running','stopping'].includes(r.state))){area.hidden=true;return;}area.hidden=false;
        area.append(element('p','空席確認・伝言の記録です。予約成立を保証するものではありません。'));
        const labels={date:'日付',time:'時刻',partySize:'人数',price:'料金',confirmed:'相手の確認発言'};
        // The verdict first: what the other side confirmed, and what is still open. The cards below are the evidence for it.
        if(r.memory.notes.length){
            const names=list=>list.map(n=>labels[n.field]??n.field).join('・')||'なし';
            const verdict=element('div');verdict.id='phone-memory-verdict';
            verdict.append(element('p','確認できたこと：'+names(r.memory.notes.filter(n=>n.status==='verified'))),element('p','まだ決まっていないこと：'+names(r.memory.notes.filter(n=>n.status!=='verified'))));
            area.append(verdict);
        }
        for(const n of r.memory.notes){
            const row=element('div');row.append(element('strong',labels[n.field]??n.field));
            if(n.requested!==undefined)row.append(element('p','希望：'+String(n.requested)));
            const asRequested=n.status==='proposed'&&n.requested!==undefined&&String(n.requested)===String(n.value);
            row.append(element('p',(n.status==='verified'?'会話で確認：':n.status==='proposed'?'提案・未確認：':'未確認：')+String(n.value??'回答なし')+(asRequested?'（希望どおりですが、相手の確定はまだです）':'')));
            // Whose words these are decides how much they prove.
            if(n.quote)row.append(element('blockquote',`${n.source==='callee'?'相手':'AI'}：「${n.quote}」`));area.append(row);
        }
        if(!r.memory.notes.length)area.append(element('p','条件の回答はまだ記録されていません。'));
        // A date and a time are enough for the caller's own calendar. The file says whether they were confirmed or only offered.
        const value=field=>r.memory.notes.find(n=>n.field===field)?.value;
        if(/^\d{4}-\d{2}-\d{2}$/.test(String(value('date')??''))&&/^\d{2}:\d{2}$/.test(String(value('time')??''))){
            const settled=['date','time'].every(f=>r.memory.notes.find(n=>n.field===f)?.status==='verified');
            const add=element('a','予定に追加（カレンダー用ファイル）');add.id='phone-calendar';add.className='btn';add.href='/v1/phone/calls/'+encodeURIComponent(r.id)+'/calendar.ics';add.setAttribute('download','oathra-phone-memo.ics');
            area.append(add,element('p',settled?'電話で確認した日時として追加します。予約の成立を保証するものではありません。':'まだ確定していない日時です。「未確定」の予定として追加します。'));
        }
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
        $('#phone-live-summary').textContent = r.summary ?? '';
        $('#phone-live-summary').hidden = !r.summary;
        $('#phone-live-request-text').textContent = r.request.instruction;
        renderMemory(r);
        notice('#phone-live-error', r.state === 'unknown' ? '結果を確認できていません。再発信せず、通信会社の状態を確認してください。' : r.state === 'failed' && !r.error ? '通話が途中で終わりました。つながっていた時間の分だけクレジットを使っています。下の会話の記録を確認し、必要ならもう一度かけてください。' : errorText[r.error] ?? (r.error?.startsWith('realtime_') ? '音声AIでエラーが発生し、通話を終了しました。管理者に確認を依頼してください。' : r.error));
        $('#phone-live-transcript').replaceChildren(...r.transcript.map(t => element('p', `${t.source === 'callee' ? r.request.name : 'AI'}：${t.text}`)));
        $('#phone-hangup').hidden = !['starting', 'running', 'stopping', 'unknown'].includes(r.state);
        $('#phone-hangup').disabled = controlPending || r.state === 'stopping';
        $('#phone-resolve').hidden = r.state !== 'unknown';
        $('#phone-resolve').classList.toggle('primary', r.state === 'unknown');
        availability();
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
            if (typeof saved.voice === 'string' && saved.voice) setVoice(saved.voice);
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
        setVoice(rememberedVoice());
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
            } : {}), ...(voiceSelect.value && voiceSelect.value !== defaultVoice() ? { voice: voiceSelect.value } : {})
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
            renderReview();
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
