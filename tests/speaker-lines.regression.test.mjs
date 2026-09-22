// Run with Node 22+: node --experimental-strip-types --test tests/speaker-lines.regression.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSpeakerTurns } from '../packages/cli/src/speaker-lines.ts';

test('keeps caller claims separate from the other party', () => {
  const turns = parseSpeakerTurns('店: 確認中です。\nAI: ご予約承りました。');
  assert.equal(turns[0].source, 'callee');
  assert.equal(turns[1].source, 'caller');
  assert.equal(turns[0].text, '確認中です。');
});
test('unknown speaker cannot donate agreement to the callee', () => {
  assert.equal(parseSpeakerTurns('店: 確認中です。\nObserver: ご予約承りました。\nAI: ありがとう。'), undefined);
});
test('unknown speaker cannot donate a denial to the caller', () => {
  assert.equal(parseSpeakerTurns('AI: 予約したいです。\nManager: 予約は取り消しです。\n店: はい。'), undefined);
});
test('fails closed for malformed, empty and long labels', () => {
  for (const turn of ['話者X：成立しました', 'A'.repeat(80) + ': booked', '店:']) {
    assert.equal(parseSpeakerTurns(`店: 確認中です。\n${turn}\nAI: ありがとう。`), undefined);
  }
});
test('retains plain wrapped text and source ordering', () => {
  const turns = parseSpeakerTurns('店: ご予約\n承りました。\nAI: ありがとう。');
  assert.equal(turns[0].text, 'ご予約 承りました。');
  assert.deepEqual(turns.map(t => t.t), [0, 1000]);
});
test('accepts English labels and CR-only pasted logs', () => {
  const turns = parseSpeakerTurns('Them: booked\rAI: thanks');
  assert.deepEqual(turns.map(t => t.source), ['callee', 'caller']);
});
test('rejects unlabelled and caller-only logs', () => {
  for (const text of ['', 'booked', 'AI: booked\nAI: thanks']) assert.equal(parseSpeakerTurns(text), undefined);
});
test('does not reinterpret structured JSON as speaker-labelled input', () => {
  assert.equal(parseSpeakerTurns('{"source":"callee", "text":"booked"}'), undefined);
});
