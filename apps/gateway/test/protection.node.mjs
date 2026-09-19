// Protections for the person being called, and the record of what was done to them:
//   H1 stop-contact detection, H2 rate limits that cannot starve opt-out or "stop this call",
//   H3 opt-out that survives a lost session, H4 an audit trail that can answer a complaint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker, simulate } from '../lib/worker.mjs';
import { Phone } from '../lib/phone.mjs';
import { hash } from '../lib/security.mjs';
import { evaluateSales, wantsNoContact } from '../lib/sales.mjs';
import { createGateway, clientIp, limitClass, RATE_LIMITS } from '../server.mjs';

const now = Date.parse('2026-09-19T03:00:00+09:00');
const token = 'test-operator-token-'.repeat(3);
const PHONE = '+819000000001';

function fixture(extra = {}) {
  let clock = now;
  const config = {
    mode: 'simulator', maxSeconds: 300, maxCallUsd: 10, dailyCalls: 20, dailyUsd: 30, rateCeilingUsd: 0.1, setupFeeUsd: 0,
    consentVersion: 'v1', liveReady: false, publicUrl: 'https://gateway.test', missing: [],
    users: [{ id: 'alice', team: 'one', role: 'admin', tokenHash: hash(token) }, { id: 'bob', team: 'one', role: 'operator', tokenHash: hash('bob-token') }],
    ...extra,
  };
  const store = new Store(':memory:', randomBytes(32).toString('hex'), () => clock);
  const service = new Service(store, config), u = config.users[0];
  service.saveConsent(u, 'v1');
  const product = service.product(u, { name: 'Example product', facts: 'Only the reviewed feature.', reviewed: true });
  const contact = service.contact(u, { name: '田中さん', phone: PHONE, relationship: 'inquiry', basis: 'Asked for a call back' });
  const draft = () => service.prepare(u, { request: '田中さんに商談を提案', contactId: contact.id, productId: product.id });
  const approve = (m, key = 'one') => service.start(u, service.review(u, m.id).approvalToken, key, true);
  return { config, store, service, u, product, contact, draft, approve, advance(ms) { clock += ms; }, close() { store.close(); } };
}
const withFixture = (fn, extra) => async () => { const f = fixture(extra); try { await fn(f); } finally { f.close(); } };
const quiet = { process: async () => {}, send: async () => {} };
const actions = f => f.store.audits({ limit: 500 }).map(a => a.action);
const entry = (f, action) => f.store.audits({ limit: 500 }).filter(a => a.action === action).pop();

// ---------------------------------------------------------------------------------------------- H1

const STOP = ['もうかけてこないでください', '二度とかけてこないで', 'もう電話してこないでください', '今後一切連絡してこないでください', 'いりません', '必要ありません',
  '迷惑です。やめてください', 'リストから削除してください', 'うちは間に合ってます', '今後電話しないでください', '興味がありません', 'いえ、結構です。',
  '営業のお電話はお断りしています', 'ｍｏｕ かけてこないで', 'Please take me off your list.', 'do not call me again'];
const NOT_STOP = ['はい、今は大丈夫です。', 'はい、大丈夫です。', 'それで結構です。', 'はい、9月25日の15時でお願いします。', 'ご迷惑をおかけしました。', '資料を送ってください。',
  '少々お待ちください。', '担当に代わります。', 'もう一度お願いします。', 'はい、田中です。'];

for (const line of STOP) test(`stop-contact is heard: ${line}`, () => {
  assert.equal(wantsNoContact(line), true);
  const r = evaluateSales([{ id: 'a', source: 'caller', text: 'ご案内のお電話です。' }, { id: 'c', source: 'callee', text: line }], { goal: 'meeting' }, true, now);
  assert.equal(r.status, 'DECLINED'); assert.equal(r.doNotContact, true); assert.deepEqual(r.verified, {});
});
for (const line of NOT_STOP) test(`ordinary reply is not a stop-contact: ${line}`, () => assert.equal(wantsNoContact(line), false));

test('a stop-contact during the call aborts it, suppresses the number and says why', withFixture(async f => {
  let aborted = false;
  const m = f.approve(f.draft());
  const w = new Worker(f.service, quiet, async (_m, hooks) => {
    hooks.onEvent({ type: 'call.connected' });
    hooks.onEvent({ type: 'transcript.final', turnId: 't1', source: 'callee', text: 'もう　かけてこないでください' });
    aborted = hooks.signal.aborted; return {};
  });
  await w.tick(); await w.active?.promise;
  assert.equal(aborted, true);
  assert.equal(f.store.suppressed('one', PHONE), true);
  assert.equal(f.store.get('mission', m.id).status, 'DECLINED');
  const a = entry(f, 'contact.suppressed');
  assert.deepEqual({ source: a.detail.source, turn: a.detail.turn, mission: a.detail.mission }, { source: 'transcript', turn: 't1', mission: m.id });
  // A suppressed number cannot be approved again by anyone on the team.
  assert.throws(() => f.approve(f.draft(), 'two'), /recipient_suppressed/);
}));

// ---------------------------------------------------------------------------------------------- H2

test('requests are budgeted by kind', () => {
  assert.equal(limitClass('POST', '/hooks/twilio/consent/abc'), 'hook');
  assert.equal(limitClass('POST', '/v1/missions/452b7f13-f073-4972-b098-d5549c9aa40d/cancel'), 'control');
  assert.equal(limitClass('POST', '/v1/missions/452b7f13-f073-4972-b098-d5549c9aa40d/reconcile'), 'control');
  assert.equal(limitClass('POST', '/v1/suppressions'), 'control');
  assert.equal(limitClass('GET', '/healthz'), 'public');
  assert.equal(limitClass('GET', '/'), 'public');
  assert.equal(limitClass('POST', '/v1/missions/draft'), 'api');
  assert.equal(limitClass('POST', '/hooks/line'), 'api');
});

test('the client address comes from the proxy header only when the proxy is trusted', () => {
  const req = { socket: { remoteAddress: '172.18.0.3' }, headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' } };
  assert.equal(clientIp(req, false), '172.18.0.3');
  assert.equal(clientIp(req, true), '198.51.100.7'); // the entry the proxy itself appended
  assert.equal(clientIp({ socket: { remoteAddress: '172.18.0.3' }, headers: {} }, true), '172.18.0.3');
  assert.equal(clientIp({ socket: { remoteAddress: '172.18.0.3' }, headers: { 'x-forwarded-for': 'x'.repeat(200) } }, true), '172.18.0.3');
});

test('flooding public pages cannot make opt-out callbacks or "stop this call" answer 429', withFixture(async f => {
  const app = await createGateway(f.config, { store: f.store, execute: simulate, channels: quiet });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port, attacker = { 'x-forwarded-for': '203.0.113.9' };
  try {
    let last = 200;
    for (let i = 0; i <= RATE_LIMITS.public; i++) last = (await fetch(base + '/healthz', { headers: attacker })).status;
    assert.equal(last, 429);
    // Same address, other budgets: the carrier callback is judged on its signature, the cancel on its token.
    const hook = await fetch(base + '/hooks/twilio/consent/abc', { method: 'POST', headers: { ...attacker, 'content-type': 'application/x-www-form-urlencoded' }, body: 'Digits=2' });
    assert.equal(hook.status, 401);
    const m = f.approve(f.draft());
    const cancel = await fetch(`${base}/v1/missions/${m.id}/cancel`, { method: 'POST', headers: { ...attacker, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(cancel.status, 200);
    // Another client is untouched even for the flooded kind.
    assert.equal((await fetch(base + '/healthz', { headers: { 'x-forwarded-for': '198.51.100.7' } })).status, 200);
  } finally { await app.close(); }
}, { trustProxy: true }));

// ---------------------------------------------------------------------------------------------- H3

const ENV = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'twilio-secret', TWILIO_PHONE_NUMBER: '+815012345678', OATHRA_BUSINESS_NAME: 'Example', OATHRA_VOICE_MODEL: 'test', OPENAI_API_KEY: 'test' };
function signed(path, params) {
  const data = 'https://gateway.test' + path + Object.keys(params).sort().map(k => k + params[k]).join('');
  return { 'x-twilio-signature': createHmac('sha1', ENV.TWILIO_AUTH_TOKEN).update(data).digest('base64') };
}
const SID = 'CA' + 'b'.repeat(32);

test('"2" is honoured even when the gateway has forgotten the call', withFixture(f => {
  const phone = new Phone(f.service, ENV), m = f.approve(f.draft());
  f.store.setKey('optout', 'tok123', f.store.seal({ mission: m.id, owner: 'alice', team: 'one', phone: PHONE }), 3600_000);
  const path = '/hooks/twilio/consent/tok123', params = { AccountSid: ENV.TWILIO_ACCOUNT_SID, CallSid: SID, Digits: '2' };
  assert.equal(phone.callback(path, params, signed(path, params)), '<Response><Hangup/></Response>');
  assert.equal(f.store.suppressed('one', PHONE), true);
  const after = f.store.get('mission', m.id);
  assert.equal(after.optOut, true); assert.equal(after.carrierSid, SID);
  assert.equal(entry(f, 'contact.suppressed').detail.source, 'dtmf_without_session');
}));

test('without a session "1" just ends the call, and an unknown token is still rejected', withFixture(f => {
  const phone = new Phone(f.service, ENV), m = f.draft();
  f.store.setKey('optout', 'tok123', f.store.seal({ mission: m.id, owner: 'alice', team: 'one', phone: PHONE }), 3600_000);
  const path = '/hooks/twilio/consent/tok123', one = { AccountSid: ENV.TWILIO_ACCOUNT_SID, CallSid: SID, Digits: '1' };
  assert.equal(phone.callback(path, one, signed(path, one)), '<Response><Hangup/></Response>');
  assert.equal(f.store.suppressed('one', PHONE), false);
  const other = '/hooks/twilio/consent/nope', two = { AccountSid: ENV.TWILIO_ACCOUNT_SID, CallSid: SID, Digits: '2' };
  assert.throws(() => phone.callback(other, two, signed(other, two)), /unknown_call/);
  assert.throws(() => phone.callback(path, two, { 'x-twilio-signature': 'forged' }), /invalid_twilio_signature/);
}));

test('the opt-out record is written before the carrier is contacted', withFixture(async f => {
  const phone = new Phone(f.service, ENV), m = { ...f.draft(), maxSeconds: 60 };
  const original = globalThis.fetch; let sawRecord = null;
  // The dial request "times out": Twilio may well have placed the call, and the session is dropped.
  globalThis.fetch = async () => { sawRecord = f.store.db.prepare("SELECT COUNT(*) AS n FROM keys WHERE scope='optout'").get().n; throw new Error('timeout'); };
  try {
    await assert.rejects(phone.execute(m, { signal: new AbortController().signal, onEvent() {}, control: {} }), e => e.uncertain === true || /dial_request_outcome_unknown|runtime_error/.test(e.code ?? ''));
  } finally { globalThis.fetch = original; }
  assert.equal(sawRecord, 1);
  assert.equal(phone.sessions.size, 0);
  const row = f.store.db.prepare("SELECT key,value FROM keys WHERE scope='optout'").get();
  assert.equal(f.store.open(row.value).phone, PHONE);
  assert(!row.value.includes(PHONE)); // sealed, not plaintext
  const path = '/hooks/twilio/consent/' + row.key, params = { AccountSid: ENV.TWILIO_ACCOUNT_SID, CallSid: SID, Digits: '2' };
  phone.callback(path, params, signed(path, params));
  assert.equal(f.store.suppressed('one', PHONE), true);
}));

// ---------------------------------------------------------------------------------------------- H4

test('the audit trail reconstructs who approved which call, what happened, and survives deletion', withFixture(async f => {
  const m = f.approve(f.draft());
  const w = new Worker(f.service, quiet, simulate);
  await w.tick(); await w.active?.promise;
  const finished = f.store.get('mission', m.id);
  f.store.removeMission(finished);

  assert.deepEqual(actions(f).filter(a => /^(call|mission)\./.test(a)), ['mission.drafted', 'call.approved', 'call.dialing', 'call.result', 'mission.deleted']);
  const ref = f.store.phoneRef(PHONE);
  const approved = entry(f, 'call.approved');
  assert.equal(approved.owner, 'alice');
  assert.deepEqual({ mission: approved.detail.mission, target: approved.detail.target, via: approved.detail.via, revision: approved.detail.revision }, { mission: m.id, target: ref, via: 'api', revision: 1 });
  assert.equal(approved.detail.fingerprint, f.service.fingerprint({ ...finished, status: undefined }));
  assert.deepEqual({ status: entry(f, 'call.result').detail.status, verified: entry(f, 'call.result').detail.verified }, { status: 'INCOMPLETE', verified: ['material_send_allowed'] });
  // The mission, its transcript and events are gone; the tombstone still ties the person to the approval.
  assert.equal(f.store.get('mission', m.id), null);
  assert.deepEqual({ target: entry(f, 'mission.deleted').detail.target, status: entry(f, 'mission.deleted').detail.status, approvedAt: entry(f, 'mission.deleted').detail.approvedAt },
    { target: ref, status: 'INCOMPLETE', approvedAt: finished.approvedAt });
  // No raw phone number or transcript text anywhere in the audit table, sealed or not.
  const dump = JSON.stringify(f.store.audits({ limit: 500 }));
  assert(!dump.includes(PHONE)); assert(!dump.includes('資料を送ってください'));
}));

test('editing a draft is recorded as an edit, not as a phantom draft and deletion', withFixture(f => {
  const m = f.draft(), before = actions(f).length;
  f.service.edit(f.u, m.id, { request: '田中さんに資料送付の了承を取る' });
  assert.deepEqual(actions(f).slice(before), ['mission.edited']);
  assert.deepEqual(entry(f, 'mission.edited').detail, { mission: m.id, revision: 2, goal: 'meeting' }); // the goal is kept unless it is edited explicitly
}));

test('consent and policy rejections are recorded', withFixture(async f => {
  assert.equal(entry(f, 'consent.saved').detail.version, 'v1');
  const m = f.approve(f.draft());
  f.store.suppress('one', PHONE);
  const w = new Worker(f.service, quiet, async () => { throw new Error('must not dial'); });
  await w.tick();
  assert.equal(f.store.get('mission', m.id).status, 'FAILED');
  assert.equal(entry(f, 'call.policy_rejected').detail.error, 'recipient_suppressed');
  assert(!actions(f).includes('call.dialing'));
}));

test('only an administrator can read the audit trail, in pages', withFixture(async f => {
  f.approve(f.draft());
  const app = await createGateway(f.config, { store: f.store, execute: simulate, channels: quiet });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    assert.equal((await fetch(base + '/v1/audit')).status, 401);
    assert.equal((await fetch(base + '/v1/audit', { headers: { authorization: 'Bearer bob-token' } })).status, 403);
    const all = await (await fetch(base + '/v1/audit', { headers: { authorization: 'Bearer ' + token } })).json();
    assert(all.entries.some(e => e.action === 'call.approved' && e.detail.target === f.store.phoneRef(PHONE)));
    const page = await (await fetch(`${base}/v1/audit?after=${all.entries[0].seq}&limit=1`, { headers: { authorization: 'Bearer ' + token } })).json();
    assert.equal(page.entries.length, 1); assert.equal(page.entries[0].seq, all.entries[1].seq);
    assert.equal((await fetch(base + '/v1/audit?limit=9999', { headers: { authorization: 'Bearer ' + token } })).status, 400);
  } finally { await app.close(); }
}));

test('a database created before audit details existed is upgraded in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oathra-audit-')), path = join(dir, 'db'), key = randomBytes(32).toString('hex');
  try {
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,created INTEGER NOT NULL)');
    old.prepare('INSERT INTO audit(owner,action,subject,created) VALUES(?,?,?,?)').run('alice', 'call.approved', 'h', 1);
    old.close();
    const store = new Store(path, key);
    store.audit('alice', 'consent.saved', 'alice', { version: 'v1' });
    assert.deepEqual(store.audits().map(a => [a.action, a.detail]), [['call.approved', null], ['consent.saved', { version: 'v1' }]]);
    store.close();
    new Store(path, key).close(); // opening again must not try to add the column twice
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
