import { TranscriptCheckSchema, verifyTranscript } from '../../packages/cli/src/transcript.js';

const root = document.querySelector<HTMLElement>('[data-evidence-story]');
const ja = document.documentElement.lang === 'ja';
const words = (a: string, b: string) => ja ? a : b;
const text = (selector: string, value: string) => { const node = root?.querySelector(selector); if (node) node.textContent = value; };

if (root) {
  // Every quote and value comes from the published recording; no synthetic conversation.
  fetch(new URL('data/recorded-check.json', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('recording_unavailable');
    const record = TranscriptCheckSchema.parse(await response.json());
    const moments = [2, 6, record.utterances.length - 1] as const;
    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-story-step]');
    const paint = (step: 0 | 1 | 2) => {
      const utterances = record.utterances.slice(0, moments[step] + 1);
      const last = [...utterances].reverse().find(turn => turn.source === 'callee');
      if (!last) throw new Error('recording_incomplete');
      // Intermediate views replay a prefix while the recorded conversation was still active.
      const result = verifyTranscript({ ...record, utterances, connection: step === 2 ? record.connection : 'active' });
      root.dataset.step = String(step); root.dataset.complete = String(result.complete);
      buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.storyStep) === step)));
      text('[data-story-time]', `${String(Math.floor(last.t / 60000)).padStart(2, '0')}:${String(Math.floor(last.t / 1000) % 60).padStart(2, '0')}`);
      text('[data-story-quote]', last.text);
      text('[data-story-code]', `complete: ${result.complete}`);
      text('[data-story-verdict]', result.complete ? words('完了の根拠が揃った', 'Evidence complete') : words('まだ、完了にしない', 'Not complete yet'));
      const missingLabels: Record<string, string> = { date: words('日付','date'), partySize: words('人数','party size'), price: words('価格','price'), breakfast: words('朝食','breakfast'), smoking: words('禁煙','non-smoking'), confirmed: words('確定','confirmation') };
      const missing = result.missing.map(field => missingLabels[field] || field).join(ja ? '・' : ', ');
      text('[data-story-reason]', result.complete
        ? words('必須条件の証拠と予算条件を確認。保存記録では、この後に会話が終了しています。', 'Required evidence and budget checks pass. The saved conversation ends after this confirmation.')
        : missing ? words(`未確認：${missing}。相手の返答を待ちます。`, `Still missing: ${missing}. More evidence is needed.`)
        : words('必要な値が揃っても、会話の終了までは完了にしません。', 'The conversation must also finish before it can be complete.'));
      const fields = root.querySelector('[data-story-fields]')!;
      fields.replaceChildren();
      for (const [key, label] of [['price', words('価格 / 上限 ¥20,000', 'PRICE / LIMIT ¥20,000')], ['breakfast', words('朝食付き', 'BREAKFAST')], ['confirmed', words('予約の確定', 'CONFIRMED')]] as const) {
        const value = result.fields[key];
        const group = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value === undefined ? words('未確認', 'Not verified') : typeof value === 'boolean' ? value ? words('確認済み', 'Verified') : words('なし', 'No') : key === 'price' ? `¥${Number(value).toLocaleString('en-US')}` : String(value);
        group.append(dt, dd); fields.append(group);
      }
    };
    buttons.forEach(button => {
      button.disabled = false;
      button.addEventListener('click', () => {
        const step = Number(button.dataset.storyStep);
        if (step === 0 || step === 1 || step === 2) paint(step);
      });
    });
    paint(1); root.dataset.ready = 'true';
  }).catch(() => {
    text('[data-story-verdict]', words('記録を読み込めませんでした', 'The recording could not load'));
    text('[data-story-reason]', words('元データのリンクを確認するか、ページを再読み込みしてください。', 'Open the source link or reload this page.'));
  });
}
