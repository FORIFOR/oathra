// Real local server, product simulator, real filesystem failure. No network adapter or mock.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startArena } from '../apps/arena/dist/index.js';
import { ScriptedAgent } from '../providers/simulator/dist/index.js';
const work = mkdtempSync(join(tmpdir(), 'oathra-outcome-'));
const callsDir = join(work, 'calls');
// A file at the directory path provokes a real ENOTDIR; removed before save-only recovery.
writeFileSync(callsDir, '');
const arena = await startArena({ scenariosDir: resolve('scenarios'), brains: { scripted: () => new ScriptedAgent() }, callsDir, port: 0 });
const post = (path, body, headers = {}) => fetch(arena.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = async path => { const r = await fetch(arena.url + path); assert.equal(r.status, 200); return r.json(); };
try {
  const input = { scenarioId: 'restaurant-reservation', mode: 'play' };
  // Malformed caller input goes through the real HTTP boundary, before a call exists.
  const invalidBodies = ['null', '[]', 'true', '42', '"text"', '{', '', '{}',
    ...[{ scenarioId: 42 }, { brain: null }, { speed: 'fast' }, { speed: 0 },
      { speed: -1 }, { calleeName: [] }, { mode: null }].map(fields => JSON.stringify({ ...input, ...fields })),
    '{"scenarioId":"restaurant-reservation","speed":1e999}'];
  for (const body of invalidBodies) {
    const response = await fetch(arena.url + '/api/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, 400, `invalid body: ${body}`);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
    assert.equal((await get('/api/calls')).length, 0, 'invalid input must not start a call');
  }
  assert.equal((await post('/api/calls', input, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post('/api/calls', { ...input, mode: 'invalid' })).status, 400);
  assert.equal((await post('/api/calls', { ...input, brain: 'openai' })).status, 400);
  const headers = { 'idempotency-key': 'outcome-run-0001' };
  const [a, b] = await Promise.all([post('/api/calls', input, headers), post('/api/calls', input, headers)]);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const first = await a.json(), second = await b.json();
  assert.equal(first.callId, second.callId);
  assert.equal((await get('/api/requests/outcome-run-0001')).callId, first.callId);
  assert.equal((await fetch(arena.url + '/api/requests/unknown-request')).status, 404);
  assert.equal((await get('/api/calls')).length, 1);
  assert.equal((await post('/api/calls', { ...input, mode: 'watch' }, headers)).status, 409);
  const path = `/api/calls/${first.callId}`;
  for (const body of [null, [], { text: 42 }, { text: ' ' }]) {
    const response = await post(path + '/reply', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
  }
  assert.equal((await post(path + '/hangup', {})).status, 200);
  const stream = await (await fetch(arena.url + path + '/events')).text();
  assert.ok(stream.includes('event: done'));
  const result = await get(path);
  assert.equal(result.endReason, 'cancelled');
  assert.equal(result.persistence, 'failed');
  assert.equal(result.result.complete, false);
  assert.equal((await post(path + '/reply', { text: 'はい' })).status, 409);
  const artifact = await get(path + '/artifact');
  assert.deepEqual(artifact.result, result.result);
  assert.ok(artifact.summary.includes(first.callId));
  rmSync(callsDir); mkdirSync(callsDir);
  assert.equal((await post(path + '/save', {})).status, 200);
  assert.equal((await get(path)).persistence, 'saved');
  assert.deepEqual(JSON.parse(readFileSync(join(callsDir, first.callId, 'result.json'), 'utf8')), result.result);
  assert.equal(readFileSync(join(callsDir, first.callId, 'summary.md'), 'utf8'), artifact.summary);
  assert.deepEqual((await get(`/api/replays/${first.callId}`)).result, result.result);
  assert.deepEqual(await get(`/api/replays/${first.callId}/artifact`), artifact);
  assert.equal((await get('/api/calls')).length, 1);
  const watch = await (await post('/api/calls', { ...input, mode: 'watch' })).json();
  await post(`/api/calls/${watch.callId}/hangup`, {});
  await (await fetch(`${arena.url}/api/calls/${watch.callId}/events`)).text();
  assert.equal((await get(`/api/calls/${watch.callId}`)).endReason, 'cancelled');
  console.log('PASS: origin, invalid JSON/object/field validation without call creation, reply validation, concurrent idempotency, conflict, play/watch cancellation, ended reply, failed save, download, save-only recovery, disk and replay equality');
} finally { arena.server.closeAllConnections(); await arena.close(); rmSync(work, { recursive: true, force: true }); }
