import { parseSpokenLines, TranscriptCheckSchema, verifyTranscript } from '../../packages/cli/src/transcript.js';

const ja = document.documentElement.lang === 'ja';
const say = (a: string, b: string) => ja ? a : b;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = el<HTMLTextAreaElement>('check-input');
const load = el<HTMLButtonElement>('load-recording');
const download = el<HTMLButtonElement>('download-result');
let output: string | undefined;
let revision = 0;
const maxBytes = 1_000_000;

function invalidate() {
  revision++;
  output = undefined;
  download.disabled = true;
  el('check-summary').textContent = say('入力を検証すると、ここに結果が表示されます。', 'Check the input to see its result here.');
  el('check-summary').className = 'summary';
  el('field-results').replaceChildren();
  el('evidence-results').replaceChildren();
  el('raw-result').textContent = '';
  el('check-error').textContent = '';
}

input.addEventListener('input', () => { invalidate(); el('input-source').textContent = say('編集した入力', 'Edited input'); });
el('clear-input').addEventListener('click', () => { input.value = ''; invalidate(); el('input-source').textContent = ''; input.focus(); });
load.addEventListener('click', async () => {
  const at = ++revision;
  load.disabled = true;
  try {
    const response = await fetch(new URL('data/recorded-check.json', import.meta.url));
    if (!response.ok) throw new Error('recording unavailable');
    const text = await response.text();
    if (at !== revision) return;
    input.value = text;
    invalidate();
    el('input-source').textContent = say('公開済みの実行記録：GPT-4o-mini × ホテルシミュレーター。実電話ではありません。', 'Saved run: GPT-4o-mini × hotel simulator. This is not a real phone call.');
  } catch {
    if (at === revision) el('check-error').textContent = say('記録を読み込めませんでした。時間をおいて再試行してください。', 'Could not load the recording. Please retry later.');
  } finally { load.disabled = false; }
});

/** One place that paints a verdict, whether the input arrived as JSON or as a pasted log. */
function show(result: ReturnType<typeof verifyTranscript>): void {
  output = JSON.stringify(result, null, 2);
  download.disabled = false;
  el('raw-result').textContent = output;
  el('check-summary').className = 'summary ' + (result.complete ? 'complete' : 'incomplete');
  const status = { completed: say('完了条件を満たしています', 'Completion conditions satisfied'), incomplete: say('未完了', 'Incomplete'), constraint_violation: say('条件に違反しています', 'Constraints not satisfied'), failed: say('接続が失敗しています', 'Connection failed') }[result.status];
  el('check-summary').textContent = `${result.complete ? '✓' : '○'} ${status} · complete: ${result.complete}`;
  const details = document.createElement('p');
  details.textContent = say('未確認の必須項目：', 'Missing required fields: ') + (result.missing.join(', ') || say('なし', 'none'));
  el('field-results').append(details);
  // Nothing read at all is not the same as "not confirmed": say so instead of showing an empty verdict.
  if (!Object.keys(result.fields).length) {
    const none = document.createElement('p');
    none.textContent = say(
      'この記録からは、条件になる値を1つも読み取れませんでした。日時・人数・確定の言葉が相手の発言として入っているか、対応範囲の言い回しかを確認してください。',
      'No values could be read from this log. Check that the date, the time, the party size and the agreement appear in the other party\'s own words, and that the phrasing is in the supported set.');
    el('field-results').append(none);
  }
  for (const [key, value] of Object.entries(result.fields)) {
    const row = document.createElement('div'); row.className = 'field';
    const label = document.createElement('code'); label.textContent = key;
    const val = document.createElement('strong'); val.textContent = String(value);
    row.append(label, val); el('field-results').append(row);
  }
  for (const violation of result.constraints.violations) {
    const row = document.createElement('p'); row.className = 'error';
    row.textContent = `${violation.field}: ${String(violation.actual)} / ${violation.rule} ${String(violation.expected)}`;
    el('field-results').append(row);
  }
  if (result.constraints.unknown.length) {
    const row = document.createElement('p');
    row.textContent = say('値がなく判定できない制約：', 'Constraints with no known value: ') + result.constraints.unknown.join(', ');
    el('field-results').append(row);
  }
  // Show the complete evidence history, including unverified and superseded claims.
  // Current accepted values above come from the production evaluator, not this UI.
  for (const evidence of result.evidence) {
    const block = document.createElement('article'); block.className = 'evidence';
    const title = document.createElement('p'); title.className = 'evidence-title';
    title.textContent = `${evidence.field} = ${String(evidence.value)} · ${evidence.source} · ${(evidence.t / 1000).toFixed(1)}s`;
    const quote = document.createElement('blockquote'); quote.textContent = evidence.transcript;
    const note = document.createElement('small'); note.textContent = `${evidence.utteranceId} · ${evidence.verified ? say('確認根拠あり', 'Evidence verified') : say('未確認', 'Unverified')}${evidence.note ? ' · ' + evidence.note : ''}`;
    block.append(title, quote, note); el('evidence-results').append(block);
  }
}

el<HTMLFormElement>('check-form').addEventListener('submit', event => {
  event.preventDefault();
  invalidate();
  if (new TextEncoder().encode(input.value).length > maxBytes) {
    el('check-error').textContent = say('ブラウザ版の上限は1 MBです。大きなログにはCLIを使ってください。', 'The browser limit is 1 MB. Use the CLI for larger logs.');
    return;
  }
  try {
    // Most people paste a call log with speaker labels, not JSON. Read that too, and say what it assumed.
    const spoken = parseSpokenLines(input.value);
    if (spoken) {
      const result = verifyTranscript(spoken);
      el('input-source').textContent = say(
        `発言ラベル付きのログとして読みました（${spoken.utterances.length}発言）。「相手が承諾したか」だけを必須にした既定の条件で判定しています。日時や人数を条件にするには、下の入力形式でJSONを渡してください。`,
        `Read as a speaker-labelled log (${spoken.utterances.length} turns). The default check requires only that the other party agreed. To require a date, a time or a party size, pass JSON in the format below.`);
      show(result);
      return;
    }
    const parsed = TranscriptCheckSchema.safeParse(JSON.parse(input.value));
    if (!parsed.success) {
      el('check-error').textContent = say('入力形式を確認してください：\n', 'Check the input format:\n') + parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'input'}: ${issue.code}`).join('\n');
      return;
    }
    show(verifyTranscript(parsed.data));
  } catch {
    // Do not echo potentially sensitive transcript values in errors or logs.
    el('check-error').textContent = say(
      '読み取れませんでした。「店: …」「AI: …」のように発言者を付けた行か、下の形式のJSONを貼ってください。',
      'Could not read that. Paste one turn per line with a speaker ("Them: …", "AI: …"), or JSON in the format below.');
  }
});

download.addEventListener('click', () => {
  if (!output) return;
  const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'oathra-result.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
