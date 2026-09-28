import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceList, practiceRun, practicePlayStart, practicePlayState, practicePlayReply, practicePlayHangup } from '../lib/practice.mjs';

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

test('自分が相手役: only the callee\'s own words settle a field; the conversation belongs to its user; one at a time', { timeout: 60000 }, async () => {
  const until = async (id, ok) => { for (let i = 0; i < 100; i++) { const st = practicePlayState('me', id); if (ok(st)) return st; await new Promise(r => setTimeout(r, 250)); } throw new Error('timeout'); };
  let st = await practicePlayStart('me', 'restaurant-reservation');
  assert.equal(st.status, 'running'); assert.deepEqual(st.require, ['date', 'time', 'partySize', 'confirmed']);
  assert.throws(() => practicePlayState('someone-else', st.id), /unknown_practice/);
  assert.throws(() => practicePlayReply('someone-else', st.id, 'はい'), /unknown_practice/);
  assert.throws(() => practicePlayReply('me', st.id, ''), /invalid_reply/);
  practicePlayReply('me', st.id, 'はい、さくら亭です。');
  st = await until(st.id, s => s.transcript.some(t => t.source === 'caller' && /予約/.test(t.text)));
  assert.equal(st.settled.length, 0, 'the AI asking settles nothing');
  practicePlayReply('me', st.id, 'はい、9月12日の19時に2名様で空いております。');
  st = await until(st.id, s => s.settled.some(x => x.field === 'partySize'));
  const line = st.transcript.find(t => t.id === st.settled.find(x => x.field === 'partySize').turnId);
  assert.equal(line?.source, 'callee', 'a settled field points at the user\'s own line');
  const first = st.id, again = await practicePlayStart('me', 'restaurant-reservation');
  assert.throws(() => practicePlayState('me', first), /unknown_practice/, 'starting again ends the previous one');
  practicePlayHangup('me', again.id);
  st = await until(again.id, s => s.status !== 'running');
  assert.equal(st.complete, false);
  assert.throws(() => practicePlayReply('me', again.id, 'もしもし'), /practice_ended/);
});
