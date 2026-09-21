import { $, element } from './dom.js';
export function usageText(r) {
    const u = r.creditUsage;
    if (!u)
        return '消費クレジット：未確認';
    if (u.status === 'waived')
        return `今回の消費：0 クレジット（運営者負担・${u.released} 返却）`;
    if (u.status === 'pending' && r.spending && ['starting', 'running', 'stopping'].includes(r.state))
        return `通話の利用：${Math.min(r.spending.consumed, r.spending.limit)} / ${r.spending.limit} クレジット（上限で自動終了）`;
    if (u.status === 'pending')
        return `精算待ち · ${u.held} クレジット確保中`;
    // "返却：377" alone reads as credits being added; say what it was returned from.
    const detail = u.held ? `（確保中：${u.held}）` : u.released ? `（確保 ${u.consumed + u.released} のうち返却：${u.released}）` : '';
    return `今回の消費：${u.consumed} クレジット${detail}`;
}
export function costText(r) {
    const c = r.creditUsage?.cost;
    if (c?.basis === 'usage-rate-v1')
        return `通話 ${c.durationSeconds}秒 · 利用額 ${c.creditUsd ? `約${(c.totalNanoUsd / 1e9 / c.creditUsd).toFixed(1)}クレジット（` : ''}${c.unitRates?.carrierFx ? `約${Math.round(c.totalNanoUsd / 1e9 * c.unitRates.carrierFx.unitsPerUsdNano / 1e9)}円・` : ''}$${(c.totalNanoUsd / 1e9).toFixed(3)}${c.creditUsd ? '）' : ''}`;
    const seconds = c?.durationSeconds ?? r.billing?.durationSeconds;
    const time = Number.isFinite(seconds) ? `通話 ${seconds}秒` : '';
    if (!c)
        return time;
    return `${time} · 回線 ${c.carrierCurrency === 'JPY' ? `¥${Math.abs(Number(c.carrierAmount))}（$${(c.carrierNanoUsd / 1e9).toFixed(5)}換算）` : `$${(c.carrierNanoUsd / 1e9).toFixed(5)}`} ＋ 音声AI $${(c.aiNanoUsd / 1e9).toFixed(5)}${c.capped ? '（承認上限を適用）' : ''}`;
}
export function costBreakdown(r) {
    const c = r.creditUsage?.cost;
    if (c?.basis !== 'usage-rate-v1')
        return null;
    const details = element('details');
    details.className = 'phone-cost-details';
    details.append(element('summary', '利用内訳'));
    // Three decimals are enough to read; the exact unit prices and quantities are one level down.
    // Credits first, because that is what the balance is counted in; dollars stay for anyone checking the rates.
    const usd = n => '$' + (n / 1e9).toFixed(6), short = n => `${c.creditUsd ? `約${(n / 1e9 / c.creditUsd).toFixed(1)}クレジット（` : ''}$${(n / 1e9).toFixed(3)}${c.creditUsd ? '）' : ''}`, list = element('dl');
    for (const [label, value] of [['電話回線', short(c.carrierNanoUsd)], ['音声の中継', c.excluded?.includes('unmeasured-media-usage') ? '運営者負担' : short(c.mediaNanoUsd)], ['音声AI', short(c.aiNanoUsd)], [`検索 ${c.searchCalls}回`, short(c.searchNanoUsd)]])
        list.append(element('dt', label), element('dd', value));
    details.append(list);
    const u = r.creditUsage, held = Number.isFinite(u?.consumed) && Number.isFinite(u?.released) ? u.consumed + u.released : null;
    details.append(element('p', `通話の前に${held ? ` ${held} クレジットを` : ''}確保しました（1回の通話の上限と、そのときの残高の小さいほう）。実際に使った分だけを消費し、残りは通話の直後に返却しています。`));
    const rates = c.unitRates, q = c.quantities, units = element('details');
    units.append(element('summary', '単価・使用量'));
    details.append(units);
    units.append(element('p', `回線：${q.carrierBilledSeconds}課金秒（${rates.carrier.incrementSeconds}秒単位） × ${rates.carrier.currency} ${rates.carrier.perMinute}/分`));
    if (!c.excluded?.includes('unmeasured-media-usage'))
        units.append(element('p', `音声中継：${Math.ceil(q.mediaSeconds / 60)}分 × ${usd(rates.mediaPerMinuteNanoUsd)}/分`));
    if (rates.voicePerMinuteNanoUsd)
        units.append(element('p', `音声AI（${c.voiceModel}）：${Math.ceil(q.voiceSeconds / 60)}分 × ${usd(rates.voicePerMinuteNanoUsd)}/分`));
    const names = {
        inputText: '入力テキスト', inputAudio: '入力音声', cachedText: 'キャッシュテキスト', cachedAudio: 'キャッシュ音声', outputText: '出力テキスト', outputAudio: '出力音声'
    };
    // Calls settled under the earlier token tariff keep their recorded quantities.
    for (const [k, n] of Object.entries(q.voice ?? {}))
        if (n)
            units.append(element('p', `${names[k]}：${n} tokens × $${rates.voice[k] / 1000}/100万tokens`));
    units.append(element('p', `検索：${c.searchCalls}回 × ${usd(rates.search.perCallNanoUsd)} ＋ ${c.searchModel} ${usd(c.searchTokensNanoUsd)}`));
    for (const [k, label] of [['input', '入力'], ['cached', 'キャッシュ'], ['output', '出力']])
        if (q.search[k])
            units.append(element('p', `検索${label}：${q.search[k]} tokens × $${rates.search.rates[k] / 1000}/100万tokens`));
    if (rates.carrierFx)
        units.append(element('p', `換算：1 USD = ${rates.carrierFx.unitsPerUsdNano / 1e9}円（${rates.carrierFx.date}）`));
    units.append(element('p', `1クレジット = $${c.creditUsd}。合計を切り上げ${c.capped ? '、承認上限を適用' : ''}。単価 ${c.tariff}。`));
    if (c.excluded?.length)
        units.append(element('p', '取得できなかった使用量の費用は運営者が負担しました。'));
    units.append(element('p', '使用量と単価によるサービス利用額です。後日の追加徴収はありません。'));
    return details;
}
