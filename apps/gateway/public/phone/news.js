import { $, element } from './dom.js';
export function renderNews(r) {
    let area = $('#phone-news');
    if (!area) {
        area = element('details');
        area.id = 'phone-news';
        $('#phone-live-transcript').after(area);
    }
    area.hidden = !r.news?.length;
    area.replaceChildren(element('summary', '調べたニュース・イベント'));
    for (const result of r.news ?? []) {
        const article = element('div');
        article.append(element('p', new Date(result.checkedAt).toLocaleString() + ' · ' + (result.status === 'verified' ? '検索結果' : result.reason === 'cancelled' ? '検索が中断されました' : result.reason === 'timeout' ? '検索が時間切れになりました' : '情報を確認できませんでした')));
        if (result.status === 'verified') {
            article.append(element('p', result.text));
            for (const source of result.sources ?? []) {
                try {
                    const url = new URL(source.url);
                    if (url.protocol !== 'https:' || url.username || url.password)
                        continue;
                    const a = element('a', source.title);
                    a.href = url.href;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    article.append(a, element('br'));
                }
                catch {
                }
            }
        }
        area.append(article);
    }
}
