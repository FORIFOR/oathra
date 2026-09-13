import { EvidenceEngine, evaluate, type Speaker } from '../../packages/evidence/src/index.js';
import { defineCall } from '../../packages/contract/src/index.js';

const root = document.getElementById('sim');
if (root) {
  const ja = root.dataset.lang === 'ja';
  const say = (a: string, b: string) => ja ? a : b;
  const fields = ['date', 'time', 'partySize', 'confirmed'];
  const labels = ja ? ['日付', '時刻', '人数', '確定'] : ['Date', 'Time', 'Party', 'Confirmed'];
  const contract = defineCall({ goal: 'restaurant.reservation', target: { scenario: 'browser-evidence' }, input: {}, require: { date: true, time: true, partySize: true, confirmed: true }, constraints: { time: { gte: '19:00' }, partySize: { eq: 2 } }, permissions: { ask: true, reserve: true } });
  // These are editable example utterances, never predetermined results.
  const opening = say('9月12日の19時以降で2名、予約をお願いします。', 'Please book a table for two on September 12 at 7 pm or later.');
  const options = [
    say('たぶん大丈夫ですが、まだ確定ではありません。', "Probably fine, but it is not confirmed yet."),
    say('19時は満席です。19時半なら空いています。', '7 pm is full. 7:30 pm is available.'),
    say('はい、9月12日の19時に2名様でご予約承りました。', "Yes, you are booked for two on September 12 at 7 pm."),
    say('申し訳ありません、やはりご予約をお取りできませんでした。', 'Sorry, we cannot honor the reservation after all.')
  ];
  let engine: EvidenceEngine;
  let seq = 0;
  let started = false;
  let completed = false;
  root.innerHTML = `<div class="ph"><span><b>${say('予約の証拠ラボ', 'Reservation evidence lab')}</b></span><span class="tag">${say('実エンジン · 発信なし', 'REAL ENGINE · NO PHONE CALL')}</span></div>
    <div class="body"><div><div class="tx" id="s-tx" aria-label="${say('発言履歴', 'Utterance history')}"></div><div class="chips"><p>${say('店側の返事を送ってみる', 'Send a reply from the restaurant')}</p><div class="row" id="s-chips"></div>
    <button class="chip reset" id="evidence-reset" type="button">${say('最初から', 'Reset')}</button><details class="custom-evidence"><summary>${say('自分の言葉・AI側の発言で試す', 'Try your own wording or the AI side')}</summary><form id="evidence-form"><label for="evidence-source">${say('発言する側', 'Speaker')}</label><select id="evidence-source"><option value="callee">${say('相手（店）', 'Restaurant')}</option><option value="caller">${say('発信側（AI）', 'Caller (AI)')}</option></select><label for="evidence-text">${say('あなたの言葉でも試せます', 'Try your own wording')}</label><textarea id="evidence-text" required maxlength="1000" rows="2"></textarea><button class="btn" type="submit">${say('判定する', 'Check evidence')}</button></form></details></div></div>
    <aside><div><h4>${say('ミッション', 'MISSION')} <b id="s-n"></b></h4><ul id="s-m"></ul></div><div><h4>${say('発言に紐づく証拠', 'EVIDENCE FROM UTTERANCES')}</h4><div class="ev" id="s-ev"></div></div></aside></div>
    <p class="res" id="s-res" role="status" aria-live="polite"></p><p class="note">${say('本体と同じ判定コードをブラウザで実行。入力は送信されません。音声認識・AIとの通話ではなく、文字からの証拠判定を試す機能です。日付の基準年：2026。', 'The production evidence engine runs in your browser. Your text stays here. This checks transcript evidence, not speech recognition or an AI call. Date reference year: 2026.')}</p>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const label = (field: string) => labels[fields.indexOf(field)] ?? field;
  const value = (v: unknown) => v === true ? say('はい', 'yes') : String(v ?? '—');
  function track(name: string) { (window as Window & { productEvent?: (name: string) => void }).productEvent?.(name); }
  function render() {
    const result = evaluate(contract, engine, 'completed');
    el('s-m').replaceChildren();
    for (const f of fields) {
      const verified = result.fields[f] !== undefined;
      const pending = engine.pending(f);
      const li = document.createElement('li'); li.className = verified ? 'ok' : pending ? 'pend' : '';
      const mark = document.createElement('i'); mark.textContent = verified ? '✓' : '○';
      const name = document.createElement('span'); name.textContent = label(f);
      const val = document.createElement('span'); val.className = 'v'; val.textContent = value(verified ? result.fields[f] : pending?.value);
      li.append(mark, name, val); el('s-m').append(li);
    }
    el('s-n').textContent = `${fields.length - result.missing.length} / ${fields.length}`;
    el('s-ev').replaceChildren();
    for (const f of fields) {
      const node = result.fields[f] !== undefined ? engine.latestVerified(f) : engine.pending(f);
      if (!node) continue;
      const d = document.createElement('div'); d.className = node.source === 'callee' ? 'callee' : 'ai';
      d.textContent = `${label(f)}: ${value(node.value)} · ${node.source}\n“${node.transcript}”`;
      if (node.value === null && f === 'time') d.textContent += '\n' + say('午前・午後を明示して、時刻を再確認してください。', 'Specify am/pm and confirm the time again.');
      el('s-ev').append(d);
    }
    el('s-res').className = 'res' + (result.complete ? ' ok' : '');
    el('s-res').textContent = result.complete ? say('✓ 完了条件を満たしています', '✓ Completion conditions satisfied') : result.status === 'constraint_violation' ? say('条件を満たしていません', 'Constraints are not satisfied') : say('未完了 · 未確認：', 'Incomplete · missing: ') + result.missing.map(label).join(' / ');
    if (started && result.complete && !completed) { completed = true; track('demo_complete'); }
  }
  function ingest(source: Speaker, text: string) {
    engine.ingest({ id: `browser-${++seq}`, source, text, t: seq * 1000 });
    const d = document.createElement('div'); d.className = `ln ${source === 'callee' ? 'callee' : 'agent'}`;
    const who = document.createElement('b'); who.textContent = source === 'callee' ? say('相手', 'SHOP') : 'AI';
    const words = document.createElement('span'); words.textContent = text; d.append(who, words); el('s-tx').append(d);
    el('s-tx').scrollTop = el('s-tx').scrollHeight;
    render();
  }
  function send(source: Speaker, text: string) { if (!started) { started = true; track('demo_start'); } ingest(source, text); }
  for (const text of options) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = text; b.addEventListener('click', () => send('callee', text)); el('s-chips').append(b); }
  function reset() { engine = new EvidenceEngine({ language: ja ? 'ja' : 'en', now: new Date('2026-09-01T00:00:00Z') }); seq = 0; el('s-tx').replaceChildren(); el<HTMLTextAreaElement>('evidence-text').value = ''; ingest('caller', opening); }
  el('evidence-reset').addEventListener('click', reset);
  el<HTMLFormElement>('evidence-form').addEventListener('submit', e => { e.preventDefault(); const input = el<HTMLTextAreaElement>('evidence-text'); const text = input.value.trim(); if (!text) return; send(el<HTMLSelectElement>('evidence-source').value as Speaker, text); input.value = ''; });
  reset();
}
