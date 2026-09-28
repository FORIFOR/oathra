import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceList, practiceRun } from '../lib/practice.mjs';

test('practice: Japanese scenarios only, with what each one checks', async () => {
  const list = await practiceList();
  assert.ok(list.length >= 5);
  const r = list.find(x => x.id === 'restaurant-reservation');
  assert.equal(r.title, 'レストラン予約'); assert.deepEqual(r.require, ['date', 'time', 'partySize', 'confirmed']);
  assert.ok(list.every(x => x.id !== 'restaurant-reservation-en'));
});
test('practice run: settled only on verified evidence; the full-restaurant trap is not a completion', async () => {
  const ok = await practiceRun('restaurant-reservation');
  assert.equal(ok.complete, true); assert.equal(ok.falseCompletion, false);
  assert.deepEqual(ok.settled.map(s => s.field).sort(), ['confirmed', 'date', 'partySize', 'time']);
  assert.ok(ok.settled.every(s => ok.transcript.some(t => t.id === s.turnId)), 'each settled field points at a line of the conversation');
  const trap = await practiceRun('false-completion-trap');
  assert.equal(trap.complete, false); assert.equal(trap.falseCompletion, false);
  await assert.rejects(() => practiceRun('no-such-practice'), /unknown_practice/);
});
