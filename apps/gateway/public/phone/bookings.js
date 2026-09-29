import { $, element, notice } from './dom.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const day = iso => new Date(iso + 'T00:00:00Z');
const addDays = (iso, n) => new Date(day(iso).getTime() + n * 86400_000).toISOString().slice(0, 10);
const dayLabel = (iso, today) => iso === today ? '今日' : iso === addDays(today, 1) ? '明日' : `${day(iso).getUTCMonth() + 1}/${day(iso).getUTCDate()}`;
const longLabel = iso => `${day(iso).getUTCMonth() + 1}月${day(iso).getUTCDate()}日（${WEEKDAYS[day(iso).getUTCDay()]}）`;
const clock = t => t.endsWith(':00') ? `${Number(t.slice(0, 2))}時` : t.endsWith(':30') ? `${Number(t.slice(0, 2))}時半` : t;

/** The restaurant's ledger as the desk wrote it: read-only, one day at a time, with what is still free. */
export function createBookings({ api, on, show, openCall }) {
    let data = null, selected = null, query = '', version = 0, observer = null;
    const closed = iso => data.restaurant.closedDates.includes(iso) || data.restaurant.closedWeekdays.includes(day(iso).getUTCDay());
    const matches = b => !query || b.name.normalize('NFKC').includes(query.normalize('NFKC'));
    const days = () => [...new Set([...Array.from({ length: 7 }, (_, i) => addDays(data.today, i)), ...data.bookings.map(b => b.date)])].sort();

    function chip(b) {
        const button = element('button'); button.type = 'button'; button.className = 'bk-booking';
        const who = element('span', b.name + ' 様'); who.className = 'bk-who';
        const party = element('span', b.partySize + '名'); party.className = 'bk-party';
        const arrow = element('span', '→'); arrow.className = 'bk-arrow'; arrow.setAttribute('aria-hidden', 'true');
        button.append(who, party, arrow);
        button.setAttribute('aria-label', `${b.name}様 ${b.partySize}名、${clock(b.time)}。この予約を受けた通話を開く`);
        button.addEventListener('click', () => openCall(b.callId));
        return button;
    }
    function seats(total, taken) {
        const wrap = element('span'); wrap.className = 'bk-seats'; wrap.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < total; i++) { const dot = element('i'); if (i < taken) dot.className = 'on'; wrap.append(dot); }
        return wrap;
    }
    function agenda() {
        const board = $('#bookings-board'), list = element('ol'); list.className = 'bk-slots';
        // The list scrolls inside its frame on a long evening, so the keyboard has to be able to reach it.
        list.tabIndex = 0; list.setAttribute('aria-label', '時刻ごとの予約');
        const booked = data.bookings.filter(b => b.date === selected), shut = closed(selected);
        if (shut && !booked.length) { const p = element('p', '休業日のため、この日の席は表示していません。'); p.className = 'bk-shut'; board.replaceChildren(p); return; }
        // A booking taken at a time that has since left the settings still has to be seen.
        for (const time of [...new Set([...Object.keys(data.restaurant.slots), ...booked.map(b => b.time)])].sort()) {
            const tables = data.restaurant.slots[time] ?? 0;
            const here = booked.filter(b => b.time === time), left = Math.max(0, tables - here.length), row = element('li');
            // A closed day only lists what was booked before it was closed; it never shows tables as free.
            if (shut && !here.length) continue;
            row.className = 'bk-slot' + (left === 0 && tables > 0 && !shut ? ' full' : '');
            const t = element('span', clock(time)); t.className = 'bk-time';
            const state = element('span', shut ? '休業（休業前の予約）' : tables === 0 ? 'いまは受け付けていない時刻' : left === 0 ? '満席' : `残り${left}卓`); state.className = 'bk-left';
            const occupancy = element('span'); occupancy.className = 'bk-occupancy'; if (!shut && tables > 0) occupancy.append(seats(tables, here.length)); occupancy.append(state);
            const names = element('span'); names.className = 'bk-names';
            const shown = here.filter(matches);
            if (shown.length) names.append(...shown.map(chip)); else { const none = element('span', here.length ? '該当なし' : '予約なし'); none.className = 'bk-none'; names.append(none); }
            row.append(t, occupancy, names); list.append(row);
        }
        board.replaceChildren(list);
        // A long evening scrolls inside the frame: say there is more below, and open on the first booking of the day.
        const more = () => { board.classList.toggle('bk-more', list.scrollHeight - list.scrollTop - list.clientHeight > 4); board.classList.toggle('bk-above', list.scrollTop > 4); };
        list.addEventListener('scroll', more, { passive: true });
        // The list also changes height without a redraw: an error line appears, the window is resized.
        if (typeof ResizeObserver === 'function') { observer?.disconnect(); observer = new ResizeObserver(more); observer.observe(list); }
        const first = list.querySelector('.bk-booking')?.closest('.bk-slot');
        if (first && list.scrollHeight > list.clientHeight) list.scrollTop = Math.max(0, first.offsetTop - list.offsetTop - first.offsetHeight);
        more();
    }
    function render() {
        if (!data?.restaurant) return;
        $('#bookings-restaurant').textContent = `${data.restaurant.name}・AIが電話で予約を受けています`;
        const total = data.bookings.length, guests = data.bookings.reduce((n, b) => n + b.partySize, 0);
        $('#bookings-summary').textContent = total ? `これからの予約は${total}件、${guests}名です。1組は${data.restaurant.maxParty}名まで受けています。` : `これからの予約はまだありません。店の番号に電話がかかり、AIが予約を受けるとここに並びます。`;
        const strip = $('#bookings-days'), keepFocus = strip.contains(document.activeElement);
        const found = query ? data.bookings.filter(matches) : [];
        strip.replaceChildren(...days().map(d => {
            const b = element('button'); b.type = 'button'; b.className = 'bk-daychip'; b.setAttribute('aria-pressed', String(d === selected));
            const count = data.bookings.filter(x => x.date === d).length, hits = found.filter(x => x.date === d).length;
            if (query && !hits) b.classList.add('bk-dim');
            const top = element('span', dayLabel(d, data.today)); top.className = 'bk-daychip-day';
            const sub = element('span', query ? (hits ? `該当${hits}件` : '該当なし') : closed(d) ? '休業' : `${WEEKDAYS[day(d).getUTCDay()]}・${count}件`); sub.className = 'bk-daychip-sub';
            b.append(top, sub); b.addEventListener('click', () => { selected = d; render(); });
            return b;
        }));
        // Choosing a day redraws the strip; the keyboard stays on the day that was chosen.
        if (keepFocus) strip.querySelector('[aria-pressed=true]')?.focus();
        const here = data.bookings.filter(b => b.date === selected);
        $('#bookings-day-title').textContent = longLabel(selected);
        const elsewhere = [...new Set(found.filter(b => b.date !== selected).map(b => b.date))].sort();
        $('#bookings-day-note').textContent = query ? (found.length === 0 ? `「${query}」に一致する予約は、これからの予約の中にありません。`
            : (found.some(b => b.date === selected) ? `この日に${found.filter(b => b.date === selected).length}件。` : 'この日にはありません。') + (elsewhere.length ? `ほかに ${elsewhere.map(d => dayLabel(d, data.today)).join('、')} にあります。` : ''))
            : closed(selected) ? 'この日は休業日です。AIは予約を受けません。' : here.length ? `${here.length}件・${here.reduce((n, b) => n + b.partySize, 0)}名` : 'この日の予約はまだありません。';
        agenda();
        $('#bookings-board').classList.toggle('bk-closed', closed(selected));
    }
    async function load() {
        const mine = ++version, button = $('#bookings-refresh');
        button.disabled = true; button.textContent = '確認しています…'; notice('#bookings-error', '');
        try {
            const next = await api('/phone/bookings');
            if (mine !== version) return;
            data = next; if (!selected || selected < data.today) selected = data.today;
            const now = new Date(); $('#bookings-checked').textContent = `${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分に確認`;
            render();
        } catch (e) {
            if (mine === version && !e.stale) notice('#bookings-error', '予約台帳を読み込めませんでした。通信を確かめて「最新の状態にする」を押してください。');
        } finally { if (mine === version) { button.disabled = false; button.textContent = '最新の状態にする'; } }
    }
    on('#bookings-open', 'click', () => { show('bookings'); return load(); });
    on('#bookings-refresh', 'click', load);
    $('#bookings-search').addEventListener('input', e => { query = e.target.value.trim(); render(); });
    document.addEventListener('keydown', e => {
        if (e.key !== '/' || $('#screen-bookings').hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.querySelector('dialog[open]')) return;
        e.preventDefault(); $('#bookings-search').focus();
    });
    return {
        enable(name) { $('#bookings-open').hidden = !name; },
        reset() { version++; data = null; selected = null; query = ''; $('#bookings-search').value = ''; $('#bookings-open').hidden = true; $('#bookings-board').replaceChildren(); $('#bookings-days').replaceChildren(); $('#bookings-checked').textContent = ''; },
    };
}
