// Things that went wrong quietly: lost updates, double sends, stuck queues, silent failures, records that never expire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Channels } from '../lib/channels.mjs';
import { Followups } from '../lib/followups.mjs';
import { Worker, simulate } from '../lib/worker.mjs';
import { Phone } from '../lib/phone.mjs';
import { hash, phone } from '../lib/security.mjs';
import { createGateway } from '../server.mjs';
import { readFileSync } from 'node:fs';
import { PluginRegistry } from '../../../sdk/plugin-kit/index.mjs';
import { defineChannel } from '../../../sdk/channel-sdk/index.mjs';

const start = Date.parse('2026-09-19T03:00:00+09:00');
const token = 'test-operator-token-'.repeat(3);
const PHONE = '+819000000001', DAY = 86400_000;

function fixture() {
  let clock = start;
  const config = {
    mode: 'simulator', maxSeconds: 300, maxCallUsd: 10, dailyCalls: 20, dailyUsd: 30, rateCeilingUsd: 0.1, setupFeeUsd: 0,
    consentVersion: 'v1', liveReady: false, publicUrl: 'https://gateway.test', missing: [],
    users: [{ id: 'alice', team: 'one', role: 'admin', tokenHash: hash(token) }, { id: 'bob', team: 'one', role: 'operator', tokenHash: hash('bob-token') }],
  };
  const store = new Store(':memory:', randomBytes(32).toString('hex'), () => clock);
  const service = new Service(store, config), u = config.users[0];
  service.saveConsent(u, 'v1');
  const product = service.product(u, { name: 'Example product', facts: 'Only the reviewed feature.', reviewed: true });
  const contact = service.contact(u, { name: '田中さん', phone: PHONE, relationship: 'inquiry', basis: 'Asked for a call back', email: 'tanaka@example.test' });
  const draft = (owner = u) => service.prepare(owner, { request: '田中さんに商談を提案', contactId: contact.id, productId: product.id });
  const approve = (m, key = 'one') => service.start(u, service.review(u, m.id).approvalToken, key, true);
  return { config, store, service, u, product, contact, draft, approve, advance(ms) { clock += ms; }, close() { store.close(); } };
}
const withFixture = fn => async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } };
const quiet = { process: async () => {}, send: async () => {} };
async function captureErrors(fn) {
  const original = console.error, lines = []; console.error = line => lines.push(String(line));
  try { await fn(); } finally { console.error = original; }
  return lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
}

// ------------------------------------------------------------------------------------------ lost updates

const ENV = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'secret' };
test('reconciling the carrier does not overwrite a result written while the carrier was answering', withFixture(async f => {
  const m = f.draft(); Object.assign(m, { status: 'UNKNOWN', carrierSid: 'CA' + 'b'.repeat(32) }); f.store.put('mission', m);
  const phoneLayer = new Phone(f.service, ENV), original = globalThis.fetch;
  globalThis.fetch = async () => {
    // Meanwhile the worker finishes the call and stores the evidence.
    const live = f.store.get('mission', m.id); live.result = { status: 'INCOMPLETE', verified: { material_send_allowed: true } }; live.transcript = [{ id: 't', source: 'callee', text: 'x' }]; f.store.put('mission', live);
    return new Response(JSON.stringify({ status: 'completed', price: '-0.05', price_unit: 'USD' }), { status: 200 });
  };
  try { await phoneLayer.reconcile(f.u, m.id); } finally { globalThis.fetch = original; }
  const after = f.store.get('mission', m.id);
  assert.deepEqual(after.result.verified, { material_send_allowed: true });
  assert.equal(after.transcript.length, 1);
  assert.deepEqual({ status: after.status, carrierStatus: after.carrierStatus, charge: after.actualCarrierCharge }, { status: 'INCOMPLETE', carrierStatus: 'completed', charge: { amount: '-0.05', currency: 'USD' } });
}));

test('a mission deleted while the carrier was answering stays deleted', withFixture(async f => {
  const m = f.draft(); Object.assign(m, { status: 'UNKNOWN', carrierSid: 'CA' + 'b'.repeat(32) }); f.store.put('mission', m);
  const phoneLayer = new Phone(f.service, ENV), original = globalThis.fetch;
  globalThis.fetch = async () => { f.store.removeMission(f.store.get('mission', m.id)); return new Response(JSON.stringify({ status: 'completed', price: null }), { status: 200 }); };
  try { await assert.rejects(phoneLayer.reconcile(f.u, m.id), /not_found/); } finally { globalThis.fetch = original; }
  assert.equal(f.store.get('mission', m.id), null);
}));

// ------------------------------------------------------------------------------------------ one person, one key

test('a domestic trunk prefix cannot create a second identity for the same person', () => {
  assert.equal(phone('+81 (0)90-1234-5678'), '+819012345678');
  assert.equal(phone('+81 90 1234 5678'), '+819012345678');
  assert.throws(() => phone('+81 090 1234 5678'), /trunk_prefix/);
  assert.throws(() => phone('+4407700900123'), /trunk_prefix/);
  assert.equal(phone('+1 (500) 555-0006'), '+15005550006');
});

test('suppression follows the number, whichever team recorded it', withFixture(f => {
  f.store.suppress('another-team', PHONE);
  assert.throws(() => f.approve(f.draft()), /recipient_suppressed/);
}));

test('two owners cannot have calls to the same person in flight at once', withFixture(f => {
  f.approve(f.draft());
  const bob = f.config.users[1]; f.service.saveConsent(bob, 'v1');
  const product = f.service.product(bob, { name: 'Example product', facts: 'Reviewed.', reviewed: true });
  const contact = f.service.contact(bob, { name: '田中さん', phone: PHONE, relationship: 'customer', basis: 'Existing customer' });
  const m = f.service.prepare(bob, { request: '田中さんに商談を提案', contactId: contact.id, productId: product.id });
  assert.throws(() => f.service.start(bob, f.service.review(bob, m.id).approvalToken, 'bob-1', true), /recipient_has_active_call/);
}));

// ------------------------------------------------------------------------------------------ follow-ups

function followFixture(f) {
  const m = f.draft(); Object.assign(m, { mode: 'live', status: 'COMPLETED', result: { verified: { material_send_allowed: true }, doNotContact: false } }); f.store.put('mission', m);
  const env = { OATHRA_INTEGRATION_OWNER: f.u.id, GOOGLE_REFRESH_TOKEN: 't', GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't', OATHRA_SMS_ENABLED: 'true', TWILIO_AUTH_TOKEN: 't' };
  const a = new Followups(f.service, env); a.googleToken = async () => 'not-a-real-token';
  const email = () => a.preview(f.u, m.id, { kind: 'email', subject: 'Test', body: 'Hello', contactPermissionBasis: 'Requested on the call' });
  return { m, a, email };
}

test('an email that may have been sent cannot be previewed and sent again', withFixture(async f => {
  const { a, email } = followFixture(f), p = email(); let calls = 0;
  a.send = async () => { calls++; throw new Error('timeout'); };
  assert.equal((await a.execute(f.u, p.id, { approvalToken: p.approvalToken, acknowledged: true }, 'k1')).status, 'UNKNOWN');
  assert.throws(() => email(), /followup_outcome_unknown_reconcile_before_retry/);
  // Only after a person checked the provider and says nothing went out:
  assert.throws(() => a.markNotDelivered(f.u, p.id, false), /reconciliation_confirmation_required/);
  a.markNotDelivered(f.u, p.id, true);
  const retry = email(); a.send = async () => { calls++; return { id: 'provider-id' }; };
  assert.equal((await a.execute(f.u, retry.id, { approvalToken: retry.approvalToken, acknowledged: true }, 'k2')).status, 'SUBMITTED');
  assert.throws(() => email(), /followup_already_sent/);
  assert.equal(calls, 2);
  assert.equal(f.store.audits({ limit: 500 }).filter(x => x.action === 'followup.result').length, 2);
}));

test('a follow-up that finishes after its mission was deleted is not written back', withFixture(async f => {
  const { m, a, email } = followFixture(f), p = email();
  a.send = async () => { f.store.removeMission(f.store.get('mission', m.id)); return { id: 'provider-id' }; };
  await a.execute(f.u, p.id, { approvalToken: p.approvalToken, acknowledged: true }, 'k1');
  assert.equal(f.store.get('followup', p.id), null);
}));

// ------------------------------------------------------------------------------------------ queues

// A real manifest (LINE's) under another id, with a fake protocol adapter: the same construction the plugin tests use.
const lineManifest = JSON.parse(readFileSync(new URL('../../../plugins/line/oathra.plugin.json', import.meta.url), 'utf8'));
function registryWith(id) {
  const r = new PluginRegistry();
  r.register({ ...lineManifest, id, environment: [] }, defineChannel({ verify: () => true, decode: raw => JSON.parse(raw), send: async () => ({ status: 'accepted' }) }));
  return r;
}
const deliver = (c, id, events) => c.receive(id, Buffer.from(JSON.stringify({ events })), {});

test('strangers cannot fill the inbox; a link code is still accepted', withFixture(f => {
  const c = new Channels(f.service, {}, registryWith('chat'));
  deliver(c, 'chat', Array.from({ length: 50 }, (_, i) => ({ eventId: 'spam' + i, type: 'message', actor: 'stranger', destination: 'stranger', text: 'hello ' + i })));
  assert.equal(f.store.list('inbox').length, 0);
  deliver(c, 'chat', [{ eventId: 'link', type: 'message', actor: 'stranger', destination: 'stranger', text: '連携 ' + f.service.linkCode(f.u) }]);
  assert.deepEqual(f.store.list('inbox').map(j => j.id), ['chat:link']);
}));

test('approvals are taken before chatter, and the oldest job is never starved', withFixture(f => {
  for (let i = 0; i < 1100; i++) { f.store.enqueue('inbox', 'msg' + i, '_channel', { kind: 'chat', normalized: { type: 'message' } }); f.advance(1); }
  assert.equal(f.store.next('inbox').id, 'msg0'); // previously the oldest of the newest 1000: msg100
  f.store.enqueue('inbox', 'approve', '_channel', { kind: 'chat', normalized: { type: 'action' } }, { priority: true });
  assert.equal(f.store.next('inbox').id, 'approve'); // 1,100 messages ahead of it, and still first
}));

test('a channel delivers button presses as priority jobs', withFixture(f => {
  const c = new Channels(f.service, {}, registryWith('chat')); f.service.link('chat', 'U1', f.service.linkCode(f.u));
  deliver(c, 'chat', [{ eventId: 'm1', type: 'message', actor: 'U1', destination: 'U1', text: 'hello' }]); f.advance(5);
  deliver(c, 'chat', [{ eventId: 'a1', type: 'action', actor: 'U1', destination: 'U1', action: 'oa_x' }]);
  assert.equal(f.store.next('inbox').id, 'chat:a1');
}));

test('a queued call whose owner was removed fails instead of blocking every call behind it', withFixture(async f => {
  const stuck = f.approve(f.draft()); f.advance(10);
  const orphan = f.store.get('mission', stuck.id); orphan.owner = 'removed-user'; f.store.put('mission', orphan);
  const w = new Worker(f.service, quiet, simulate);
  await w.tick();
  assert.deepEqual({ status: f.store.get('mission', stuck.id).status, error: f.store.get('mission', stuck.id).error }, { status: 'FAILED', error: 'unlinked_account' });
  assert.equal(f.store.list('mission', undefined, 'QUEUED').length, 0);
}));

// ------------------------------------------------------------------------------------------ silence

test('a job that gives up is logged without its content and counted for the administrator', withFixture(async f => {
  f.store.enqueue('outbox', 'note-1', 'alice', { channel: 'chat', actor: 'a', destination: 'd', text: 'private result for 田中さん' });
  const w = new Worker(f.service, { process: async () => {}, send: async () => { const e = new Error('nope'); e.code = 'channel_delivery_not_accepted'; throw e; } }, simulate);
  const logs = await captureErrors(async () => { for (let i = 0; i < 5; i++) { await w.tick(); f.advance(61_000); } });
  assert.equal(f.store.get('outbox', 'note-1').status, 'failed');
  assert.deepEqual(logs.map(l => [l.event, l.code, l.attempts]), [['outbox.gave_up', 'channel_delivery_not_accepted', 5]]);
  assert(!JSON.stringify(logs).includes('田中'));
  assert.deepEqual(f.store.failedJobs(), { inbox: 0, outbox: 1 });

  const app = await createGateway(f.config, { store: f.store, execute: simulate, channels: quiet });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const admin = await (await fetch(base + '/v1/bootstrap', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.deepEqual(admin.failedJobs, { inbox: 0, outbox: 1 });
    const operator = await (await fetch(base + '/v1/bootstrap', { headers: { authorization: 'Bearer bob-token' } })).json();
    assert.equal(operator.failedJobs, undefined);
  } finally { await app.close(); }
}));

test('an unexplained server error is logged with its request id; client errors are not', withFixture(async f => {
  const app = await createGateway(f.config, { store: f.store, execute: simulate, channels: quiet });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const logs = await captureErrors(async () => {
      assert.equal((await fetch(base + '/v1/bootstrap')).status, 401);
      f.store.audits = () => { throw new Error('disk gone'); };
      const res = await fetch(base + '/v1/audit', { headers: { authorization: 'Bearer ' + token } });
      assert.equal(res.status, 500);
      assert.equal((await res.json()).requestId, res.headers.get('x-request-id'));
    });
    assert.equal(logs.length, 1);
    assert.deepEqual({ event: logs[0].event, status: logs[0].status }, { event: 'request.failed', status: 500 });
    assert.match(logs[0].requestId, /^[a-f0-9-]{36}$/);
  } finally { await app.close(); }
}));

// ------------------------------------------------------------------------------------------ retention

test('retention reaches every old mission and abandoned draft, and keeps what must be reconciled', withFixture(f => {
  const make = (id, patch) => f.store.put('mission', { id, owner: 'alice', team: 'one', target: { phone: PHONE }, ...patch });
  for (let i = 0; i < 1200; i++) make('old-' + i, { status: 'INCOMPLETE', finishedAt: start });
  make('old-draft', { status: 'DRAFT', createdAt: start });
  make('old-unknown', { status: 'UNKNOWN', finishedAt: start });
  f.advance(31 * DAY);
  make('recent', { status: 'COMPLETED', finishedAt: start + 31 * DAY });
  make('recent-draft', { status: 'DRAFT', createdAt: start + 31 * DAY });
  f.store.prune(30);
  const left = f.store.db.prepare("SELECT id FROM records WHERE kind='mission' ORDER BY id").all().map(r => r.id);
  assert.deepEqual(left, ['old-unknown', 'recent', 'recent-draft']); // previously ~200 of the 1200 survived forever, and drafts never expired
  f.store.prune(30); // a second pass over only kept records terminates
}));

test('retention is configurable', withFixture(f => {
  f.store.put('mission', { id: 'm', owner: 'alice', team: 'one', status: 'INCOMPLETE', finishedAt: start, target: { phone: PHONE } });
  f.advance(8 * DAY);
  f.store.prune(30); assert(f.store.get('mission', 'm'));
  f.store.prune(7); assert.equal(f.store.get('mission', 'm'), null);
}));
