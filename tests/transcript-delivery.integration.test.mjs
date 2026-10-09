// Run after `pnpm build:site && pnpm build`.
// Executes the actual generated website module at a small DOM boundary and the
// compiled/packaged CLI. This is not a browser rendering or real-call test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSpokenLines, verifyTranscript } from '../packages/cli/dist/transcript.js';

const normal = 'AI: 9月12日19時半に2名で予約をお願いします。\n店: はい、9月12日19時半に2名様でご予約承りました。';
const unknown = 'AI: 9月12日19時半に2名で予約をお願いします。\n店: ただいま空き状況を確認しております。\nObserver: はい、9月12日19時半に2名様でご予約承りました。';
const callerOnly = '店: ただいま空き状況を確認しております。\nAI: はい、9月12日19時半に2名様でご予約承りました。';
const cancelled = normal + '\n店: 申し訳ありません、やはりご予約をお取りできませんでした。';
const today = new Date(2026, 9, 4, 12);

test('compiled parser and evaluator preserve speaker boundaries and cancellation', () => {
  assert.equal(parseSpokenLines(unknown, today), undefined);
  assert.equal(verifyTranscript(parseSpokenLines(normal, today)).complete, true);
  assert.equal(verifyTranscript(parseSpokenLines(callerOnly, today)).complete, false);
  assert.equal(verifyTranscript(parseSpokenLines(cancelled, today)).complete, false);
});

class Element {
  value = ''; textContent = ''; className = ''; disabled = false;
  children = []; listeners = new Map();
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  focus() {}
  fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
}

test('generated website bundle rejects unknown speakers, clears stale success and recovers', async t => {
  const elements = new Map(['check-input', 'load-recording', 'download-result', 'check-summary', 'field-results', 'evidence-results', 'raw-result', 'check-error', 'input-source', 'clear-input', 'check-form'].map(id => [id, new Element()]));
  const beforeDocument = globalThis.document, beforeFetch = globalThis.fetch;
  t.after(() => { if (beforeDocument === undefined) delete globalThis.document; else globalThis.document = beforeDocument; globalThis.fetch = beforeFetch; });
  globalThis.document = { documentElement: { lang: 'ja' }, getElementById: id => { assert.ok(elements.has(id), `unexpected element ${id}`); return elements.get(id); }, createElement: () => new Element() };
  globalThis.fetch = () => { throw new Error('network is forbidden in this fixture'); };
  await import(new URL('../site/check.js', import.meta.url).href + '?delivery-regression');
  const get = id => elements.get(id);
  const submit = text => { get('check-input').value = text; get('check-input').fire('input'); get('check-form').fire('submit'); };
  submit(normal);
  assert.equal(JSON.parse(get('raw-result').textContent).complete, true);
  assert.equal(get('download-result').disabled, false);
  for (const text of [unknown, '店: 確認中です。\n話者X：ご予約承りました。', '店: 確認中です。\n店:', '{invalid JSON']) {
    submit(text);
    assert.equal(get('raw-result').textContent, '');
    assert.equal(get('download-result').disabled, true);
    assert.match(get('check-error').textContent, /読み取れません/);
    assert.equal(get('field-results').children.length, 0);
    assert.equal(get('evidence-results').children.length, 0);
  }
  submit(callerOnly);
  assert.equal(JSON.parse(get('raw-result').textContent).complete, false);
  submit(cancelled);
  assert.equal(JSON.parse(get('raw-result').textContent).complete, false);
  submit(normal);
  assert.equal(JSON.parse(get('raw-result').textContent).complete, true);
  get('clear-input').fire('click');
  assert.equal(get('check-input').value, '');
  assert.equal(get('raw-result').textContent, '');
  assert.equal(get('download-result').disabled, true);
});

for (const entry of ['../packages/cli/dist/bin.js', '../packages/cli/dist/bundle/bin.js']) {
  test(`${entry}: JSON CLI success, incomplete, cancellation and invalid source are distinct`, () => {
    const run = input => spawnSync(process.execPath, [fileURLToPath(new URL(entry, import.meta.url)), 'verify', '-'], { input: JSON.stringify(input), encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'UTC' }, timeout: 10000 });
    for (const [text, status, complete] of [[normal, 0, true], [callerOnly, 2, false], [cancelled, 2, false]]) {
      const result = run(parseSpokenLines(text, today));
      assert.equal(result.error, undefined);
      assert.equal(result.status, status, result.stderr);
      assert.equal(JSON.parse(result.stdout).complete, complete);
    }
    const malformed = parseSpokenLines(normal, today);
    malformed.utterances[1].source = 'observer';
    const result = run(malformed);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  });
}
